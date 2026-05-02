import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

const MAX_INJECTION_LENGTH = 8192;

// GET /api/v1/account/injection — return current injection settings
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("system_injection, system_injection_enabled")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    system_injection: profile?.system_injection ?? null,
    system_injection_enabled: profile?.system_injection_enabled ?? false,
  });
}

// PATCH /api/v1/account/injection — save injection settings
export async function PATCH(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { system_injection?: string | null; system_injection_enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const injection = body.system_injection ?? null;
  const enabled = body.system_injection_enabled ?? false;

  if (injection !== null && typeof injection !== "string") {
    return NextResponse.json({ error: "system_injection must be a string or null" }, { status: 400 });
  }
  if (injection && injection.length > MAX_INJECTION_LENGTH) {
    return NextResponse.json(
      { error: `system_injection exceeds max length of ${MAX_INJECTION_LENGTH} characters` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      system_injection: injection,
      system_injection_enabled: enabled,
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save injection settings" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
