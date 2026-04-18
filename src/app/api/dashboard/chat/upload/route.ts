import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  const conversationId = form.get("conversation_id");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "unsupported mime type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (max 20 MB)" }, { status: 413 });
  }

  // If a conversation id is provided, enforce ownership (via RLS SELECT).
  let convFolder = "unattached";
  if (typeof conversationId === "string" && conversationId) {
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("id")
      .eq("id", conversationId)
      .single();
    if (!conv) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }
    convFolder = conv.id;
  }

  const ext = file.type.split("/")[1] || "bin";
  const path = `${user.id}/${convFolder}/${randomUUID()}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from("chat-uploads")
    .upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Return a short-lived signed URL for the client to preview immediately.
  const { data: signed } = await supabase.storage
    .from("chat-uploads")
    .createSignedUrl(path, 60 * 60);

  return NextResponse.json({
    path,
    mime: file.type,
    size: file.size,
    signed_url: signed?.signedUrl ?? null,
  });
}
