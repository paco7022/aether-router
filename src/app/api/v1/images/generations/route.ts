import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateMediaRequest } from "@/lib/media-auth";
import {
  createMediaJob,
  downloadAsset,
  MediaError,
  reconcileMediaJob,
  signAssets,
  type MediaJobRow,
} from "@/lib/media-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

// Wrapper OpenAI-compatible sobre la cola de media: encola y espera. Existe
// para que un cliente que ya habla con la API de imágenes de OpenAI funcione
// sin cambios. El video NO pasa por acá: un clip tarda minutos y ninguna
// conexión HTTP aguanta eso — para eso está /v1/media/jobs.
const POLL_INTERVAL_MS = 1_500;
const MAX_WAIT_MS = 240_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  const auth = await authenticateMediaRequest(req, { mutating: true });
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request" } },
      { status: 400 },
    );
  }

  const responseFormat = body.response_format === "b64_json" ? "b64_json" : "url";

  let job: MediaJobRow;
  try {
    job = await createMediaJob(auth.keyInfo, body);
  } catch (err) {
    if (err instanceof MediaError) {
      return NextResponse.json(
        { error: { message: err.message, type: err.code } },
        { status: err.status },
      );
    }
    console.error("images/generations:", err);
    return NextResponse.json(
      { error: { message: "Internal server error", type: "server_error" } },
      { status: 500 },
    );
  }

  if (job.kind === "video") {
    return NextResponse.json(
      {
        error: {
          message: `Video generation is asynchronous. Poll GET /v1/media/jobs/${job.id} for the result.`,
          type: "async_required",
          job_id: job.id,
        },
      },
      { status: 202 },
    );
  }

  const supabase = createAdminClient();
  const deadline = Date.now() + MAX_WAIT_MS;
  let current = job;

  while (Date.now() < deadline) {
    if (req.signal.aborted) {
      // El cliente cortó: el job sigue vivo y se puede recoger por su id.
      return NextResponse.json(
        { error: { message: "Client disconnected", type: "client_closed_request", job_id: job.id } },
        { status: 499 },
      );
    }

    await sleep(POLL_INTERVAL_MS);

    const { data } = await supabase.from("media_jobs").select("*").eq("id", job.id).single();
    const row = (data as unknown as MediaJobRow) || current;
    current = await reconcileMediaJob(row).catch(() => row);

    if (current.status === "succeeded") break;
    if (current.status === "failed" || current.status === "canceled") {
      return NextResponse.json(
        {
          error: {
            message: current.error || "The generation failed",
            type: "generation_failed",
            job_id: current.id,
          },
        },
        { status: 502 },
      );
    }
  }

  if (current.status !== "succeeded") {
    return NextResponse.json(
      {
        error: {
          message: `The generation is taking longer than expected. Poll GET /v1/media/jobs/${current.id} for the result.`,
          type: "timeout",
          job_id: current.id,
        },
      },
      { status: 202 },
    );
  }

  const data =
    responseFormat === "b64_json"
      ? await Promise.all(
          (current.assets || []).map(async (asset) => {
            const bytes = await downloadAsset(asset);
            return {
              b64_json: bytes ? Buffer.from(bytes).toString("base64") : null,
              revised_prompt: current.prompt,
            };
          }),
        )
      : (await signAssets(current.assets || [])).map((asset) => ({
          url: asset.url,
          revised_prompt: current.prompt,
        }));

  return NextResponse.json({
    created: Math.floor(new Date(current.finished_at || Date.now()).getTime() / 1000),
    data,
    // Extras fuera del contrato de OpenAI, útiles para reproducir la imagen.
    aether: {
      job_id: current.id,
      model: current.model_id,
      seed: current.seed,
      credits: current.credits_charged,
    },
  });
}
