import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const HISTORY_LIMIT = 50;
const STORAGE_PREFIX = "storage:";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: string; [k: string]: unknown };

type StoredContent = string | ContentPart[];

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

function hasImage(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (p) => p && typeof p === "object" && (p as { type?: string }).type === "image_url"
  );
}

/**
 * Normalize user-provided content into the JSONB shape we persist:
 *   - strings → stored verbatim as strings (cheaper for text-only history)
 *   - arrays → parts are kept as-is; image_url paths stay as `storage:{path}`
 *     so signed URLs aren't frozen into the DB
 */
function normalizeForStorage(content: StoredContent): StoredContent {
  if (typeof content === "string") return content;
  return (content as ContentPart[]).map((p) => {
    if (p && typeof p === "object" && p.type === "image_url") {
      const url = (p as { image_url?: { url?: string }; storage_path?: string }).image_url?.url;
      const storagePath = (p as { storage_path?: string }).storage_path;
      // Prefer an explicit storage_path if present; otherwise accept an
      // already-prefixed URL. Never persist raw signed URLs — they expire.
      const path = storagePath || (typeof url === "string" && url.startsWith(STORAGE_PREFIX) ? url.slice(STORAGE_PREFIX.length) : null);
      if (path) {
        return { type: "image_url", image_url: { url: `${STORAGE_PREFIX}${path}` } } as ContentPart;
      }
    }
    return p;
  });
}

/**
 * Convert any `storage:{path}` image references into inline data URLs by
 * downloading the bytes through the service-role client. Returns a plain
 * string when the content is text-only (keeps prompts small for history).
 */
async function inlineForForward(
  admin: ReturnType<typeof createAdminClient>,
  content: unknown
): Promise<string | ContentPart[]> {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return extractText(content);

  const hasAnyImage = hasImage(content);
  if (!hasAnyImage) return extractText(content);

  const out: ContentPart[] = [];
  for (const p of content as ContentPart[]) {
    if (p && p.type === "image_url") {
      const url = (p as { image_url?: { url?: string } }).image_url?.url;
      if (typeof url === "string" && url.startsWith(STORAGE_PREFIX)) {
        const path = url.slice(STORAGE_PREFIX.length);
        const { data, error } = await admin.storage.from("chat-uploads").download(path);
        if (error || !data) {
          console.error("chat-uploads download failed:", path, error?.message);
          continue;
        }
        const buf = Buffer.from(await data.arrayBuffer());
        const mime = data.type || "image/png";
        out.push({ type: "image_url", image_url: { url: `data:${mime};base64,${buf.toString("base64")}` } });
        continue;
      }
      // If the URL is already a data/http URL, pass through.
      if (typeof url === "string") {
        out.push({ type: "image_url", image_url: { url } });
        continue;
      }
    } else if (p && p.type === "text") {
      out.push(p);
    }
  }
  return out;
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: conversationId } = await params;

  // 1. Session auth
  const userSb = await createServerSupabase();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: { content?: StoredContent };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const userContent = body.content;
  const userText = extractText(userContent);
  const imagesPresent = hasImage(userContent);
  if (!userText.trim() && !imagesPresent) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  // 3. Load conversation (ownership enforced by RLS on userSb)
  const { data: conv } = await userSb
    .from("chat_conversations")
    .select("id, user_id, model_id, system_prompt")
    .eq("id", conversationId)
    .single();

  if (!conv) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }

  // 4. Load history — note we pull content as-is (with storage: sentinels)
  // because we're going to inline them for the upstream forward.
  const admin = createAdminClient();
  const { data: history } = await admin
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  // 5. Persist the user's message (storage-safe form — never frozen signed URLs)
  const storedUserContent = normalizeForStorage(userContent ?? "");
  const { data: userMsgRow, error: userMsgErr } = await admin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: storedUserContent as unknown as object,
    })
    .select("id, role, content, created_at")
    .single();

  if (userMsgErr || !userMsgRow) {
    return NextResponse.json({ error: userMsgErr?.message ?? "failed to save message" }, { status: 500 });
  }

  // 6. Build forwarded messages. For each historical message, if it contains
  // images they're inlined as data URLs — no signed URL leakage to upstream.
  const forwardMessages: Array<{ role: string; content: string | ContentPart[] }> = [];
  if (conv.system_prompt) {
    forwardMessages.push({ role: "system", content: conv.system_prompt });
  }
  for (const h of history ?? []) {
    const inlined = await inlineForForward(admin, h.content);
    if ((typeof inlined === "string" && inlined) || (Array.isArray(inlined) && inlined.length > 0)) {
      forwardMessages.push({ role: h.role, content: inlined });
    }
  }
  const newInlined = await inlineForForward(admin, userContent ?? "");
  forwardMessages.push({ role: "user", content: newInlined });

  // 7. Forward to /v1/chat/completions with session cookie (same billing path)
  const origin = req.nextUrl.origin;
  const cookieHeader = req.headers.get("cookie") ?? "";

  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({
        model: conv.model_id,
        messages: forwardMessages,
        stream: true,
      }),
    });
  } catch (e) {
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: { type: "text", text: "" },
      model_id: conv.model_id,
      error: (e as Error).message,
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  if (!upstream.ok) {
    const errJson: { error?: { message?: string } } = await upstream.json().catch(() => ({}));
    const msg = errJson.error?.message || `upstream ${upstream.status}`;
    await admin.from("chat_messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: { type: "text", text: "" },
      model_id: conv.model_id,
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: upstream.status });
  }

  if (!upstream.body) {
    return NextResponse.json({ error: "no upstream body" }, { status: 502 });
  }

  // 8. Stream back, accumulate assistant text, persist on flush
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let completionText = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let creditsCharged: number | null = null;
  let errorDuringStream: string | null = null;

  const reader = upstream.body.getReader();

  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({
            user_message_id: userMsgRow.id,
            conversation_id: conversationId,
            model_id: conv.model_id,
          })}\n\n`
        )
      );

      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);

          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload) as {
                usage?: { prompt_tokens?: number; completion_tokens?: number };
                choices?: Array<{ delta?: { content?: unknown } }>;
              };
              if (parsed.usage) {
                promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
                completionTokens = parsed.usage.completion_tokens ?? completionTokens;
              }
              const delta = parsed.choices?.[0]?.delta?.content;
              if (typeof delta === "string") completionText += delta;
            } catch {
              // ignore non-JSON lines
            }
          }
        }
      } catch (e) {
        errorDuringStream = (e as Error).message;
        console.error("Chat stream relay error:", e);
      } finally {
        try {
          const { data: lastUsage } = await admin
            .from("usage_logs")
            .select("credits_charged, prompt_tokens, completion_tokens")
            .eq("user_id", user!.id)
            .eq("source", "chat")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastUsage) {
            creditsCharged = lastUsage.credits_charged;
            promptTokens = lastUsage.prompt_tokens ?? promptTokens;
            completionTokens = lastUsage.completion_tokens ?? completionTokens;
          }

          const { data: assistantRow } = await admin
            .from("chat_messages")
            .insert({
              conversation_id: conversationId,
              user_id: user!.id,
              role: "assistant",
              content: { type: "text", text: completionText },
              model_id: conv.model_id,
              prompt_tokens: promptTokens || null,
              completion_tokens: completionTokens || null,
              credits_charged: creditsCharged,
              error: errorDuringStream,
            })
            .select("id")
            .single();

          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                assistant_message_id: assistantRow?.id ?? null,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                credits_charged: creditsCharged,
              })}\n\n`
            )
          );
        } catch (e) {
          console.error("Chat stream finalize error:", e);
        } finally {
          controller.close();
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
