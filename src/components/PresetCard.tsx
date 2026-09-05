"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberField, SectionHeader, SmallToggle, Toggle } from "./FieldControls";
import {
  MAX_PRESET_BYTES,
  MAX_PROMPT_CONTENT,
  parseSillyTavernPreset,
  validatePreset,
  type UserPreset,
  type UserPresetRow,
} from "@/lib/preset";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "AetherRouter",
} as const;

interface BuiltinPresetMeta {
  id: string;
  name: string;
  description: string;
}

interface Props {
  initialPresets: UserPresetRow[];
  initialActiveId: string | null;
  initialEnabled: boolean;
  builtinPresets: BuiltinPresetMeta[];
  initialBuiltinId: string | null;
}

type PromptItem = UserPreset["prompts"][number];

// Memoized: a big imported preset can hold 100+ prompts, and without this
// every keystroke in one textarea re-renders the whole list. Handlers take the
// prompt id / index so the parent can pass stable useCallback references.
const PromptCard = memo(function PromptCard({
  prompt,
  index,
  total,
  expanded,
  onToggleExpand,
  onChange,
  onDelete,
  onMove,
  draggable,
  onDragStart,
  onDrop,
  dragging,
}: {
  prompt: PromptItem;
  index: number;
  total: number;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onChange: (id: string, p: PromptItem) => void;
  onDelete: (id: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  draggable: boolean;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
  dragging: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [truncated, setTruncated] = useState(false);

  return (
    <div
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={draggable ? () => onDrop(index) : undefined}
      className="rounded-xl p-3 transition-colors"
      style={{
        background: prompt.enabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255,255,255,0.06)",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {draggable && (
          <span
            draggable
            onDragStart={() => onDragStart(index)}
            onDragEnd={() => onDrop(index)}
            className="cursor-grab active:cursor-grabbing text-[var(--text-dim)] hover:text-white/50 transition-colors shrink-0 px-0.5"
            title="Drag to reorder"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
            </svg>
          </span>
        )}

        <SmallToggle value={prompt.enabled} onChange={(v) => onChange(prompt.id, { ...prompt, enabled: v })} />

        {prompt.position === "depth" && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
            style={{
              background: "rgba(139,92,246,0.15)",
              color: "rgba(196,181,253,0.9)",
              border: "1px solid rgba(139,92,246,0.25)",
            }}
            title={`In-chat injection at depth ${prompt.depth ?? 0}`}
          >
            @{prompt.depth ?? 0}
          </span>
        )}

        <input
          value={prompt.name}
          onChange={(e) => onChange(prompt.id, { ...prompt, name: e.target.value })}
          placeholder="Prompt name"
          className="flex-1 min-w-[8rem] bg-transparent text-sm text-white/80 placeholder:text-white/20 focus:outline-none"
        />

        <select
          value={prompt.role}
          onChange={(e) => onChange(prompt.id, { ...prompt, role: e.target.value as PromptItem["role"] })}
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
          onClick={() => onToggleExpand(prompt.id)}
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
          onClick={() => onMove(index, -1)}
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
          onClick={() => onMove(index, 1)}
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
              onClick={() => onDelete(prompt.id)}
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
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[var(--text-dim)] uppercase tracking-wider text-[10px]">Injection</span>
            <select
              value={prompt.position ?? "relative"}
              onChange={(e) => {
                const pos = e.target.value as "relative" | "depth";
                if (pos === "depth") {
                  onChange(prompt.id, { ...prompt, position: "depth", relative_to: undefined, depth: prompt.depth ?? 0, order: prompt.order ?? 100 });
                } else {
                  onChange(prompt.id, { ...prompt, position: "relative", relative_to: prompt.relative_to ?? "before_history", depth: undefined, order: undefined });
                }
              }}
              className="rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
            >
              <option value="relative">Relative</option>
              <option value="depth">In-chat depth</option>
            </select>

            {(prompt.position ?? "relative") === "relative" ? (
              <select
                value={prompt.relative_to ?? "before_history"}
                onChange={(e) => onChange(prompt.id, { ...prompt, relative_to: e.target.value as "before_history" | "after_history" })}
                className="rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
              >
                <option value="before_history">Before history</option>
                <option value="after_history">After history</option>
              </select>
            ) : (
              <>
                <label className="flex items-center gap-1 text-[var(--text-dim)]">
                  Depth
                  <NumberField
                    min={0}
                    max={999}
                    step={1}
                    value={prompt.depth ?? 0}
                    onCommit={(v) => onChange(prompt.id, { ...prompt, depth: Math.max(0, Math.floor(v)) })}
                    className="w-16 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  />
                </label>
                <label className="flex items-center gap-1 text-[var(--text-dim)]">
                  Order
                  <NumberField
                    step={1}
                    value={prompt.order ?? 100}
                    onCommit={(v) => onChange(prompt.id, { ...prompt, order: Math.floor(v) })}
                    className="w-16 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  />
                </label>
              </>
            )}
          </div>

          <textarea
            value={prompt.content}
            onChange={(e) => {
              const raw = e.target.value;
              const clipped = raw.slice(0, MAX_PROMPT_CONTENT);
              setTruncated(clipped.length < raw.length);
              onChange(prompt.id, { ...prompt, content: clipped });
            }}
            placeholder="Prompt content…"
            rows={6}
            className="w-full rounded-lg text-sm text-white/75 resize-y placeholder:text-white/20 focus:outline-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "0.6rem 0.75rem",
              fontFamily: "inherit",
            }}
          />

          {truncated && (
            <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,191,36,0.85)" }}>
              A single prompt is capped at {Math.round(MAX_PROMPT_CONTENT / 1024)} KB — the text past
              that limit was not kept. Split it into two prompts.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

function emptyPreset(name = "My Preset"): UserPreset {
  return {
    version: 2,
    name,
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
    position: "relative",
    relative_to: "before_history",
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
  { key: "top_a", label: "Top A", min: 0, max: 1, step: 0.01 },
  { key: "min_p", label: "Min P", min: 0, max: 1, step: 0.01 },
  { key: "frequency_penalty", label: "Frequency Penalty", min: -2, max: 2, step: 0.01 },
  { key: "presence_penalty", label: "Presence Penalty", min: -2, max: 2, step: 0.01 },
  { key: "repetition_penalty", label: "Repetition Penalty", min: 0, max: 3, step: 0.01 },
  { key: "max_tokens", label: "Max Tokens", min: 1, max: 128000, step: 1 },
];

export function PresetCard({
  initialPresets,
  initialActiveId,
  initialEnabled,
  builtinPresets,
  initialBuiltinId,
}: Props) {
  const [presets, setPresets] = useState<UserPresetRow[]>(initialPresets);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialActiveId ?? initialPresets[0]?.id ?? null
  );
  const initialSelected = initialPresets.find((p) => p.id === (initialActiveId ?? initialPresets[0]?.id));
  const [preset, setPreset] = useState<UserPreset>(initialSelected?.preset ?? emptyPreset());

  const [enabled, setEnabled] = useState(initialEnabled);
  const [activeBuiltinId, setActiveBuiltinId] = useState<string | null>(initialBuiltinId);
  const [builtinStatus, setBuiltinStatus] = useState<"idle" | "saving" | "error">("idle");
  const [builtinError, setBuiltinError] = useState("");

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [importMsg, setImportMsg] = useState("");

  const [samplingOpen, setSamplingOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const builtinActive = activeBuiltinId !== null;
  const selectedRow = presets.find((p) => p.id === selectedId) ?? null;

  // Serializing a 256KB preset three times per render made typing lag on big
  // imported presets — do it once and derive both the dirty flag and the size.
  const serialized = useMemo(() => JSON.stringify(preset), [preset]);
  const dirty = useMemo(
    () =>
      selectedRow
        ? JSON.stringify(selectedRow.preset) !== serialized
        : preset.prompts.length > 0 || Object.keys(preset.sampling).length > 0,
    [selectedRow, serialized, preset]
  );

  async function setBuiltin(id: string | null) {
    setBuiltinStatus("saving");
    setBuiltinError("");
    const res = await fetch("/api/v1/account/builtin-preset", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ builtin_preset_id: id }),
    });
    if (res.ok) {
      setActiveBuiltinId(id);
      if (id !== null) setEnabled(true);
      setBuiltinStatus("idle");
    } else {
      const d = await res.json().catch(() => ({}));
      setBuiltinError((d as { error?: string }).error ?? "Failed to update built-in preset.");
      setBuiltinStatus("error");
    }
  }

  async function setEnabledRemote(v: boolean) {
    setEnabled(v); // optimistic
    const res = await fetch("/api/v1/account/preset", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ preset_enabled: v }),
    });
    if (!res.ok) {
      setEnabled(!v); // revert
      const d = await res.json().catch(() => ({}));
      setErrorMsg((d as { error?: string }).error ?? "Failed to toggle preset.");
      setStatus("error");
    }
  }

  const serializedSize = serialized.length;
  const nearLimit = serializedSize > MAX_PRESET_BYTES * 0.85;
  const overLimit = serializedSize > MAX_PRESET_BYTES;

  const updateSampling = useCallback(
    (key: keyof UserPreset["sampling"], value: number | undefined) => {
      setPreset((p) => {
        const s = { ...p.sampling };
        if (value === undefined) delete s[key];
        else s[key] = value;
        return { ...p, sampling: s };
      });
    },
    []
  );

  const updatePrompt = useCallback((id: string, updated: PromptItem) => {
    setPreset((p) => ({ ...p, prompts: p.prompts.map((pr) => (pr.id === id ? updated : pr)) }));
  }, []);

  const deletePrompt = useCallback((id: string) => {
    setPreset((p) => ({ ...p, prompts: p.prompts.filter((pr) => pr.id !== id) }));
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

  const reorderPrompt = useCallback((from: number, to: number) => {
    setPreset((p) => {
      if (from === to || from < 0 || to < 0 || from >= p.prompts.length || to >= p.prompts.length) return p;
      const prompts = [...p.prompts];
      const [moved] = prompts.splice(from, 1);
      prompts.splice(to, 0, moved);
      return { ...p, prompts };
    });
  }, []);

  const addPrompt = useCallback(() => {
    const np = newPrompt();
    setPreset((p) => ({ ...p, prompts: [...p.prompts, np] }));
    setExpandedIds((s) => new Set(s).add(np.id));
  }, []);

  const setAllEnabled = useCallback((v: boolean) => {
    setPreset((p) => ({ ...p, prompts: p.prompts.map((pr) => ({ ...pr, enabled: v })) }));
  }, []);

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
    setDragIndex(index);
  }, []);

  const handleDrop = useCallback(
    (index: number) => {
      const from = dragIndexRef.current;
      if (from !== null && from !== index) reorderPrompt(from, index);
      dragIndexRef.current = null;
      setDragIndex(null);
    },
    [reorderPrompt]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function loadRow(row: UserPresetRow | null) {
    setSelectedId(row?.id ?? null);
    setPreset(row?.preset ?? emptyPreset());
    setExpandedIds(new Set());
    setPromptSearch("");
    setStatus("idle");
    setErrorMsg("");
  }

  function selectPreset(id: string) {
    if (id === selectedId) return;
    if (dirty && !confirm("Discard unsaved changes to the current preset?")) return;
    loadRow(presets.find((p) => p.id === id) ?? null);
  }

  // Give an imported preset a name that doesn't collide with the library.
  function uniquePresetName(base: string): string {
    const taken = new Set(presets.map((row) => row.name));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base} (${i})`.slice(0, 120);
      if (!taken.has(candidate)) return candidate;
    }
    return base;
  }

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (dirty && !confirm("Discard the unsaved changes in the editor and load this file?")) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        // Round-trip: our own export validates directly; otherwise treat as a
        // SillyTavern Chat Completion preset and convert.
        const parsed = validatePreset(json) ? (json as UserPreset) : parseSillyTavernPreset(json);
        if (parsed.prompts.length === 0) {
          throw new Error("That file has no usable prompts — nothing was imported.");
        }
        // An import always lands as a NEW preset: otherwise the next Save would
        // silently overwrite whichever saved preset happened to be open.
        const name = uniquePresetName(parsed.name);
        setSelectedId(null);
        setPreset({ ...parsed, name });
        setExpandedIds(new Set());
        setPromptSearch("");
        setStatus("idle");
        setErrorMsg("");
        const depthCount = parsed.prompts.filter((p) => p.position === "depth").length;
        const depthNote = depthCount > 0 ? `, ${depthCount} depth-injected` : "";
        setImportMsg(
          `Imported ${parsed.prompts.length} prompt${parsed.prompts.length !== 1 ? "s" : ""}${depthNote} from "${parsed.name}" — loaded as the new preset "${name}", hit Save to keep it`
        );
        setTimeout(() => setImportMsg(""), 8000);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not parse JSON file.");
        setStatus("error");
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function exportPreset() {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "preset"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Save = update the selected library row, or create one if nothing is selected.
  async function save() {
    if (overLimit) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      if (selectedId) {
        const res = await fetch(`/api/v1/account/presets/${selectedId}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: preset.name, preset }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
        const { preset: row } = (await res.json()) as { preset: UserPresetRow };
        setPresets((list) => list.map((p) => (p.id === row.id ? row : p)));
      } else {
        const { row } = await createPreset(preset.name, preset);
        setSelectedId(row.id);
      }
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save.");
      setStatus("error");
    }
  }

  async function createPreset(name: string, p: UserPreset): Promise<{ row: UserPresetRow }> {
    const res = await fetch("/api/v1/account/presets", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, preset: p }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create preset.");
    const { preset: row } = (await res.json()) as { preset: UserPresetRow };
    setPresets((list) => [row, ...list]);
    return { row };
  }

  async function newBlankPreset() {
    if (dirty && !confirm("Discard unsaved changes to the current preset?")) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      const blank = emptyPreset(`Preset ${presets.length + 1}`);
      const { row } = await createPreset(blank.name, blank);
      loadRow(row);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  async function saveAs() {
    setStatus("saving");
    setErrorMsg("");
    try {
      const copyName = `${preset.name} copy`.slice(0, 120);
      const { row } = await createPreset(copyName, { ...preset, name: copyName });
      loadRow(row);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  async function activateSelected() {
    if (overLimit) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      let id = selectedId;
      if (!id) {
        const { row } = await createPreset(preset.name, preset);
        id = row.id;
        setSelectedId(id);
      }
      const res = await fetch(`/api/v1/account/presets/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: preset.name, preset, activate: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to activate.");
      const { preset: row } = (await res.json()) as { preset: UserPresetRow };
      setPresets((list) => list.map((p) => (p.id === row.id ? row : p)));
      setActiveId(id);
      setActiveBuiltinId(null); // server cleared the built-in selection
      setEnabled(true);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  async function deleteSelected() {
    if (!selectedId) {
      loadRow(null);
      return;
    }
    if (!confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/v1/account/presets/${selectedId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete.");
      const remaining = presets.filter((p) => p.id !== selectedId);
      setPresets(remaining);
      if (activeId === selectedId) setActiveId(null);
      loadRow(remaining[0] ?? null);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  // Unsaved edits used to vanish on reload or on any sidebar navigation.
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // App Router client navigations never hit beforeunload, so also intercept
    // in-app link clicks while there is something unsaved.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      if (anchor.origin !== window.location.origin) return;
      if (anchor.pathname === window.location.pathname) return;
      if (!confirm("You have unsaved preset changes. Leave this page and discard them?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const filteredPrompts = useMemo(() => {
    const q = promptSearch.trim().toLowerCase();
    return preset.prompts
      .map((p, realIndex) => ({ p, realIndex }))
      .filter(({ p }) =>
        !q || p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
      );
  }, [preset.prompts, promptSearch]);

  const canDrag = promptSearch.trim() === "";
  const customDisabled = builtinActive;

  return (
    <div className="glass-card shimmer-line p-6 mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-cyan)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h3 className="font-semibold text-white/85">Presets</h3>
        </div>
        <Toggle
          value={enabled}
          onChange={setEnabledRemote}
          label={enabled ? "Disable presets" : "Enable presets"}
        />
      </div>

      <p className="text-xs text-[var(--text-dim)] mb-5 leading-relaxed">
        Save multiple named presets and switch the active one. The active preset is applied to every
        request SillyTavern-style: sampling parameters apply (and optionally override the client&apos;s),
        prompts are injected relative to the chat history or at a set depth (the{" "}
        <span className="font-mono">@N</span> badge), macros are resolved, and optional prefill is
        appended. Import a SillyTavern preset JSON to populate one automatically.
      </p>

      {/* Aether built-in presets */}
      {builtinPresets.length > 0 && (
        <div className="mb-5 rounded-xl p-4"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.06), rgba(34,211,238,0.04))",
            border: "1px solid rgba(139,92,246,0.18)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-300/80">
              Aether Built-in Presets
            </h4>
          </div>
          <p className="text-[11px] text-[var(--text-dim)] mb-3 leading-relaxed">
            Curated by Aether. When active, the built-in preset overrides your own ones below.
            Prompt contents are private and only injected on the server.
          </p>
          <div className="space-y-2">
            {builtinPresets.map((bp) => {
              const isActive = activeBuiltinId === bp.id;
              return (
                <div
                  key={bp.id}
                  className="flex items-start gap-3 rounded-lg p-3 transition-colors"
                  style={{
                    background: isActive ? "rgba(139,92,246,0.10)" : "rgba(255,255,255,0.02)",
                    border: isActive ? "1px solid rgba(139,92,246,0.35)" : "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white/85">{bp.name}</span>
                      {isActive && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(34,211,238,0.15)", color: "rgba(34,211,238,0.9)", border: "1px solid rgba(34,211,238,0.25)" }}
                        >
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-dim)] mt-1 leading-relaxed">{bp.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBuiltin(isActive ? null : bp.id)}
                    disabled={builtinStatus === "saving"}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer disabled:opacity-50"
                    style={
                      isActive
                        ? { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }
                        : { background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(34,211,238,0.2))", border: "1px solid rgba(139,92,246,0.3)", color: "white" }
                    }
                  >
                    {isActive ? "Deactivate" : `Activate ${bp.name}`}
                  </button>
                </div>
              );
            })}
          </div>
          {builtinError && <p className="mt-2 text-xs text-red-400/80">{builtinError}</p>}
        </div>
      )}

      {/* Notice when a built-in is overriding custom */}
      {builtinActive && (
        <div className="mb-4 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)", color: "rgba(251,191,36,0.85)" }}
        >
          A built-in preset is currently active — your own presets below are not being applied.
          Deactivate the built-in, or activate one of your presets, to use your own.
        </div>
      )}

      {/* Preset library */}
      <div className="mb-5 rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
            My Presets ({presets.length})
          </h4>
          <button
            type="button"
            onClick={newBlankPreset}
            className="px-2.5 py-1 rounded-lg text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        </div>

        {presets.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)] py-1">
            No saved presets yet. Edit below and hit Save, or import a SillyTavern JSON.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presets.map((row) => {
              const isSelected = row.id === selectedId;
              const isActive = row.id === activeId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectPreset(row.id)}
                  className="px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 max-w-[16rem]"
                  style={{
                    background: isSelected ? "rgba(34,211,238,0.10)" : "rgba(255,255,255,0.03)",
                    border: isSelected ? "1px solid rgba(34,211,238,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    color: isSelected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.6)",
                  }}
                  title={isActive ? `${row.name} (active)` : row.name}
                >
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "rgba(34,211,238,0.9)", boxShadow: "0 0 6px rgba(34,211,238,0.8)" }} />
                  )}
                  <span className="truncate">{row.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Active / dirty status line */}
      <div className="flex items-center gap-2 mb-4 flex-wrap text-xs">
        {selectedRow && activeId === selectedRow.id ? (
          <span className="px-2 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.12)", color: "rgba(34,211,238,0.9)", border: "1px solid rgba(34,211,238,0.25)" }}>
            Editing the active preset
          </span>
        ) : (
          <span className="text-[var(--text-dim)]">
            {selectedRow ? "Editing a saved preset (not active)" : "Unsaved new preset"}
          </span>
        )}
        {dirty && <span className="text-amber-400/80">• unsaved changes</span>}
      </div>

      {/* Preset name */}
      <div className="mb-5">
        <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider block mb-1">Preset Name</label>
        <input
          value={preset.name}
          onChange={(e) => setPreset((p) => ({ ...p, name: e.target.value }))}
          placeholder="My Preset"
          className="w-full rounded-xl text-sm text-white/80 placeholder:text-white/20 focus:outline-none transition-colors"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", padding: "0.5rem 0.75rem" }}
        />
      </div>

      {/* Sampling */}
      <div className="mb-4">
        <SectionHeader title="Sampling Parameters" open={samplingOpen} onToggle={() => setSamplingOpen((v) => !v)} />
        {samplingOpen && (
          <div className="mt-3 space-y-2">
            {SAMPLING_FIELDS.map(({ key, label, min, max, step }) => {
              const active = preset.sampling[key] != null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <SmallToggle
                    value={active}
                    onChange={(v) => {
                      if (!v) updateSampling(key, undefined);
                      else {
                        const defaults: UserPreset["sampling"] = {
                          temperature: 1, top_p: 1, top_k: 0, top_a: 0, min_p: 0,
                          frequency_penalty: 0, presence_penalty: 0,
                          repetition_penalty: 1, max_tokens: 2048,
                        };
                        updateSampling(key, defaults[key]);
                      }
                    }}
                  />
                  <span className="text-xs w-36 shrink-0" style={{ color: active ? "rgba(255,255,255,0.65)" : "var(--text-dim)" }}>{label}</span>
                  <NumberField
                    min={min}
                    max={max}
                    step={step}
                    disabled={!active}
                    value={preset.sampling[key]}
                    onCommit={(v) => updateSampling(key, v)}
                    className="w-24 rounded-lg text-sm text-white/80 focus:outline-none transition-colors disabled:opacity-30"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", padding: "0.35rem 0.6rem" }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Behaviour */}
      <div className="border-t border-white/[0.04] pt-2">
        <div className="flex items-center gap-3 mb-3 py-1">
          <SmallToggle value={preset.strip_client_params === true} onChange={(v) => setPreset((p) => ({ ...p, strip_client_params: v }))} />
          <span className="text-xs text-[var(--text-dim)]">Ignore client sampler params (temp, top_p…) — preset is authoritative</span>
        </div>
        <div className="flex items-center gap-3 mb-3 py-1">
          <SmallToggle value={preset.squash_system_messages} onChange={(v) => setPreset((p) => ({ ...p, squash_system_messages: v }))} />
          <span className="text-xs text-[var(--text-dim)]">Squash consecutive system messages into one</span>
        </div>
        <div className="flex items-center gap-3 mb-4 py-1">
          <span className="text-xs text-[var(--text-dim)] w-36 shrink-0">Message post-processing</span>
          <select
            value={preset.post_processing ?? "none"}
            onChange={(e) => setPreset((p) => ({ ...p, post_processing: e.target.value as UserPreset["post_processing"] }))}
            className="text-xs rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
          >
            <option value="none">None</option>
            <option value="merge">Merge consecutive roles</option>
            <option value="semi_strict">Semi-strict</option>
            <option value="strict">Strict</option>
          </select>
        </div>
      </div>

      {/* Prompts */}
      <div className="mb-4 border-t border-white/[0.04] pt-4">
        <SectionHeader
          title={`Prompts (${preset.prompts.length})`}
          open={promptsOpen}
          onToggle={() => setPromptsOpen((v) => !v)}
          right={
            preset.prompts.length > 0 ? (
              <div className="flex items-center gap-2 text-[10px]">
                <button type="button" onClick={() => setAllEnabled(true)} className="text-[var(--text-dim)] hover:text-cyan-300/80 transition-colors cursor-pointer">Enable all</button>
                <span className="text-white/10">|</span>
                <button type="button" onClick={() => setAllEnabled(false)} className="text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer">Disable all</button>
                <span className="text-white/10">|</span>
                <button type="button" onClick={() => setExpandedIds(new Set(preset.prompts.map((p) => p.id)))} className="text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer">Expand all</button>
                <span className="text-white/10">|</span>
                <button type="button" onClick={() => setExpandedIds(new Set())} className="text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer">Collapse all</button>
              </div>
            ) : undefined
          }
        />
        {promptsOpen && (
          <div className="mt-3 space-y-2">
            {preset.prompts.length > 3 && (
              <div className="relative">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  placeholder={`Search ${preset.prompts.length} prompts by name or content…`}
                  className="w-full rounded-lg text-xs text-white/80 placeholder:text-white/25 focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", padding: "0.45rem 0.6rem 0.45rem 2rem" }}
                />
                {promptSearch && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-dim)]">
                    {filteredPrompts.length} match{filteredPrompts.length !== 1 ? "es" : ""} · drag off
                  </span>
                )}
              </div>
            )}

            {preset.prompts.length === 0 && (
              <p className="text-xs text-[var(--text-dim)] py-2">No prompts yet. Import a SillyTavern JSON or add one manually.</p>
            )}

            {filteredPrompts.map(({ p: prompt, realIndex }) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                index={realIndex}
                total={preset.prompts.length}
                expanded={expandedIds.has(prompt.id)}
                onToggleExpand={toggleExpand}
                onChange={updatePrompt}
                onDelete={deletePrompt}
                onMove={movePrompt}
                draggable={canDrag}
                dragging={dragIndex === realIndex}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
              />
            ))}

            {promptSearch && filteredPrompts.length === 0 && (
              <p className="text-xs text-[var(--text-dim)] py-2">No prompts match “{promptSearch}”.</p>
            )}

            <button
              type="button"
              onClick={addPrompt}
              className="mt-1 px-3 py-1.5 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Prompt
            </button>
          </div>
        )}
      </div>

      {/* Assistant prefill */}
      <div className="mb-5 border-t border-white/[0.04] pt-4">
        <SectionHeader title="Assistant Prefill" open={prefillOpen} onToggle={() => setPrefillOpen((v) => !v)} />
        {prefillOpen && (
          <div className="mt-3">
            <div className="flex items-center gap-3 mb-3">
              <SmallToggle value={preset.prefill_enabled} onChange={(v) => setPreset((p) => ({ ...p, prefill_enabled: v }))} />
              <span className="text-xs text-[var(--text-dim)]">Enable assistant prefill</span>
            </div>
            <textarea
              value={preset.assistant_prefill}
              onChange={(e) => setPreset((p) => ({ ...p, assistant_prefill: e.target.value }))}
              placeholder="Text to prepend to the model's response…"
              rows={4}
              disabled={!preset.prefill_enabled}
              className="w-full rounded-xl text-sm text-white/80 resize-y placeholder:text-white/20 focus:outline-none transition-colors disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", padding: "0.75rem 1rem", fontFamily: "inherit" }}
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
        <p className="mb-3 text-xs font-mono" style={{ color: overLimit ? "rgba(239,68,68,0.8)" : "rgba(251,191,36,0.7)" }}>
          Preset size: {(serializedSize / 1024).toFixed(1)} KB / 256 KB
          {overLimit && " — exceeds limit, cannot save"}
        </p>
      )}

      {importMsg && <p className="mb-3 text-xs" style={{ color: "rgba(34,211,238,0.8)" }}>{importMsg}</p>}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || overLimit}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-all cursor-pointer disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(34,211,238,0.25))", border: "1px solid rgba(139,92,246,0.25)" }}
        >
          {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Save"}
        </button>

        <button
          type="button"
          onClick={activateSelected}
          disabled={status === "saving" || overLimit || (selectedRow !== null && activeId === selectedRow.id && !dirty && enabled && !builtinActive)}
          className="px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer disabled:opacity-40"
          style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.3)", color: "rgba(34,211,238,0.95)" }}
          title="Save, make this the active preset, and turn presets on"
        >
          {selectedRow && activeId === selectedRow.id && !builtinActive ? "Re-apply" : "Activate"}
        </button>

        <button type="button" onClick={saveAs} disabled={status === "saving"} className="px-3 py-2 rounded-xl text-xs btn-ghost transition-all cursor-pointer disabled:opacity-50">
          Save as…
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import JSON
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />

        <button
          type="button"
          onClick={exportPreset}
          className="px-3 py-2 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
          title="Download this preset as JSON"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>

        <button
          type="button"
          onClick={deleteSelected}
          disabled={status === "saving"}
          className="px-3 py-2 rounded-xl text-xs text-[var(--text-dim)] hover:text-red-400/80 transition-all cursor-pointer disabled:opacity-50 ml-auto"
        >
          {selectedRow ? "Delete preset" : "Clear"}
        </button>
      </div>

      {status === "error" && errorMsg && <p className="mt-3 text-xs text-red-400/80">{errorMsg}</p>}

      {customDisabled && (
        <p className="mt-3 text-[10px] text-[var(--text-dim)]">
          Tip: activating one of your presets automatically turns off the Aether built-in.
        </p>
      )}
    </div>
  );
}
