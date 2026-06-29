// Shared stall guard for streaming (SSE) provider responses.
//
// Some upstream resellers keep a stream "alive" without ever producing
// content: ZenLLM emits ": ping" comment keepalives forever when a model is
// unavailable (opus-4-8 returns 503 non-stream but just pings on stream);
// Orbit/Anthropic upstreams can send `event: ping` and then stall without a
// terminal `message_stop`. A raw passthrough forwards those non-events, so the
// client (e.g. SillyTavern) sits in "streaming…" with no content and no end.
//
// guardSseStall wraps an OpenAI-shaped SSE ReadableStream so that if no real
// `data:` event arrives for `stallMs`, we cancel the upstream, emit a terminal
// error chunk + [DONE], and close — turning an infinite hang into a fast,
// visible failure the client can retry / fall back from. Only `data:` lines
// count as progress; ": " comment pings do NOT reset the clock (that's exactly
// the stuck-stream case we're catching).
//
// The wrapped stream must already be in OpenAI SSE wire format (`data: {…}` per
// chunk). For providers that translate another protocol (e.g. Orbit's
// Anthropic→OpenAI transform), apply this AFTER that transform.

export const DEFAULT_STREAM_STALL_MS = 120_000;

export function guardSseStall(
  source: ReadableStream<Uint8Array>,
  stallMs: number = DEFAULT_STREAM_STALL_MS
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let lastData = Date.now();
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const clear = () => {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      watchdog = setInterval(() => {
        if (Date.now() - lastData <= stallMs) return;
        clear();
        reader.cancel().catch(() => {});
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: {
                message: `Upstream produced no content for ${Math.round(
                  stallMs / 1000
                )}s — the model may be temporarily unavailable. Please retry.`,
                type: "upstream_stall",
                code: "stream_stalled",
              },
            })}\n\n`
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }, 5_000);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clear();
          controller.close();
          return;
        }
        if (/^data:/m.test(decoder.decode(value, { stream: true }))) {
          lastData = Date.now();
        }
        controller.enqueue(value);
      } catch {
        clear();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel(reason) {
      clear();
      reader.cancel(reason).catch(() => {});
    },
  });
}
