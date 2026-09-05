"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberField, SectionHeader, SmallToggle, Toggle } from "./FieldControls";
import {
  MAX_ACTIVE_LOREBOOKS,
  MAX_ENTRY_CONTENT,
  MAX_LOREBOOK_BYTES,
  emptyLorebook,
  parseLorebook,
  type Lorebook,
  type LorebookEntry,
  type LorebookPosition,
  type LorebookRow,
} from "@/lib/lorebook";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "AetherRouter",
} as const;

interface Props {
  initialLorebooks: LorebookRow[];
  initialEnabled: boolean;
}

const POSITION_LABELS: Array<{ value: LorebookPosition; label: string; hint: string }> = [
  { value: "before", label: "Top of preamble", hint: "ST: before character defs" },
  { value: "after", label: "End of preamble", hint: "ST: after character defs — right before the chat" },
  { value: "an_top", label: "After chat (top)", hint: "ST: author's note top" },
  { value: "an_bottom", label: "After chat (bottom)", hint: "ST: author's note bottom" },
  { value: "depth", label: "In chat @ depth", hint: "N messages from the end, with a role" },
  { value: "outlet", label: "Outlet", hint: "placed by {{outlet::name}} in a preset prompt" },
];

const LOGIC_LABELS: Array<{ value: LorebookEntry["logic"]; label: string }> = [
  { value: "and_any", label: "AND ANY" },
  { value: "not_all", label: "NOT ALL" },
  { value: "not_any", label: "NOT ANY" },
  { value: "and_all", label: "AND ALL" },
];

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.07)",
} as const;

const selectStyle = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.7)",
} as const;

/** Comma-separated list bound to a string[]; keeps its own text buffer so a
 *  half-typed "elf, " doesn't get rewritten under the cursor. */
function KeyListField({
  value,
  onCommit,
  placeholder,
}: {
  value: string[];
  onCommit: (keys: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value.join(", "));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value.join(", "));
  }, [value, focused]);

  return (
    <input
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(
          e.target.value
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 100)
        );
      }}
      onBlur={() => {
        setFocused(false);
        setText(value.join(", "));
      }}
      className="w-full rounded-lg text-xs text-white/80 placeholder:text-white/25 focus:outline-none"
      style={{ ...inputStyle, padding: "0.4rem 0.6rem" }}
    />
  );
}

function newEntry(): LorebookEntry {
  return {
    id: crypto.randomUUID(),
    name: "New entry",
    keys: [],
    secondary_keys: [],
    logic: "and_any",
    content: "",
    enabled: true,
    constant: false,
    position: "before",
    order: 100,
  };
}

const EntryCard = memo(function EntryCard({
  entry,
  expanded,
  onToggleExpand,
  onChange,
  onDelete,
}: {
  entry: LorebookEntry;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onChange: (id: string, e: LorebookEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const set = (patch: Partial<LorebookEntry>) => onChange(entry.id, { ...entry, ...patch });

  return (
    <div
      className="rounded-xl p-3 transition-colors"
      style={{
        background: entry.enabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <SmallToggle value={entry.enabled} onChange={(v) => set({ enabled: v })} />

        {entry.constant ? (
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
            style={{
              background: "rgba(34,211,238,0.15)",
              color: "rgba(34,211,238,0.9)",
              border: "1px solid rgba(34,211,238,0.25)",
            }}
            title="Always injected, no keywords needed"
          >
            always
          </span>
        ) : (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
            style={{
              background: "rgba(139,92,246,0.15)",
              color: "rgba(196,181,253,0.9)",
              border: "1px solid rgba(139,92,246,0.25)",
            }}
            title={entry.keys.length ? `Keys: ${entry.keys.join(", ")}` : "No keys — this entry can never fire"}
          >
            {entry.keys.length ? `${entry.keys.length} key${entry.keys.length !== 1 ? "s" : ""}` : "no keys"}
          </span>
        )}

        {entry.position === "depth" && (
          <span className="text-[10px] font-mono text-[var(--text-dim)] shrink-0">@{entry.depth ?? 0}</span>
        )}

        <input
          value={entry.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Entry name"
          className="flex-1 min-w-[8rem] bg-transparent text-sm text-white/80 placeholder:text-white/20 focus:outline-none"
        />

        <select
          value={entry.position}
          onChange={(e) => {
            const position = e.target.value as LorebookPosition;
            set({
              position,
              depth: position === "depth" ? entry.depth ?? 4 : undefined,
              role: position === "depth" ? entry.role ?? "system" : undefined,
              outlet: position === "outlet" ? entry.outlet ?? "" : undefined,
            });
          }}
          className="text-xs rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
          style={selectStyle}
          title={POSITION_LABELS.find((p) => p.value === entry.position)?.hint}
        >
          {POSITION_LABELS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => onToggleExpand(entry.id)}
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

        {confirmDelete ? (
          <>
            <button
              type="button"
              onClick={() => onDelete(entry.id)}
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
            title="Delete entry"
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
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Keywords</span>
              <KeyListField
                value={entry.keys}
                onCommit={(keys) => set({ keys })}
                placeholder="elf, elves, eldar"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                Optional filter
              </span>
              <KeyListField
                value={entry.secondary_keys}
                onCommit={(secondary_keys) => set({ secondary_keys })}
                placeholder="forest, night"
              />
            </label>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              Logic
              <select
                value={entry.logic}
                onChange={(e) => set({ logic: e.target.value as LorebookEntry["logic"] })}
                className="rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
                style={selectStyle}
              >
                {LOGIC_LABELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              Order
              <NumberField
                step={1}
                value={entry.order}
                onCommit={(v) => set({ order: Math.floor(v) })}
                className="w-16 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
            </label>

            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              Trigger %
              <NumberField
                min={0}
                max={100}
                step={1}
                value={entry.probability ?? 100}
                onCommit={(v) => set({ probability: Math.max(0, Math.min(100, Math.round(v))) })}
                className="w-16 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
            </label>

            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              <SmallToggle value={entry.constant} onChange={(v) => set({ constant: v })} />
              Always on
            </label>
          </div>

          {entry.position === "depth" && (
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
                Depth
                <NumberField
                  min={0}
                  max={999}
                  step={1}
                  value={entry.depth ?? 0}
                  onCommit={(v) => set({ depth: Math.max(0, Math.floor(v)) })}
                  className="w-16 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                  style={inputStyle}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
                Role
                <select
                  value={entry.role ?? "system"}
                  onChange={(e) => set({ role: e.target.value as LorebookEntry["role"] })}
                  className="rounded-lg px-2 py-1 cursor-pointer focus:outline-none"
                  style={selectStyle}
                >
                  <option value="system">system</option>
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                </select>
              </label>
            </div>
          )}

          {entry.position === "outlet" && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
              Outlet name
              <input
                value={entry.outlet ?? ""}
                onChange={(e) => set({ outlet: e.target.value })}
                placeholder="Notes"
                className="rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
              <span className="text-[10px]">
                placed by <span className="font-mono">{`{{outlet::${entry.outlet || "Notes"}}}`}</span> in a preset prompt
              </span>
            </label>
          )}

          <div className="flex items-center gap-3 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              Group
              <input
                value={entry.group ?? ""}
                onChange={(e) => set({ group: e.target.value || undefined })}
                placeholder="none"
                className="w-28 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
                title="Only one activated entry per group makes it into the prompt"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              Scan depth
              <NumberField
                min={0}
                max={50}
                step={1}
                value={entry.scan_depth}
                onCommit={(v) => set({ scan_depth: Math.max(0, Math.floor(v)) })}
                className="w-16 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[var(--text-dim)]">
              <SmallToggle
                value={entry.match_whole_words !== false}
                onChange={(v) => set({ match_whole_words: v })}
              />
              Whole words
            </label>
          </div>

          <textarea
            value={entry.content}
            onChange={(e) => {
              const clipped = e.target.value.slice(0, MAX_ENTRY_CONTENT);
              setTruncated(clipped.length < e.target.value.length);
              set({ content: clipped });
            }}
            placeholder="What the model should know when this entry fires…"
            rows={5}
            className="w-full rounded-lg text-sm text-white/75 resize-y placeholder:text-white/20 focus:outline-none"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "0.6rem 0.75rem",
              fontFamily: "inherit",
            }}
          />
          {truncated && (
            <p className="text-[10px]" style={{ color: "rgba(251,191,36,0.85)" }}>
              An entry is capped at {Math.round(MAX_ENTRY_CONTENT / 1024)} KB — the rest was not kept.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

export function LorebookCard({ initialLorebooks, initialEnabled }: Props) {
  const [rows, setRows] = useState<LorebookRow[]>(initialLorebooks);
  const [selectedId, setSelectedId] = useState<string | null>(initialLorebooks[0]?.id ?? null);
  const [bookState, setBookState] = useState<Lorebook>(
    initialLorebooks[0]?.book ?? emptyLorebook()
  );
  const [enabled, setEnabled] = useState(initialEnabled);

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [entrySearch, setEntrySearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  const serialized = useMemo(() => JSON.stringify(bookState), [bookState]);
  const dirty = useMemo(
    () =>
      selectedRow ? JSON.stringify(selectedRow.book) !== serialized : bookState.entries.length > 0,
    [selectedRow, serialized, bookState]
  );
  const size = serialized.length;
  const overLimit = size > MAX_LOREBOOK_BYTES;
  const activeCount = rows.filter((r) => r.is_active).length;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const updateEntry = useCallback((id: string, updated: LorebookEntry) => {
    setBookState((b) => ({ ...b, entries: b.entries.map((e) => (e.id === id ? updated : e)) }));
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setBookState((b) => ({ ...b, entries: b.entries.filter((e) => e.id !== id) }));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function loadRow(row: LorebookRow | null) {
    setSelectedId(row?.id ?? null);
    setBookState(row?.book ?? emptyLorebook());
    setExpandedIds(new Set());
    setEntrySearch("");
    setStatus("idle");
    setErrorMsg("");
  }

  function selectRow(id: string) {
    if (id === selectedId) return;
    if (dirty && !confirm("Discard unsaved changes to this lorebook?")) return;
    loadRow(rows.find((r) => r.id === id) ?? null);
  }

  function addEntry() {
    const e = newEntry();
    setBookState((b) => ({ ...b, entries: [...b.entries, e] }));
    setExpandedIds((s) => new Set(s).add(e.id));
  }

  async function toggleMaster(v: boolean) {
    setEnabled(v);
    const res = await fetch("/api/v1/account/lorebooks", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled: v }),
    });
    if (!res.ok) {
      setEnabled(!v);
      setErrorMsg("Failed to toggle lorebooks.");
      setStatus("error");
    }
  }

  async function createBook(name: string, b: Lorebook): Promise<LorebookRow> {
    const res = await fetch("/api/v1/account/lorebooks", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, book: b }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create.");
    const { lorebook } = (await res.json()) as { lorebook: LorebookRow };
    setRows((list) => [lorebook, ...list]);
    return lorebook;
  }

  async function save() {
    if (overLimit) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      if (selectedId) {
        const res = await fetch(`/api/v1/account/lorebooks/${selectedId}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: bookState.name, book: bookState }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
        const { lorebook } = (await res.json()) as { lorebook: LorebookRow };
        setRows((list) => list.map((r) => (r.id === lorebook.id ? lorebook : r)));
      } else {
        const row = await createBook(bookState.name, bookState);
        setSelectedId(row.id);
      }
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save.");
      setStatus("error");
    }
  }

  async function saveAs() {
    setStatus("saving");
    setErrorMsg("");
    try {
      const name = uniqueName(`${bookState.name} copy`);
      const row = await createBook(name, { ...bookState, name });
      loadRow(row);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  async function newBook() {
    if (dirty && !confirm("Discard unsaved changes to this lorebook?")) return;
    setStatus("saving");
    try {
      const name = uniqueName(`Lorebook ${rows.length + 1}`);
      const row = await createBook(name, emptyLorebook(name));
      loadRow(row);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  // Activation applies the SAVED row, so save first when there are pending
  // edits — otherwise the user would activate a stale version.
  async function setActive(row: LorebookRow, active: boolean) {
    setStatus("saving");
    setErrorMsg("");
    try {
      const body: Record<string, unknown> = { is_active: active };
      if (row.id === selectedId && dirty) {
        body.book = bookState;
        body.name = bookState.name;
      }
      const res = await fetch(`/api/v1/account/lorebooks/${row.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed.");
      const { lorebook } = (await res.json()) as { lorebook: LorebookRow };
      setRows((list) => list.map((r) => (r.id === lorebook.id ? lorebook : r)));
      if (active) setEnabled(true);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  async function deleteBook() {
    if (!selectedId) {
      loadRow(null);
      return;
    }
    if (!confirm(`Delete lorebook "${bookState.name}"? This cannot be undone.`)) return;
    setStatus("saving");
    try {
      const res = await fetch(`/api/v1/account/lorebooks/${selectedId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete.");
      const remaining = rows.filter((r) => r.id !== selectedId);
      setRows(remaining);
      loadRow(remaining[0] ?? null);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed.");
      setStatus("error");
    }
  }

  function uniqueName(base: string): string {
    const taken = new Set(rows.map((r) => r.name));
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
        const { book: parsed, regexKeysDropped, entriesSkipped } = parseLorebook(json);
        // Like presets: an import is always a NEW book, never an overwrite.
        const name = uniqueName(parsed.name);
        setSelectedId(null);
        setBookState({ ...parsed, name });
        setExpandedIds(new Set());
        setEntrySearch("");
        setStatus("idle");
        setErrorMsg("");
        const notes = [
          `${parsed.entries.length} entr${parsed.entries.length !== 1 ? "ies" : "y"}`,
          entriesSkipped > 0 ? `${entriesSkipped} skipped (empty or unusable)` : "",
          regexKeysDropped > 0 ? `${regexKeysDropped} regex key(s) dropped — not supported yet` : "",
        ].filter(Boolean);
        setImportMsg(`Imported ${notes.join(", ")} as "${name}" — hit Save to keep it`);
        setTimeout(() => setImportMsg(""), 9000);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not parse JSON file.");
        setStatus("error");
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function exportBook() {
    const blob = new Blob([JSON.stringify(bookState, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bookState.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "lorebook"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredEntries = useMemo(() => {
    const q = entrySearch.trim().toLowerCase();
    if (!q) return bookState.entries;
    return bookState.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.keys.some((k) => k.toLowerCase().includes(q))
    );
  }, [bookState.entries, entrySearch]);

  return (
    <div className="glass-card shimmer-line p-6 mt-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-cyan)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <h3 className="font-semibold text-white/85">Lorebooks</h3>
        </div>
        <Toggle value={enabled} onChange={toggleMaster} label={enabled ? "Disable lorebooks" : "Enable lorebooks"} />
      </div>

      <p className="text-xs text-[var(--text-dim)] mb-5 leading-relaxed">
        World Info for your requests: entries fire when their keywords show up in the recent chat and
        get injected where you tell them to. Import a SillyTavern World Info export or a character
        card — up to {MAX_ACTIVE_LOREBOOKS} books can be active at once, and they work with or
        without a preset. Timed effects that need chat memory (cooldown) and vectorized entries are
        not applied; <span className="font-mono">delay</span> is exact and{" "}
        <span className="font-mono">sticky</span> widens the scan window.
      </p>

      {/* Library */}
      <div className="mb-5 rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
            My Lorebooks ({rows.length}) · {activeCount}/{MAX_ACTIVE_LOREBOOKS} active
          </h4>
          <button type="button" onClick={newBook} className="px-2.5 py-1 rounded-lg text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)] py-1">
            No lorebooks yet. Import a World Info JSON or a character card, or build one below.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const isSelected = row.id === selectedId;
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
                  style={{
                    background: isSelected ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.02)",
                    border: isSelected ? "1px solid rgba(34,211,238,0.35)" : "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <SmallToggle value={row.is_active} onChange={(v) => setActive(row, v)} />
                  <button
                    type="button"
                    onClick={() => selectRow(row.id)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <span className="text-sm text-white/85 truncate block">{row.name}</span>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {row.book?.entries?.length ?? 0} entries
                      {row.is_active ? " · live" : ""}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap text-xs">
        {selectedRow?.is_active ? (
          <span className="px-2 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.12)", color: "rgba(34,211,238,0.9)", border: "1px solid rgba(34,211,238,0.25)" }}>
            Editing a live lorebook
          </span>
        ) : (
          <span className="text-[var(--text-dim)]">
            {selectedRow ? "Editing a saved lorebook (not active)" : "Unsaved new lorebook"}
          </span>
        )}
        {dirty && <span className="text-amber-400/80">• unsaved changes</span>}
        {!enabled && activeCount > 0 && (
          <span className="text-amber-400/80">• lorebooks are switched off</span>
        )}
      </div>

      <div className="mb-5">
        <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider block mb-1">Lorebook name</label>
        <input
          value={bookState.name}
          onChange={(e) => setBookState((b) => ({ ...b, name: e.target.value }))}
          placeholder="My Lorebook"
          className="w-full rounded-xl text-sm text-white/80 placeholder:text-white/20 focus:outline-none"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", padding: "0.5rem 0.75rem" }}
        />
      </div>

      {/* Book settings */}
      <div className="mb-4">
        <SectionHeader title="Scan Settings" open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)} />
        {settingsOpen && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-[var(--text-dim)]">Scan depth (messages)</span>
              <NumberField
                min={0}
                max={50}
                step={1}
                value={bookState.settings.scan_depth}
                onCommit={(v) =>
                  setBookState((b) => ({ ...b, settings: { ...b.settings, scan_depth: Math.max(0, Math.min(50, Math.floor(v))) } }))
                }
                className="w-20 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-[var(--text-dim)]">Recursion steps</span>
              <NumberField
                min={0}
                max={5}
                step={1}
                value={bookState.settings.recursion_steps}
                onCommit={(v) =>
                  setBookState((b) => ({ ...b, settings: { ...b.settings, recursion_steps: Math.max(0, Math.min(5, Math.floor(v))) } }))
                }
                className="w-20 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
              <span className="text-[10px] text-[var(--text-dim)]">0 = entries can&apos;t trigger each other</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-[var(--text-dim)]">Token budget</span>
              <NumberField
                min={100}
                max={20000}
                step={100}
                value={bookState.settings.budget_tokens}
                onCommit={(v) =>
                  setBookState((b) => ({ ...b, settings: { ...b.settings, budget_tokens: Math.max(100, Math.min(20000, Math.floor(v))) } }))
                }
                className="w-20 rounded-lg px-2 py-1 text-white/80 focus:outline-none"
                style={inputStyle}
              />
              <span className="text-[10px] text-[var(--text-dim)]">extra entries are dropped past this</span>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <SmallToggle
                value={bookState.settings.case_sensitive}
                onChange={(v) => setBookState((b) => ({ ...b, settings: { ...b.settings, case_sensitive: v } }))}
              />
              <span className="text-[var(--text-dim)]">Case-sensitive keywords</span>
            </div>
            <div className="flex items-center gap-3">
              <SmallToggle
                value={bookState.settings.match_whole_words}
                onChange={(v) => setBookState((b) => ({ ...b, settings: { ...b.settings, match_whole_words: v } }))}
              />
              <span className="text-[var(--text-dim)]">Match whole words</span>
            </div>
          </div>
        )}
      </div>

      {/* Entries */}
      <div className="mb-4 border-t border-white/[0.04] pt-4">
        <SectionHeader
          title={`Entries (${bookState.entries.length})`}
          open={entriesOpen}
          onToggle={() => setEntriesOpen((v) => !v)}
          right={
            bookState.entries.length > 0 ? (
              <div className="flex items-center gap-2 text-[10px]">
                <button type="button" onClick={() => setExpandedIds(new Set(bookState.entries.map((e) => e.id)))} className="text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer">Expand all</button>
                <span className="text-white/10">|</span>
                <button type="button" onClick={() => setExpandedIds(new Set())} className="text-[var(--text-dim)] hover:text-white/60 transition-colors cursor-pointer">Collapse all</button>
              </div>
            ) : undefined
          }
        />
        {entriesOpen && (
          <div className="mt-3 space-y-2">
            {bookState.entries.length > 3 && (
              <input
                value={entrySearch}
                onChange={(e) => setEntrySearch(e.target.value)}
                placeholder={`Search ${bookState.entries.length} entries by name, keyword or content…`}
                className="w-full rounded-lg text-xs text-white/80 placeholder:text-white/25 focus:outline-none"
                style={{ ...inputStyle, padding: "0.45rem 0.6rem" }}
              />
            )}

            {bookState.entries.length === 0 && (
              <p className="text-xs text-[var(--text-dim)] py-2">
                No entries yet. Import a World Info JSON or add one manually.
              </p>
            )}

            {filteredEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggleExpand={toggleExpand}
                onChange={updateEntry}
                onDelete={deleteEntry}
              />
            ))}

            {entrySearch && filteredEntries.length === 0 && (
              <p className="text-xs text-[var(--text-dim)] py-2">No entries match “{entrySearch}”.</p>
            )}

            <button type="button" onClick={addEntry} className="mt-1 px-3 py-1.5 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add entry
            </button>
          </div>
        )}
      </div>

      {size > MAX_LOREBOOK_BYTES * 0.85 && (
        <p className="mb-3 text-xs font-mono" style={{ color: overLimit ? "rgba(239,68,68,0.8)" : "rgba(251,191,36,0.7)" }}>
          Lorebook size: {(size / 1024).toFixed(1)} KB / {Math.round(MAX_LOREBOOK_BYTES / 1024)} KB
          {overLimit && " — exceeds limit, cannot save"}
        </p>
      )}

      {importMsg && <p className="mb-3 text-xs" style={{ color: "rgba(34,211,238,0.8)" }}>{importMsg}</p>}

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

        <button type="button" onClick={saveAs} disabled={status === "saving"} className="px-3 py-2 rounded-xl text-xs btn-ghost transition-all cursor-pointer disabled:opacity-50">
          Save as…
        </button>

        <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import JSON
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />

        <button type="button" onClick={exportBook} className="px-3 py-2 rounded-xl text-xs btn-ghost transition-all cursor-pointer flex items-center gap-1.5" title="Download this lorebook as JSON">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>

        <button
          type="button"
          onClick={deleteBook}
          disabled={status === "saving"}
          className="px-3 py-2 rounded-xl text-xs text-[var(--text-dim)] hover:text-red-400/80 transition-all cursor-pointer disabled:opacity-50 ml-auto"
        >
          {selectedRow ? "Delete lorebook" : "Clear"}
        </button>
      </div>

      {status === "error" && errorMsg && <p className="mt-3 text-xs text-red-400/80">{errorMsg}</p>}
    </div>
  );
}
