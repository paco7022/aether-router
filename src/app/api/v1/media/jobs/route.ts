import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateMediaRequest } from "@/lib/media-auth";
import {
  createMediaJob,
  MediaError,
  reconcileMediaJob,
  serializeJob,
  type MediaJobRow,
} from "@/lib/media-jobs";

export const runtime = "nodejs";
// Encolar es rápido (submit + insert); la espera la hace el poll.
export const maxDuration = 120;

const MAX_BODY_BYTES = 16 * 1024 * 1024; // init_image en base64
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function errorResponse(err: unknown) {
  if (err instanceof MediaError) {
    return NextResponse.json({ error: { message: err.message, type: err.code } }, { status: err.status });
  }
  console.error("media/jobs:", err);
  return NextResponse.json(
    { error: { message: "Internal server error", type: "server_error" } },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  const auth = await authenticateMediaRequest(req, { mutating: true });
  if ("response" in auth) return auth.response;

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { message: "Request body too large", type: "invalid_request" } },
      { status: 413 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request" } },
      { status: 400 },
    );
  }

  try {
    const job = await createMediaJob(auth.keyInfo, body);
    return NextResponse.json(await serializeJob(job), { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  const auth = await authenticateMediaRequest(req, { mutating: false });
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("media_jobs")
    .select("*")
    .eq("user_id", auth.keyInfo.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: { message: "Could not load generations", type: "server_error" } },
      { status: 500 },
    );
  }

  const rows = (data as unknown as MediaJobRow[]) || [];

  // Los jobs abiertos se reconcilian acá también: así el historial del
  // dashboard avanza aunque nadie esté haciendo poll del job puntual.
  const settled = await Promise.all(
    rows.map(async (row) => {
      if (row.status !== "queued" && row.status !== "running") return row;
      try {
        return await reconcileMediaJob(row);
      } catch {
        return row;
      }
    }),
  );

  return NextResponse.json({
    object: "list",
    data: await Promise.all(settled.map(serializeJob)),
  });
}
