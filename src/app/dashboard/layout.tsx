"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Sidebar } from "@/components/Sidebar";
import { FingerprintCapture } from "@/components/FingerprintCapture";
import { isAdmin as checkAdmin } from "@/lib/admin";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<{
    email: string;
    displayName: string;
    credits: number;
    dailyCredits: number;
    planName?: string;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    async function loadProfile() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*, plans(name)")
        .eq("id", authUser.id)
        .single();

      setUser({
        email: authUser.email || "",
        displayName: profile?.display_name || "",
        credits: profile?.credits || 0,
        dailyCredits: profile?.daily_credits || 0,
        planName: (profile?.plans as { name: string } | null)?.name,
      });
      setIsAdmin(checkAdmin(authUser.email));
      setLoading(false);
    }

    loadProfile();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          router.push("/login");
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="aurora-bg">
          <div className="aurora-orb-1" />
          <div className="aurora-orb-2" />
        </div>
        <div className="noise-overlay" />
        <div className="relative z-10 text-center">
          <div
            className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center animate-pulse"
            style={{
              background: "linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(139, 92, 246, 0.3))",
              border: "1px solid rgba(139, 92, 246, 0.2)",
            }}
          >
            <span className="aurora-text font-bold">A</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen relative">
      {/* Aurora background */}
      <div className="aurora-bg">
        <div className="aurora-orb-1" />
        <div className="aurora-orb-2" />
      </div>
      {/* Noise overlay */}
      <div className="noise-overlay" />

      <Sidebar
        user={user}
        isAdmin={isAdmin}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <FingerprintCapture />

      <main className="flex-1 p-5 lg:p-8 lg:ml-64 relative z-10 min-h-screen">
        {/* Mobile header */}
        <div className="flex items-center gap-3 mb-5 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center btn-ghost"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
              style={{
                background: "linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(139, 92, 246, 0.3))",
                border: "1px solid rgba(139, 92, 246, 0.2)",
              }}
            >
              <span className="aurora-text">A</span>
            </div>
            <span className="text-sm font-bold text-white/90">Aether Router</span>
          </div>
        </div>

        {/* Proxy/premium model disclaimer */}
        <div
          className="mb-6 rounded-xl px-4 py-3 text-xs flex items-start gap-3"
          style={{
            background: "linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(239, 68, 68, 0.04))",
            border: "1px solid rgba(251, 191, 36, 0.15)",
            color: "rgba(252, 211, 77, 0.9)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-amber-300/80">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="leading-relaxed">
            <span className="font-semibold text-amber-200/95">Heads up:</span>{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">w/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">c/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">an/</code> and{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">op/</code>{" "}
            models are routed through third-party providers. They come with{" "}
            <span className="font-semibold">no uptime guarantee</span>, are{" "}
            <span className="font-semibold">not eligible for refunds</span>, and may stop working at any time
            without notice. Use them at your own risk. See the full{" "}
            <Link href="/policies" className="underline hover:text-amber-100 transition-colors">
              policies
            </Link>
            .
          </p>
        </div>

        <div className="animate-in">
          {children}
        </div>
      </main>
    </div>
  );
}
