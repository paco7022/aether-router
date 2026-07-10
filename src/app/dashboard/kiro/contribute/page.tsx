import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { KiroContributeCard } from "@/components/KiroContributeCard";

export default async function KiroContributePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Kiro Pool</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Contribute your Kiro account to the community pool and unlock real Claude (
          <span className="font-mono text-white/70">k/</span> models) cheap for everyone.
        </p>
      </div>

      <KiroContributeCard />
    </div>
  );
}
