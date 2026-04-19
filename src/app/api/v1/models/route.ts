import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateBanStatus } from "@/lib/ban";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const banDecision = await evaluateBanStatus({ headers: req.headers });
  if (banDecision?.blocked) {
    if (banDecision.statusCode === 403) {
      return NextResponse.json(
        { error: { message: banDecision.reason, type: "ban_enforced" } },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: { message: banDecision.reason, type: "server_error" } },
      { status: 503 }
    );
  }

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
