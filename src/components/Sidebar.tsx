"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* ---- SVG icon components (Lucide-style, 20x20) ---- */
const icons = {
  overview: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  key: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  models: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  usage: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  billing: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  docs: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  policies: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  admin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  analytics: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
    </svg>
  ),
  referrals: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  logout: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  chat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

const nav = [
  { href: "/dashboard", label: "Overview", icon: icons.overview },
  { href: "/dashboard/chat", label: "Chat", icon: icons.chat },
  { href: "/dashboard/api-keys", label: "API Keys", icon: icons.key },
  { href: "/dashboard/models", label: "Models", icon: icons.models },
  { href: "/dashboard/usage", label: "Usage", icon: icons.usage },
  { href: "/dashboard/analytics", label: "Analytics", icon: icons.analytics },
  { href: "/dashboard/billing", label: "Billing", icon: icons.billing },
  { href: "/dashboard/referrals", label: "Referrals", icon: icons.referrals },
  { href: "/dashboard/docs", label: "Docs", icon: icons.docs },
  { href: "/policies", label: "Policies", icon: icons.policies },
];

const adminNav = { href: "/dashboard/admin", label: "Admin", icon: icons.admin };

export function Sidebar({
  user,
  isAdmin,
  open,
  onClose,
}: {
  user: { email: string; displayName: string; credits: number; dailyCredits: number; planName?: string };
  isAdmin?: boolean;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full w-64 flex flex-col z-50 transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          background: "rgba(8, 8, 24, 0.9)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.04)",
        }}
      >
        {/* Aurora shimmer line at top */}
        <div
          className="absolute top-0 left-0 right-0 h-[1px]"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.4), rgba(139, 92, 246, 0.5), rgba(217, 70, 239, 0.3), transparent)",
          }}
        />

        {/* Subtle vertical aurora glow on right edge */}
        <div
          className="absolute top-0 right-0 w-[1px] h-full"
          style={{
            background: "linear-gradient(180deg, rgba(34, 211, 238, 0.15) 0%, rgba(139, 92, 246, 0.1) 50%, rgba(217, 70, 239, 0.08) 100%)",
          }}
        />

        {/* Logo */}
        <div className="p-5 border-b border-white/[0.04]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold relative"
              style={{
                background: "linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(139, 92, 246, 0.3))",
                border: "1px solid rgba(139, 92, 246, 0.2)",
                boxShadow: "0 0 20px -4px rgba(139, 92, 246, 0.2)",
              }}
            >
              <span className="aurora-text font-bold">A</span>
            </div>
            <div>
              <h1 className="text-[15px] font-bold tracking-tight text-white/90">Aether Router</h1>
              <p className="text-[10px] text-[var(--text-dim)] tracking-widest uppercase">AI Model Proxy</p>
            </div>
          </div>
        </div>

        {/* Balance */}
        <div className="px-5 py-4 border-b border-white/[0.04]">
          <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">Balance</p>
          <p className="text-2xl font-bold aurora-text">
            {(user.credits + user.dailyCredits).toLocaleString()}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">credits</p>
          <div className="flex gap-3 mt-2">
            <span className="inline-flex items-center gap-1.5 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400/60" />
              <span className="text-teal-400/80">{user.dailyCredits.toLocaleString()} daily</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
              <span className="text-emerald-400/80">{user.credits.toLocaleString()} perm</span>
            </span>
          </div>
          {user.planName && (
            <div
              className="mt-2.5 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium badge-violet"
            >
              {user.planName}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 relative ${
                  active
                    ? "text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-white/[0.03]"
                }`}
                style={active ? {
                  background: "linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(34, 211, 238, 0.06))",
                  border: "1px solid rgba(139, 92, 246, 0.12)",
                } : {}}
              >
                {active && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{
                      background: "linear-gradient(180deg, var(--aurora-cyan), var(--aurora-violet))",
                    }}
                  />
                )}
                <span className={`w-5 flex items-center justify-center transition-colors ${
                  active ? "text-cyan-300/90" : "text-[var(--text-dim)] group-hover:text-[var(--text-muted)]"
                }`}>
                  {item.icon}
                </span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="border-t border-white/[0.04] my-2" />
              <Link
                href={adminNav.href}
                onClick={onClose}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                  pathname === adminNav.href
                    ? "text-red-300"
                    : "text-red-400/60 hover:text-red-300 hover:bg-red-500/5"
                }`}
                style={pathname === adminNav.href ? {
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.12)",
                } : {}}
              >
                <span className="w-5 flex items-center justify-center">{adminNav.icon}</span>
                <span className="font-medium">{adminNav.label}</span>
              </Link>
            </>
          )}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-white/[0.04]">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(34, 211, 238, 0.15))",
                border: "1px solid rgba(139, 92, 246, 0.15)",
                color: "rgba(200, 200, 240, 0.8)",
              }}
            >
              {(user.displayName || user.email || "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate text-white/80">{user.displayName || user.email}</p>
              <p className="text-[11px] text-[var(--text-dim)] truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 flex items-center gap-2 text-[11px] text-[var(--text-dim)] hover:text-[var(--danger)] transition-colors"
          >
            {icons.logout}
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
