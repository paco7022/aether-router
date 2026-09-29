import { describe, expect, it } from "vitest";
import {
  capCompletionTokens,
  COMPLETION_TOKEN_CAP_MULTIPLIER,
  COMPLETION_TOKEN_CAP_SLACK,
  estimateTokens,
  toolCallsText,
} from "../src/lib/token-estimator";

// capCompletionTokens is the mirror of floorPromptTokens: the floor stops an
// upstream from under-reporting (which would let it drain credits while we
// bill nothing), this stops the over-reporting that bills the CUSTOMER for
// output that was never generated. Motivating case: or/ (Orbit) has been
// measured reporting 4-9x the real completion. Harmless while premium billing
// was a flat per-request cost, real money under billing_mode='payg' and on
// per-token providers (ds/, na/).

const ceilingFor = (observed: number) =>
  Math.ceil(observed * COMPLETION_TOKEN_CAP_MULTIPLIER) + COMPLETION_TOKEN_CAP_SLACK;

describe("capCompletionTokens", () => {
  it("clamps an absurdly inflated completion to the ceiling", () => {
    // Orbit-style 9x inflation over 1000 tokens of text we actually streamed.
    expect(capCompletionTokens(9000, 1000)).toBe(ceilingFor(1000));
  });

  it("leaves an honest report untouched", () => {
    // Upstream tokenizer differs slightly from o200k — well inside the margin.
    expect(capCompletionTokens(1050, 1000)).toBe(1050);
  });

  it("allows hidden reasoning tokens well above the visible text", () => {
    // A thinking model bills tokens that never appear as content; 2.5x the
    // visible answer must still go through.
    expect(capCompletionTokens(2500, 1000)).toBe(2500);
  });

  it("does not raise an under-report (that is the floor's job)", () => {
    expect(capCompletionTokens(10, 1000)).toBe(10);
  });

  it("is a no-op when no text was observed (e.g. tool-call-only reply)", () => {
    expect(capCompletionTokens(5000, 0)).toBe(5000);
  });

  it("keeps short replies from being clamped by rounding", () => {
    // 1 token of visible text must not cap a small reasoning burst at ~3.
    expect(capCompletionTokens(60, 1)).toBe(60);
  });

  it("coerces non-finite inputs safely", () => {
    expect(capCompletionTokens(NaN, 1000)).toBe(0);
    expect(capCompletionTokens(1000, NaN)).toBe(1000);
  });
});

// Tool-call arguments are generated output (Claude Code's Write/Edit put whole
// files there). Before toolCallsText they were invisible to the observed-output
// count, so a tool-heavy reply was capped at 3x its short prose + 64 tokens.
describe("toolCallsText", () => {
  it("joins names and argument strings of full tool_calls", () => {
    const calls = [
      { id: "c1", type: "function", function: { name: "write_file", arguments: '{"path":"a.py","content":"print(1)"}' } },
      { id: "c2", type: "function", function: { name: "run_tests", arguments: "{}" } },
    ];
    expect(toolCallsText(calls)).toBe('write_file{"path":"a.py","content":"print(1)"}run_tests{}');
  });

  it("concatenates streaming delta fragments", () => {
    const fragments = [
      [{ index: 0, id: "c1", function: { name: "read_file", arguments: "" } }],
      [{ index: 0, function: { arguments: '{"pa' } }],
      [{ index: 0, function: { arguments: 'th":"x"}' } }],
    ];
    expect(fragments.map(toolCallsText).join("")).toBe('read_file{"path":"x"}');
  });

  it("serializes object arguments", () => {
    expect(toolCallsText([{ function: { name: "f", arguments: { a: 1 } } }])).toBe('f{"a":1}');
  });

  it("ignores malformed input", () => {
    expect(toolCallsText(undefined)).toBe("");
    expect(toolCallsText(null)).toBe("");
    expect(toolCallsText("x")).toBe("");
    expect(toolCallsText([null, 3, {}, { function: null }, { function: { name: 5 } }])).toBe("");
  });

  it("lets an honest tool-heavy report through the cap", () => {
    const prose = "I'll write the file.";
    const fileBody = "def handler(event):\n    return {'ok': True}\n".repeat(80);
    const args = JSON.stringify({ path: "src/handler.py", content: fileBody });
    const honest = estimateTokens(prose) + estimateTokens(args);
    // Prose alone would clamp the honest report far below the truth.
    expect(capCompletionTokens(honest, estimateTokens(prose))).toBeLessThan(honest);
    const observed = estimateTokens(prose + toolCallsText([{ function: { name: "write_file", arguments: args } }]));
    expect(capCompletionTokens(honest, observed)).toBe(honest);
  });
});
