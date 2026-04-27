"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseMessage, type Artifact } from "@/lib/chat/artifacts";
import { MessageContent } from "@/components/chat/MessageContent";
import { ArtifactsPanel } from "@/components/chat/ArtifactsPanel";

type ConversationSummary = {
  id: string;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
};

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; storage_path?: string }
  | { type: string; [k: string]: unknown };

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: unknown;
  model_id?: string | null;
  error?: string | null;
  created_at: string;
};

type Model = {
  id: string;
  display_name: string;
  provider: string;
  capabilities: string[];
};

type Attachment = {
  // tmp id used only client-side for removal
  tmpId: string;
  path: string;          // storage path: {user}/{conv|unattached}/{uuid}.{ext}
  mime: string;
  size: number;
  signed_url: string;    // short-lived preview URL
};

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "type" in p && (p as { type: string }).type === "text"
          ? ((p as { text?: string }).text ?? "")
          : ""
      )
      .join("");
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: unknown }).text ?? "");
  }
  return "";
}

function extractImages(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const urls: string[] = [];
  for (const p of content as ContentPart[]) {
    if (p && typeof p === "object" && p.type === "image_url") {
      const url = (p as { image_url?: { url?: string } }).image_url?.url;
      if (typeof url === "string" && url) urls.push(url);
    }
  }
  return urls;
}

export default function ChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const lastArtifactCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModelInfo = models.find((m) => m.id === selectedModel);
  const supportsVision = (selectedModelInfo?.capabilities ?? []).includes("vision");

  // Parse every assistant message + the live streaming text into segments
  // and artifacts. Re-parsed on every render — cheap (regex over text we
  // already render) and avoids duplicating state.
  const parsedByMsgId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseMessage>>();
    for (const m of messages) {
      if (m.role === "assistant") {
        map.set(m.id, parseMessage(m.id, extractText(m.content)));
      }
    }
    if (streaming) {
      map.set("__streaming__", parseMessage("__streaming__", streamingText));
    }
    return map;
  }, [messages, streaming, streamingText]);

  const allArtifacts = useMemo<Artifact[]>(() => {
    const out: Artifact[] = [];
    // Iterate in message order so the panel sidebar reads top-to-bottom.
    for (const m of messages) {
      const parsed = parsedByMsgId.get(m.id);
      if (parsed) out.push(...parsed.artifacts);
    }
    const streamingParsed = parsedByMsgId.get("__streaming__");
    if (streamingParsed) out.push(...streamingParsed.artifacts);
    return out;
  }, [messages, parsedByMsgId]);

  const artifactsById = useMemo(() => {
    const map = new Map<string, Artifact>();
    for (const a of allArtifacts) map.set(a.id, a);
    return map;
  }, [allArtifacts]);

  // Auto-open the panel when a new artifact appears, selecting the latest.
  // We don't reopen if the user has already closed and no new artifacts
  // arrived — track count via ref.
  useEffect(() => {
    const prev = lastArtifactCountRef.current;
    if (allArtifacts.length > prev) {
      const latest = allArtifacts[allArtifacts.length - 1];
      setActiveArtifactId(latest.id);
      setPanelOpen(true);
    }
    lastArtifactCountRef.current = allArtifacts.length;
  }, [allArtifacts]);

  // Reset panel + artifact selection when switching conversations.
  useEffect(() => {
    setActiveArtifactId(null);
    setPanelOpen(false);
    lastArtifactCountRef.current = 0;
  }, [activeId]);

  const openArtifact = useCallback((id: string) => {
    setActiveArtifactId(id);
    setPanelOpen(true);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("models")
        .select("id, display_name, provider, capabilities")
        .eq("is_active", true)
        .order("id");
      const list = (data ?? []) as Model[];
      setModels(list);
      if (!selectedModel && list.length > 0) {
        const preferred =
          list.find((m) => m.id === "gemini-2.5-flash-nothinking") ||
          list.find((m) => m.id === "gemini-2.5-flash") ||
          list[0];
        setSelectedModel(preferred.id);
      }
    })();
    loadConversations();
  }, []);

  async function loadConversations() {
    const res = await fetch("/api/dashboard/chat/conversations", {
      headers: { "X-Requested-With": "AetherRouter" },
    });
    if (!res.ok) return;
    const json = await res.json();
    setConversations(json.conversations ?? []);
  }

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/chat/conversations/${id}`, {
        headers: { "X-Requested-With": "AetherRouter" },
      });
      if (!res.ok) throw new Error("failed to load");
      const json = await res.json();
      setMessages(json.messages ?? []);
      setSelectedModel(json.conversation?.model_id ?? selectedModel);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedModel]);

  async function newConversation() {
    if (!selectedModel) return;
    const res = await fetch("/api/dashboard/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
      body: JSON.stringify({ model_id: selectedModel, title: "New chat" }),
    });
    if (!res.ok) {
      setError("Failed to create conversation");
      return;
    }
    const json = await res.json();
    await loadConversations();
    setActiveId(json.conversation.id);
    setMessages([]);
    setAttachments([]);
  }

  async function deleteConversation(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/dashboard/chat/conversations/${id}`, {
      method: "DELETE",
      headers: { "X-Requested-With": "AetherRouter" },
    });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
      setAttachments([]);
    }
    loadConversations();
  }

  async function changeModel(modelId: string) {
    setSelectedModel(modelId);
    if (activeId) {
      await fetch(`/api/dashboard/chat/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({ model_id: modelId }),
      });
      loadConversations();
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        if (activeId) form.append("conversation_id", activeId);
        const res = await fetch("/api/dashboard/chat/upload", {
          method: "POST",
          headers: { "X-Requested-With": "AetherRouter" },
          body: form,
        });
        if (!res.ok) {
          const { error: msg } = await res.json().catch(() => ({ error: "upload failed" }));
          setError(msg || "upload failed");
          continue;
        }
        const json = (await res.json()) as Omit<Attachment, "tmpId">;
        setAttachments((xs) => [
          ...xs,
          { ...json, tmpId: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
        ]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(tmpId: string) {
    setAttachments((xs) => xs.filter((a) => a.tmpId !== tmpId));
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;

    let convId = activeId;
    // Auto-create conversation on first message
    if (!convId) {
      const res = await fetch("/api/dashboard/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({
          model_id: selectedModel,
          title: (text || "Image chat").slice(0, 60),
        }),
      });
      if (!res.ok) {
        setError("Failed to create conversation");
        return;
      }
      const json = await res.json();
      convId = json.conversation.id;
      setActiveId(convId);
      await loadConversations();
    }

    // Build the multimodal content array.
    // Use the `storage:{path}` sentinel so the server never receives a frozen
    // signed URL; the server inlines as data URL when forwarding.
    const parts: ContentPart[] = [];
    if (text) parts.push({ type: "text", text });
    for (const a of attachments) {
      parts.push({
        type: "image_url",
        image_url: { url: `storage:${a.path}` },
      });
    }
    const outgoingContent: string | ContentPart[] = attachments.length > 0 ? parts : text;

    // Optimistic user bubble — show the local preview URL instead of the
    // `storage:` sentinel so the thumbnail renders immediately.
    const optimisticParts: ContentPart[] = [];
    if (text) optimisticParts.push({ type: "text", text });
    for (const a of attachments) {
      optimisticParts.push({ type: "image_url", image_url: { url: a.signed_url } });
    }
    const optimisticUserMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: attachments.length > 0 ? optimisticParts : text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUserMsg]);

    setInput("");
    setError(null);
    setStreaming(true);
    setStreamingText("");
    setAttachments([]);

    try {
      const res = await fetch(`/api/dashboard/chat/conversations/${convId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({ content: outgoingContent }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text();
        let msg = "Request failed";
        try { msg = JSON.parse(errText).error ?? msg; } catch {}
        setError(msg);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let blockIdx: number;
        while ((blockIdx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, blockIdx);
          buffer = buffer.slice(blockIdx + 2);

          let ev = "message";
          let dataLine = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine || dataLine === "[DONE]") continue;
          if (ev === "meta" || ev === "done") continue;

          try {
            const parsed = JSON.parse(dataLine) as {
              choices?: Array<{ delta?: { content?: unknown } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              assembled += delta;
              setStreamingText(assembled);
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }

      await loadConversation(convId!);
      await loadConversations();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  const activeConversation = conversations.find((c) => c.id === activeId);

  return (
    <div className="h-[calc(100vh-10rem)] flex gap-4">
      {/* Conversation list */}
      <aside
        className="w-64 shrink-0 glass-card shimmer-line p-3 flex flex-col overflow-hidden"
      >
        <button
          onClick={newConversation}
          className="mb-3 w-full rounded-xl px-3 py-2 text-sm font-medium transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(34, 211, 238, 0.1))",
            border: "1px solid rgba(139, 92, 246, 0.22)",
            color: "rgba(230, 230, 255, 0.95)",
          }}
        >
          + New chat
        </button>

        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {conversations.length === 0 && (
            <p className="text-xs text-[var(--text-dim)] px-2 py-6 text-center">
              No conversations yet
            </p>
          )}
          {conversations.map((c) => {
            const active = c.id === activeId;
            return (
              <div
                key={c.id}
                onClick={() => loadConversation(c.id)}
                className={`group cursor-pointer rounded-lg px-3 py-2 text-sm flex items-start gap-2 transition-colors ${
                  active ? "text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
                style={active ? {
                  background: "rgba(139, 92, 246, 0.12)",
                  border: "1px solid rgba(139, 92, 246, 0.18)",
                } : {
                  border: "1px solid transparent",
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate">{c.title}</p>
                  <p className="text-[10px] text-[var(--text-dim)] font-mono mt-0.5 truncate">
                    {c.model_id}
                  </p>
                </div>
                <button
                  onClick={(ev) => deleteConversation(c.id, ev)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-dim)] hover:text-red-400 shrink-0"
                  aria-label="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Chat pane */}
      <section className={`glass-card shimmer-line flex flex-col overflow-hidden ${panelOpen && allArtifacts.length > 0 ? "flex-1 min-w-0" : "flex-1"}`}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white/90 truncate">
              {activeConversation?.title || "New chat"}
            </h2>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mt-0.5">
              In-app chat · billed in credits
              {supportsVision && " · vision"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!panelOpen && allArtifacts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPanelOpen(true);
                  if (!activeArtifactId) setActiveArtifactId(allArtifacts[allArtifacts.length - 1].id);
                }}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                style={{
                  background: "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(34, 211, 238, 0.1))",
                  border: "1px solid rgba(139, 92, 246, 0.25)",
                  color: "rgba(230, 230, 255, 0.95)",
                }}
                title="Show artifacts"
              >
                {allArtifacts.length} artifact{allArtifacts.length === 1 ? "" : "s"} →
              </button>
            )}
            <select
              value={selectedModel}
              onChange={(e) => changeModel(e.target.value)}
              className="rounded-lg px-3 py-1.5 text-xs font-mono bg-black/30 text-white/80 border border-white/10 outline-none focus:border-violet-400/40"
            >
              {models.map((m) => {
                const hasVision = (m.capabilities ?? []).includes("vision");
                return (
                  <option key={m.id} value={m.id} className="bg-slate-900">
                    {hasVision ? "👁 " : ""}{m.id}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {loadingMessages && (
            <p className="text-xs text-[var(--text-dim)] text-center py-6">Loading…</p>
          )}

          {!loadingMessages && messages.length === 0 && !streaming && (
            <div className="text-center py-16">
              <div
                className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(34, 211, 238, 0.1))",
                  border: "1px solid rgba(139, 92, 246, 0.15)",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-200/70">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-white/70 mb-1">Start a conversation</p>
              <p className="text-xs text-[var(--text-dim)] max-w-xs mx-auto">
                Ask anything. Attach images on vision-capable models (👁).
              </p>
            </div>
          )}

          {messages.map((m) => {
            const parsed = m.role === "assistant" ? parsedByMsgId.get(m.id) : null;
            return (
              <MessageBubble
                key={m.id}
                role={m.role}
                text={extractText(m.content)}
                images={extractImages(m.content)}
                error={m.error ?? null}
                segments={parsed?.segments ?? null}
                artifactsById={artifactsById}
                activeArtifactId={activeArtifactId}
                onOpenArtifact={openArtifact}
              />
            );
          })}

          {streaming && (
            <MessageBubble
              role="assistant"
              text={streamingText}
              images={[]}
              pulsing
              segments={parsedByMsgId.get("__streaming__")?.segments ?? null}
              artifactsById={artifactsById}
              activeArtifactId={activeArtifactId}
              onOpenArtifact={openArtifact}
            />
          )}
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.04] p-4">
          {error && (
            <div className="mb-2 rounded-lg px-3 py-2 text-xs text-red-300"
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}>
              {error}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mb-2 flex gap-2 flex-wrap">
              {attachments.map((a) => (
                <div
                  key={a.tmpId}
                  className="relative group rounded-lg overflow-hidden"
                  style={{
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    background: "rgba(0, 0, 0, 0.3)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.signed_url} alt="attachment" className="w-16 h-16 object-cover" />
                  <button
                    onClick={() => removeAttachment(a.tmpId)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.9)" }}
                    aria-label="Remove attachment"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {attachments.length > 0 && !supportsVision && (
            <p className="mb-2 text-[11px] text-amber-300/80">
              ⚠ {selectedModel} doesn&apos;t support vision — switch to a 👁 model or remove images.
            </p>
          )}

          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || uploading}
              className="rounded-xl px-3 py-2 text-sm transition-all disabled:opacity-40"
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "rgba(200, 200, 240, 0.9)",
              }}
              title="Attach image"
              aria-label="Attach image"
            >
              {uploading ? "…" : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={2}
              placeholder="Message the model… (Enter to send, Shift+Enter for newline)"
              className="flex-1 resize-none rounded-xl px-3 py-2 text-sm bg-black/30 text-white/90 border border-white/10 outline-none focus:border-violet-400/40"
              disabled={streaming}
            />
            <button
              onClick={sendMessage}
              disabled={streaming || (!input.trim() && attachments.length === 0)}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:opacity-40"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(34, 211, 238, 0.15))",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                color: "rgba(230, 230, 255, 0.95)",
              }}
            >
              {streaming ? "…" : "Send"}
            </button>
          </div>
        </div>
      </section>

      {/* Artifacts side panel */}
      {panelOpen && allArtifacts.length > 0 && (
        <ArtifactsPanel
          artifacts={allArtifacts}
          activeId={activeArtifactId}
          onSelect={setActiveArtifactId}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

function MessageBubble({
  role,
  text,
  images,
  error,
  pulsing,
  segments,
  artifactsById,
  activeArtifactId,
  onOpenArtifact,
}: {
  role: "user" | "assistant" | "system";
  text: string;
  images: string[];
  error?: string | null;
  pulsing?: boolean;
  segments?: import("@/lib/chat/artifacts").Segment[] | null;
  artifactsById?: Map<string, Artifact>;
  activeArtifactId?: string | null;
  onOpenArtifact?: (id: string) => void;
}) {
  const isUser = role === "user";
  const hasArtifact = (segments ?? []).some((s) => s.kind === "artifact-ref");
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-2xl px-4 py-3 text-sm ${pulsing ? "animate-pulse" : ""} ${hasArtifact ? "max-w-[92%]" : "max-w-[80%]"}`}
        style={{
          background: isUser
            ? "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(217, 70, 239, 0.1))"
            : "rgba(255, 255, 255, 0.03)",
          border: `1px solid ${isUser ? "rgba(139, 92, 246, 0.2)" : "rgba(255, 255, 255, 0.06)"}`,
          color: "rgba(240, 240, 255, 0.92)",
        }}
      >
        {images.length > 0 && (
          <div className="mb-2 flex gap-2 flex-wrap">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${i}-${src.slice(0, 40)}`}
                src={src}
                alt="attachment"
                className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                style={{ border: "1px solid rgba(255, 255, 255, 0.08)" }}
              />
            ))}
          </div>
        )}
        {error ? (
          <p className="text-red-300 text-xs">⚠ {error}</p>
        ) : segments && artifactsById && onOpenArtifact ? (
          <MessageContent
            segments={segments}
            artifactsById={artifactsById}
            activeArtifactId={activeArtifactId ?? null}
            onOpenArtifact={onOpenArtifact}
          />
        ) : (
          <div className="leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>
            {text || (pulsing ? "…" : "")}
          </div>
        )}
      </div>
    </div>
  );
}
