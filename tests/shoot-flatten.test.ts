import { describe, it, expect } from "vitest";
import {
  flattenClaudeRequest,
  hasToolUsage,
  isContentBlock,
} from "../src/lib/providers/shoot";
import type { ProviderRequest } from "../src/lib/providers/types";

const base = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "claude-opus-4-7",
  messages: [
    { role: "system", content: "You are Aria." },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey" },
    { role: "user", content: "how are you" },
  ],
  ...over,
});

describe("flattenClaudeRequest", () => {
  it("collapses every turn into a single user message", () => {
    const out = flattenClaudeRequest(base());
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
    const text = out.messages[0].content as string;
    expect(text).toContain("You are Aria.");
    expect(text).toContain("Human: hi");
    expect(text).toContain("Assistant: hey");
    expect(text).toContain("Human: how are you");
  });

  it("preserves passthrough params and strips tool scaffolding", () => {
    const out = flattenClaudeRequest(
      base({
        stream: true,
        max_tokens: 123,
        temperature: 0.7,
        tools: [{ type: "function", function: { name: "x" } }],
        tool_choice: "auto",
      } as Partial<ProviderRequest>)
    );
    expect(out.stream).toBe(true);
    expect(out.max_tokens).toBe(123);
    expect(out.temperature).toBe(0.7);
    expect((out as Record<string, unknown>).tools).toBeUndefined();
    expect((out as Record<string, unknown>).tool_choice).toBeUndefined();
  });

  it("extracts text from array-style (multimodal) content", () => {
    const out = flattenClaudeRequest(
      base({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "part-a" },
              { type: "image_url", image_url: { url: "x" } },
              { type: "text", text: "part-b" },
            ],
          },
        ] as unknown as ProviderRequest["messages"],
      })
    );
    const text = out.messages[0].content as string;
    expect(text).toContain("part-a");
    expect(text).toContain("part-b");
  });
});

describe("hasToolUsage", () => {
  it("is false for a plain chat request", () => {
    expect(hasToolUsage(base())).toBe(false);
  });
  it("is true when tools are declared", () => {
    expect(
      hasToolUsage(base({ tools: [{ type: "function" }] } as Partial<ProviderRequest>))
    ).toBe(true);
  });
  it("is true when a message carries tool_calls or role:tool", () => {
    expect(
      hasToolUsage(
        base({
          messages: [
            { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
          ] as unknown as ProviderRequest["messages"],
        })
      )
    ).toBe(true);
    expect(
      hasToolUsage(
        base({
          messages: [
            { role: "tool", content: "result" },
          ] as unknown as ProviderRequest["messages"],
        })
      )
    ).toBe(true);
  });
});

describe("isContentBlock", () => {
  it("matches the upstream content-blocked 400", () => {
    expect(
      isContentBlock(
        400,
        '{"error":{"type":"agent_router_api_error","code":"content-blocked"}}'
      )
    ).toBe(true);
  });
  it("ignores non-400 and unrelated 400s", () => {
    expect(isContentBlock(500, "content-blocked")).toBe(false);
    expect(isContentBlock(400, '{"error":{"message":"bad request"}}')).toBe(false);
  });
});
