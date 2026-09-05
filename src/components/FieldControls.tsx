"use client";

import { useEffect, useState } from "react";

// Small form controls shared by the preset and lorebook editors. They were
// born inside PresetCard; the lorebook editor needs the exact same look, so
// they live here instead of being copied.

export function Toggle({
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

export function SmallToggle({
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

export function SectionHeader({
  title,
  open,
  onToggle,
  right,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-left cursor-pointer group"
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
      {right}
    </div>
  );
}

/** Numeric input that keeps its own text buffer, so the field can be cleared
 *  and retyped instead of snapping back to the last valid value mid-edit. */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  disabled,
  className,
  style,
}: {
  value: number | undefined;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [focused, setFocused] = useState(false);

  // Re-sync when the value changes from the outside (preset switch, import),
  // but never while the user is typing into it.
  useEffect(() => {
    if (!focused) setText(value === undefined ? "" : String(value));
  }, [value, focused]);

  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") return; // let the field sit empty while retyping
        const v = parseFloat(raw);
        if (!isNaN(v)) onCommit(v);
      }}
      onBlur={() => {
        setFocused(false);
        setText(value === undefined ? "" : String(value));
      }}
      className={className}
      style={style}
    />
  );
}
