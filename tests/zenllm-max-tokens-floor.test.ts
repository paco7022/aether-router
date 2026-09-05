import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zenllmProvider } from "../src/lib/providers/zenllm";
import type { ProviderRequest } from "../src/lib/providers/types";

// z/gpt-6-astra rejects max_tokens below 16 with a hard 400 instead of clamping
// it. The adapter raises an explicitly-low budget to that minimum so a client
// asking for a very short answer gets a short answer, not an error.

const OK = JSON.stringify({
  choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { completion_tokens: 2, total_tokens: 12 },
});

function mockFetch() {
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response(OK, { status: 200, headers: { "content-type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof mockFetch>) {
  return JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
}

describe("zenllm max_tokens floor", () => {
  beforeEach(() => {
    process.env.ZENLLM_API_KEY = "sk-test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZENLLM_API_KEY;
  });

  it("raises a below-minimum max_tokens to the upstream floor", async () => {
    const fetchMock = mockFetch();
    await zenllmProvider.forward({
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "di ok" }],
      max_tokens: 8,
    } as ProviderRequest);
    expect(sentBody(fetchMock).max_tokens).toBe(16);
  });

  it("leaves a normal max_tokens untouched", async () => {
    const fetchMock = mockFetch();
    await zenllmProvider.forward({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hola" }],
      max_tokens: 2048,
    } as ProviderRequest);
    expect(sentBody(fetchMock).max_tokens).toBe(2048);
  });

  it("does not invent a max_tokens when the client omitted it", async () => {
    const fetchMock = mockFetch();
    await zenllmProvider.forward({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hola" }],
    } as ProviderRequest);
    expect(sentBody(fetchMock).max_tokens).toBeUndefined();
  });
});
