"use client";

import { useRef, useState, useCallback } from "react";
import { parseSillyTavernPreset, type UserPreset } from "@/lib/preset";

const MAX_PRESET_BYTES = 256 * 1024;

interface Props {
  initialPreset: UserPreset | null;
  initialEnabled: boolean;
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative flex items-center gap-2 cursor-pointer shrink-0"
      aria-label={label}
    >
      <span className="text-xs text-[var(--text-dim)]">{value ? "Enabled" : "Disabled"}</span>
      <span
        className="relative inline-block w-10 h-5 rounded-full transition-colors duration-200"
        style={{
          background: value
            ? "linear-gradient(90deg, rgba(34,211,238,0.5), rgba(139,92,246,0.5))"
            : "rgba(255,255,255,0.07)",
          border: value ? "1px solid rgba(34,211,238,0.3)" : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-200"
          style={{
            background: value ? "rgba(34,211,238,0.9)" : "rgba(255,255,255,0.25)",
            transform: value ? "translateX(20px)" : "translateX(0)",
          }}
        />
      </span>
    </button>
  );
}

function SmallToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative inline-block w-8 h-4 rounded-full transition-colors duration-200 cursor-pointer shrink-0"
      style={{
        background: value
          ? "linear-gradient(90deg, rgba(34,211,238,0.45), rgba(139,92,246,0.45))"
          : "rgba(255,255,255,0.07)",
        border: value ? "1px solid rgba(34,211,238,0.25)" : "1px solid rgba(255,255,255,0.08)",
      }}
      aria-pressed={value}
    >
      <span
        className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full transition-transform duration-200"
        style={{
          background: value ? "rgba(34,211,238,0.9)" : "rgba(255,255,255,0.25)",
          transform: value ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

function SectionHeader({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 w-full text-left cursor-pointer group"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--text-dim)] transition-transform duration-200"
        style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)] group-hover:text-white/50 transition-colors">
        {title}
      </span>
    </button>
  );
}

type PromptItem = UserPreset["prompts"][number];

function PromptCard({
  prompt,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  prompt: PromptItem;
  index: number;
  total: number;
  onChange: (p: PromptItem) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className="rounded-xl p-3 transition-colors"
      style={{
        background: prompt.enabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-2">
        <SmallToggle value={prompt.enabled} onChange={(v) => onChange({ ...prompt, enabled: v })} />

        <input
          value={prompt.name}
          onChange={(e) => onChange({ ...prompt, name: e.target.value })}
          placeholder="Prompt name"
          className="flex-1 min-w-0 bg-transparent text-sm text-white/80 placeholder:text-white/20 focus:outline-none"
        />

        <select
          value={prompt.role}
          onChange={(e) => onChange({ ...prompt, role: e.target.value as PromptItem["role"] })}
          className="text-xs rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            color:
              prompt.role === "system"
                ? "rgba(34,211,238,0.8)"
                : prompt.role === "assistant"
                ? "rgba(139,92,246,0.8)"
                : "rgba(255,255,255,0.6)",
          }}
        >
          <option value="system">system</option>
          <option value="user">user</option>
          <option value="assistant">assistant</option>
        </select>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded-lg text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer"
          title={expanded ? "Collapse" : "Expand"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className="p-1 rounded-lg text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer disabled:opacity-20"
          title="Move up"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          className="p-1 rounded-lg text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer disabled:opacity-20"
          title="Move down"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {confirmDelete ? (
          <>
            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-red-400/80 hover:text-red-400 transition-colors cursor-pointer px-1"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer px-1"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="p-1 rounded-lg text-[var(--text-dim)] hover:text-red-400/60 transition-colors cursor-pointer"
            title="Delete"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <textarea
          value={prompt.content}
          onChange={(e) => onChange({ ...prompt, content: e.target.value.slice(0, 32 * 1024) })}
          placeholder="Prompt content…"
          rows={6}
          className="mt-3 w-full rounded-lg text-sm text-white/75 resize-y placeholder:text-white/20 focus:outline-none transition-colors"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "0.6rem 0.75rem",
            fontFamily: "inherit",
          }}
        />
      )}
    </div>
  );
}

function emptyPreset(): UserPreset {
  return {
    version: 1,
    name: "My Preset",
    sampling: {},
    prompts: [],
    assistant_prefill: "",
    prefill_enabled: false,
    squash_system_messages: false,
  };
}

function newPrompt(): PromptItem {
  return {
    id: crypto.randomUUID(),
    name: "New Prompt",
    role: "system",
    content: "",
    enabled: true,
  };
}

const SAMPLING_FIELDS: Array<{
  key: keyof UserPreset["sampling"];
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "temperature", label: "Temperature", min: 0, max: 5, step: 0.01 },
  { key: "top_p", label: "Top P", min: 0, max: 1, step: 0.01 },
  { key: "top_k", label: "Top K", min: 0, max: 200, step: 1 },
  { key: "frequency_penalty", label: "Frequency Penalty", min: -2, max: 2, step: 0.01 },
  { key: "presence_penalty", label: "Presence Penalty", min: -2, max: 2, step: 0.01 },
  { key: "repetition_penalty", label: "Repetition Penalty", min: 0, max: 3, step: 0.01 },
  { key: "max_tokens", label: "Max Tokens", min: 1, max: 128000, step: 1 },
];

export function PresetCard({ initialPreset, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [preset, setPreset] = useState<UserPreset>(initialPreset ?? emptyPreset());
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [samplingOpen, setSamplingOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [prefillOpen, setPrefillOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const serializedSize = JSON.stringify({ preset, preset_enabled: enabled }).length;
  const nearLimit = serializedSize > MAX_PRESET_BYTES * 0.85;
  const overLimit = serializedSize > MAX_PRESET_BYTES;

  const updateSampling = useCallback(
    (key: keyof UserPreset["sampling"], value: number | undefined) => {
      setPreset((p) => {
        const s = { ...p.sampling };
        if (value === undefined) {
          delete s[key];
        } else {
          s[key] = value;
        }
        return { ...p, sampling: s };
      });
    },
    []
  );

  const updatePrompt = useCallback((index: number, updated: PromptItem) => {
    setPreset((p) => {
      const prompts = [...p.prompts];
      prompts[index] = updated;
      return { ...p, prompts };
    });
  }, []);

  const deletePrompt = useCallback((index: number) => {
    setPreset((p) => ({ ...p, prompts: p.prompts.filter((_, i) => i !== index) }));
  }, []);

  const movePrompt = useCallback((index: number, dir: -1 | 1) => {
    setPreset((p) => {
      const prompts = [...p.prompts];
      const target = index + dir;
      if (target < 0 || target >= prompts.length) return p;
      [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
      return { ...p, prompts };
    });
  }, []);

  const addPrompt = useCallback(() => {
    setPreset((p) => ({ ...p, prompts: [...p.prompts, newPrompt()] }));
  }, []);

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const parsed = parseSillyTavernPreset(json);
        setPreset(parsed);
        setImportMsg(`Imported ${parsed.prompts.length} prompt${parsed.prompts.length !== 1 ? "s" : ""} from "${parsed.name}"`);
        setTimeout(() => setImportMsg(""), 4000);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not parse JSON file.");
        setStatus("error");
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  async function save() {
    if (overLimit) return;
    setStatus("saving");
    setErrorMsg("");
    const res = await fetch("/api/v1/account/preset", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "AetherRouter",
      },
      body: JSON.stringify({ preset, preset_enabled: enabled }),
    });
    if (res.ok) {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } else {
      const d = await res.json().catch(() => ({}));
      setErrorMsg((d as { error?: string }).error ?? "Failed to save.");
      setStatus("error");
    }
  }

  return (
    <div className="glass-card shimmer-line p-6 mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--aurora-cyan)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-60"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h3 className="font-semibold text-white/85">Preset</h3>
        </div>
        <Toggle
          value={enabled}
          onChange={setEnabled}
          label={enabled ? "Disable preset" : "Enable preset"}
        />
      </div>

      <p className="text-xs text-[var(--text-dim)] mb-5 leading-relaxed">
        When enabled, this preset is applied to every request: sampling parameters override client
        values, prompts are prepended in order, and optional prefill is appended. Import a
        SillyTavern preset JSON to populate it automatically.
      </p>

      {/* Preset name */}
      <div className="mb-5">
        <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider block mb-1">
          Preset Name
        </label>
        <input
          value={preset.name}
          onChange={(e) => setPreset((p) => ({ ...p, name: e.target.value }))}
          placeholder="My Preset"
          className="w-full rounded-xl text-sm text-white/80 placeholder:text-white/20 focus:outline-none transition-colors"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            padding: "0.5rem 0.75rem",
          }}
        />
      </div>

      {/* Sampling */}
      <div className="mb-4">
        <SectionHeader
          title="Sampling Parameters"
          open={samplingOpen}
          onToggle={() => setSamplingOpen((v) => !v)}
        />
        {samplingOpen && (
          <div className="mt-3 space-y-2">
            {SAMPLING_FIELDS.map(({ key, label, min, max, step }) => {
              const active = preset.sampling[key] != null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <SmallToggle
                    value={active}
                    onChange={(v) => {
                      if (!v) {
                        updateSampling(key, undefined);
                      } else {
                        const defaults: UserPreset["sampling"] = {
                          temperature: 1,
                          top_p: 1,
                          top_k: 0,
                          frequency_penalty: 0,
                          presence_penalty: 0,
                          repetition_penalty: 1,
                          max_tokens: 2048,
                        };
                        updateSampling(key, defaults[key]);
                      }
                    }}
                  />
                  <span
                    className="text-xs w-36 shrink-0"
                    style={{ color: active ? "rgba(255,255,255,0.65)" : "var(--text-dim)" }}
                  >
                    {label}
                  </span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    disabled={!active}
                    value={preset.sampling[key] ?? ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateSampling(key, v);
                    }}
                    className="w-24 rounded-lg text-sm text-white/80 focus:outline-none transition-colors disabled:opacity-30"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      padding: "0.35rem 0.6rem",
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Squash system messages */}
      <div className="flex items-center gap-3 mb-4 py-2 border-t border-white/[0.04]">
        <SmallToggle
          value={preset.squash_system_messages}
          onChange={(v) => setPreset((p) => ({ ...p, squash_system_messages: v }))}
        />
        <span className="text-xs text-[var(--text-dim)]">Squash consecutive system messages into one</span>
      </div>

      {/* Prompts */}
      <div className="mb-4 border-t border-white/[0.04] pt-4">
        <SectionHeader
          title={`Prompts (${preset.prompts.length})`}
          open={promptsOpen}
          onToggle={() => setPromptsOpen((v) => !v)}
        />
        {promptsOpen && (
          <div className="mt-3 space-y-2">
            {preset.prompts.length === 0 && (
              <p className="text-xs text-[var(--text-dim)] py-2">
                No prompts yet. Import a SillyTavern JSON or add one manually.
              </p>
            )}
            {preset.prompts.map((prompt, i) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                index={i}
                total={preset.prompts.length}
                onChange={(updated) => updatePrompt(i, updated)}
                onDelete={() => deletePrompt(i)}
                onMove={(dir) => movePrompt(i, dir)}
              />
            ))}
            <button
              type="button"
              onClick={addPrompt}
              className="mt-1 px-3 py-1.5 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Prompt
            </button>
          </div>
        )}
      </div>

      {/* Assistant prefill */}
      <div className="mb-5 border-t border-white/[0.04] pt-4">
        <SectionHeader
          title="Assistant Prefill"
          open={prefillOpen}
          onToggle={() => setPrefillOpen((v) => !v)}
        />
        {prefillOpen && (
          <div className="mt-3">
            <div className="flex items-center gap-3 mb-3">
              <SmallToggle
                value={preset.prefill_enabled}
                onChange={(v) => setPreset((p) => ({ ...p, prefill_enabled: v }))}
              />
              <span className="text-xs text-[var(--text-dim)]">Enable assistant prefill</span>
            </div>
            <textarea
              value={preset.assistant_prefill}
              onChange={(e) => setPreset((p) => ({ ...p, assistant_prefill: e.target.value }))}
              placeholder="Text to prepend to the model's response…"
              rows={4}
              disabled={!preset.prefill_enabled}
              className="w-full rounded-xl text-sm text-white/80 resize-y placeholder:text-white/20 focus:outline-none transition-colors disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "0.75rem 1rem",
                fontFamily: "inherit",
              }}
            />
            <p className="mt-1.5 text-[10px] text-[var(--text-dim)] leading-relaxed">
              Only applied on providers that accept a trailing assistant turn as a prefill signal
              (Anthropic-routed). OpenAI-native endpoints ignore it.
            </p>
          </div>
        )}
      </div>

      {/* Size warning */}
      {nearLimit && (
        <p
          className="mb-3 text-xs font-mono"
          style={{ color: overLimit ? "rgba(239,68,68,0.8)" : "rgba(251,191,36,0.7)" }}
        >
          Preset size: {(serializedSize / 1024).toFixed(1)} KB / 256 KB
          {overLimit && " — exceeds limit, cannot save"}
        </p>
      )}

      {/* Import confirmation */}
      {importMsg && (
        <p className="mb-3 text-xs" style={{ color: "rgba(34,211,238,0.8)" }}>
          {importMsg}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || overLimit}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-all cursor-pointer disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(34,211,238,0.25))",
            border: "1px solid rgba(139,92,246,0.25)",
          }}
        >
          {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Save"}
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 rounded-xl text-sm btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import SillyTavern JSON
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />

        <button
          type="button"
          onClick={() => setPreset(emptyPreset())}
          className="px-3 py-2 rounded-xl text-xs text-[var(--text-dim)] hover:text-white/60 transition-all cursor-pointer"
        >
          Reset
        </button>
      </div>

      {status === "error" && errorMsg && (
        <p className="mt-3 text-xs text-red-400/80">{errorMsg}</p>
      )}
    </div>
  );
}
