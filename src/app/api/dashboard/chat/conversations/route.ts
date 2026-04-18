import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, title, model_id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { model_id?: string; title?: string; system_prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.model_id) {
    return NextResponse.json({ error: "model_id required" }, { status: 400 });
  }

  const { data: model } = await supabase
    .from("models")
    .select("id")
    .eq("id", body.model_id)
    .eq("is_active", true)
    .single();

  if (!model) {
    return NextResponse.json({ error: "model not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("chat_conversations")
    .insert({
      user_id: user.id,
      title: body.title?.slice(0, 200) || "New chat",
      model_id: body.model_id,
      system_prompt: body.system_prompt?.slice(0, 10_000) || null,
    })
    .select("id, title, model_id, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: data });
}
