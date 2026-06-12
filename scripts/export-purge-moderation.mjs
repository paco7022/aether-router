// Export-and-purge moderation content.
//
// Policy (2026-06-05): storing the flagged conversation text is a legal
// liability in the operator's country. This script DOWNLOADS each
// moderation_reviews row's content to a local folder on the operator's PC
// (for the human to read), then PURGES the content from the DB — leaving only
// the logs (metadata row + the hash-only csam_incidents audit).
//
// IMPORTANT — the script NEVER prints the flagged text/context to stdout or
// stderr. It only prints row ids, filenames, byte counts and summary totals.
// This keeps the content out of any AI/agent context: the agent runs the
// script but never sees the material. The human reads the exported files.
//
// Usage:
//   node scripts/export-purge-moderation.mjs                 # export only (dry; no DB change)
//   node scripts/export-purge-moderation.mjs --purge         # export THEN clear content in DB
//   node scripts/export-purge-moderation.mjs --out "C:\\path" # override output folder
//   node scripts/export-purge-moderation.mjs --status all     # default; or pending|dismissed|actioned
//
// Output folder default: <gemini proxy>\moderation-evidence  (outside the public repo)

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---- args ----
const args = process.argv.slice(2);
const PURGE = args.includes("--purge");
const outIdx = args.indexOf("--out");
const statusIdx = args.indexOf("--status");
const STATUS = statusIdx >= 0 ? args[statusIdx + 1] : "all";
const OUT_DIR = resolve(
  outIdx >= 0 ? args[outIdx + 1] : resolve(process.cwd(), "..", "moderation-evidence")
);

// ---- env ----
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE url/service key in .env.local"); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });

// ---- fetch rows (content included, but kept inside this process only) ----
let q = supabase
  .from("moderation_reviews")
  .select("id, user_id, content_hash, flagged_text, context, categories, category_scores, source, status, reviewed_by, reviewed_at, created_at")
  .order("created_at", { ascending: true });
if (STATUS !== "all") q = q.eq("status", STATUS);
const { data: rows, error } = await q;
if (error) { console.error("Query failed:", error.message); process.exit(1); }

// Skip rows whose content is already empty (idempotent).
const withContent = rows.filter(
  (r) => (r.flagged_text && r.flagged_text.length > 0) ||
         (Array.isArray(r.context) && r.context.length > 0)
);

console.log(`Rows matched: ${rows.length}  | with content to export: ${withContent.length}`);
console.log(`Output folder: ${OUT_DIR}`);
console.log(`Mode: ${PURGE ? "EXPORT + PURGE (DB content will be cleared)" : "EXPORT ONLY (no DB change) — pass --purge to delete"}`);

if (withContent.length === 0) { console.log("Nothing to do."); process.exit(0); }

// emails for the human's reference (identifier, not content)
const ids = [...new Set(withContent.map((r) => r.user_id))];
const { data: profs } = await supabase.from("profiles").select("id, email").in("id", ids);
const emailById = Object.fromEntries((profs || []).map((p) => [p.id, p.email]));

mkdirSync(OUT_DIR, { recursive: true });

const purgedIds = [];
let exported = 0;
for (const r of withContent) {
  const stamp = String(r.created_at).replace(/[:T]/g, "-").slice(0, 16);
  const fname = `${stamp}_${r.status}_${r.id.slice(0, 8)}.json`;
  const fpath = join(OUT_DIR, fname);
  try {
    const payload = JSON.stringify(
      { ...r, email: emailById[r.user_id] || null, _exported_at: new Date().toISOString() },
      null,
      2
    );
    writeFileSync(fpath, payload, { encoding: "utf8" });
    exported++;
    // Print filename + size ONLY. Never the content.
    console.log(`  exported ${fname}  (${Buffer.byteLength(payload)} bytes)`);
    if (PURGE) purgedIds.push(r.id);
  } catch (e) {
    console.error(`  FAILED to export row ${r.id}: ${e.message}`);
  }
}

console.log(`Exported ${exported}/${withContent.length} rows.`);

if (PURGE && purgedIds.length > 0) {
  // Clear content only; keep the metadata row as the audit log.
  const { error: upErr, count } = await supabase
    .from("moderation_reviews")
    .update({ flagged_text: "", context: [] }, { count: "exact" })
    .in("id", purgedIds);
  if (upErr) { console.error("Purge failed:", upErr.message); process.exit(1); }
  console.log(`Purged content from ${count ?? purgedIds.length} DB rows (metadata + hashes kept).`);
} else if (PURGE) {
  console.log("Purge requested but no rows were exported; DB left unchanged.");
}
