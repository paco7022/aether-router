import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dlabProvider } from "../src/lib/providers/dlab";
import type { ProviderRequest } from "../src/lib/providers/types";

// The dlab provider (a) floors an explicitly-low max_tokens so the upstream's
// hidden extended-thinking tokens can't consume the whole budget and return
// empty content, and (b) for non-streaming calls, retries with a doubled budget
// when the upstream still returns empty content + finish_reason "length".

const EMPTY_LENGTH = JSON.stringify({
  choices: [{ message: { role: "assistant", content: null }, finish_reason: "length" }],
  usage: { completion_tokens: 2048, total_tokens: 2099 },
});
const GOOD = JSON.stringify({
  choices: [{ message: { role: "assistant", content: "France - Paris" }, finish_reason: "stop" }],
  usage: { completion_tokens: 40, total_tokens: 91 },
});

// Queue of body strings; each fetch call returns the next (last repeats).
function mockFetchSequence(bodies: string[]) {
  let i = 0;
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyOf = (mock: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(mock.mock.calls[call][1]!.body as string);

const base: ProviderRequest = {
  model: "claude-opus-4.6",
  messages: [{ role: "user", content: "hi" }],
};

describe("dlabProvider max_tokens floor", () => {
  beforeEach(() => {
    process.env.DLAB_API_KEY = "test-key";
    delete process.env.DLAB_MIN_MAX_TOKENS; // default 2048
  });
  afterEach(() => vi.unstubAllGlobals());

  it("raises an explicitly-low max_tokens to the floor", async () => {
    const f = mockFetchSequence([GOOD]);
    await dlabProvider.forward({ ...base, max_tokens: 100 });
    expect(bodyOf(f, 0).max_tokens).toBe(2048);
  });

  it("leaves a max_tokens already at/above the floor untouched", async () => {
    const f = mockFetchSequence([GOOD]);
    await dlabProvider.forward({ ...base, max_tokens: 4000 });
    expect(bodyOf(f, 0).max_tokens).toBe(4000);
  });

  it("leaves an unset max_tokens untouched", async () => {
    const f = mockFetchSequence([GOOD]);
    await dlabProvider.forward({ ...base });
    expect(bodyOf(f, 0).max_tokens).toBeUndefined();
  });

  it("preserves other request fields when flooring", async () => {
    const f = mockFetchSequence([GOOD]);
    await dlabProvider.forward({ ...base, max_tokens: 30, temperature: 0, stream: true });
    const body = bodyOf(f, 0);
    expect(body.max_tokens).toBe(2048);
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("claude-opus-4.6");
  });
});

describe("dlabProvider retry-on-empty (non-streaming)", () => {
  beforeEach(() => {
    process.env.DLAB_API_KEY = "test-key";
    delete process.env.DLAB_MIN_MAX_TOKENS;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("retries with a doubled budget when content is empty + finish_reason=length", async () => {
    const f = mockFetchSequence([EMPTY_LENGTH, GOOD]);
    const res = await dlabProvider.forward({ ...base, max_tokens: 100 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 0).max_tokens).toBe(2048); // floored first attempt
    expect(bodyOf(f, 1).max_tokens).toBe(4096); // doubled on retry
    expect((await res.json()).choices[0].message.content).toBe("France - Paris");
  });

  it("stops doubling at the retry ceiling (8192) and returns the last response", async () => {
    const f = mockFetchSequence([EMPTY_LENGTH]); // always empty
    const res = await dlabProvider.forward({ ...base, max_tokens: 100 });
    // 2048 -> 4096 -> 8192, then ceiling reached: 3 calls total.
    expect(f).toHaveBeenCalledTimes(3);
    expect(bodyOf(f, 1).max_tokens).toBe(4096);
    expect(bodyOf(f, 2).max_tokens).toBe(8192);
    expect(res.status).toBe(200);
  });

  it("does NOT retry an empty streaming response (cannot replay a stream)", async () => {
    const f = mockFetchSequence([EMPTY_LENGTH]);
    await dlabProvider.forward({ ...base, max_tokens: 100, stream: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on a good first response (no extra calls)", async () => {
    const f = mockFetchSequence([GOOD, GOOD]);
    await dlabProvider.forward({ ...base, max_tokens: 100 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
