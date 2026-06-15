"use client";

/**
 * EXPERIMENTAL — Orbital navigation ("solar system menu").
 *
 * A sandbox alternative to the sidebar: every nav item is a planet orbiting a
 * central hub. Lives at /dashboard/testdashboard so it never touches the real
 * navigation until we're happy with it.
 *
 * Key UX decisions (see the chat thread for the reasoning):
 *  - The whole system PAUSES on hover/focus so you never chase a moving target.
 *  - Icons counter-rotate to stay upright while their orbit spins.
 *  - Each planet is a real <Link> -> keyboard focusable + screen-reader friendly.
 *  - Rotation is slow + disabled under prefers-reduced-motion.
 *  - Hovering for >2s reveals a tooltip with the destination, as requested.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Planet = {
  href: string;
  label: string;
  hint: string;        // shown in the 2s tooltip
  color: string;       // accent for the planet body + glow
  icon: React.ReactNode;
};

const ico = (d: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

/* Each orbit ring is an array of planets evenly spaced around it. */
const ORBITS: { radius: string; duration: number; planets: Planet[] }[] = [
  {
    radius: "19vmin",
    duration: 64,
    planets: [
      { href: "/dashboard", label: "Overview", hint: "Tu resumen general", color: "#22d3ee", icon: ico(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>) },
      { href: "/dashboard/chat", label: "Chat", hint: "Habla con los modelos", color: "#14b8a6", icon: ico(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />) },
      { href: "/dashboard/billing", label: "Billing", hint: "Compra y administra créditos", color: "#34d399", icon: ico(<><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></>) },
    ],
  },
  {
    radius: "31vmin",
    duration: 92,
    planets: [
      { href: "/dashboard/models", label: "Models", hint: "Catálogo de modelos", color: "#8b5cf6", icon: ico(<><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></>) },
      { href: "/dashboard/api-keys", label: "API Keys", hint: "Crea y gira tus llaves", color: "#fbbf24", icon: ico(<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />) },
      { href: "/dashboard/usage", label: "Usage", hint: "Consumo en tiempo real", color: "#4ade80", icon: ico(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />) },
      { href: "/dashboard/analytics", label: "Analytics", hint: "Gráficas y tendencias", color: "#3b82f6", icon: ico(<><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>) },
    ],
  },
  {
    radius: "43vmin",
    duration: 122,
    planets: [
      { href: "/dashboard/enterprise", label: "Enterprise", hint: "Planes y contratos B2B", color: "#818cf8", icon: ico(<><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></>) },
      { href: "/dashboard/referrals", label: "Referrals", hint: "Invita y gana créditos", color: "#d946ef", icon: ico(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>) },
      { href: "/dashboard/docs", label: "Docs", hint: "Guía de integración", color: "#38bdf8", icon: ico(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>) },
      { href: "/dashboard/settings", label: "Settings", hint: "Preferencias de cuenta", color: "#94a3b8", icon: ico(<><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>) },
      { href: "/policies", label: "Policies", hint: "Términos y políticas", color: "#fb7185", icon: ico(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />) },
    ],
  },
];

export default function TestDashboardPage() {
  // When any planet is hovered/focused, freeze the entire system.
  const [frozen, setFrozen] = useState(false);
  // Which planet (by href) has revealed its 2s tooltip.
  const [revealed, setRevealed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function enter(href: string) {
    setFrozen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealed(href), 2000); // tooltip after 2s
  }
  function leave() {
    setFrozen(false);
    setRevealed(null);
    if (timer.current) clearTimeout(timer.current);
  }

  return (
    <div className="fixed inset-0 lg:left-64 z-20 overflow-hidden" style={{ pointerEvents: "none" }}>
      {/* Galaxy backdrop */}
      <div className="galaxy" aria-hidden />
      <div className="stars" aria-hidden />

      <div className="relative z-10 w-full h-full grid place-items-center">
        <div className={`stage ${frozen ? "is-frozen" : ""}`}>
          {/* Orbit guide rings */}
          {ORBITS.map((o, i) => (
            <div key={`ring-${i}`} className="orbit-ring" style={{ width: `calc(${o.radius} * 2)`, height: `calc(${o.radius} * 2)` }} />
          ))}

          {/* Central hub */}
          <Link href="/dashboard" className="hub" aria-label="Aether Router — Overview">
            <span className="aurora-text">A</span>
          </Link>

          {/* Orbiting planets */}
          {ORBITS.map((orbit, oi) => (
            <div
              key={`orbit-${oi}`}
              className="orbit"
              style={{
                width: `calc(${orbit.radius} * 2)`,
                height: `calc(${orbit.radius} * 2)`,
                animationDuration: `${orbit.duration}s`,
              }}
            >
              {orbit.planets.map((p, pi) => {
                const angle = (360 / orbit.planets.length) * pi;
                return (
                  <div
                    key={p.href}
                    className="planet-slot"
                    style={{ transform: `rotate(${angle}deg) translate(${orbit.radius})` }}
                  >
                    <Link
                      href={p.href}
                      className="planet"
                      style={{
                        // counter the slot rotation + the orbit spin so icons stay upright
                        "--undo": `${-angle}deg`,
                        "--spin-dur": `${orbit.duration}s`,
                        "--accent": p.color,
                      } as React.CSSProperties}
                      onMouseEnter={() => enter(p.href)}
                      onMouseLeave={leave}
                      onFocus={() => enter(p.href)}
                      onBlur={leave}
                      aria-label={`${p.label} — ${p.hint}`}
                    >
                      <span className="planet-body">{p.icon}</span>
                      <span className="planet-label">{p.label}</span>
                      <span className={`tooltip ${revealed === p.href ? "show" : ""}`} role="tooltip">
                        {p.label}
                        <em>{p.hint}</em>
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="hint">Pasa el cursor sobre un planeta para detenerlo · mantenlo 2s para ver a dónde lleva</p>

      <style>{`
        .galaxy {
          position: absolute; inset: 0;
          background:
            radial-gradient(120% 90% at 70% 15%, rgba(139,92,246,0.18), transparent 55%),
            radial-gradient(100% 80% at 20% 85%, rgba(34,211,238,0.12), transparent 55%),
            radial-gradient(80% 80% at 50% 50%, rgba(217,70,239,0.08), transparent 60%),
            #05050f;
        }
        .stars {
          position: absolute; inset: 0; opacity: 0.7;
          background-image:
            radial-gradient(1px 1px at 12% 22%, #fff, transparent),
            radial-gradient(1px 1px at 82% 38%, #cbd5ff, transparent),
            radial-gradient(1px 1px at 47% 71%, #fff, transparent),
            radial-gradient(1.5px 1.5px at 28% 88%, #a5f3fc, transparent),
            radial-gradient(1px 1px at 66% 12%, #fff, transparent),
            radial-gradient(1px 1px at 92% 76%, #e9d5ff, transparent),
            radial-gradient(1px 1px at 8% 60%, #fff, transparent),
            radial-gradient(1.5px 1.5px at 58% 48%, #fff, transparent);
          animation: twinkle 6s ease-in-out infinite alternate;
        }
        @keyframes twinkle { from { opacity: 0.45 } to { opacity: 0.8 } }

        .stage {
          position: relative;
          width: min(96vw, 90vmin);
          height: min(96vw, 90vmin);
          display: grid;
          place-items: center;
          pointer-events: none;
        }

        /* Only the planets + hub are clickable; everything else lets clicks
           pass through. This also fixes the bug where the largest orbit's box
           sat on top and swallowed the inner planets' clicks. */
        .orbit, .orbit-ring, .planet-slot { pointer-events: none; }
        .planet, .hub { pointer-events: auto; }

        .hint {
          position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
          margin: 0; font-size: 11px; color: var(--text-dim);
          text-align: center; max-width: 90vw; pointer-events: none; z-index: 10;
        }

        .orbit-ring {
          position: absolute; border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.05);
          box-shadow: inset 0 0 40px rgba(139,92,246,0.04);
        }

        .hub {
          position: absolute;
          width: 76px; height: 76px; border-radius: 50%;
          display: grid; place-items: center;
          font-size: 26px; font-weight: 800; text-decoration: none;
          background: radial-gradient(circle at 35% 30%, rgba(34,211,238,0.35), rgba(139,92,246,0.45));
          border: 1px solid rgba(139,92,246,0.4);
          box-shadow: 0 0 60px -8px rgba(139,92,246,0.6), inset 0 0 24px rgba(34,211,238,0.25);
          animation: pulse 4s ease-in-out infinite;
          z-index: 5;
        }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 50px -10px rgba(139,92,246,0.5), inset 0 0 24px rgba(34,211,238,0.2); }
          50%     { box-shadow: 0 0 80px -6px rgba(139,92,246,0.75), inset 0 0 30px rgba(34,211,238,0.35); }
        }

        .orbit {
          position: absolute; border-radius: 50%;
          animation-name: spin;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .orbit .planet-slot {
          position: absolute; top: 50%; left: 50%;
          margin: -27px 0 0 -27px; /* half of planet size to center on the ring */
        }

        .planet {
          position: relative; display: grid; place-items: center;
          width: 54px; height: 54px; border-radius: 50%;
          text-decoration: none; color: #fff; cursor: pointer;
          background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 55%, #0b0b1a), #0b0b1a);
          border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
          box-shadow: 0 0 22px -6px var(--accent), inset 0 0 12px rgba(0,0,0,0.5);
          /* undo the slot's static rotation + the orbit's spin so the icon stays upright */
          transform: rotate(var(--undo));
          animation: spin-rev var(--spin-dur) linear infinite;
          transition: box-shadow .25s ease, scale .25s ease;
        }
        .planet:hover, .planet:focus-visible {
          scale: 1.18;
          box-shadow: 0 0 34px -2px var(--accent), inset 0 0 12px rgba(0,0,0,0.4);
          outline: none;
        }
        .planet-body { color: color-mix(in srgb, var(--accent) 70%, #fff); display: grid; place-items: center; }

        .planet-label {
          position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
          font-size: 10px; letter-spacing: 0.04em; white-space: nowrap;
          color: var(--text-muted); opacity: 0; transition: opacity .2s ease; pointer-events: none;
        }
        .planet:hover .planet-label, .planet:focus-visible .planet-label { opacity: 1; }

        .tooltip {
          position: absolute; bottom: 66px; left: 50%; transform: translateX(-50%) translateY(6px);
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 7px 11px; border-radius: 10px; white-space: nowrap;
          background: rgba(10,10,24,0.92); backdrop-filter: blur(8px);
          border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
          box-shadow: 0 8px 30px -8px rgba(0,0,0,0.7);
          font-size: 12px; font-weight: 600; color: #fff;
          opacity: 0; pointer-events: none; transition: opacity .2s ease, transform .2s ease; z-index: 20;
        }
        .tooltip em { font-style: normal; font-weight: 400; font-size: 10.5px; color: var(--text-muted); }
        .tooltip.show { opacity: 1; transform: translateX(-50%) translateY(0); }

        /* Freeze everything while the user is interacting with a planet. */
        .stage.is-frozen .orbit,
        .stage.is-frozen .planet { animation-play-state: paused; }

        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes spin-rev {
          from { transform: rotate(calc(var(--undo))); }
          to   { transform: rotate(calc(var(--undo) - 360deg)); }
        }

        @media (prefers-reduced-motion: reduce) {
          .orbit, .planet, .hub, .stars { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
