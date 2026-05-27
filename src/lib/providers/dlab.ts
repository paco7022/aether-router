import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// DLab's upstream (Anthropic via dlabkeys.com) emits extended-thinking tokens
// that count against `completion_tokens` but are NOT surfaced as content (the
// OpenAI-compatible response carries only role+content, no reasoning_content).
// With a low `max_tokens`, the hidden thinking consumes the whole budget before
// any answer is written, so the call returns `content: null` +
// `finish_reason: "length"` — an empty reply that still "spent" a generation.
// Measured empty-rate (Opus 4.6, 5 calls each, temp 0): max_tokens=30 → 5/5,
// 100 → 1/5, 300 → 2/5, 600 → 2/5, 1500 → 0/5. Raising `max_tokens` only lifts
// the ceiling — the model still stops at finish_reason=stop once done, so this
// never pads short answers; it just gives the thinking room to finish.
// Tunable via DLAB_MIN_MAX_TOKENS. See [[project_aether_premium_claude]].
const DLAB_MIN_MAX_TOKENS = Number(process.env.DLAB_MIN_MAX_TOKENS) || 2048;

// The floor cuts the empty-rate from ~100% (at tiny max_tokens) to ~0-10%, but
// thinking can occasionally still exhaust 2048. For NON-streaming calls we can
// detect that (content empty + finish_reason "length") and transparently retry
// with a doubled budget, up to this ceiling. Streaming can't be replayed, so it
// relies on the floor alone.
const DLAB_MAX_EMPTY_RETRIES = 2;
const DLAB_MAX_RETRY_TOKENS = 8192;

function jsonResponse(text: string, source: Response): Response {
  return new Response(text, {
    status: source.status,
    headers: { "content-type": source.headers.get("content-type") || "application/json" },
  });
}

function isEmptyLengthCapped(text: string): boolean {
  try {
    const choice = JSON.parse(text)?.choices?.[0];
    const content = choice?.message?.content;
    const empty = content == null || (typeof content === "string" && content.trim() === "");
    return empty && choice?.finish_reason === "length";
  } catch {
    return false;
  }
}

// DLab (db/): premium OpenAI-compatible reseller fronting Anthropic's
// Claude family at https://api.dlabkeys.com/v1. Billed as a premium
// provider (flat 1 credit + per-model premium_request_cost against the
// daily pool — same shape as h/, gm/, t/, an/, w/), but with one extra
// gate: each user must be flipped on individually via
// profiles.dlab_approved from the admin panel before they can route to
// db/ models. Gate is independent of plan tier so a free user that the
// admin has explicitly approved can use it.
export const dlabProvider: Provider = {
  name: "dlab",
  baseUrl: process.env.DLAB_BASE_URL || "https://api.dlabkeys.com/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.DLAB_API_KEY;
    if (!apiKey) {
      throw new Error("DLAB_API_KEY not configured");
    }

    // Floor max_tokens so hidden thinking can't starve the visible answer.
    // Only raises an explicitly-low ceiling; an unset or already-larger
    // max_tokens is left untouched.
    const floored: ProviderRequest =
      typeof request.max_tokens === "number" &&
      request.max_tokens < DLAB_MIN_MAX_TOKENS
        ? { ...request, max_tokens: DLAB_MIN_MAX_TOKENS }
        : request;

    // One POST with the existing 5xx-retry behaviour.
    const post = async (body: ProviderRequest): Promise<Response> => {
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
          body: JSON.stringify(body),
          signal,
        });
        if (res.ok || res.status < 500 || res.status === 503) {
          return res;
        }
        lastResponse = res;
      }
      return lastResponse!;
    };

    // Streaming responses can't be inspected/replayed — return the raw stream;
    // the floor is the only mitigation there.
    if (floored.stream === true) {
      return post(floored);
    }

    // Non-streaming: buffer and retry-on-empty with a doubled budget.
    let body = floored;
    let res = await post(body);
    for (let i = 0; i < DLAB_MAX_EMPTY_RETRIES; i++) {
      if (!res.ok) return res; // let the route surface upstream errors
      const text = await res.text();
      const currentMax =
        typeof body.max_tokens === "number" ? body.max_tokens : DLAB_MIN_MAX_TOKENS;
      if (isEmptyLengthCapped(text) && currentMax < DLAB_MAX_RETRY_TOKENS) {
        body = { ...body, max_tokens: Math.min(currentMax * 2, DLAB_MAX_RETRY_TOKENS) };
        res = await post(body);
        continue;
      }
      return jsonResponse(text, res); // body already consumed — rebuild it
    }
    if (!res.ok) return res;
    return jsonResponse(await res.text(), res);
  },
};
