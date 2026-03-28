import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { pricePerMTokens } from "@/lib/credits";

export async function GET(req: NextRequest) {
  // Optional auth - if key provided, validate it
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    const keyInfo = await validateApiKey(key);
    if (!keyInfo) {
      return NextResponse.json(
        { error: { message: "Invalid API key", type: "auth_error" } },
        { status: 401 }
      );
    }
  }

  const supabase = createAdminClient();
  const { data: models, error } = await supabase
    .from("models")
    .select("*")
    .eq("is_active", true)
    .order("id");

  if (error) {
    return NextResponse.json({ error: { message: "Failed to fetch models" } }, { status: 500 });
  }

  return NextResponse.json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: Math.floor(new Date(m.created_at).getTime() / 1000),
      owned_by: m.provider,
      credits_per_m_input: pricePerMTokens(m.cost_per_m_input, m.margin),
      credits_per_m_output: pricePerMTokens(m.cost_per_m_output, m.margin),
    })),
  });
}
