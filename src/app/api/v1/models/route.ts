import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createAdminClient();

  const { data: models, error } = await supabase
    .from("models")
    .select("id, capabilities")
    .eq("is_active", true)
    .order("id");

  if (error) {
    return NextResponse.json(
      { error: { message: "Failed to fetch models", type: "server_error" } },
      { status: 500 }
    );
  }

  // OpenAI-compatible /v1/models response format, extended with capabilities
  const data = (models || []).map((m) => ({
    id: m.id,
    object: "model",
    created: 0,
    owned_by: "aether-router",
    capabilities: m.capabilities ?? ["streaming", "system_message"],
  }));

  return NextResponse.json({
    object: "list",
    data,
  });
}
