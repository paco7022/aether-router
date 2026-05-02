import { createServerSupabase } from "@/lib/supabase/server";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { SystemInjectionCard } from "@/components/SystemInjectionCard";

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
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Settings</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Your account details</p>
      </div>

      <div className="glass-card shimmer-line p-6">
        <div className="flex items-center gap-2 mb-5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <h3 className="font-semibold text-white/85">Profile</h3>
        </div>

        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(34, 211, 238, 0.15))",
                border: "1px solid rgba(139, 92, 246, 0.15)",
                boxShadow: "0 0 20px -4px rgba(139, 92, 246, 0.15)",
              }}
            >
              <span className="text-base font-semibold text-violet-300/80">
                {(profile?.display_name || user?.email || "U")[0].toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-base font-medium text-white/85">{profile?.display_name || "-"}</p>
              <p className="text-xs text-[var(--text-dim)]">Display Name</p>
            </div>
          </div>

          <div className="border-t border-white/[0.04] pt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">Email</p>
              <p className="text-sm text-white/80">{user?.email}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">Member Since</p>
              <p className="text-sm text-white/80">{new Date(profile?.created_at).toLocaleDateString()}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">User ID</p>
              <p className="text-xs font-mono text-cyan-300/50 select-all">{user?.id}</p>
            </div>
          </div>
        </div>
      </div>

      <SystemInjectionCard
        initialEnabled={profile?.system_injection_enabled ?? false}
        initialInjection={profile?.system_injection ?? null}
      />

      {/* Danger Zone */}
      <div className="glass-card shimmer-line p-6 mt-6" style={{ borderColor: "rgba(239, 68, 68, 0.1)" }}>
        <div className="flex items-center gap-2 mb-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(239, 68, 68, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h3 className="font-semibold text-red-400/80">Danger Zone</h3>
        </div>
        <p className="text-xs text-[var(--text-dim)] mb-4 leading-relaxed">
          Deleting your account will remove all data and free your device fingerprint so you can register again with a different email.
        </p>
        <DeleteAccountButton />
      </div>
    </div>
  );
}
