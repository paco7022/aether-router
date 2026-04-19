import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { evaluateBanStatus } from "@/lib/ban";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";

  // SECURITY: prevent open redirects. `next` must be a same-origin absolute
  // path. Attackers try variants like `//evil.com/x`, `/\evil.com`, or
  // `http://evil.com/x`; we reject anything that doesn't start with a single
  // `/` followed by a non-slash, non-backslash character.
  const safeNext =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/dashboard";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const banDecision = await evaluateBanStatus({
          headers: request.headers,
          userId: user.id,
        });

        if (banDecision?.blocked) {
          await supabase.auth.signOut();
          const reason = encodeURIComponent(banDecision.reason || "Access blocked");
          return NextResponse.redirect(`${origin}/login?error=banned&reason=${reason}`);
        }
      }

      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
