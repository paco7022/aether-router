// Print a metadata-only triage index of moderation_reviews rows.
// Identifiers + scores + status only — NEVER the flagged content. Lets the
// operator know which exported evidence file to read and prioritize.
//
// Usage: node scripts/moderation-index.mjs [pending|dismissed|actioned|all]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const STATUS = process.argv[2] || "pending";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let q = supabase
  .from("moderation_reviews")
  .select("id, user_id, categories, category_scores, source, status, created_at")
  .order("created_at", { ascending: true });
if (STATUS !== "all") q = q.eq("status", STATUS);
const { data: rows, error } = await q;
if (error) { console.error(error.message); process.exit(1); }

const ids = [...new Set(rows.map((r) => r.user_id))];
const { data: profs } = await supabase.from("profiles").select("id, email").in("id", ids);
const emailById = Object.fromEntries((profs || []).map((p) => [p.id, p.email]));

console.log(`status=${STATUS}  rows=${rows.length}\n`);
for (const r of rows) {
  const stamp = String(r.created_at).replace(/[:T]/g, "-").slice(0, 16);
  const file = `${stamp}_${r.status}_${r.id.slice(0, 8)}.json`;
  const score = (r.category_scores && r.category_scores["sexual/minors"]) ?? "";
  console.log(`${file}`);
  console.log(`   email=${emailById[r.user_id] || "?"}  score=${typeof score === "number" ? score.toFixed(3) : score}  src=${r.source}  cats=${(r.categories || []).join(",")}`);
}
