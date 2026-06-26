// Discord bot API helpers (server-side / service-role context).
//
// Used to propagate router-level bans to the Discord guild so a single admin
// action removes a violator from BOTH surfaces (router + Discord). This is
// best-effort: the router ban is always authoritative and must never be
// blocked or reverted if Discord is down, unconfigured, or the user isn't in
// the server. Requires a bot (with BAN_MEMBERS) added to the guild:
//   DISCORD_BOT_TOKEN  — the bot user's token ("Bot xxx")
//   DISCORD_GUILD_ID   — the server (guild) id

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordBanResult =
  | { ok: true; status: number }
  | { ok: false; skipped: string; status?: number };

/**
 * Ban a Discord user from the configured guild. Safe no-op when the bot isn't
 * configured or `discordId` is missing. Never throws.
 */
export async function banFromDiscordGuild(
  discordId: string | null | undefined,
  reason: string
): Promise<DiscordBanResult> {
  if (!discordId) return { ok: false, skipped: "no_discord_id" };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { ok: false, skipped: "not_configured" };

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/bans/${discordId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        // Surfaces in the server's audit log. Header must be URL-encoded.
        "X-Audit-Log-Reason": encodeURIComponent(reason.slice(0, 400)),
      },
      // Purge the last 7 days of the offender's messages from the server.
      body: JSON.stringify({ delete_message_seconds: 604800 }),
    });

    if (res.status === 204 || res.status === 200) return { ok: true, status: res.status };
    if (res.status === 404) return { ok: false, skipped: "not_in_guild", status: 404 };

    const txt = await res.text().catch(() => "");
    console.error(`Discord guild ban failed (${res.status}):`, txt.slice(0, 200));
    return { ok: false, skipped: "api_error", status: res.status };
  } catch (e) {
    console.error("Discord guild ban error:", (e as Error).message);
    return { ok: false, skipped: "exception" };
  }
}
