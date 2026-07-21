import { describe, it, expect } from "vitest";
import {
  classifyHealth,
  errorCodeLabel,
  timeAgo,
  type ModelHealthRow,
} from "../src/lib/model-health";

function row(partial: Partial<ModelHealthRow>): ModelHealthRow {
  return {
    model_id: "x/model",
    ok_recent: 0,
    err_recent: 0,
    ok_window: 0,
    err_window: 0,
    last_ok: null,
    last_err: null,
    last_err_code: null,
    ...partial,
  };
}

describe("classifyHealth", () => {
  it("reports idle when the model has no rows at all", () => {
    expect(classifyHealth(undefined).state).toBe("idle");
    expect(classifyHealth(row({})).state).toBe("idle");
  });

  it("reports operational on clean recent traffic", () => {
    const v = classifyHealth(row({ ok_recent: 5, ok_window: 20 }));
    expect(v.state).toBe("operational");
    expect(v.basis).toBe("recent");
  });

  it("reports down when the recent window is essentially all errors", () => {
    const v = classifyHealth(row({ err_recent: 4, err_window: 9, last_err_code: "error_503" }));
    expect(v.state).toBe("down");
  });

  it("reports degraded when errors mix with successes", () => {
    expect(classifyHealth(row({ ok_recent: 6, err_recent: 4, last_err_code: "error_429" })).state).toBe(
      "degraded"
    );
  });

  it("does not call a model down off a single failure", () => {
    expect(classifyHealth(row({ err_recent: 1, err_window: 1, last_err_code: "error_500" })).state).toBe(
      "degraded"
    );
  });

  it("ignores caller-fault errors instead of blaming the provider", () => {
    const v = classifyHealth(row({ err_recent: 5, err_window: 5, last_err_code: "error_400" }));
    expect(v.state).toBe("idle");
  });

  it("falls back to the 24h window when the last hour was quiet", () => {
    const v = classifyHealth(row({ ok_window: 3, err_window: 0 }));
    expect(v.state).toBe("operational");
    expect(v.basis).toBe("window");
  });
});

describe("labels", () => {
  it("humanises error codes", () => {
    expect(errorCodeLabel("error_429")).toBe("HTTP 429 — rate limited");
    expect(errorCodeLabel("error_empty")).toBe("empty response");
    expect(errorCodeLabel(null)).toBeNull();
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-07-20T12:00:00Z");
    expect(timeAgo(null, now)).toBe("—");
    expect(timeAgo("2026-07-20T11:58:00Z", now)).toBe("2m ago");
    expect(timeAgo("2026-07-20T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-07-18T12:00:00Z", now)).toBe("2d ago");
  });
});
