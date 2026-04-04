"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const nav = [
  { href: "/dashboard", label: "Overview", icon: "~" },
  { href: "/dashboard/api-keys", label: "API Keys", icon: "#" },
  { href: "/dashboard/models", label: "Models", icon: ">" },
  { href: "/dashboard/usage", label: "Usage", icon: "=" },
  { href: "/dashboard/billing", label: "Billing", icon: "$" },
  { href: "/dashboard/docs", label: "Docs", icon: "?" },
];

const adminNav = { href: "/dashboard/admin", label: "Admin", icon: "!" };

export function Sidebar({
  user,
  isAdmin,
}: {
  user: { email: string; displayName: string; credits: number; dailyCredits: number; planName?: string };
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-64 flex flex-col z-50"
      style={{
        background: "rgba(8, 8, 24, 0.85)",
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
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(139, 92, 246, 0.3))",
              border: "1px solid rgba(139, 92, 246, 0.2)",
            }}
          >
            A
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight text-white/90">Aether Router</h1>
            <p className="text-[10px] text-[var(--text-dim)] tracking-wide uppercase">AI Model Proxy</p>
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
          <span className="inline-flex items-center gap-1 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400/60" />
            <span className="text-teal-400/80">{user.dailyCredits.toLocaleString()} daily</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
            <span className="text-emerald-400/80">{user.credits.toLocaleString()} perm</span>
          </span>
        </div>
        {user.planName && (
          <div
            className="mt-2.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{
              background: "linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(34, 211, 238, 0.1))",
              border: "1px solid rgba(139, 92, 246, 0.2)",
              color: "rgba(167, 139, 250, 0.9)",
            }}
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
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 relative ${
                active
                  ? "text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
              style={active ? {
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(34, 211, 238, 0.08))",
                border: "1px solid rgba(139, 92, 246, 0.15)",
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
              <span className={`font-mono text-sm w-5 text-center transition-colors ${
                active ? "text-cyan-300/80" : "text-[var(--text-dim)] group-hover:text-[var(--text-muted)]"
              }`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="border-t border-white/[0.04] my-2" />
            <Link
              href={adminNav.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                pathname === adminNav.href
                  ? "text-red-300"
                  : "text-red-400/60 hover:text-red-300 hover:bg-red-500/5"
              }`}
              style={pathname === adminNav.href ? {
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.12)",
              } : {}}
            >
              <span className="font-mono text-sm w-5 text-center">{adminNav.icon}</span>
              {adminNav.label}
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
          className="mt-3 text-[11px] text-[var(--text-dim)] hover:text-[var(--danger)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
