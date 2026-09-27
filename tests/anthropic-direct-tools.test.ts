import { describe, expect, it } from "vitest";
import {
  anthropicToOpenAINonStream,
  openAIToAnthropic,
} from "../src/lib/providers/anthropic";
import type { ProviderRequest } from "../src/lib/providers/types";

describe("anthropic direct (ad/) tool-call translation", () => {
  it("translates OpenAI `tools` + `tool_choice` to Anthropic shape", () => {
    const req: ProviderRequest = {
      model: "ad/claude-opus-5",
      messages: [{ role: "user", content: "what's the weather in Lima?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    } as unknown as ProviderRequest;

    const body = openAIToAnthropic(req);

    expect(body.tools).toEqual([
      {
        name: "get_weather",
        description: "Get current weather",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "tool", name: "get_weather" });
  });

  it("maps auto/required/none tool_choice strings", () => {
    const base = (choice: unknown): ProviderRequest =>
      ({
        model: "ad/claude-opus-5",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: choice,
      }) as unknown as ProviderRequest;

    expect(openAIToAnthropic(base("auto")).tool_choice).toEqual({ type: "auto" });
    expect(openAIToAnthropic(base("required")).tool_choice).toEqual({ type: "any" });
    expect(openAIToAnthropic(base("none")).tool_choice).toEqual({ type: "none" });
  });

  it("turns an assistant tool_calls message into a tool_use content block", () => {
    const req: ProviderRequest = {
      model: "ad/claude-opus-5",
      messages: [
        { role: "user", content: "what's the weather in Lima?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Lima"}' } },
          ],
        },
      ],
    } as unknown as ProviderRequest;

    const body = openAIToAnthropic(req);
    const assistantMsg = body.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toEqual([
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Lima" } },
    ]);
  });

  it("merges consecutive OpenAI tool-result messages into one Anthropic user message", () => {
    const req: ProviderRequest = {
      model: "ad/claude-opus-5",
      messages: [
        { role: "user", content: "compare weather in Lima and Cusco" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Lima"}' } },
            { id: "call_2", type: "function", function: { name: "get_weather", arguments: '{"city":"Cusco"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "22C sunny" },
        { role: "tool", tool_call_id: "call_2", content: "15C cloudy" },
        { role: "user", content: "thanks!" },
      ],
    } as unknown as ProviderRequest;

    const body = openAIToAnthropic(req);
    // [user, assistant(tool_use x2), user(tool_result x2 + "thanks!")] —
    // consecutive user content merges into one turn, tool_results first.
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_1", content: "22C sunny" },
        { type: "tool_result", tool_use_id: "call_2", content: "15C cloudy" },
        { type: "text", text: "thanks!" },
      ],
    });
  });

  it("puts tool_result blocks first even if user text arrives before them", () => {
    const req = {
      model: "ad/claude-opus-5",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }],
        },
        { role: "user", content: "<system-reminder>be brief</system-reminder>" },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
    } as unknown as ProviderRequest;

    const last = openAIToAnthropic(req).messages[2];
    expect((last.content as Array<{ type: string }>).map((b) => b.type)).toEqual([
      "tool_result",
      "text",
    ]);
  });

  it("drops empty messages instead of sending empty content", () => {
    const req = {
      model: "ad/claude-opus-5",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "" },
        { role: "user", content: "again" },
      ],
    } as unknown as ProviderRequest;

    expect(openAIToAnthropic(req).messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }, { type: "text", text: "again" }] },
    ]);
  });

  it("translates images in user messages and in tool results", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const req = {
      model: "ad/claude-opus-5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: png } },
          ],
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: [{ type: "image_url", image_url: { url: png } }],
        },
      ],
    } as unknown as ProviderRequest;

    const body = openAIToAnthropic(req);
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
    expect(body.messages[0].content).toEqual([{ type: "text", text: "what is this?" }, image]);
    expect(body.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "call_1", content: [image] },
    ]);
  });

  it("reports prompt_tokens in OpenAI semantics (uncached + cache read + cache write)", () => {
    const openAi = anthropicToOpenAINonStream(
      {
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 4, cache_read_input_tokens: 78000, cache_creation_input_tokens: 300, output_tokens: 10 },
      },
      "ad/claude-opus-5"
    );
    expect(openAi.usage.prompt_tokens).toBe(78304);
    expect(openAi.usage.cache_read_input_tokens).toBe(78000);
    expect(openAi.usage.cache_creation_input_tokens).toBe(300);
  });

  it("translates an Anthropic tool_use response block into OpenAI tool_calls", () => {
    const openAi = anthropicToOpenAINonStream(
      {
        id: "msg_1",
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Lima" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      "ad/claude-opus-5"
    );

    expect(openAi.choices[0].finish_reason).toBe("tool_calls");
    expect(openAi.choices[0].message.content).toBeNull();
    expect(openAi.choices[0].message.tool_calls).toEqual([
      { id: "toolu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Lima"}' } },
    ]);
  });
});
