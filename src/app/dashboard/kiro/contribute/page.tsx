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
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Pool de Kiro</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Aporta tu cuenta de Kiro al pool comunitario y desbloquea Claude real (modelos{" "}
          <span className="font-mono text-white/70">k/</span>) barato para todos.
        </p>
      </div>

      <KiroContributeCard />
    </div>
  );
}
