import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

// Discord snowflakes are 17-20 digit numeric IDs.
const DISCORD_ID_RE = /^\d{17,20}$/;

// POST /api/v1/account/discord — link/update/remove the user's Discord ID.
// Body: { discord_id: string }. Empty string removes the link.
export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { discord_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = typeof body.discord_id === "string" ? body.discord_id.trim() : "";

  // Empty => unlink.
  let discordId: string | null = null;
  if (raw.length > 0) {
    if (!DISCORD_ID_RE.test(raw)) {
      return NextResponse.json(
        { error: "Enter a valid Discord ID (17-20 digits). Enable Developer Mode in Discord, right-click your name and choose “Copy User ID”." },
        { status: 400 }
      );
    }
    discordId = raw;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ discord_id: discordId })
    .eq("id", user.id);

  if (error) {
    console.error("Failed to update discord_id:", error.message);
    return NextResponse.json({ error: "Failed to save. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, discord_id: discordId });
}
