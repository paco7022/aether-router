import { createServerSupabase } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90">Settings</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Your account details</p>
      </div>

      <div className="glass-card shimmer-line p-6">
        <h3 className="font-semibold text-white/85 mb-5">Profile</h3>

        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(34, 211, 238, 0.15))",
                border: "1px solid rgba(139, 92, 246, 0.15)",
              }}
            >
              <span className="text-sm font-semibold text-violet-300/80">
                {(profile?.display_name || user?.email || "U")[0].toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-white/85">{profile?.display_name || "-"}</p>
              <p className="text-xs text-[var(--text-dim)]">Display Name</p>
            </div>
          </div>

          <div className="border-t border-white/[0.04] pt-4 space-y-4">
            <div>
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">Email</p>
              <p className="text-sm text-white/80">{user?.email}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">User ID</p>
              <p className="text-xs font-mono text-cyan-300/50">{user?.id}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">Member Since</p>
              <p className="text-sm text-white/80">{new Date(profile?.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
