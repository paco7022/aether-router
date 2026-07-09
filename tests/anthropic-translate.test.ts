import { describe, expect, it } from "vitest";
import {
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  openAIErrorToAnthropic,
  makeOpenAIToAnthropicStreamTransform,
} from "../src/lib/anthropic/translate";

// Drive an OpenAI SSE string through the transform and collect the emitted
// Anthropic events as parsed {event, data} pairs.
async function runStream(openaiSse: string): Promise<
  Array<{ event: string; data: any }>
> {
  const transform = makeOpenAIToAnthropicStreamTransform("t/claude-opus-4.8");
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const collected: string[] = [];
  const readAll = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      collected.push(dec.decode(value));
    }
  })();

  await writer.write(enc.encode(openaiSse));
  await writer.close();
  await readAll;

  const raw = collected.join("");
  const events: Array<{ event: string; data: any }> = [];
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    events.push({ event, data: data ? JSON.parse(data) : null });
  }
  return events;
}

describe("anthropicToOpenAIRequest", () => {
  it("moves system to a leading system message and passes string content", () => {
    const out = anthropicToOpenAIRequest({
      model: "t/x",
      max_tokens: 100,
      system: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(out.max_tokens).toBe(100);
  });

  it("flattens array system blocks", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      system: [
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
      messages: [{ role: "user", content: "q" }],
    });
    expect(out.messages[0].content).toBe("AB");
  });

  it("translates tools and tool_choice", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
      tool_choice: { type: "tool", name: "get_weather" },
    });
    expect(out.tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    });
    expect(out.tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("maps tool_choice any->required and auto->auto", () => {
    expect(
      anthropicToOpenAIRequest({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        tool_choice: { type: "any" },
      }).tool_choice
    ).toBe("required");
    expect(
      anthropicToOpenAIRequest({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        tool_choice: { type: "auto" },
      }).tool_choice
    ).toBe("auto");
  });

  it("converts assistant tool_use blocks to OpenAI tool_calls", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { city: "Paris" },
            },
          ],
        },
      ],
    });
    const assistant = out.messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("Let me check");
    expect(assistant.tool_calls?.[0]).toEqual({
      id: "toolu_1",
      type: "function",
      function: { name: "get_weather", arguments: JSON.stringify({ city: "Paris" }) },
    });
  });

  it("converts user tool_result blocks to OpenAI tool messages", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "sunny" },
          ],
        },
      ],
    });
    expect(out.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "toolu_1",
      content: "sunny",
    });
  });

  it("builds multimodal user content for images", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAAA" },
            },
          ],
        },
      ],
    });
    const content = out.messages[0].content as any[];
    expect(content[0]).toEqual({ type: "text", text: "what is this" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });

  it("maps stop_sequences to stop", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stop_sequences: ["END", 5 as any],
    });
    expect(out.stop).toEqual(["END"]);
  });
});

describe("openAIToAnthropicResponse", () => {
  it("translates a plain text completion", () => {
    const anth = openAIToAnthropicResponse(
      {
        id: "cmpl_1",
        model: "t/x",
        choices: [
          { message: { role: "assistant", content: "hello" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      },
      "fallback"
    );
    expect(anth.type).toBe("message");
    expect(anth.role).toBe("assistant");
    expect(anth.content).toEqual([{ type: "text", text: "hello" }]);
    expect(anth.stop_reason).toBe("end_turn");
    expect(anth.usage).toEqual({ input_tokens: 10, output_tokens: 3 });
  });

  it("translates tool_calls into tool_use blocks with parsed input", () => {
    const anth = openAIToAnthropicResponse(
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "f", arguments: '{"a":1}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
      "m"
    );
    expect(anth.stop_reason).toBe("tool_use");
    expect(anth.content).toEqual([
      { type: "tool_use", id: "call_1", name: "f", input: { a: 1 } },
    ]);
  });

  it("maps length finish_reason to max_tokens", () => {
    const anth = openAIToAnthropicResponse(
      { choices: [{ message: { content: "x" }, finish_reason: "length" }] },
      "m"
    );
    expect(anth.stop_reason).toBe("max_tokens");
  });
});

describe("openAIErrorToAnthropic", () => {
  it("wraps an OpenAI error in the Anthropic envelope", () => {
    const err = openAIErrorToAnthropic({
      error: { message: "Invalid API key", type: "auth_error" },
    });
    expect(err).toEqual({
      type: "error",
      error: { type: "authentication_error", message: "Invalid API key" },
    });
  });
});

describe("makeOpenAIToAnthropicStreamTransform", () => {
  it("emits the standard event sequence for a text stream", async () => {
    const sse =
      'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1}}\n\n' +
      "data: [DONE]\n\n";
    const events = await runStream(sse);
    const types = events.map((e) => e.event);
    expect(types[0]).toBe("message_start");
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
    expect(types).toContain("content_block_stop");
    expect(types).toContain("message_delta");
    expect(types[types.length - 1]).toBe("message_stop");

    const text = events
      .filter((e) => e.event === "content_block_delta")
      .map((e) => e.data.delta.text)
      .join("");
    expect(text).toBe("Hello");

    const msgDelta = events.find((e) => e.event === "message_delta");
    expect(msgDelta?.data.delta.stop_reason).toBe("end_turn");
    expect(msgDelta?.data.usage.output_tokens).toBe(1);
  });

  it("emits tool_use content blocks with input_json_delta", async () => {
    const sse =
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"NYC\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      "data: [DONE]\n\n";
    const events = await runStream(sse);

    const start = events.find(
      (e) => e.event === "content_block_start" && e.data.content_block.type === "tool_use"
    );
    expect(start?.data.content_block).toMatchObject({
      type: "tool_use",
      id: "call_1",
      name: "get_weather",
    });

    const json = events
      .filter(
        (e) =>
          e.event === "content_block_delta" &&
          e.data.delta.type === "input_json_delta"
      )
      .map((e) => e.data.delta.partial_json)
      .join("");
    expect(json).toBe('{"city":"NYC"}');
    expect(JSON.parse(json)).toEqual({ city: "NYC" });

    const msgDelta = events.find((e) => e.event === "message_delta");
    expect(msgDelta?.data.delta.stop_reason).toBe("tool_use");
  });

  it("switches from text to a tool block, closing the text block first", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"thinking"}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      "data: [DONE]\n\n";
    const events = await runStream(sse);
    const seq = events.map((e) => e.event);
    // text block opens (0), a stop must precede the tool block opening.
    const firstStop = seq.indexOf("content_block_stop");
    const toolStart = seq.findIndex(
      (_, i) =>
        events[i].event === "content_block_start" &&
        events[i].data.content_block?.type === "tool_use"
    );
    expect(firstStop).toBeGreaterThan(-1);
    expect(toolStart).toBeGreaterThan(firstStop);
    // block indices must be distinct and sequential.
    expect(events.find((e) => e.data?.content_block?.type === "text")?.data.index).toBe(0);
    expect(start_index(events, "tool_use")).toBe(1);
  });
});

function start_index(
  events: Array<{ event: string; data: any }>,
  blockType: string
): number | undefined {
  return events.find(
    (e) => e.event === "content_block_start" && e.data.content_block?.type === blockType
  )?.data.index;
}
