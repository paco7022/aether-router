import { createAdminClient } from "@/lib/supabase/admin";
import { banFromDiscordGuild } from "@/lib/discord-bot";

// Permanently ban a user account for a non-CSAM reason (e.g. multi-account
// abuse, key sharing). Mirrors the account-level actions of
// banUserForViolation (auth ban + key disable + profile lockdown) but does
// NOT write a csam_incidents row — those are reserved for actual CSAM.
// Propagates the ban to the Discord guild (best-effort; the router ban is
// authoritative and never blocked if Discord is down/unconfigured/unlinked).
export async function banUserAccount(options: {
  userId: string;
  reason: string;
}): Promise<void> {
  const supabase = createAdminClient();

  // Clear protection + revoke activation so anti-abuse triggers apply if they
  // try to return via fingerprint reuse.
  const { error: profErr } = await supabase
    .from("profiles")
    .update({ is_protected: false, is_activated: false })
    .eq("id", options.userId);
  if (profErr) console.error("Multi-account ban: profile update failed:", profErr.message);

  // auth.users banned_until — what GoTrue checks to block new sessions.
  const { error: authErr } = await supabase.auth.admin.updateUserById(options.userId, {
    ban_duration: "876000h",
  });
  if (authErr) console.error("Multi-account ban: auth ban failed:", authErr.message);

  const { error: keyErr } = await supabase
    .from("api_keys")
    .update({ is_active: false, note: `Disabled: ${options.reason}` })
    .eq("user_id", options.userId);
  if (keyErr) console.error("Multi-account ban: key disable failed:", keyErr.message);

  // Cross-ban to Discord if the account has a linked id.
  const { data: prof } = await supabase
    .from("profiles")
    .select("discord_id")
    .eq("id", options.userId)
    .single();
  if (prof?.discord_id) {
    const result = await banFromDiscordGuild(prof.discord_id, options.reason);
    if (!result.ok) {
      console.warn(
        `Discord cross-ban not applied for ${options.userId}: ${result.skipped}${
          result.status ? ` (${result.status})` : ""
        }`
      );
    }
  }
}
