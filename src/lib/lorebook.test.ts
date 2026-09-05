import { describe, it, expect } from "vitest";
import {
  activateLorebook,
  defaultLorebookSettings,
  emptyLorebook,
  mergeLorebooks,
  parseLorebook,
  validateLorebook,
  type Lorebook,
  type LorebookEntry,
} from "./lorebook";
import { applyPreset, applyLorebook, type UserPreset } from "./preset";

// A trimmed-down SillyTavern World Info export: entries keyed by uid, ST
// numeric enums, a regex key, a marker-less constant, an @depth entry.
const ST_BOOK = {
  name: "Eldoria",
  entries: {
    "0": {
      uid: 0,
      key: ["elf", "elves"],
      keysecondary: ["forest"],
      selectiveLogic: 3, // AND_ALL
      comment: "Elves",
      content: "The elves of Eldoria live in the deep forest.",
      constant: false,
      order: 100,
      position: 0, // before char defs
      disable: false,
      probability: 100,
      useProbability: true,
    },
    "1": {
      uid: 1,
      key: ["/dragon.*/i"],
      comment: "Regex only",
      content: "Dragons are extinct.",
      position: 1,
    },
    "2": {
      uid: 2,
      key: [],
      constant: true,
      comment: "Always",
      content: "The year is 1204.",
      order: 200,
      position: 1, // after char defs
    },
    "3": {
      uid: 3,
      key: ["sword"],
      comment: "Deep note",
      content: "Swords are forged in Karak.",
      position: 4, // at depth
      depth: 2,
      role: 1, // user
      order: 50,
    },
    "4": {
      uid: 4,
      key: ["ghost"],
      comment: "Empty",
      content: "   ",
      position: 0,
    },
  },
};

const V2_CARD = {
  data: {
    name: "Ayla",
    character_book: {
      name: "Ayla's book",
      scan_depth: 3,
      recursive_scanning: false,
      entries: [
        {
          keys: ["village"],
          secondary_keys: ["night"],
          content: "The village sleeps early.",
          enabled: true,
          insertion_order: 10,
          position: "after_char",
        },
        {
          keys: ["temple"],
          content: "The temple is off limits.",
          enabled: false,
          insertion_order: 20,
          position: "before_char",
        },
      ],
    },
  },
};

const chat = (...contents: string[]) =>
  contents.map((c, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: c }));

function entry(over: Partial<LorebookEntry>): LorebookEntry {
  return {
    id: over.id ?? "e",
    name: over.name ?? "e",
    keys: over.keys ?? [],
    secondary_keys: over.secondary_keys ?? [],
    logic: over.logic ?? "and_any",
    content: over.content ?? "LORE",
    enabled: over.enabled ?? true,
    constant: over.constant ?? false,
    position: over.position ?? "before",
    order: over.order ?? 100,
    ...over,
  };
}

function book(entries: LorebookEntry[], settings: Partial<Lorebook["settings"]> = {}): Lorebook {
  return {
    version: 1,
    name: "test",
    settings: { ...defaultLorebookSettings(), ...settings },
    entries,
  };
}

describe("parseLorebook", () => {
  const { book: parsed, regexKeysDropped, entriesSkipped } = parseLorebook(ST_BOOK);

  it("imports a SillyTavern World Info export", () => {
    expect(parsed.name).toBe("Eldoria");
    expect(validateLorebook(parsed)).toBe(true);
    const ids = parsed.entries.map((e) => e.id);
    expect(ids).toContain("0");
    expect(ids).toContain("2");
    expect(ids).toContain("3");
  });

  it("maps ST enums onto our own", () => {
    const elves = parsed.entries.find((e) => e.id === "0")!;
    expect(elves.position).toBe("before");
    expect(elves.logic).toBe("and_all");
    expect(elves.secondary_keys).toEqual(["forest"]);

    const deep = parsed.entries.find((e) => e.id === "3")!;
    expect(deep.position).toBe("depth");
    expect(deep.depth).toBe(2);
    expect(deep.role).toBe("user");

    const always = parsed.entries.find((e) => e.id === "2")!;
    expect(always.constant).toBe(true);
    expect(always.position).toBe("after");
  });

  it("drops regex keys and unusable entries, and reports both", () => {
    expect(regexKeysDropped).toBe(1);
    // uid 1 had only a regex key (so it could never fire) and uid 4 was empty.
    expect(entriesSkipped).toBe(2);
    expect(parsed.entries.map((e) => e.id)).not.toContain("1");
    expect(parsed.entries.map((e) => e.id)).not.toContain("4");
  });

  it("imports a V2 character card book", () => {
    const { book: b } = parseLorebook(V2_CARD);
    expect(b.name).toBe("Ayla's book");
    expect(b.settings.scan_depth).toBe(3);
    expect(b.settings.recursion_steps).toBe(0);
    const [village, temple] = b.entries;
    expect(village.position).toBe("after");
    expect(village.secondary_keys).toEqual(["night"]);
    expect(village.order).toBe(10);
    expect(temple.enabled).toBe(false);
  });

  it("round-trips one of our own books", () => {
    const mine = emptyLorebook("Mine");
    mine.entries.push(entry({ id: "x", keys: ["k"] }));
    expect(parseLorebook(mine).book).toEqual(mine);
  });

  it("rejects a file with no entries", () => {
    expect(() => parseLorebook({ foo: 1 })).toThrow(/no lorebook entries/i);
  });
});

describe("activateLorebook", () => {
  it("fires on a keyword inside the scan window and ignores older ones", () => {
    const b = book([entry({ id: "a", keys: ["dragon"], content: "DRAGONS" })], { scan_depth: 2 });

    const hit = activateLorebook(chat("a dragon appears", "b", "c"), b);
    expect(hit.before.map((e) => e.id)).toEqual([]);

    const near = activateLorebook(chat("x", "y", "a dragon appears"), b);
    expect(near.before.map((e) => e.id)).toEqual(["a"]);
  });

  it("matches whole words only, unless the entry says otherwise", () => {
    const strict = book([entry({ id: "a", keys: ["orc"] })]);
    expect(activateLorebook(chat("the orchestra played"), strict).before).toHaveLength(0);
    expect(activateLorebook(chat("an orc, actually"), strict).before).toHaveLength(1);

    const loose = book([entry({ id: "a", keys: ["orc"], match_whole_words: false })]);
    expect(activateLorebook(chat("the orchestra played"), loose).before).toHaveLength(1);
  });

  it("applies secondary key logic", () => {
    const mk = (logic: LorebookEntry["logic"]) =>
      book([entry({ id: "a", keys: ["elf"], secondary_keys: ["forest", "night"], logic })]);

    const both = chat("an elf in the forest at night");
    const one = chat("an elf in the forest");

    expect(activateLorebook(one, mk("and_any")).before).toHaveLength(1);
    expect(activateLorebook(one, mk("and_all")).before).toHaveLength(0);
    expect(activateLorebook(both, mk("and_all")).before).toHaveLength(1);
    expect(activateLorebook(one, mk("not_any")).before).toHaveLength(0);
    expect(activateLorebook(chat("a lone elf"), mk("not_any")).before).toHaveLength(1);
    expect(activateLorebook(one, mk("not_all")).before).toHaveLength(1);
    expect(activateLorebook(both, mk("not_all")).before).toHaveLength(0);
  });

  it("always fires constant entries and never fires 0% ones", () => {
    const b = book([
      entry({ id: "always", constant: true }),
      entry({ id: "never", keys: ["elf"], probability: 0 }),
    ]);
    const out = activateLorebook(chat("an elf"), b);
    expect(out.before.map((e) => e.id)).toEqual(["always"]);
  });

  it("honours delay: the entry needs a long enough chat", () => {
    const b = book([entry({ id: "a", keys: ["elf"], delay: 4 })]);
    expect(activateLorebook(chat("elf", "b"), b).before).toHaveLength(0);
    expect(activateLorebook(chat("x", "y", "z", "elf"), b).before).toHaveLength(1);
  });

  it("recursion lets one entry trigger another, and prevent_recursion stops it", () => {
    const chain = book(
      [
        entry({ id: "a", keys: ["elf"], content: "Elves guard the SIGIL." }),
        entry({ id: "b", keys: ["sigil"], content: "The sigil burns." }),
      ],
      { recursion_steps: 1 }
    );
    expect(activateLorebook(chat("an elf"), chain).before.map((e) => e.id)).toEqual(["a", "b"]);

    const blocked = book(
      [
        entry({ id: "a", keys: ["elf"], content: "Elves guard the SIGIL.", prevent_recursion: true }),
        entry({ id: "b", keys: ["sigil"], content: "The sigil burns." }),
      ],
      { recursion_steps: 1 }
    );
    expect(activateLorebook(chat("an elf"), blocked).before.map((e) => e.id)).toEqual(["a"]);

    const off = book(
      [
        entry({ id: "a", keys: ["elf"], content: "Elves guard the SIGIL." }),
        entry({ id: "b", keys: ["sigil"], content: "The sigil burns." }),
      ],
      { recursion_steps: 0 }
    );
    expect(activateLorebook(chat("an elf"), off).before.map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps exactly one winner per inclusion group", () => {
    const b = book([
      entry({ id: "low", keys: ["elf"], group: "elves", order: 10, group_override: true }),
      entry({ id: "high", keys: ["elf"], group: "elves", order: 90, group_override: true }),
      entry({ id: "loose", keys: ["elf"] }),
    ]);
    const ids = activateLorebook(chat("an elf"), b).before.map((e) => e.id);
    expect(ids).toContain("high");
    expect(ids).not.toContain("low");
    expect(ids).toContain("loose");
  });

  it("drops the lowest-priority entries once the budget is spent", () => {
    const big = "x".repeat(4000); // ~1000 rough tokens each
    const b = book(
      [
        entry({ id: "keep", constant: true, content: big }),
        entry({ id: "drop", keys: ["elf"], content: big }),
      ],
      { budget_tokens: 1200 }
    );
    const out = activateLorebook(chat("an elf"), b);
    expect(out.before.map((e) => e.id)).toEqual(["keep"]);
    expect(out.stats.droppedByBudget).toBe(1);
  });

  it("buckets entries by position, lowest order furthest from the chat", () => {
    const b = book([
      entry({ id: "b2", keys: ["elf"], position: "before", order: 200 }),
      entry({ id: "b1", keys: ["elf"], position: "before", order: 100 }),
      entry({ id: "a1", keys: ["elf"], position: "after" }),
      entry({ id: "an", keys: ["elf"], position: "an_bottom" }),
      entry({ id: "d", keys: ["elf"], position: "depth", depth: 1, role: "user" }),
      entry({ id: "o", keys: ["elf"], position: "outlet", outlet: "Notes" }),
    ]);
    const out = activateLorebook(chat("an elf"), b);
    expect(out.before.map((e) => e.id)).toEqual(["b1", "b2"]);
    expect(out.after.map((e) => e.id)).toEqual(["a1"]);
    expect(out.anBottom.map((e) => e.id)).toEqual(["an"]);
    expect(out.depth.map((e) => e.id)).toEqual(["d"]);
    expect(Object.keys(out.outlets)).toEqual(["notes"]);
  });
});

describe("mergeLorebooks", () => {
  it("resolves per-book settings onto the entries and keeps ids unique", () => {
    const a = book([entry({ id: "1", keys: ["a"] })], { scan_depth: 9, case_sensitive: true });
    const b = book([entry({ id: "1", keys: ["b"] })], { scan_depth: 2, budget_tokens: 4000 });
    const merged = mergeLorebooks([a, b]);

    expect(merged.entries).toHaveLength(2);
    expect(merged.entries[0].scan_depth).toBe(9);
    expect(merged.entries[0].case_sensitive).toBe(true);
    expect(merged.entries[1].scan_depth).toBe(2);
    expect(merged.entries[1].id).not.toBe(merged.entries[0].id);
    expect(merged.settings.budget_tokens).toBe(4000);
  });
});

describe("lorebook + preset assembly", () => {
  const preset: UserPreset = {
    version: 2,
    name: "p",
    sampling: {},
    prompts: [
      { id: "sys", name: "sys", role: "system", content: "You are a bard.", enabled: true },
      {
        id: "notes",
        name: "notes",
        role: "system",
        content: "Notes: {{outlet::Notes}}",
        enabled: true,
      },
      {
        id: "jb",
        name: "jb",
        role: "system",
        content: "Stay in character.",
        enabled: true,
        position: "relative",
        relative_to: "after_history",
      },
    ],
    assistant_prefill: "",
    prefill_enabled: false,
    squash_system_messages: false,
  };

  const lore = book([
    entry({ id: "pre", keys: ["elf"], position: "before", content: "ELVES EXIST" }),
    entry({ id: "post", keys: ["elf"], position: "after", content: "NEAR CHAT" }),
    entry({ id: "an", keys: ["elf"], position: "an_bottom", content: "AFTER HISTORY" }),
    entry({ id: "deep", keys: ["elf"], position: "depth", depth: 1, role: "user", content: "AT DEPTH" }),
    entry({ id: "out", keys: ["elf"], position: "outlet", outlet: "Notes", content: "FROM OUTLET" }),
  ]);

  it("places every position around the preset's own prompts", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "user", content: "tell me about the elf" },
        { role: "assistant", content: "sure" },
      ],
    };
    applyPreset(body, preset, lore);
    const msgs = body.messages as Array<{ role: string; content: string }>;
    const text = msgs.map((m) => m.content).join("\n---\n");

    // Preamble order: lore "before" → preset prompts → lore "after".
    expect(text.indexOf("ELVES EXIST")).toBeLessThan(text.indexOf("You are a bard."));
    expect(text.indexOf("You are a bard.")).toBeLessThan(text.indexOf("NEAR CHAT"));
    // The outlet entry landed inside the preset prompt that asked for it.
    expect(text).toContain("Notes: FROM OUTLET");
    // Depth 1 = one message from the end of the client history.
    const deepIdx = msgs.findIndex((m) => m.content === "AT DEPTH");
    expect(msgs[deepIdx].role).toBe("user");
    expect(msgs[deepIdx + 1].content).toBe("sure");
    // Post-history lore sits after the preset's post-history prompt.
    expect(text.indexOf("Stay in character.")).toBeLessThan(text.indexOf("AFTER HISTORY"));
  });

  it("applies a lorebook with no preset at all", () => {
    const body: Record<string, unknown> = {
      temperature: 0.9,
      messages: [{ role: "user", content: "the elf again" }],
    };
    applyLorebook(body, lore);
    const msgs = body.messages as Array<{ role: string; content: string }>;
    expect(msgs[0].content).toContain("ELVES EXIST");
    expect(msgs.some((m) => m.content === "AT DEPTH")).toBe(true);
    // A lorebook must never touch sampling.
    expect(body.temperature).toBe(0.9);
  });

  it("injects nothing when no key matches", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hello there" }],
    };
    applyLorebook(body, lore);
    expect(body.messages).toEqual([{ role: "user", content: "hello there" }]);
  });
});
