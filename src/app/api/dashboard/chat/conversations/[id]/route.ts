import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireCsrf } from "@/lib/csrf";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: string; [k: string]: unknown };

const STORAGE_PREFIX = "storage:";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Replace internal `storage:{path}` sentinels with fresh signed URLs so the
 * client can render image previews. Never stored in the DB — regenerated on
 * every read because signed URLs expire.
 */
async function expandImageUrls(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  content: unknown
): Promise<unknown> {
  if (!Array.isArray(content)) return content;
  const parts = content as ContentPart[];
  const paths: string[] = [];
  for (const p of parts) {
    if (p && typeof p === "object" && p.type === "image_url") {
      const url = (p as { image_url?: { url?: string } }).image_url?.url;
      if (typeof url === "string" && url.startsWith(STORAGE_PREFIX)) {
        paths.push(url.slice(STORAGE_PREFIX.length));
      }
    }
  }
  if (paths.length === 0) return content;

  const { data: signed } = await supabase.storage
    .from("chat-uploads")
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  const byPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
  }

  return parts.map((p) => {
    if (p && typeof p === "object" && p.type === "image_url") {
      const url = (p as { image_url?: { url?: string } }).image_url?.url;
      if (typeof url === "string" && url.startsWith(STORAGE_PREFIX)) {
        const path = url.slice(STORAGE_PREFIX.length);
        const signedUrl = byPath.get(path);
        if (signedUrl) {
          return { ...p, image_url: { url: signedUrl }, storage_path: path };
        }
      }
    }
    return p;
  });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: conv, error: convErr } = await supabase
    .from("chat_conversations")
    .select("id, title, model_id, system_prompt, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (convErr || !conv) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, role, content, model_id, prompt_tokens, completion_tokens, credits_charged, error, created_at")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const expanded = await Promise.all(
    (messages ?? []).map(async (m) => ({
      ...m,
      content: await expandImageUrls(supabase, m.content),
    }))
  );

  return NextResponse.json({ conversation: conv, messages: expanded });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { title?: string; model_id?: string; system_prompt?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.slice(0, 200);
  if (typeof body.model_id === "string") patch.model_id = body.model_id;
  if (body.system_prompt === null) patch.system_prompt = null;
  else if (typeof body.system_prompt === "string") patch.system_prompt = body.system_prompt.slice(0, 10_000);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chat_conversations")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, title, model_id, system_prompt, created_at, updated_at")
    .single();

  if (error || !data) {
    if (error) console.error("Failed to update conversation:", error.message);
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation: data });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const csrfError = requireCsrf(_req);
  if (csrfError) return csrfError;

  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("chat_conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to delete conversation:", error.message);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
