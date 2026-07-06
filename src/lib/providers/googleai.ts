import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

// Google AI Studio (googleai / gk-): direct Google Generative Language API.
//
// We talk to the NATIVE Gemini endpoint (:generateContent /
// :streamGenerateContent) rather than Google's OpenAI-compat endpoint because
// the OpenAI-compat layer REJECTS `safetySettings` ("Unknown name", 400) — and
// turning the content filters all the way down is the whole point here (RP /
// SillyTavern traffic gets blocked otherwise). The native endpoint takes
// safetySettings as a first-class field. This file adapts our internal
// OpenAI-shape requests/responses to/from Gemini's native format so the rest of
// the router (completions/route.ts stream parser, usage extraction) is unchanged.
//
// Also disables "thinking" (thinkingConfig.thinkingBudget = 0): Gemini 3.x Flash
// reason by default, and on the tiny free-tier output budget that silently eats
// the answer (empty content + finish "length"). Off = predictable, cheaper.
//
// KEY POOL: only Flash-class models are free on Google's API (every Pro model
// returns `limit: 0` = paid-only). Free quota is per-ACCOUNT (~1500 req/day) and
// more keys from the same account do NOT add quota — the multiplier is distinct
// accounts. GOOGLEAI_API_KEY holds a comma-separated pool of keys from different
// accounts; on a per-key 429 (RESOURCE_EXHAUSTED) or 403 we fail over to another
// key on retry, aggregating N accounts' free quotas.
//
// Billed as a premium provider (flat premium_request_cost per model), paid users
// only — upstream is $0 on the free tier but we don't expose it as unlimited.

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const GEMINI_BASE =
  process.env.GOOGLEAI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta";
const STREAM_STALL_MS =
  Number(process.env.GOOGLEAI_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;
// Gemini Flash output ceiling default when the caller doesn't specify.
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// Content filters all the way down. OFF (the true off-switch, validated on
// 2.5/3/3.1 Flash) skips classification entirely on every settable category.
const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" },
];

interface GeminiPart {
  text?: string;
  thought?: boolean;
  [key: string]: unknown;
}
interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  safetySettings: typeof SAFETY_SETTINGS;
  generationConfig: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    thinkingConfig?: { thinkingBudget: number };
  };
}
interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
  index?: number;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsage;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
  responseId?: string;
}

function mapFinishReason(fr: string | null | undefined): string {
  switch (fr) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return "content_filter";
    default:
      return "stop";
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function openAIToGemini(req: ProviderRequest): GeminiRequestBody {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  const pushTurn = (role: "user" | "model", text: string) => {
    const last = contents[contents.length - 1];
    // Merge consecutive same-role turns (Gemini prefers alternation).
    if (last && last.role === role) {
      const lp = last.parts[last.parts.length - 1];
      if (lp && typeof lp.text === "string") lp.text += "\n\n" + text;
      else last.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  };

  for (const m of req.messages || []) {
    const text = stringifyContent(m.content);
    if (m.role === "system") {
      if (!text) continue;
      // Leading system (before any turn) → top-level systemInstruction.
      // Mid-conversation system messages (SillyTavern depth injections /
      // jailbreaks / formatting presets) stay in place as an inline user turn —
      // hoisting them can make the model ignore them (same lesson as the Orbit
      // adapter). systemInstruction is authoritative, so keep it for the lead.
      if (contents.length === 0) systemParts.push(text);
      else pushTurn("user", text);
      continue;
    }
    if (m.role === "user") pushTurn("user", text);
    else if (m.role === "assistant") pushTurn("model", text);
    // tool/function roles dropped in v1 (parity with other providers here).
  }

  // Gemini requires the first content to be role "user".
  if (contents.length === 0 || contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "" }] });
  }

  const requested =
    (typeof req.max_tokens === "number" && req.max_tokens > 0
      ? req.max_tokens
      : undefined) ??
    (typeof (req as Record<string, unknown>).max_completion_tokens === "number"
      ? ((req as Record<string, unknown>).max_completion_tokens as number)
      : undefined);

  const generationConfig: GeminiRequestBody["generationConfig"] = {
    maxOutputTokens: requested && requested > 0 ? requested : DEFAULT_MAX_OUTPUT_TOKENS,
    // Disable thinking by default so it doesn't consume the answer budget.
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (typeof req.temperature === "number") generationConfig.temperature = req.temperature;
  const topP = (req as Record<string, unknown>).top_p;
  if (typeof topP === "number") generationConfig.topP = topP;
  const topK = (req as Record<string, unknown>).top_k;
  if (typeof topK === "number") generationConfig.topK = topK;
  const stop = (req as Record<string, unknown>).stop;
  if (typeof stop === "string") generationConfig.stopSequences = [stop];
  else if (Array.isArray(stop))
    generationConfig.stopSequences = stop.filter((s): s is string => typeof s === "string");

  const body: GeminiRequestBody = {
    contents,
    safetySettings: SAFETY_SETTINGS,
    generationConfig,
  };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  }
  return body;
}

function extractText(parts: GeminiPart[] | undefined): { text: string; thought: string } {
  let text = "";
  let thought = "";
  for (const p of parts || []) {
    if (typeof p.text !== "string" || !p.text) continue;
    if (p.thought === true) thought += p.text;
    else text += p.text;
  }
  return { text, thought };
}

function geminiToOpenAINonStream(g: GeminiResponse, model: string) {
  const cand = g.candidates?.[0];
  const { text } = extractText(cand?.content?.parts);
  const input = Number(g.usageMetadata?.promptTokenCount) || 0;
  const output = Number(g.usageMetadata?.candidatesTokenCount) || 0;
  const finish = cand
    ? mapFinishReason(cand.finishReason)
    : g.promptFeedback?.blockReason
      ? "content_filter"
      : "stop";
  return {
    id: g.responseId || `googleai-${Date.now()}`,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model: g.modelVersion || model,
    choices: [
      { index: 0, message: { role: "assistant" as const, content: text }, finish_reason: finish },
    ],
    usage: {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: input + output,
    },
  };
}

// Gemini native SSE (alt=sse) emits `data: {candidates,...}` blocks separated by
// blank lines, with NO [DONE] sentinel. Translate each into OpenAI chat.chunk
// shape, roll up usage/finish, and synthesize the trailing [DONE].
function makeGeminiToOpenAIStreamTransform(model: string): TransformStream<Uint8Array, Uint8Array> {
  const id = `googleai-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let finalFinish: string | null = null;
  let roleSent = false;
  let doneSent = false;

  function emit(c: TransformStreamDefaultController<Uint8Array>, payload: unknown) {
    c.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }
  function emitDone(c: TransformStreamDefaultController<Uint8Array>) {
    if (doneSent) return;
    doneSent = true;
    // Final usage + finish roll-up, then the sentinel.
    emit(c, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: finalFinish ?? "stop" }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
    c.enqueue(encoder.encode("data: [DONE]\n\n"));
  }

  function handle(dataStr: string, c: TransformStreamDefaultController<Uint8Array>) {
    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(dataStr) as GeminiResponse;
    } catch {
      return;
    }
    if (parsed.usageMetadata) {
      promptTokens = Number(parsed.usageMetadata.promptTokenCount) || promptTokens;
      completionTokens = Number(parsed.usageMetadata.candidatesTokenCount) || completionTokens;
    }
    const cand = parsed.candidates?.[0];
    if (!roleSent) {
      emit(c, {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      });
      roleSent = true;
    }
    const { text, thought } = extractText(cand?.content?.parts);
    if (thought) {
      emit(c, {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { reasoning_content: thought }, finish_reason: null }],
      });
    }
    if (text) {
      emit(c, {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      });
    }
    if (cand?.finishReason) finalFinish = mapFinishReason(cand.finishReason);
  }

  function flush(chunkText: string, c: TransformStreamDefaultController<Uint8Array>) {
    buffer += chunkText;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of block.split("\n")) {
        const t = line.trim();
        if (t.startsWith("data:")) handle(t.slice(5).trim(), c);
      }
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      flush(decoder.decode(chunk, { stream: true }), controller);
    },
    flush(controller) {
      flush(decoder.decode(), controller);
      // Handle a trailing block with no blank-line terminator.
      const rest = buffer.trim();
      if (rest.startsWith("data:")) handle(rest.slice(5).trim(), controller);
      buffer = "";
      emitDone(controller);
    },
  });
}

// GOOGLEAI_API_KEY: single key or comma-separated pool. Trailing \r\n trimmed
// (PS-set secrets sometimes carry them → 401). Empty entries dropped.
function getKeys(): string[] {
  return (process.env.GOOGLEAI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const googleaiProvider: Provider = {
  name: "googleai",
  baseUrl: GEMINI_BASE,

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getKeys();
    if (keys.length === 0) {
      throw new Error("GOOGLEAI_API_KEY not configured");
    }
    const keyOrder = shuffled(keys);
    const wantStream = request.stream === true;
    const model = request.model;
    const geminiBody = openAIToGemini(request);
    const endpoint = wantStream ? "streamGenerateContent?alt=sse" : "generateContent";

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
      const apiKey = keyOrder[attempt % keyOrder.length];
      const keyTag = apiKey.slice(0, 8);

      const upstream = await fetch(`${this.baseUrl}/models/${model}:${endpoint}`, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: wantStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(geminiBody),
        signal,
      });

      if (!upstream.ok) {
        // Per-key free-tier quota exhausted (429), key suspended (403), or
        // transient 5xx (≠503) → fail over to the next key. Others return as-is
        // so the route surfaces + refunds them.
        if (
          upstream.status === 429 ||
          upstream.status === 403 ||
          (upstream.status >= 500 && upstream.status !== 503)
        ) {
          console.warn(
            `[googleai] key ${keyTag}… attempt ${attempt + 1}/${MAX_RETRIES + 1} → ${upstream.status}; failing over to next key`
          );
          lastResponse = upstream;
          continue;
        }
        return upstream;
      }

      if (wantStream) {
        if (!upstream.body) {
          return new Response(
            JSON.stringify({ error: { message: "Empty stream body from upstream", type: "server_error" } }),
            { status: 502, headers: { "content-type": "application/json" } }
          );
        }
        const transformed = upstream.body.pipeThrough(makeGeminiToOpenAIStreamTransform(model));
        return new Response(guardSseStall(transformed, STREAM_STALL_MS), {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      const gJson = (await upstream.json()) as GeminiResponse;
      const openAi = geminiToOpenAINonStream(gJson, model);
      return new Response(JSON.stringify(openAi), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return lastResponse!;
  },
};
