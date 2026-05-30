import { describe, it, expect } from "vitest";
import { parseSillyTavernPreset, applyPreset, validatePreset, type UserPreset } from "./preset";

// A compact stand-in for a real SillyTavern Chat Completion export: a
// markers-only dummy order (100000) plus the actual configured list (100001),
// macros, a relative prefill, and two in-chat depth injections.
const ST_PRESET = {
  temperature: 0.7,
  top_p: 0.9,
  openai_max_tokens: 1234,
  squash_system_messages: true,
  assistant_prefill: "",
  prompts: [
    { identifier: "chatHistory", marker: true, name: "Chat History" },
    { identifier: "charDescription", marker: true, name: "Char" },
    { identifier: "main", role: "system", name: "Main", content: "{{// empty slot }}" },
    { identifier: "vars", role: "system", name: "Variables", content: "{{setvar::style::noir}}" },
    { identifier: "core", role: "system", name: "Core", content: "Write in {{getvar::style}} style. Char={{char}}." },
    { identifier: "rng", role: "system", name: "RNG", content: "Pick {{random:ONLY}}, roll {{roll:1d1}}." },
    { identifier: "startTurn", role: "user", name: "Start", content: "<start>", injection_position: 1, injection_depth: 0, injection_order: 50 },
    { identifier: "deepNote", role: "system", name: "Deep", content: "DEEP", injection_position: 1, injection_depth: 1, injection_order: 10 },
    { identifier: "prefill", role: "assistant", name: "Prefill", content: "Reply in {{getvar::style}}:" },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "chatHistory", enabled: true },
      ],
    },
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "vars", enabled: true },
        { identifier: "core", enabled: true },
        { identifier: "rng", enabled: true },
        { identifier: "deepNote", enabled: true },
        { identifier: "charDescription", enabled: false },
        { identifier: "chatHistory", enabled: true },
        { identifier: "startTurn", enabled: true },
        { identifier: "prefill", enabled: true },
      ],
    },
  ],
};

describe("parseSillyTavernPreset", () => {
  const preset = parseSillyTavernPreset(ST_PRESET);

  it("imports from the real order (100001), not the markers-only dummy (100000)", () => {
    expect(preset.version).toBe(2);
    // core/rng/vars/deepNote/startTurn/prefill all live only in 100001.
    const ids = preset.prompts.map((p) => p.id);
    expect(ids).toContain("core");
    expect(ids).toContain("prefill");
    expect(ids).toContain("startTurn");
    expect(validatePreset(preset)).toBe(true);
  });

  it("captures sampling and sets authoritative strip by default", () => {
    expect(preset.sampling.temperature).toBe(0.7);
    expect(preset.sampling.top_p).toBe(0.9);
    expect(preset.sampling.max_tokens).toBe(1234);
    expect(preset.strip_client_params).toBe(true);
  });

  it("classifies injection position: relative before/after history + depth", () => {
    const core = preset.prompts.find((p) => p.id === "core")!;
    expect(core.position).toBe("relative");
    expect(core.relative_to).toBe("before_history");

    const prefill = preset.prompts.find((p) => p.id === "prefill")!;
    expect(prefill.relative_to).toBe("after_history");

    const deep = preset.prompts.find((p) => p.id === "deepNote")!;
    expect(deep.position).toBe("depth");
    expect(deep.depth).toBe(1);

    const start = preset.prompts.find((p) => p.id === "startTurn")!;
    expect(start.position).toBe("depth");
    expect(start.depth).toBe(0);
  });
});

describe("applyPreset — assembly", () => {
  it("resolves macros, injects at depth, strips client params, squashes system", () => {
    const preset = parseSillyTavernPreset(ST_PRESET);
    const body: Record<string, unknown> = {
      temperature: 2,
      top_k: 99,
      max_tokens: 50,
      messages: [
        { role: "system", content: "client-sys" },
        { role: "user", content: "hello" },
      ],
    };

    applyPreset(body, preset);

    // Authority: client temp/top_k dropped; preset values applied.
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(1234);
    expect(body.top_k).toBeUndefined();

    const msgs = body.messages as Array<{ role: string; content: string }>;
    const flat = JSON.stringify(msgs);

    // No unresolved macros leak to the model.
    expect(flat).not.toContain("{{");
    // setvar/getvar resolved across prompts.
    expect(flat).toContain("noir");
    // card macro {{char}} -> ""
    expect(flat).toContain("Char=.");
    // random single-option + 1d1 roll are deterministic.
    expect(flat).toContain("Pick ONLY, roll 1.");

    // System preamble + client system + depth-1 DEEP squashed into one system.
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("client-sys");
    expect(msgs[0].content).toContain("DEEP");

    // depth-0 in-chat injection lands at the very end of the history.
    const startIdx = msgs.findIndex((m) => m.content === "<start>");
    const helloIdx = msgs.findIndex((m) => m.content === "hello");
    expect(startIdx).toBeGreaterThan(helloIdx);

    // after-history relative assistant prompt is the trailing message.
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Reply in noir:");
  });

  it("legacy v1 preset (no strip flag) keeps client params it doesn't define", () => {
    const v1: UserPreset = {
      version: 1,
      name: "v1",
      sampling: { temperature: 0.5 },
      prompts: [{ id: "a", name: "a", role: "system", content: "Hi", enabled: true }],
      assistant_prefill: "",
      prefill_enabled: false,
      squash_system_messages: false,
    };
    const body: Record<string, unknown> = {
      temperature: 2,
      top_k: 5,
      messages: [{ role: "user", content: "x" }],
    };
    applyPreset(body, v1);

    expect(body.temperature).toBe(0.5); // preset overrides
    expect(body.top_k).toBe(5); // not stripped (legacy)
    const msgs = body.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: "system", content: "Hi" });
    expect(msgs[1]).toEqual({ role: "user", content: "x" });
  });
});
