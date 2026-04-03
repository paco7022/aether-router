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
    <aside className="fixed left-0 top-0 h-full w-64 bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col">
      <div className="p-5 border-b border-[var(--border)]">
        <h1 className="text-lg font-bold">Aether Router</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">AI Model Proxy</p>
      </div>

      {/* Balance */}
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Balance</p>
        <p className="text-2xl font-bold mt-1">
          {(user.credits + user.dailyCredits).toLocaleString()}
          <span className="text-sm font-normal text-[var(--text-muted)]"> credits</span>
        </p>
        <div className="flex gap-3 mt-1">
          <p className="text-xs text-teal-400">{user.dailyCredits.toLocaleString()} daily</p>
          <p className="text-xs text-green-400">{user.credits.toLocaleString()} perm</p>
        </div>
        {user.planName && (
          <p className="text-xs text-[var(--accent)] mt-1">{user.planName} plan</p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              }`}
            >
              <span className="font-mono text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="border-t border-[var(--border)] my-2" />
            <Link
              href={adminNav.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === adminNav.href
                  ? "bg-red-600 text-white"
                  : "text-red-400 hover:bg-red-500/10 hover:text-red-300"
              }`}
            >
              <span className="font-mono text-base w-5 text-center">{adminNav.icon}</span>
              {adminNav.label}
            </Link>
          </>
        )}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-[var(--border)]">
        <p className="text-sm font-medium truncate">{user.displayName || user.email}</p>
        <p className="text-xs text-[var(--text-muted)] truncate">{user.email}</p>
        <button
          onClick={handleLogout}
          className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
