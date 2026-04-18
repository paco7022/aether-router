import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const HISTORY_LIMIT = 50;

type ContentPart = { type: "text"; text: string } | { type: string; [k: string]: unknown };
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

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: conversationId } = await params;

  // 1. Session auth — we use the *user-scoped* client to verify ownership
  // via RLS, then switch to the admin client only for inserts that need to
  // bypass RLS in downstream triggers.
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
  if (!userText.trim()) {
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

  // 4. Load conversation history (oldest first). Admin client bypasses RLS
  // but we filter by the authenticated user's id, so no data leak.
  const admin = createAdminClient();
  const { data: history } = await admin
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  // 5. Persist the user's message now. Saving before forwarding means if the
  // upstream call fails the user's text isn't lost and the retry can reuse
  // the same conversation without retyping.
  const normalizedUserContent: ContentPart =
    typeof userContent === "string"
      ? { type: "text", text: userContent }
      : Array.isArray(userContent) && userContent.length > 0
        ? (userContent[0] as ContentPart)
        : { type: "text", text: userText };

  const { data: userMsgRow, error: userMsgErr } = await admin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: normalizedUserContent as unknown as object,
    })
    .select("id, role, content, created_at")
    .single();

  if (userMsgErr || !userMsgRow) {
    return NextResponse.json({ error: userMsgErr?.message ?? "failed to save message" }, { status: 500 });
  }

  // 6. Build the OpenAI-style messages array we'll send to /v1/chat/completions.
  // System prompt first (if any), then prior turns, then the new user message.
  const forwardMessages: Array<{ role: string; content: string }> = [];
  if (conv.system_prompt) {
    forwardMessages.push({ role: "system", content: conv.system_prompt });
  }
  for (const h of history ?? []) {
    const text = extractText(h.content);
    if (text) forwardMessages.push({ role: h.role, content: text });
  }
  forwardMessages.push({ role: "user", content: userText });

  // 7. Call our own /v1/chat/completions internally with session auth.
  // The request carries the caller's Supabase session cookie so /v1
  // resolves the same user via validateSession() and applies all the
  // normal billing/rate-limit/premium logic as if the user hit the API
  // directly with a Bearer key.
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
    // /v1 returned JSON error — relay status + message, save error row.
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

  // 8. Stream back. We relay raw SSE chunks so the client sees standard
  // OpenAI-format deltas, while parsing a side copy to accumulate the
  // assistant text + final usage for persistence.
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
      // Envelope so the client can bind this stream to the persisted user row.
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
          // /v1 already billed, reserved/settled, and wrote usage_logs. We just
          // persist the assistant turn so the UI can replay the conversation.
          // Fetch the credits_charged from the most recent usage_log row for
          // this user to surface in the chat_messages row.
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
            // Prefer authoritative token counts from /v1 over our local parse.
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
