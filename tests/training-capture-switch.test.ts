import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrainingCaptureEnabled } from "@/lib/training-capture";

describe("isTrainingCaptureEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off when the variable is unset", () => {
    vi.stubEnv("AETHER_TRAINING_CAPTURE_ENABLED", undefined);
    expect(isTrainingCaptureEnabled()).toBe(false);
  });

  it("is off for any value other than \"true\"", () => {
    vi.stubEnv("AETHER_TRAINING_CAPTURE_ENABLED", "false");
    expect(isTrainingCaptureEnabled()).toBe(false);
    vi.stubEnv("AETHER_TRAINING_CAPTURE_ENABLED", "1");
    expect(isTrainingCaptureEnabled()).toBe(false);
  });

  it("is on only for \"true\"", () => {
    vi.stubEnv("AETHER_TRAINING_CAPTURE_ENABLED", "true");
    expect(isTrainingCaptureEnabled()).toBe(true);
  });
});
