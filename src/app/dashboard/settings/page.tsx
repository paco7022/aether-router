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
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="font-semibold mb-4">Profile</h3>

        <div className="space-y-3">
          <div>
            <p className="text-sm text-[var(--text-muted)]">Email</p>
            <p className="text-sm">{user?.email}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">Display Name</p>
            <p className="text-sm">{profile?.display_name || "-"}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">User ID</p>
            <p className="text-xs font-mono text-[var(--text-muted)]">{user?.id}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">Member Since</p>
            <p className="text-sm">{new Date(profile?.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
