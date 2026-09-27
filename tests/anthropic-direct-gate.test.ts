import { describe, expect, it } from "vitest";
import {
  isAllowedClaudeProvider,
  isAnthropicDirectAllowed,
} from "../src/lib/claude-block";

describe("Anthropic direct (ad/) access gate", () => {
  it("is never a member of ALLOWED_CLAUDE_PROVIDERS", () => {
    // "anthropic" must never fall through to the normal plan-based Claude
    // gate — the whole point of isAnthropicDirectAllowed is that it's the
    // ONLY door in.
    expect(isAllowedClaudeProvider("anthropic")).toBe(false);
  });

  it("blocks a regular (non-custom) key even if paid + claude_activated", () => {
    expect(
      isAnthropicDirectAllowed({ isCustom: false, allowedProviders: null })
    ).toBe(false);
  });

  it("blocks a custom key with no allowed_providers restriction (null = all)", () => {
    // Other custom keys (B2B, older friend keys) default allowed_providers to
    // null meaning "all providers" for THEM — that must not silently include
    // "anthropic" just because they're custom.
    expect(
      isAnthropicDirectAllowed({ isCustom: true, allowedProviders: null })
    ).toBe(false);
  });

  it("blocks a custom key whose allowlist doesn't mention anthropic", () => {
    expect(
      isAnthropicDirectAllowed({
        isCustom: true,
        allowedProviders: ["kiro", "shoot"],
      })
    ).toBe(false);
  });

  it("allows a custom key explicitly allowlisted for anthropic", () => {
    expect(
      isAnthropicDirectAllowed({
        isCustom: true,
        allowedProviders: ["kiro", "anthropic"],
      })
    ).toBe(true);
  });
});
