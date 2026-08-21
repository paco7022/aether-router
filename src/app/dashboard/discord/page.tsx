import { createServerSupabase } from "@/lib/supabase/server";
import { DiscordCard } from "@/components/DiscordCard";

const ERR_MESSAGES: Record<string, string> = {
  state: "Verification link expired or invalid. Please try again.",
  token: "Couldn't reach Discord. Please try again.",
  identity: "Couldn't read your Discord account. Please try again.",
  verify_email: "Your Discord email isn't verified. Verify it in Discord, then try again.",
  dupe: "That Discord account is already linked to another account.",
  server: "Something went wrong on our side. Please try again.",
  config: "Discord verification is temporarily unavailable.",
  unknown: "Verification didn't complete. Please try again.",
};

const DiscordLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.332-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z" />
  </svg>
);

export default async function DiscordPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; discord?: string }>;
}) {
  const { err } = await searchParams;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("discord_id, discord_verified")
    .eq("id", user!.id)
    .single();

  const verified = profile?.discord_verified === true;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Discord</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Link Discord for giveaways, booster credits and support.
        </p>
      </div>

      {err && ERR_MESSAGES[err] && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm text-red-300" style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}>
          {ERR_MESSAGES[err]}
        </div>
      )}

      {/* Verified OAuth status / action */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[#7b86f5]" style={{ background: "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(139,92,246,0.12))", border: "1px solid rgba(88,101,242,0.20)" }}>
              <DiscordLogo size={22} />
            </div>
            <div>
              <h3 className="font-semibold text-white/85">Discord verification</h3>
              {verified ? (
                <p className="text-xs text-emerald-400 mt-0.5">✓ Verified — your free plan is secured.</p>
              ) : (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Required for the free plan. One Discord account = one free account.</p>
              )}
            </div>
          </div>
          {!verified && (
            <a
              href="/api/auth/discord/start"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: "linear-gradient(135deg, #5865f2, #7b86f5)", border: "1px solid rgba(123,134,245,0.4)" }}
            >
              <DiscordLogo size={16} />
              Verify with Discord
            </a>
          )}
        </div>
      </div>

      <DiscordCard initialDiscordId={profile?.discord_id ?? null} />
    </div>
  );
}
