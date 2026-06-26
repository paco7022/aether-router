import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { signState, buildAuthorizeUrl, DISCORD_NONCE_COOKIE } from "@/lib/discord-oauth";

// GET /api/auth/discord/start — begins the verified Discord OAuth flow.
// Generates a signed `state` bound to the current user, stores the matching
// nonce in an httpOnly cookie, and redirects to Discord's consent screen.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const secret = process.env.DISCORD_OAUTH_STATE_SECRET;
  if (!secret) {
    console.error("DISCORD_OAUTH_STATE_SECRET is not set");
    return NextResponse.redirect(`${origin}/dashboard/discord?err=config`);
  }

  const { state, nonce } = await signState(secret, user.id);

  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set(DISCORD_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
