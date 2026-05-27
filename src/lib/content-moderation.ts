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
// 2s was too tight for Hapuppy's proxy (it aborted mid-call → fail open). 5s
// gives it room while still bounding the request hot path.
const FETCH_TIMEOUT_MS = 5_000;
// Hapuppy caps the TOTAL chars per /moderations request at ~32,768 — verified:
// 32k array total OK, 40k total = 400, regardless of per-item size. So we both
// (a) split any single text into <=MAX_BATCH_CHARS chunks and (b) pack chunks
// into requests whose combined length stays under MAX_BATCH_CHARS. Chunking
// also stops CSAM from being hidden past a truncation cutoff.
const MAX_BATCH_CHARS = 30_000;
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
  // The flagged fragment itself. Kept so the review queue can show a human
  // exactly what tripped the moderator (the ban path only ever needs the hash).
  text: string;
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
  const flaggedItems: FlaggedItem[] = [];

  // Build the moderation batch. Each uncached text is split into chunks of
  // <=MAX_INPUT_CHARS; every chunk is moderated and mapped back to its parent
  // text so a verdict covers the whole message, not just the first 30k chars.
  const chunks: Array<{ text: string; parent: number }> = [];
  const chunkCount: Record<number, number> = {};
  const uncachedIdx: number[] = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = cache.get(hashes[i]);
    if (cached && cached.expiresAt > now) {
      if (cached.flagged) {
        flaggedItems.push({ hash: hashes[i], text: texts[i], categories: ["cached"], scores: {} });
      }
      continue;
    }
    uncachedIdx.push(i);
    chunkCount[i] = 0;
    for (let off = 0; off < texts[i].length; off += MAX_BATCH_CHARS) {
      chunks.push({ text: texts[i].slice(off, off + MAX_BATCH_CHARS), parent: i });
      chunkCount[i]++;
    }
  }

  // Cache says flagged on every input → no network call needed.
  if (flaggedItems.length > 0 && chunks.length === 0) {
    return { flagged: true, flaggedItems, serviceError: false };
  }

  let serviceError = false;

  if (chunks.length > 0) {
    // Pack chunks into batches whose combined length stays under the per-request
    // total-char limit; one HTTP call per batch. Most requests are a single
    // batch (small new message; history is cached); only a huge uncached char
    // card spills into a second batch.
    const batches: number[][] = [];
    let cur: number[] = [];
    let curLen = 0;
    for (let i = 0; i < chunks.length; i++) {
      const len = chunks[i].text.length;
      if (cur.length > 0 && curLen + len > MAX_BATCH_CHARS) {
        batches.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(i);
      curLen += len;
    }
    if (cur.length > 0) batches.push(cur);

    type ModItem = NonNullable<OpenAIModerationResponse["results"]>[number];
    const chunkResults: Array<ModItem | undefined> = new Array(chunks.length);

    for (const batch of batches) {
      const texts = batch.map((idx) => chunks[idx].text);
      // Try each backend in order; first non-error response wins.
      let data: OpenAIModerationResponse | null = null;
      for (const backend of backends) {
        data = await fetchModeration(backend, texts);
        if (data) break;
      }
      // Any batch we can't verify means we can't clear the message → fail open.
      if (!data) {
        serviceError = true;
        break;
      }
      const rs = Array.isArray(data.results) ? data.results : [];
      for (let j = 0; j < batch.length; j++) chunkResults[batch[j]] = rs[j];
    }

    if (!serviceError) {
      // Aggregate chunk verdicts back to their parent text.
      const seen = new Map<number, number>(); // parent -> chunks that returned
      const cats = new Map<number, Set<string>>();
      const scores = new Map<number, Record<string, number>>();

      for (let i = 0; i < chunks.length; i++) {
        const r = chunkResults[i];
        if (!r) continue;
        const parent = chunks[i].parent;
        seen.set(parent, (seen.get(parent) ?? 0) + 1);
        for (const [name, hit] of Object.entries(r.categories ?? {})) {
          if (!hit || !FLAG_CATEGORIES.has(name)) continue;
          if (!cats.has(parent)) {
            cats.set(parent, new Set());
            scores.set(parent, {});
          }
          cats.get(parent)!.add(name);
          const sc = scores.get(parent)!;
          sc[name] = Math.max(sc[name] ?? 0, (r.category_scores ?? {})[name] ?? 0);
        }
      }

      for (const i of uncachedIdx) {
        // Only finalize (and cache) a verdict if every chunk came back — a
        // partial response shouldn't let a message be cached as "clean".
        if ((seen.get(i) ?? 0) !== chunkCount[i]) continue;

        const triggered = cats.get(i);
        const isFlagged = !!triggered && triggered.size > 0;
        cache.set(hashes[i], { flagged: isFlagged, expiresAt: now + CACHE_TTL_MS });

        if (isFlagged) {
          flaggedItems.push({
            hash: hashes[i],
            text: texts[i],
            categories: [...triggered!],
            scores: scores.get(i) ?? {},
          });
        }
      }
    }
    cachePrune();
  }

  return { flagged: flaggedItems.length > 0, flaggedItems, serviceError };
}

// Max chars we persist per review row. The whole point is to give a human the
// context, but we still bound it so one giant char card can't bloat a row.
const REVIEW_FLAGGED_TEXT_MAX = 40_000;
const REVIEW_CONTEXT_MAX = 80_000;

// Build a bounded, plain-text copy of the conversation for the reviewer. We
// keep role + text only (no images/tool payloads) and truncate so a huge
// prompt can't blow up the row.
function buildReviewContext(messages: ModerationMessage[]): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  let budget = REVIEW_CONTEXT_MAX;
  for (const m of messages) {
    if (!m || typeof m.role !== "string") continue;
    if (budget <= 0) break;
    let text = extractTextFromContent(m.content);
    if (!text) continue;
    if (text.length > budget) text = text.slice(0, budget) + "…[truncated]";
    budget -= text.length;
    out.push({ role: m.role, content: text });
  }
  return out;
}

// Queue a flagged message for MANUAL review. This replaced the old auto-ban:
// a flag no longer bans, blocks, or disables keys — it just records the
// flagged text + surrounding context here for an admin to action or dismiss.
//
// Stores one row per (user, exact flagged fragment); the unique index makes a
// repeat of the same fragment a no-op so a chatty user can't flood the queue.
// Runs on the service-role client; failures are logged but never propagate —
// queuing is best-effort and must not affect the user's request.
export async function recordModerationReview(options: {
  userId: string;
  source: "api" | "chat";
  flaggedItems: FlaggedItem[];
  messages: ModerationMessage[];
}): Promise<void> {
  if (options.flaggedItems.length === 0) return;
  const supabase = createAdminClient();

  // Merge categories/scores across all flagged fragments of this request.
  const categories = new Set<string>();
  const scores: Record<string, number> = {};
  const fragments: string[] = [];
  for (const item of options.flaggedItems) {
    for (const c of item.categories) if (c !== "cached") categories.add(c);
    for (const [k, v] of Object.entries(item.scores)) scores[k] = Math.max(scores[k] ?? 0, v);
    if (item.text) fragments.push(item.text);
  }

  let flaggedText = fragments.join("\n---\n");
  if (flaggedText.length > REVIEW_FLAGGED_TEXT_MAX) {
    flaggedText = flaggedText.slice(0, REVIEW_FLAGGED_TEXT_MAX) + "…[truncated]";
  }

  const { error } = await supabase.from("moderation_reviews").upsert(
    {
      user_id: options.userId,
      content_hash: options.flaggedItems[0].hash,
      flagged_text: flaggedText,
      context: buildReviewContext(options.messages),
      categories: [...categories],
      category_scores: scores,
      source: options.source,
      status: "pending",
    },
    { onConflict: "user_id,content_hash", ignoreDuplicates: true },
  );
  if (error) {
    console.error("Failed to queue moderation review:", error.message);
  }
}

// Permanent termination — invoked by an admin from the review queue once a
// flag is CONFIRMED a real violation (not automatically anymore).
//
// We never persist the offending text in csam_incidents — only the SHA-256,
// the categories, and the calibrated scores. The hash is enough for repeat
// detection and for handing over to law enforcement on a court order. (The
// reviewed text lives in moderation_reviews until the row is cleaned up.)
//
// All steps run with the service-role client. Failures are logged but do not
// throw; the csam_incidents audit row is the source of truth.
export async function banUserForViolation(options: {
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
    console.error("Failed to update profile after violation:", profErr.message);
  }

  // auth.users banned_until is what Supabase actually checks at the auth
  // layer, blocking new sessions. ~100 years = effectively permanent.
  const { error: authErr } = await supabase.auth.admin.updateUserById(options.userId, {
    ban_duration: "876000h",
  });
  if (authErr) {
    console.error("Failed to ban auth user after violation:", authErr.message);
  }

  // Disable every API key — including custom keys — owned by the user.
  const { error: keyErr } = await supabase
    .from("api_keys")
    .update({ is_active: false, note: "Disabled: AUP violation" })
    .eq("user_id", options.userId);
  if (keyErr) {
    console.error("Failed to disable api_keys after violation:", keyErr.message);
  }
}
