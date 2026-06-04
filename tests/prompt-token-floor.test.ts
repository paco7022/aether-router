import { describe, expect, it } from "vitest";
import { floorPromptTokens } from "../src/lib/token-estimator";

// floorPromptTokens guards usage_logs against upstreams that under-report
// prompt tokens. The motivating case: Orbit's Anthropic bridge reports only
// the visible-message count in streaming (146) while the non-stream call for
// the same request reports the full ~4300 (it injects a hidden system prompt).

describe("floorPromptTokens", () => {
  it("raises an under-reported prompt to the local estimate", () => {
    // Orbit streaming: upstream says 146, we measured ~4300 forwarded.
    expect(floorPromptTokens(146, 0, 0, 4300)).toBe(4300);
  });

  it("leaves a prompt already at/above the estimate untouched", () => {
    // Orbit non-stream: upstream already reports the full count.
    expect(floorPromptTokens(4329, 0, 0, 4300)).toBe(4329);
  });

  it("does not double-count cached tokens (Anthropic shape: prompt excludes cache)", () => {
    // Real prompt = 200 new + 4000 cache_read = 4200 >= estimate -> no change.
    expect(floorPromptTokens(200, 4000, 0, 4200)).toBe(200);
  });

  it("only fills the shortfall not already covered by cache", () => {
    // accounted = 100 + 3000 = 3100; estimate 4000 -> add 900 to prompt.
    expect(floorPromptTokens(100, 3000, 0, 4000)).toBe(1000);
  });

  it("counts cache_write toward the accounted prompt side", () => {
    // accounted = 50 + 1000 read + 2000 write = 3050 >= 3000 -> no change.
    expect(floorPromptTokens(50, 1000, 2000, 3000)).toBe(50);
  });

  it("fills from zero when upstream reports nothing", () => {
    expect(floorPromptTokens(0, 0, 0, 512)).toBe(512);
  });

  it("is a no-op when there is no local estimate", () => {
    expect(floorPromptTokens(146, 0, 0, 0)).toBe(146);
  });

  it("coerces non-finite inputs safely", () => {
    expect(floorPromptTokens(NaN, NaN, NaN, 300)).toBe(300);
  });
});
