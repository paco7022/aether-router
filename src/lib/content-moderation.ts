// CSAM detection via OpenAI Moderations API.
//
// We only enforce the `sexual/minors` category. Other categories (violence,
// self-harm, hate) are explicitly NOT blocked because legitimate users
// discuss them with the assistant and false-positives there would damage
// the service. CSAM is a hard line: legally we must not route it, period.
//
// Failure mode: fails OPEN. If OpenAI is down, our key is invalid, or the
// network call times out, we let the request through and log the error.
// Rationale — a transient upstream outage shouldn't take the entire router
// offline. The window is short and most CSAM attempts will hit on a working
// call. The DB-level audit row is the system of record on detection.

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Primary moderation backend. Defaults to Hapuppy's beta host, which resells
// OpenAI's omni-moderation model for free and returns the OpenAI-compatible
// shape (categories + category_scores). OpenAI direct is an automatic fallback
// (also free, but low-tier orgs get 429-throttled — that's exactly what took
// this gate offline on 2026-05-14).
// NOTE: use the `beta.` host — `api.hapuppy.com/v1/moderations` returns 401.
const MODERATION_DEFAULT_BASE_URL = "https://beta.hapuppy.com/v1";
const MODERATION_MODEL = "omni-moderation-latest";
const FETCH_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const CACHE_MAX_ENTRIES = 5_000;

const FLAG_CATEGORIES = new Set(["sexual/minors"]);

type CacheEntry = { flagged: boolean; expiresAt: number };

// Process-local. Survives across requests within a warm server isolate
// container; resets on cold start. Repeated identical prompts within a
// container short-circuit the moderation call.
const cache = new Map<string, CacheEntry>();

function cachePrune() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type ModerationMessage = {
  role: string;
  content: unknown;
};

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const obj = p as { type?: string; text?: unknown };
          if (obj.type === "text" && typeof obj.text === "string") return obj.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const obj = content as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

// Moderate user-authored content only. assistant messages came from the
// upstream model; including them would re-flag our own output. system
// messages ARE user-authored (callers pass arbitrary system prompts) so
// they're included.
export function extractUserAuthoredText(messages: ModerationMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (!m || typeof m.role !== "string") continue;
    if (m.role !== "user" && m.role !== "system") continue;
    const text = extractTextFromContent(m.content).trim();
    if (text) out.push(text);
  }
  return out;
}

export type FlaggedItem = {
  hash: string;
  categories: string[];
  scores: Record<string, number>;
};

export type ModerationResult = {
  flagged: boolean;
  flaggedItems: FlaggedItem[];
  // True when the moderator was unreachable. Caller still proceeds (fail-open)
  // but should log this for monitoring.
  serviceError: boolean;
};

type OpenAIModerationResponse = {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
};

type ModerationBackend = { name: string; url: string; apiKey: string };

// Ordered list of moderation backends. The first one that returns a non-error
// response wins. Hapuppy (free, OpenAI-compatible) is primary; OpenAI direct
// is the fallback. Configurable via MODERATION_BASE_URL / MODERATION_API_KEY.
function getModerationBackends(): ModerationBackend[] {
  const backends: ModerationBackend[] = [];

  const base = (process.env.MODERATION_BASE_URL || MODERATION_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const primaryKey = process.env.MODERATION_API_KEY || process.env.HAPUPPY_API_KEY;
  if (primaryKey) {
    backends.push({ name: "hapuppy", url: `${base}/moderations`, apiKey: primaryKey });
  }

  if (process.env.OPENAI_API_KEY) {
    backends.push({
      name: "openai",
      url: "https://api.openai.com/v1/moderations",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return backends;
}

// Single moderation call against one backend. Returns the parsed response, or
// null on any error (non-2xx, timeout, network) so the caller can try the next
// backend and ultimately fail open.
async function fetchModeration(
  backend: ModerationBackend,
  texts: string[],
): Promise<OpenAIModerationResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(backend.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODERATION_MODEL, input: texts }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`Moderation [${backend.name}] ${resp.status}: ${errText}`);
      return null;
    }

    return (await resp.json()) as OpenAIModerationResponse;
  } catch (err) {
    console.error(`Moderation [${backend.name}] fetch failed:`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function moderateMessages(messages: ModerationMessage[]): Promise<ModerationResult> {
  const texts = extractUserAuthoredText(messages);
  if (texts.length === 0) {
    return { flagged: false, flaggedItems: [], serviceError: false };
  }

  const backends = getModerationBackends();
  if (backends.length === 0) {
    console.error(
      "Moderation skipped: no backend configured (set MODERATION_API_KEY / HAPUPPY_API_KEY or OPENAI_API_KEY)",
    );
    return { flagged: false, flaggedItems: [], serviceError: true };
  }

  const hashes = texts.map(hashText);
  const now = Date.now();
  const inputs: Array<{ text: string; hash: string }> = [];
  const flaggedItems: FlaggedItem[] = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = cache.get(hashes[i]);
    if (cached && cached.expiresAt > now) {
      if (cached.flagged) {
        flaggedItems.push({ hash: hashes[i], categories: ["cached"], scores: {} });
      }
      continue;
    }
    inputs.push({ text: texts[i], hash: hashes[i] });
  }

  // Cache says flagged on every input → no network call needed.
  if (flaggedItems.length > 0 && inputs.length === 0) {
    return { flagged: true, flaggedItems, serviceError: false };
  }

  let serviceError = false;

  if (inputs.length > 0) {
    // Try each backend in order; first non-error response wins. If all fail,
    // serviceError stays true and we fail open (logged above per backend).
    let data: OpenAIModerationResponse | null = null;
    for (const backend of backends) {
      data = await fetchModeration(backend, inputs.map((x) => x.text));
      if (data) break;
    }

    if (!data) {
      serviceError = true;
    } else {
      const results = Array.isArray(data.results) ? data.results : [];
      for (let i = 0; i < inputs.length; i++) {
        const r = results[i];
        if (!r) continue;

        const cats = r.categories ?? {};
        const scores = r.category_scores ?? {};
        const triggered: string[] = [];
        for (const [name, hit] of Object.entries(cats)) {
          if (hit && FLAG_CATEGORIES.has(name)) triggered.push(name);
        }

        const isFlagged = triggered.length > 0;
        cache.set(inputs[i].hash, {
          flagged: isFlagged,
          expiresAt: now + CACHE_TTL_MS,
        });

        if (isFlagged) {
          flaggedItems.push({
            hash: inputs[i].hash,
            categories: triggered,
            scores,
          });
        }
      }
    }
    cachePrune();
  }

  return { flagged: flaggedItems.length > 0, flaggedItems, serviceError };
}

// Permanent termination on confirmed CSAM hit.
//
// We never persist the offending text — only the SHA-256, the categories
// that fired, and the calibrated scores. The hash is enough for repeat
// detection and for handing over to law enforcement on a court order.
//
// All steps run with the service-role client. Failures are logged but the
// caller still returns the 403 either way; the csam_incidents audit row
// is the source of truth and an admin can re-run the ban manually.
export async function recordCsamIncidentAndBan(options: {
  userId: string;
  source: "api" | "chat";
  flaggedItems: FlaggedItem[];
}): Promise<void> {
  const supabase = createAdminClient();

  for (const item of options.flaggedItems) {
    const { error: insErr } = await supabase.from("csam_incidents").insert({
      user_id: options.userId,
      content_hash: item.hash,
      categories: item.categories,
      category_scores: item.scores,
      source: options.source,
    });
    if (insErr) {
      console.error("Failed to insert csam_incident:", insErr.message);
    }
  }

  // Profile-level: clear protection + revoke activation. is_protected=false
  // makes the account eligible for the existing anti-abuse triggers if it
  // ever tries to come back via fingerprint reuse.
  const { error: profErr } = await supabase
    .from("profiles")
    .update({ is_protected: false, is_activated: false })
    .eq("id", options.userId);
  if (profErr) {
    console.error("Failed to update profile after CSAM detection:", profErr.message);
  }

  // auth.users banned_until is what Supabase actually checks at the auth
  // layer, blocking new sessions. ~100 years = effectively permanent.
  const { error: authErr } = await supabase.auth.admin.updateUserById(options.userId, {
    ban_duration: "876000h",
  });
  if (authErr) {
    console.error("Failed to ban auth user after CSAM detection:", authErr.message);
  }

  // Disable every API key — including custom keys — owned by the user.
  const { error: keyErr } = await supabase
    .from("api_keys")
    .update({ is_active: false, note: "Auto-disabled: AUP violation" })
    .eq("user_id", options.userId);
  if (keyErr) {
    console.error("Failed to disable api_keys after CSAM detection:", keyErr.message);
  }
}

export const CSAM_BLOCK_MESSAGE =
  "This message violates our acceptable use policy. The account has been suspended. Contact support if you believe this is in error.";
