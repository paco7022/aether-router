import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyState, DISCORD_NONCE_COOKIE } from "@/lib/discord-oauth";

// GET /api/auth/discord/callback — Discord redirects here with `code` + `state`.
// Validates the signed state (+ cookie nonce), exchanges the code, reads the
// verified Discord identity, and runs the atomic keep-primary link via the
// `link_discord_free` RPC. The Discord email is NEVER persisted (PII) — only
// the `verified` flag is forwarded to the RPC.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/dashboard/discord?${q}`);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const secret = process.env.DISCORD_OAUTH_STATE_SECRET;
  if (!secret) {
    console.error("DISCORD_OAUTH_STATE_SECRET is not set");
    return back("err=config");
  }

  const nonce = (await cookies()).get(DISCORD_NONCE_COOKIE)?.value;
  const payload = await verifyState(secret, state || "", nonce);
  if (!code || !payload) return back("err=state");

  // 1) Exchange the authorization code for an access token.
  let token: { access_token?: string };
  try {
    token = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI!,
      }),
    }).then((r) => r.json());
  } catch {
    return back("err=token");
  }
  if (!token.access_token) return back("err=token");

  // 2) Fetch the identity. `verified` requires the `email` scope.
  let me: { id?: string; verified?: boolean };
  try {
    me = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }).then((r) => r.json());
  } catch {
    return back("err=identity");
  }
  if (!me.id) return back("err=identity");

  // 3) Atomic keep-primary link (rejects duplicates, logs to manual queue).
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("link_discord_free", {
    p_user_id: payload.uid,
    p_discord_id: String(me.id),
    p_verified: me.verified === true,
  });

  const res = (() => {
    if (error) {
      console.error("link_discord_free failed:", error.message);
      return back("err=server");
    }
    const result = data as { status?: string; reason?: string };
    if (result?.status === "linked") return NextResponse.redirect(`${origin}/dashboard?discord=ok`);
    if (result?.reason === "email_unverified") return back("err=verify_email");
    if (result?.reason === "discord_already_linked") return back("err=dupe");
    return back("err=unknown");
  })();

  res.cookies.delete(DISCORD_NONCE_COOKIE);
  return res;
}
