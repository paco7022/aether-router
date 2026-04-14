import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { FingerprintCapture } from "@/components/FingerprintCapture";
import { isAdmin } from "@/lib/admin";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, plans(name)")
    .eq("id", user.id)
    .single();

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
        user={{
          email: user.email || "",
          displayName: profile?.display_name || "",
          credits: profile?.credits || 0,
          dailyCredits: profile?.daily_credits || 0,
          planName: (profile?.plans as { name: string } | null)?.name,
        }}
        isAdmin={isAdmin(user.email)}
      />
      <FingerprintCapture />
      <main className="flex-1 p-6 lg:p-8 ml-64 relative z-10">
        {/* Proxy/premium model disclaimer — shown site-wide */}
        <div
          className="mb-6 rounded-lg px-4 py-3 text-xs flex items-start gap-3"
          style={{
            background: "linear-gradient(135deg, rgba(251, 191, 36, 0.08), rgba(239, 68, 68, 0.06))",
            border: "1px solid rgba(251, 191, 36, 0.2)",
            color: "rgba(252, 211, 77, 0.95)",
          }}
        >
          <span aria-hidden className="font-mono text-amber-300/90 pt-0.5">!</span>
          <p className="leading-relaxed">
            <span className="font-semibold text-amber-200/95">Heads up:</span>{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">w/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">c/</code> and{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">an/</code>{" "}
            models are routed through third-party providers. They come with{" "}
            <span className="font-semibold">no uptime guarantee</span>, are{" "}
            <span className="font-semibold">not eligible for refunds</span>, and may stop working at any time
            without notice. Use them at your own risk. See the full{" "}
            <Link href="/policies" className="underline hover:text-amber-100">
              policies
            </Link>
            .
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
