// Action a moderation review (ban or dismiss) from the operator's decision.
// Part of the "human reads the exported file, agent actions via metadata" flow.
// Uses ONLY metadata (user_id, content_hash, categories, scores) — never reads
// flagged_text/context. Mirrors admin route's review_ban / banUserForViolation.
//
// Usage:
//   node scripts/review-action.mjs --email <email> --action ban     [--reviewer <who>]
//   node scripts/review-action.mjs --email <email> --action dismiss [--reviewer <who>]
//   node scripts/review-action.mjs --id <review_id> --action ban|dismiss
//
// --email targets ALL that user's pending reviews. --id targets one row.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const email = get("--email");
const reviewId = get("--id");
const action = get("--action");
const reviewer = get("--reviewer") || "operator (via agent)";
if (!action || !["ban", "dismiss"].includes(action) || (!email && !reviewId)) {
  console.error("Usage: --action ban|dismiss  (--email <email> | --id <review_id>)  [--reviewer <who>]");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Resolve target review rows (metadata only — NO flagged_text/context selected).
let userId;
if (email) {
  const { data: prof, error } = await supabase.from("profiles").select("id").eq("email", email).single();
  if (error || !prof) { console.error(`User not found for email ${email}: ${error?.message}`); process.exit(1); }
  userId = prof.id;
}
let q = supabase.from("moderation_reviews").select("id, user_id, content_hash, categories, category_scores, source, status");
q = reviewId ? q.eq("id", reviewId) : q.eq("user_id", userId).eq("status", "pending");
const { data: reviews, error: rErr } = await q;
if (rErr) { console.error(rErr.message); process.exit(1); }
if (!reviews || reviews.length === 0) { console.error("No matching review rows."); process.exit(1); }
if (!userId) userId = reviews[0].user_id;

const targetIds = reviews.map((r) => r.id);
console.log(`action=${action}  user_id=${userId}  rows=${targetIds.length}  hashes=${reviews.map((r) => r.content_hash.slice(0, 8)).join(",")}`);

if (action === "dismiss") {
  const { error } = await supabase.from("moderation_reviews")
    .update({ status: "dismissed", reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
    .in("id", targetIds);
  if (error) { console.error("Dismiss failed:", error.message); process.exit(1); }
  console.log(`Dismissed ${targetIds.length} row(s).`);
  process.exit(0);
}

// --- BAN: replicate banUserForViolation ---
// 1. hash-only audit incident per flagged review
for (const r of reviews) {
  const { error } = await supabase.from("csam_incidents").insert({
    user_id: userId, content_hash: r.content_hash,
    categories: r.categories || [], category_scores: r.category_scores || {}, source: r.source || "api",
  });
  if (error) console.error(`  csam_incident insert (hash ${r.content_hash.slice(0, 8)}):`, error.message);
}
// 2. profile: clear protection + revoke activation
{ const { error } = await supabase.from("profiles").update({ is_protected: false, is_activated: false }).eq("id", userId);
  if (error) console.error("  profile update:", error.message); }
// 3. auth ban (~permanent)
{ const { error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) console.error("  auth ban:", error.message); }
// 4. disable all api keys
{ const { error } = await supabase.from("api_keys").update({ is_active: false, note: "Disabled: AUP violation" }).eq("user_id", userId);
  if (error) console.error("  api_keys disable:", error.message); }
// 5. mark reviews actioned
{ const { error } = await supabase.from("moderation_reviews")
    .update({ status: "actioned", reviewed_by: reviewer, reviewed_at: new Date().toISOString() }).in("id", targetIds);
  if (error) console.error("  review status:", error.message); }

// verify
const { data: au } = await supabase.from("profiles").select("is_activated").eq("id", userId).single();
const { data: keys } = await supabase.from("api_keys").select("is_active").eq("user_id", userId);
const { count: inc } = await supabase.from("csam_incidents").select("*", { count: "exact", head: true }).eq("user_id", userId);
console.log(`BANNED user_id=${userId}  is_activated=${au?.is_activated}  active_keys=${(keys || []).filter((k) => k.is_active).length}/${(keys || []).length}  total_incidents=${inc}`);
