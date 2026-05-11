export interface UserPreset {
  version: 1;
  name: string;
  sampling: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    max_tokens?: number;
  };
  prompts: Array<{
    id: string;
    name: string;
    role: "system" | "user" | "assistant";
    content: string;
    enabled: boolean;
  }>;
  assistant_prefill: string;
  prefill_enabled: boolean;
  squash_system_messages: boolean;
}

const MAX_PROMPT_CONTENT = 32 * 1024;
const MAX_PRESET_BYTES = 256 * 1024;

// ST markers are placeholders filled by the client (charDescription, chatHistory, etc.).
// We skip them because they carry no static content useful server-side.
function isMarker(p: Record<string, unknown>): boolean {
  return p.marker === true;
}

function coerceRole(r: unknown): "system" | "user" | "assistant" {
  if (r === "user" || r === "assistant") return r;
  return "system";
}

export function parseSillyTavernPreset(json: unknown): UserPreset {
  if (!json || typeof json !== "object") throw new Error("Not an object");
  const raw = json as Record<string, unknown>;

  const rawPrompts = Array.isArray(raw.prompts) ? (raw.prompts as Record<string, unknown>[]) : [];
  const promptMap = new Map<string, Record<string, unknown>>();
  for (const p of rawPrompts) {
    if (typeof p.identifier === "string") promptMap.set(p.identifier, p);
  }

  // Find the prompt_order for character_id 100000 (the global default).
  // Fall back to the first entry if 100000 is not present.
  let order: Array<{ identifier: string; enabled: boolean }> = [];
  if (Array.isArray(raw.prompt_order)) {
    const po = raw.prompt_order as Array<Record<string, unknown>>;
    const entry =
      po.find((e) => e.character_id === 100000) ?? po[0];
    if (entry && Array.isArray(entry.order)) {
      order = (entry.order as Array<Record<string, unknown>>).map((o) => ({
        identifier: String(o.identifier ?? ""),
        enabled: o.enabled !== false,
      }));
    }
  }

  const prompts: UserPreset["prompts"] = [];
  for (const { identifier, enabled } of order) {
    const p = promptMap.get(identifier);
    if (!p) continue;
    if (isMarker(p)) continue;
    const content = typeof p.content === "string" ? p.content : "";
    if (!content.trim()) continue;
    prompts.push({
      id: identifier,
      name: typeof p.name === "string" ? p.name : identifier,
      role: coerceRole(p.role),
      content: content.slice(0, MAX_PROMPT_CONTENT),
      enabled,
    });
  }

  const sampling: UserPreset["sampling"] = {};
  if (typeof raw.temperature === "number") sampling.temperature = raw.temperature;
  if (typeof raw.top_p === "number") sampling.top_p = raw.top_p;
  if (typeof raw.top_k === "number") sampling.top_k = raw.top_k;
  if (typeof raw.frequency_penalty === "number") sampling.frequency_penalty = raw.frequency_penalty;
  if (typeof raw.presence_penalty === "number") sampling.presence_penalty = raw.presence_penalty;
  if (typeof raw.repetition_penalty === "number") sampling.repetition_penalty = raw.repetition_penalty;
  if (typeof raw.openai_max_tokens === "number") sampling.max_tokens = raw.openai_max_tokens;

  const preset: UserPreset = {
    version: 1,
    name: typeof raw.name === "string" && raw.name ? raw.name : "Imported Preset",
    sampling,
    prompts,
    assistant_prefill: typeof raw.assistant_prefill === "string" ? raw.assistant_prefill : "",
    // Don't auto-enable prefill on import — user must opt in explicitly.
    prefill_enabled: false,
    squash_system_messages: raw.squash_system_messages === true,
  };

  const serialized = JSON.stringify(preset);
  if (serialized.length > MAX_PRESET_BYTES) {
    throw new Error(`Preset exceeds 256KB limit (${serialized.length} bytes)`);
  }

  return preset;
}

type ChatMessage = { role: string; content: string };

export function applyPreset(
  forwardBody: Record<string, unknown>,
  preset: UserPreset
): void {
  const s = preset.sampling;

  // Preset sampling fields override client values — presets are meant to be authoritative.
  if (s.temperature != null) forwardBody.temperature = s.temperature;
  if (s.top_p != null) forwardBody.top_p = s.top_p;
  if (s.top_k != null) forwardBody.top_k = s.top_k;
  if (s.frequency_penalty != null) forwardBody.frequency_penalty = s.frequency_penalty;
  if (s.presence_penalty != null) forwardBody.presence_penalty = s.presence_penalty;
  if (s.repetition_penalty != null) forwardBody.repetition_penalty = s.repetition_penalty;
  if (s.max_tokens != null) forwardBody.max_tokens = s.max_tokens;

  const enabledPrompts = preset.prompts.filter((p) => p.enabled);

  if (enabledPrompts.length > 0) {
    // Build preset message list, merging consecutive same-role messages.
    const presetMsgs: ChatMessage[] = [];
    for (const p of enabledPrompts) {
      const last = presetMsgs[presetMsgs.length - 1];
      if (last && last.role === p.role) {
        last.content += "\n\n" + p.content;
      } else {
        presetMsgs.push({ role: p.role, content: p.content });
      }
    }

    const existing = (forwardBody.messages as ChatMessage[] | undefined) ?? [];
    forwardBody.messages = [...presetMsgs, ...existing];
  }

  const msgs = (forwardBody.messages as ChatMessage[] | undefined) ?? [];

  if (preset.squash_system_messages) {
    const squashed: ChatMessage[] = [];
    for (const m of msgs) {
      const last = squashed[squashed.length - 1];
      if (m.role === "system" && last?.role === "system") {
        last.content += "\n\n" + m.content;
      } else {
        squashed.push({ ...m });
      }
    }
    forwardBody.messages = squashed;
  }

  // Assistant prefill: append as the last message.
  // This works on Anthropic-routed providers (Claude) which accept a trailing
  // assistant turn as a prefill signal. OpenAI-native endpoints silently ignore it.
  if (preset.prefill_enabled && preset.assistant_prefill) {
    const finalMsgs = (forwardBody.messages as ChatMessage[]);
    finalMsgs.push({ role: "assistant", content: preset.assistant_prefill });
  }
}

export function validatePreset(p: unknown): p is UserPreset {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  if (x.version !== 1) return false;
  if (typeof x.name !== "string") return false;
  if (typeof x.sampling !== "object" || x.sampling === null) return false;
  if (!Array.isArray(x.prompts)) return false;
  for (const pr of x.prompts as unknown[]) {
    if (!pr || typeof pr !== "object") return false;
    const prx = pr as Record<string, unknown>;
    if (typeof prx.id !== "string") return false;
    if (typeof prx.name !== "string") return false;
    if (prx.role !== "system" && prx.role !== "user" && prx.role !== "assistant") return false;
    if (typeof prx.content !== "string") return false;
    if (typeof prx.enabled !== "boolean") return false;
  }
  const s = x.sampling as Record<string, unknown>;
  const numFields = ["temperature", "top_p", "top_k", "frequency_penalty", "presence_penalty", "repetition_penalty", "max_tokens"];
  for (const f of numFields) {
    if (s[f] !== undefined && typeof s[f] !== "number") return false;
  }
  if (typeof x.assistant_prefill !== "string") return false;
  if (typeof x.prefill_enabled !== "boolean") return false;
  if (typeof x.squash_system_messages !== "boolean") return false;
  const serialized = JSON.stringify(p);
  if (serialized.length > MAX_PRESET_BYTES) return false;
  return true;
}
