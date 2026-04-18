"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ConversationSummary = {
  id: string;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
};

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

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "type" in p && (p as { type: string }).type === "text" ? ((p as { text?: string }).text ?? "") : ""))
      .join("");
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: unknown }).text ?? "");
  }
  return "";
}

/** Minimal markdown-ish renderer: preserves whitespace, highlights fenced code blocks. */
function renderContent(raw: string): React.ReactElement {
  const parts: React.ReactElement[] = [];
  const fence = /```([\w-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = fence.exec(raw)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={`t${idx++}`} style={{ whiteSpace: "pre-wrap" }}>
          {raw.slice(last, m.index)}
        </span>
      );
    }
    parts.push(
      <pre
        key={`c${idx++}`}
        className="my-2 rounded-lg p-3 text-xs overflow-x-auto font-mono"
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <code className="text-cyan-200/90">{m[2]}</code>
      </pre>
    );
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    parts.push(
      <span key={`t${idx++}`} style={{ whiteSpace: "pre-wrap" }}>
        {raw.slice(last)}
      </span>
    );
  }
  return <>{parts}</>;
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
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    const res = await fetch("/api/dashboard/chat/conversations");
    if (!res.ok) return;
    const json = await res.json();
    setConversations(json.conversations ?? []);
  }

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/chat/conversations/${id}`);
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
      headers: { "Content-Type": "application/json" },
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
  }

  async function deleteConversation(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/dashboard/chat/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    loadConversations();
  }

  async function changeModel(modelId: string) {
    setSelectedModel(modelId);
    if (activeId) {
      await fetch(`/api/dashboard/chat/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      });
      loadConversations();
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    let convId = activeId;
    // Auto-create conversation on first message
    if (!convId) {
      const res = await fetch("/api/dashboard/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: selectedModel,
          title: text.slice(0, 60),
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

    setInput("");
    setError(null);
    setStreaming(true);
    setStreamingText("");

    // Optimistic user bubble
    const optimisticUserMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUserMsg]);

    try {
      const res = await fetch(`/api/dashboard/chat/conversations/${convId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
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

        // Parse SSE events: blocks separated by \n\n
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

          if (ev === "meta" || ev === "done") {
            // metadata events — we just ignore the body here; final UI refresh
            // happens after stream ends
            continue;
          }

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

      // Reload messages to replace optimistic rows with persisted ones
      await loadConversation(convId!);
      await loadConversations();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  // Auto-scroll to bottom when messages or streaming text change
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
      <section className="flex-1 glass-card shimmer-line flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white/90 truncate">
              {activeConversation?.title || "New chat"}
            </h2>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mt-0.5">
              In-app chat · billed in credits
            </p>
          </div>
          <select
            value={selectedModel}
            onChange={(e) => changeModel(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-mono bg-black/30 text-white/80 border border-white/10 outline-none focus:border-violet-400/40"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900">
                {m.id}
              </option>
            ))}
          </select>
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
                Ask anything. Uses your credits at normal model rates.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} text={extractText(m.content)} error={m.error ?? null} />
          ))}

          {streaming && (
            <MessageBubble role="assistant" text={streamingText} pulsing />
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
          <div className="flex gap-2 items-end">
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
              disabled={streaming || !input.trim()}
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
    </div>
  );
}

function MessageBubble({
  role,
  text,
  error,
  pulsing,
}: {
  role: "user" | "assistant" | "system";
  text: string;
  error?: string | null;
  pulsing?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${pulsing ? "animate-pulse" : ""}`}
        style={{
          background: isUser
            ? "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(217, 70, 239, 0.1))"
            : "rgba(255, 255, 255, 0.03)",
          border: `1px solid ${isUser ? "rgba(139, 92, 246, 0.2)" : "rgba(255, 255, 255, 0.06)"}`,
          color: "rgba(240, 240, 255, 0.92)",
        }}
      >
        {error ? (
          <p className="text-red-300 text-xs">⚠ {error}</p>
        ) : (
          <div className="leading-relaxed">{renderContent(text || (pulsing ? "…" : ""))}</div>
        )}
      </div>
    </div>
  );
}
