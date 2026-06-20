import { createServerSupabase } from "@/lib/supabase/server";
import { DiscordCard } from "@/components/DiscordCard";

export default async function DiscordPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("discord_id")
    .eq("id", user!.id)
    .single();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Discord</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Join our community and link your account for perks.
        </p>
      </div>

      <DiscordCard initialDiscordId={profile?.discord_id ?? null} />
    </div>
  );
}
