import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// blazeapi.org (bl/): premium OpenAI-compatible reseller fronting a mixed
// catalog (Anthropic Claude Opus 4.5–4.8 + Sonnet 4.6/5, Google Gemini 3.1 Pro,
// z.ai GLM-5.2, plus -thinking reasoning variants) via
// https://api.blazeapi.org/paid/v1. Billed as a premium provider — flat 1
// credit per request + per-model premium_request_cost against the daily
// premium pool.
//
// GOTCHAS (verified 2026-07-13):
//   - The upstream INFLATES input tokens heavily on Claude (injects its own
//     system prompt: ~1.3k prompt_tokens for a trivial "2+2"). Harmless for us
//     since premium-pool billing is per-request via premium_request_cost, not
//     per-token — but do not trust the reported usage for anything.
//   - The key carries an upstream per-day TOKEN quota (blaze_token_limit, e.g.
//     2M/day on the "starter" plan reported in usage.blaze_tokens_remaining).
//     When exhausted the upstream will start erroring; watch for it.
//   - "-thinking" variants return reasoning in a separate `reasoning_content`
//     field (streamed as reasoning deltas) — same shape the dashboard already
//     renders. Models flagged with the `reasoning` capability.
//   - Individual models can report {"error":{"type":"upstream_error"}} /
//     "temporarily unavailable" independent of our key (seen on Gemini).
//
// ISOLATED KEY: lives in its own env var (BLAZE_API_KEY), never folded into a
// shared pool. Comma-separated pool is supported (pick one at random per
// request); trailing whitespace/newlines are trimmed — PS-set secrets
// sometimes carry \r\n.
function getBlazeKeys(): string[] {
  return (process.env.BLAZE_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Claude single-user flatten (anti-"content-blocked" 400 workaround)
// ---------------------------------------------------------------------------
// Reseller Claude routes often run their own moderation classifier that keys
// off the multi-turn user/assistant/tool structure. In continued RP chats it
// starts returning HTTP 400 {"error":{"code":"content-blocked"}} even when the
// same content passed earlier. Collapsing the whole conversation into ONE user
// message (and dropping tool scaffolding) reliably dodges that classifier while
// keeping the full transcript visible to Claude.
//
// Only applied to Claude models. Requests that carry real tools / tool_calls
// (agentic / Claude Code flows) are left UNTOUCHED — those need the structured
// format and rarely hit the RP moderation path.
//
// Mode via BLAZE_CLAUDE_SINGLE_USER:
//   "on-block" (default, also the unset value) — send the request normally and
//       ONLY flatten as a one-shot retry when the upstream answers with a
//       content-blocked 400. Keeps full role/system structure (better quality)
//       for the majority of requests that pass, degrading format only when the
//       moderation classifier actually fires.
//   "always" / "1" / "force" — pre-flatten every Claude request (blunter but
//       predictable).
//   "0" / "false" / "off" — disabled; raw pass-through.
type FlattenMode = "off" | "always" | "on-block";
function flattenMode(): FlattenMode {
  const v = (process.env.BLAZE_CLAUDE_SINGLE_USER || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return "off";
  if (v === "always" || v === "1" || v === "force") return "always";
  return "on-block";
}

// Whether flattening is even eligible for this request (Claude, no tools).
function flattenApplicable(request: ProviderRequest): boolean {
  return isClaude(request.model) && !hasToolUsage(request);
}

// Detect the upstream moderation refusal so we can retry flattened. Known
// shapes: HTTP 400 {"error":{"code":"content-blocked"}} / content_filter.
export function isContentBlock(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /content[-_ ]?block|content_filter|agent_router_api_error/i.test(body);
}

function isClaude(model: unknown): boolean {
  return typeof model === "string" && model.toLowerCase().includes("claude");
}

// OpenAI message content can be a plain string or an array of parts
// ({type:"text",text:"..."} / image parts). Pull out the text; ignore the rest.
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// True if the request depends on structured tool use — leave those alone.
export function hasToolUsage(request: ProviderRequest): boolean {
  const r = request as Record<string, unknown>;
  if (Array.isArray(r.tools) && r.tools.length > 0) return true;
  if (r.tool_choice && r.tool_choice !== "none" && r.tool_choice !== "auto") return true;
  const msgs = Array.isArray(request.messages) ? request.messages : [];
  return msgs.some((m) => {
    const mm = m as unknown as Record<string, unknown>;
    return (
      mm.role === "tool" ||
      (Array.isArray(mm.tool_calls) && mm.tool_calls.length > 0)
    );
  });
}

// Collapse system + full dialogue into a single user message. System blocks go
// verbatim at the top (they are instructions); the running dialogue keeps light
// Human:/Assistant: tags so Claude still tracks turn ownership.
export function flattenClaudeRequest(request: ProviderRequest): ProviderRequest {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const systemParts: string[] = [];
  const dialogueParts: string[] = [];

  for (const m of messages) {
    const text = extractText((m as { content?: unknown }).content).trim();
    if (!text) continue;
    if (m.role === "system") {
      systemParts.push(text);
    } else if (m.role === "assistant") {
      dialogueParts.push(`Assistant: ${text}`);
    } else {
      dialogueParts.push(`Human: ${text}`);
    }
  }

  const merged = [systemParts.join("\n\n"), dialogueParts.join("\n\n")]
    .filter(Boolean)
    .join("\n\n");

  // Strip tool scaffolding so the flattened turn is a clean single-user request.
  const { tools: _tools, tool_choice: _toolChoice, ...rest } =
    request as Record<string, unknown>;

  return {
    ...(rest as ProviderRequest),
    messages: [{ role: "user", content: merged }],
  };
}


// Max time a stream may go with NO real content before we give up.
const STREAM_STALL_MS =
  Number(process.env.BLAZE_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;

export const blazeProvider: Provider = {
  name: "blaze",
  baseUrl: process.env.BLAZE_BASE_URL || "https://api.blazeapi.org/paid/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getBlazeKeys();
    if (keys.length === 0) {
      throw new Error("BLAZE_API_KEY not configured");
    }
    const apiKey = keys[Math.floor(Math.random() * keys.length)];

    const mode = flattenMode();
    const canFlatten = mode !== "off" && flattenApplicable(request);
    // In "always" mode we pre-flatten; in "on-block" we start with the raw
    // request and only flatten once, as a retry, if the upstream blocks it.
    let outbound =
      mode === "always" && canFlatten ? flattenClaudeRequest(request) : request;
    let flattenedAlready = outbound !== request;

    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(outbound),
        signal,
      });

      if (res.ok) {
        if (request.stream === true && res.body) {
          return new Response(guardSseStall(res.body, STREAM_STALL_MS), {
            status: 200,
            headers: {
              "content-type":
                res.headers.get("content-type") || "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          });
        }
        return res;
      }

      // Non-2xx below. For a content-blocked 400 we can retry ONCE with the
      // conversation flattened into a single user message. Buffer the body so
      // we can both inspect it and still return it verbatim if we don't retry.
      if (res.status < 500 || res.status === 503) {
        if (canFlatten && !flattenedAlready && res.status === 400) {
          const bodyText = await res.text();
          if (isContentBlock(res.status, bodyText)) {
            outbound = flattenClaudeRequest(request);
            flattenedAlready = true;
            continue; // immediate retry with the flattened payload
          }
          return new Response(bodyText, {
            status: res.status,
            headers: res.headers,
          });
        }
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
