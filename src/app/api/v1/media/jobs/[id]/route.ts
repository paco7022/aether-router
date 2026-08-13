import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateMediaRequest } from "@/lib/media-auth";
import {
  cancelMediaJob,
  MediaError,
  reconcileMediaJob,
  serializeJob,
  type MediaJobRow,
} from "@/lib/media-jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

async function loadOwnJob(userId: string, id: string): Promise<MediaJobRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("media_jobs")
    .select("*")
    .eq("id", id)
    // El filtro por user_id es el que hace de autorización: sin él, cualquiera
    // con un UUID ajeno vería (y cancelaría) generaciones de otro.
    .eq("user_id", userId)
    .single();
  return (data as unknown as MediaJobRow) || null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMediaRequest(req, { mutating: false });
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const row = await loadOwnJob(auth.keyInfo.userId, id);
  if (!row) {
    return NextResponse.json(
      { error: { message: "Job not found", type: "not_found" } },
      { status: 404 },
    );
  }

  try {
    const updated = await reconcileMediaJob(row);
    return NextResponse.json(await serializeJob(updated));
  } catch (err) {
    if (err instanceof MediaError) {
      return NextResponse.json(
        { error: { message: err.message, type: err.code } },
        { status: err.status },
      );
    }
    // Un fallo al consultar el bridge no debe romper el poll: se devuelve el
    // último estado conocido y el cliente reintenta.
    return NextResponse.json(await serializeJob(row));
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMediaRequest(req, { mutating: true });
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const row = await loadOwnJob(auth.keyInfo.userId, id);
  if (!row) {
    return NextResponse.json(
      { error: { message: "Job not found", type: "not_found" } },
      { status: 404 },
    );
  }

  if (row.status === "succeeded") {
    return NextResponse.json(
      { error: { message: "This generation already finished", type: "invalid_request" } },
      { status: 409 },
    );
  }

  const canceled = await cancelMediaJob(row);
  return NextResponse.json(await serializeJob(canceled));
}
