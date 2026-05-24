import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/public-endpoints";
import { getSupabasePublicKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
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
      getSupabaseUrl(),
      getSupabasePublicKey(),
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
      return NextResponse.redirect(publicUrl(safeNext));
    }
  }

  return NextResponse.redirect(publicUrl("/login?error=auth_failed"));
}
