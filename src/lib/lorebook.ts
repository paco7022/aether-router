// ============================================================
// Lorebook engine — SillyTavern World Info, adapted to a stateless proxy.
//
// A lorebook is a list of entries; each entry carries keywords and a chunk
// of text. Before every generation we scan the tail of the incoming chat,
// activate the entries whose keywords appear (plus the always-on ones), and
// inject their content at a chosen position. It is the same assembly the
// preset engine already does, with conditional activation on top — so this
// module only decides WHICH entries fire and in what order; `preset.ts`
// does the actual message assembly (and resolves macros in the content).
//
// What we deliberately cannot do, because a proxy request carries no chat
// identity and no character card:
//   * cooldown       — needs to remember when an entry last fired.
//   * vectorized     — needs embeddings of the chat.
//   * character/tag filters, automation ids, generation-type triggers,
//     persona/description matching — need card data we never receive.
// These fields are parsed (so a round-trip import/export keeps them) and
// ignored at activation. `delay` IS exact (the client sends the whole
// history) and `sticky` is approximated by widening the scan window.
//
// v1 does not support regex keys: they would run untrusted patterns on the
// hot path (ReDoS). Regex-shaped keys are dropped at import and counted.
// ============================================================

export const MAX_LOREBOOK_BYTES = 256 * 1024;
export const MAX_ENTRY_CONTENT = 16 * 1024;
export const MAX_ENTRIES = 500;
export const MAX_ACTIVE_LOREBOOKS = 3;
export const MAX_LOREBOOK_NAME_LEN = 120;

export type LorebookPosition =
  | "before" // top of the system preamble (ST: before char defs / EM top)
  | "after" // end of the preamble, just before the chat (ST: after char defs)
  | "an_top" // after the history, before the preset's post-history prompts
  | "an_bottom" // after the history, after the preset's post-history prompts
  | "depth" // in-chat at N messages from the end, with a role
  | "outlet"; // placed by a {{outlet::name}} macro in a preset prompt

export type LorebookLogic = "and_any" | "not_all" | "not_any" | "and_all";

export interface LorebookEntry {
  id: string;
  name: string;
  keys: string[];
  secondary_keys: string[];
  logic: LorebookLogic;
  content: string;
  enabled: boolean;
  constant: boolean;
  position: LorebookPosition;
  order: number;
  // position "depth"
  depth?: number;
  role?: "system" | "user" | "assistant";
  // position "outlet"
  outlet?: string;
  probability?: number; // 0-100, default 100
  // inclusion group: when several activated entries share a group, one wins
  group?: string;
  group_weight?: number; // default 100
  group_override?: boolean; // highest order wins instead of weighted random
  group_scoring?: boolean; // most matched keys wins before weighting
  // per-entry overrides of the book settings
  scan_depth?: number;
  case_sensitive?: boolean;
  match_whole_words?: boolean;
  // recursion
  exclude_recursion?: boolean; // can't be activated by other entries
  prevent_recursion?: boolean; // its content can't activate others
  delay_until_recursion?: boolean; // only activates in recursive passes
  // timed effects
  sticky?: number; // approximated: widens the scan window by N messages
  delay?: number; // needs at least N messages in the chat
  cooldown?: number; // parsed, not applied (stateless)
}

export interface LorebookSettings {
  scan_depth: number; // messages scanned back from the end
  recursion_steps: number; // extra passes; 0 = no recursion
  budget_tokens: number; // hard cap on injected lore
  case_sensitive: boolean;
  match_whole_words: boolean;
}

export interface Lorebook {
  version: 1;
  name: string;
  settings: LorebookSettings;
  entries: LorebookEntry[];
}

/** A saved library row (user_lorebooks). Declared here so client components
 *  can import the type without pulling in the server-only helpers. */
export interface LorebookRow {
  id: string;
  name: string;
  book: Lorebook;
  is_active: boolean;
  updated_at: string;
}

export function defaultLorebookSettings(): LorebookSettings {
  return {
    scan_depth: 4,
    recursion_steps: 1,
    budget_tokens: 1500,
    case_sensitive: false,
    match_whole_words: true,
  };
}

export function emptyLorebook(name = "My Lorebook"): Lorebook {
  return { version: 1, name, settings: defaultLorebookSettings(), entries: [] };
}

// ------------------------------------------------------------------
// Import
// ------------------------------------------------------------------

const ST_POSITION: Record<number, LorebookPosition> = {
  0: "before", // before char defs
  1: "after", // after char defs
  2: "an_top",
  3: "an_bottom",
  4: "depth",
  5: "before", // example messages top — we have no example block
  6: "after", // example messages bottom
  7: "outlet",
};

const ST_LOGIC: Record<number, LorebookLogic> = {
  0: "and_any",
  1: "not_all",
  2: "not_any",
  3: "and_all",
};

const ST_ROLE: Record<number, "system" | "user" | "assistant"> = {
  0: "system",
  1: "user",
  2: "assistant",
};

/** Keys like `/foo|bar/i` are regex in SillyTavern. We don't run user regex
 *  on the hot path, so they're dropped (and reported) at import. */
export function isRegexKey(key: string): boolean {
  return /^\/.*\/[a-z]*$/i.test(key.trim());
}

function toKeyList(raw: unknown): string[] {
  const list: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    for (const part of isRegexKey(v) ? [v] : v.split(",")) {
      const k = part.trim();
      if (k) list.push(k.slice(0, 200));
    }
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else push(raw);
  return list.slice(0, 100);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function optNum(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export interface LorebookImportReport {
  book: Lorebook;
  /** Keys dropped because they were regex (unsupported in v1). */
  regexKeysDropped: number;
  /** Entries dropped because they had no content or no way to ever fire. */
  entriesSkipped: number;
}

/**
 * Accepts the three shapes users actually have:
 *   1. a SillyTavern World Info export  — { name?, entries: { "0": {...} } }
 *   2. a V2 character card book         — { entries: [ { keys, content, ... } ] },
 *      either standalone or inside card.data.character_book / card.character_book
 *   3. one of our own exports           — validateLorebook() passes it through
 */
export function parseLorebook(json: unknown, fallbackName = "Imported Lorebook"): LorebookImportReport {
  if (!json || typeof json !== "object") throw new Error("Not an object");

  if (validateLorebook(json)) {
    return { book: json, regexKeysDropped: 0, entriesSkipped: 0 };
  }

  const root = json as Record<string, unknown>;
  const card = (root.data ?? root) as Record<string, unknown>;
  const src = (card.character_book ?? root) as Record<string, unknown>;

  const rawEntries: Array<Record<string, unknown>> = Array.isArray(src.entries)
    ? (src.entries as Array<Record<string, unknown>>)
    : src.entries && typeof src.entries === "object"
    ? Object.values(src.entries as Record<string, Record<string, unknown>>)
    : [];

  if (rawEntries.length === 0) {
    throw new Error(
      "No lorebook entries found in this file — is it a World Info export or a character card?"
    );
  }

  let regexKeysDropped = 0;
  let entriesSkipped = 0;
  const entries: LorebookEntry[] = [];

  rawEntries.forEach((e, i) => {
    if (entries.length >= MAX_ENTRIES) return;

    const content = typeof e.content === "string" ? e.content : "";
    if (!content.trim()) {
      entriesSkipped++;
      return;
    }

    // ST uses key/keysecondary; V2 cards use keys/secondary_keys.
    const rawKeys = toKeyList(e.key ?? e.keys);
    const rawSecondary = toKeyList(e.keysecondary ?? e.secondary_keys);
    const keys = rawKeys.filter((k) => !isRegexKey(k));
    const secondary = rawSecondary.filter((k) => !isRegexKey(k));
    regexKeysDropped += rawKeys.length - keys.length + (rawSecondary.length - secondary.length);

    const constant = e.constant === true;
    if (!constant && keys.length === 0) {
      // No keys and not always-on: it could never fire.
      entriesSkipped++;
      return;
    }

    const stPosition = optNum(e.position);
    const position: LorebookPosition =
      typeof e.position === "string"
        ? e.position === "after_char"
          ? "after"
          : "before"
        : ST_POSITION[stPosition ?? 0] ?? "before";

    const enabled = e.enabled === undefined ? e.disable !== true : e.enabled === true;
    const role = ST_ROLE[optNum(e.role) ?? -1];

    entries.push({
      id: String(e.uid ?? e.id ?? `e${i}`),
      name:
        (typeof e.comment === "string" && e.comment.trim()) ||
        (typeof e.name === "string" && e.name.trim()) ||
        keys[0] ||
        `Entry ${i + 1}`,
      keys,
      secondary_keys: secondary,
      logic: ST_LOGIC[optNum(e.selectiveLogic) ?? 0] ?? "and_any",
      content: content.slice(0, MAX_ENTRY_CONTENT),
      enabled,
      constant,
      position,
      order: num(e.order ?? e.insertion_order, 100),
      ...(position === "depth"
        ? { depth: Math.max(0, num(e.depth, 4)), role: role ?? "system" }
        : {}),
      ...(position === "outlet" && typeof e.outletName === "string"
        ? { outlet: e.outletName.trim() }
        : {}),
      probability: e.useProbability === false ? 100 : Math.max(0, Math.min(100, num(e.probability, 100))),
      group: typeof e.group === "string" && e.group.trim() ? e.group.split(",")[0].trim() : undefined,
      group_weight: optNum(e.groupWeight),
      group_override: optBool(e.groupOverride),
      group_scoring: optBool(e.useGroupScoring),
      scan_depth: optNum(e.scanDepth ?? e.scan_depth),
      case_sensitive: optBool(e.caseSensitive ?? e.case_sensitive),
      match_whole_words: optBool(e.matchWholeWords),
      exclude_recursion: optBool(e.excludeRecursion),
      prevent_recursion: optBool(e.preventRecursion),
      delay_until_recursion: optBool(e.delayUntilRecursion),
      sticky: optNum(e.sticky),
      delay: optNum(e.delay),
      cooldown: optNum(e.cooldown),
    });
  });

  if (entries.length === 0) {
    throw new Error("Every entry in this file was empty or could never trigger — nothing imported.");
  }

  const settings = defaultLorebookSettings();
  const scanDepth = optNum(src.scan_depth);
  if (scanDepth !== undefined) settings.scan_depth = Math.max(0, Math.min(50, scanDepth));
  if (src.recursive_scanning === false) settings.recursion_steps = 0;

  const name =
    (typeof src.name === "string" && src.name.trim()) ||
    (typeof root.name === "string" && root.name.trim()) ||
    fallbackName;

  const book: Lorebook = {
    version: 1,
    name: name.slice(0, MAX_LOREBOOK_NAME_LEN),
    settings,
    entries,
  };

  const size = JSON.stringify(book).length;
  if (size > MAX_LOREBOOK_BYTES) {
    throw new Error(
      `Lorebook exceeds the ${Math.round(MAX_LOREBOOK_BYTES / 1024)}KB limit (${Math.round(size / 1024)}KB) — split it into two books.`
    );
  }

  return { book, regexKeysDropped, entriesSkipped };
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

const POSITIONS: LorebookPosition[] = ["before", "after", "an_top", "an_bottom", "depth", "outlet"];
const LOGICS: LorebookLogic[] = ["and_any", "not_all", "not_any", "and_all"];

export function validateLorebook(b: unknown): b is Lorebook {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  if (x.version !== 1) return false;
  if (typeof x.name !== "string") return false;
  if (!Array.isArray(x.entries)) return false;
  if (x.entries.length > MAX_ENTRIES) return false;

  const s = x.settings as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return false;
  for (const k of ["scan_depth", "recursion_steps", "budget_tokens"] as const) {
    if (typeof s[k] !== "number" || !isFinite(s[k] as number)) return false;
  }
  if (typeof s.case_sensitive !== "boolean") return false;
  if (typeof s.match_whole_words !== "boolean") return false;

  for (const e of x.entries as unknown[]) {
    if (!e || typeof e !== "object") return false;
    const en = e as Record<string, unknown>;
    if (typeof en.id !== "string" || typeof en.name !== "string") return false;
    if (!Array.isArray(en.keys) || !Array.isArray(en.secondary_keys)) return false;
    if (en.keys.some((k) => typeof k !== "string")) return false;
    if (en.secondary_keys.some((k) => typeof k !== "string")) return false;
    if (typeof en.content !== "string" || en.content.length > MAX_ENTRY_CONTENT) return false;
    if (typeof en.enabled !== "boolean" || typeof en.constant !== "boolean") return false;
    if (!POSITIONS.includes(en.position as LorebookPosition)) return false;
    if (!LOGICS.includes(en.logic as LorebookLogic)) return false;
    if (typeof en.order !== "number") return false;
    if (en.role !== undefined && !["system", "user", "assistant"].includes(en.role as string)) return false;
  }

  if (JSON.stringify(b).length > MAX_LOREBOOK_BYTES) return false;
  return true;
}

// ------------------------------------------------------------------
// Activation
// ------------------------------------------------------------------

type ChatMessage = { role: string; content: unknown };

/** Cheap token estimate. The real tokenizer lives in token-estimator.ts, but
 *  this module is imported by client components too, so it stays dependency
 *  free — the budget is a guardrail, not an invoice. */
function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageText(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return (m.content as Array<Record<string, unknown>>)
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word matching only makes sense for keys made of word characters —
// for CJK and punctuation-heavy keys \b never matches, so fall back to a
// plain substring test (same caveat SillyTavern documents).
function matchesKey(buffer: string, key: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  if (!key) return false;
  const hay = caseSensitive ? buffer : buffer.toLowerCase();
  const needle = caseSensitive ? key : key.toLowerCase();
  if (wholeWords && /^[\w][\w\s'-]*$/.test(key)) {
    // Built from an escaped literal, so there is no user-controlled regex here.
    const re = new RegExp(`(?:^|\\W)${escapeRegex(needle)}(?:$|\\W)`, caseSensitive ? "" : "i");
    return re.test(caseSensitive ? buffer : buffer);
  }
  return hay.includes(needle);
}

function countMatches(
  buffer: string,
  keys: string[],
  caseSensitive: boolean,
  wholeWords: boolean
): number {
  let n = 0;
  for (const k of keys) if (matchesKey(buffer, k, caseSensitive, wholeWords)) n++;
  return n;
}

function secondaryPasses(
  buffer: string,
  entry: LorebookEntry,
  caseSensitive: boolean,
  wholeWords: boolean
): boolean {
  const secondary = entry.secondary_keys ?? [];
  if (secondary.length === 0) return true;
  const hits = countMatches(buffer, secondary, caseSensitive, wholeWords);
  switch (entry.logic) {
    case "and_all":
      return hits === secondary.length;
    case "not_any":
      return hits === 0;
    case "not_all":
      return hits < secondary.length;
    case "and_any":
    default:
      return hits > 0;
  }
}

type ActivationSource = "constant" | "key" | "recursion";

interface Activated {
  entry: LorebookEntry;
  score: number; // matched primary keys, for group scoring
  source: ActivationSource;
}

export interface LorebookActivation {
  before: LorebookEntry[];
  after: LorebookEntry[];
  anTop: LorebookEntry[];
  anBottom: LorebookEntry[];
  depth: LorebookEntry[];
  outlets: Record<string, LorebookEntry[]>;
  stats: { activated: number; droppedByBudget: number; tokens: number };
}

export function emptyActivation(): LorebookActivation {
  return {
    before: [],
    after: [],
    anTop: [],
    anBottom: [],
    depth: [],
    outlets: {},
    stats: { activated: 0, droppedByBudget: 0, tokens: 0 },
  };
}

/**
 * Decide which entries fire for this request.
 *
 * `random` is injectable so probability and group weighting are testable.
 */
export function activateLorebook(
  messages: ChatMessage[],
  book: Lorebook,
  random: () => number = Math.random
): LorebookActivation {
  const settings = { ...defaultLorebookSettings(), ...book.settings };
  const texts = messages.map(messageText);
  const messageCount = messages.length;

  const bufferCache = new Map<number, string>();
  const bufferFor = (depth: number): string => {
    const d = Math.max(0, Math.min(texts.length, Math.floor(depth)));
    const cached = bufferCache.get(d);
    if (cached !== undefined) return cached;
    const buf = texts.slice(texts.length - d).join("\n");
    bufferCache.set(d, buf);
    return buf;
  };

  const candidates = book.entries.filter((e) => e.enabled && e.content.trim());
  const activated = new Map<string, Activated>();
  let recurseBuffer = "";

  const passes = 1 + Math.max(0, Math.min(5, settings.recursion_steps));
  for (let pass = 0; pass < passes; pass++) {
    const fired: Activated[] = [];

    for (const entry of candidates) {
      if (activated.has(entry.id)) continue;
      // `delay`: the entry only exists once the chat is long enough. Exact,
      // because the client hands us the whole history every time.
      if ((entry.delay ?? 0) > messageCount) continue;
      if (pass === 0 && entry.delay_until_recursion) continue;
      if (pass > 0 && entry.exclude_recursion) continue;

      if (entry.constant) {
        if (pass > 0) continue;
        if (!rolls(entry, random)) continue;
        fired.push({ entry, score: 0, source: "constant" });
        continue;
      }

      const caseSensitive = entry.case_sensitive ?? settings.case_sensitive;
      const wholeWords = entry.match_whole_words ?? settings.match_whole_words;
      // `sticky` would keep an entry alive N messages after it fired; with no
      // per-chat memory the closest honest equivalent is to look that much
      // further back for the keyword.
      const window = (entry.scan_depth ?? settings.scan_depth) + (entry.sticky ?? 0);
      const buffer = pass === 0 ? bufferFor(window) : `${bufferFor(window)}\n${recurseBuffer}`;

      const score = countMatches(buffer, entry.keys, caseSensitive, wholeWords);
      if (score === 0) continue;
      if (!secondaryPasses(buffer, entry, caseSensitive, wholeWords)) continue;
      if (!rolls(entry, random)) continue;

      fired.push({ entry, score, source: pass === 0 ? "key" : "recursion" });
    }

    if (fired.length === 0) break;
    for (const f of fired) activated.set(f.entry.id, f);
    const feed = fired.filter((f) => !f.entry.prevent_recursion).map((f) => f.entry.content);
    if (feed.length > 0) recurseBuffer += `\n${feed.join("\n")}`;
  }

  const winners = resolveGroups([...activated.values()], random);

  // Budget: keep the always-on entries, then keyword hits, then whatever
  // recursion dragged in; highest insertion order first inside each tier.
  const rank: Record<ActivationSource, number> = { constant: 0, key: 1, recursion: 2 };
  const ordered = [...winners].sort(
    (a, b) => rank[a.source] - rank[b.source] || b.entry.order - a.entry.order
  );

  const kept: Activated[] = [];
  let tokens = 0;
  let droppedByBudget = 0;
  for (const a of ordered) {
    const cost = roughTokens(a.entry.content);
    if (tokens + cost > settings.budget_tokens && kept.length > 0) {
      droppedByBudget++;
      continue;
    }
    kept.push(a);
    tokens += cost;
  }

  const out = emptyActivation();
  out.stats = { activated: kept.length, droppedByBudget, tokens };

  // Inside a bucket, higher insertion order sits closer to the chat, which is
  // where it carries the most weight.
  const byOrder = (a: Activated, b: Activated) => a.entry.order - b.entry.order;
  for (const a of kept.sort(byOrder)) {
    const e = a.entry;
    switch (e.position) {
      case "after":
        out.after.push(e);
        break;
      case "an_top":
        out.anTop.push(e);
        break;
      case "an_bottom":
        out.anBottom.push(e);
        break;
      case "depth":
        out.depth.push(e);
        break;
      case "outlet": {
        const key = (e.outlet ?? "").trim().toLowerCase();
        if (!key) break; // an outlet entry with no name can never be placed
        (out.outlets[key] ??= []).push(e);
        break;
      }
      case "before":
      default:
        out.before.push(e);
    }
  }

  return out;
}

function rolls(entry: LorebookEntry, random: () => number): boolean {
  const p = entry.probability ?? 100;
  if (p >= 100) return true;
  if (p <= 0) return false;
  return random() * 100 < p;
}

/** Inclusion groups: when several activated entries share a group name, only
 *  one survives — by highest order (override), by most matched keys (scoring),
 *  or by weighted random draw. */
function resolveGroups(list: Activated[], random: () => number): Activated[] {
  const groups = new Map<string, Activated[]>();
  const loose: Activated[] = [];
  for (const a of list) {
    const g = (a.entry.group ?? "").trim().toLowerCase();
    if (!g) loose.push(a);
    else (groups.get(g) ?? groups.set(g, []).get(g)!).push(a);
  }

  const winners = [...loose];
  for (const members of groups.values()) {
    if (members.length === 1) {
      winners.push(members[0]);
      continue;
    }
    let pool = members;
    if (members.some((m) => m.entry.group_override)) {
      const best = Math.max(...members.map((m) => m.entry.order));
      pool = members.filter((m) => m.entry.order === best);
    } else if (members.some((m) => m.entry.group_scoring)) {
      const best = Math.max(...members.map((m) => m.score));
      pool = members.filter((m) => m.score === best);
    }
    winners.push(pickWeighted(pool, random));
  }
  return winners;
}

function pickWeighted(pool: Activated[], random: () => number): Activated {
  const total = pool.reduce((sum, m) => sum + Math.max(1, m.entry.group_weight ?? 100), 0);
  let roll = random() * total;
  for (const m of pool) {
    roll -= Math.max(1, m.entry.group_weight ?? 100);
    if (roll <= 0) return m;
  }
  return pool[pool.length - 1];
}

// ------------------------------------------------------------------
// Merge (library rows → the single blob the request pipeline reads)
// ------------------------------------------------------------------

/**
 * Flatten the user's active books into one lorebook. Per-entry settings are
 * resolved from each source book first, so the merged entries stay faithful
 * even when the books disagree on scan depth or matching rules.
 */
export function mergeLorebooks(books: Lorebook[]): Lorebook {
  const merged = emptyLorebook("Active lorebooks");
  let budget = 0;
  let recursion = 0;
  const seen = new Set<string>();

  books.forEach((book, bookIndex) => {
    const s = { ...defaultLorebookSettings(), ...book.settings };
    budget = Math.max(budget, s.budget_tokens);
    recursion = Math.max(recursion, s.recursion_steps);
    for (const entry of book.entries) {
      let id = entry.id;
      if (seen.has(id)) id = `b${bookIndex}_${entry.id}`;
      seen.add(id);
      merged.entries.push({
        ...entry,
        id,
        scan_depth: entry.scan_depth ?? s.scan_depth,
        case_sensitive: entry.case_sensitive ?? s.case_sensitive,
        match_whole_words: entry.match_whole_words ?? s.match_whole_words,
      });
    }
  });

  merged.settings = {
    ...defaultLorebookSettings(),
    budget_tokens: budget || defaultLorebookSettings().budget_tokens,
    recursion_steps: recursion,
  };
  return merged;
}
