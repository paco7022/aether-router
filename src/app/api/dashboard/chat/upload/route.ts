import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireCsrf } from "@/lib/csrf";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 20 * 1024 * 1024;
// Per-user in-memory rate limit to stop script-driven bucket-fills. Resets on
// cold start. For stronger enforcement, back this with the DB.
const uploadHits = new Map<string, { count: number; resetAt: number }>();
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_MAX = 20; // 20 uploads/minute/user

function isUploadRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = uploadHits.get(userId);
  if (!entry || now > entry.resetAt) {
    uploadHits.set(userId, { count: 1, resetAt: now + UPLOAD_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > UPLOAD_MAX;
}

// Magic-byte sniff — client-declared `file.type` is untrusted. We only accept
// images whose leading bytes match the expected image header.
function detectImageMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  // PNG 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // JPEG FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}

export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (isUploadRateLimited(user.id)) {
    return NextResponse.json(
      { error: "too many uploads" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
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

  // Require an owned conversation. Prevents anonymous bucket fills where an
  // attacker uploads unbounded blobs into `unattached/` with no paper trail.
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("id", conversationId)
    .single();
  if (!conv) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const convFolder = conv.id;

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Reject when declared MIME doesn't match the actual file bytes.
  // Otherwise a client could upload an HTML/SVG payload with `image/png` set,
  // and browsers that content-sniff might render it as script.
  const detected = detectImageMime(bytes);
  if (!detected || detected !== file.type) {
    return NextResponse.json(
      { error: "file content does not match declared image type" },
      { status: 400 }
    );
  }

  const ext = detected.split("/")[1] || "bin";
  const path = `${user.id}/${convFolder}/${randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("chat-uploads")
    .upload(path, bytes, {
      contentType: detected,
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
    mime: detected,
    size: file.size,
    signed_url: signed?.signedUrl ?? null,
  });
}

