// Training-data capture.
//
// A small set of users explicitly consented to have their conversations
// (input messages + the model's reply) stored to fine-tune a custom roleplay
// model, in exchange for a daily allowance of expiring credits. The router
// calls captureTrainingSample() once per completed request for those users.
//
// HARD RULE: the caller MUST only invoke this when the existing CSAM
// moderation gate did NOT flag the request (`moderation.flagged === false`).
// Flagged `sexual/minors` content must never be persisted — the dataset must
// not become the very illegal-content store the rest of the system purges.
//
// Best-effort: every failure is swallowed and logged. Capturing training data
// must never affect the user's request or billing.

import { createAdminClient } from "@/lib/supabase/admin";

export type TrainingMessage = { role: string; content: unknown };

export async function captureTrainingSample(opts: {
  userId: string;
  modelId: string | null;
  source: "api" | "chat";
  // Full input array exactly as submitted (system card + history + latest turn).
  messages: TrainingMessage[];
  // The model's reply (assistant output).
  completion: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  // Nothing useful to learn from an empty reply — and the stream-guard upstream
  // would already have refunded it. Skip to keep the corpus clean.
  if (!opts.completion || !opts.completion.trim()) return;
  if (!opts.messages || opts.messages.length === 0) return;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc("record_training_sample", {
      p_user_id: opts.userId,
      p_model_id: opts.modelId,
      p_source: opts.source,
      p_messages: opts.messages,
      p_completion: opts.completion,
      p_prompt_tokens: Math.max(0, Math.round(opts.promptTokens || 0)),
      p_completion_tokens: Math.max(0, Math.round(opts.completionTokens || 0)),
    });
    if (error) {
      console.error("Failed to record training sample:", error.message);
    }
  } catch (err) {
    console.error("Training capture threw:", (err as Error).message);
  }
}
