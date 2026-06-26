// Auto-runner for the staged local training experiments.
//
// Meant to run on a schedule (Windows Task Scheduler — see register-auto-train.ps1).
// On each run it looks for a training milestone that has been REACHED but not yet
// PROCESSED, and for it:
//   1. exports the dataset (dedup + window) → ../training-data/dataset-<tag>.jsonl
//   2. writes a READY-TO-TRAIN marker with the exact train command
//   3. if AUTO_TRAIN=1 in the env, launches the QLoRA trainer right away
//   4. stamps training_milestones.processed_at so it won't run again
//
// These are throwaway LOCAL test runs (the real one is on AWS later), so the
// default is export + marker; flip AUTO_TRAIN=1 once the Python/Unsloth env is
// installed and you want hands-off training.
//
// Manual use:
//   node scripts/auto-train-runner.mjs            # process next reached+unprocessed milestone
//   node scripts/auto-train-runner.mjs --force    # process the latest reached one even if already processed
//   node scripts/auto-train-runner.mjs --dry       # do everything except stamp/launch

import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const DATA_DIR = resolve(REPO, "..", "training-data");
const LOG = resolve(DATA_DIR, "auto-train.log");
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry");
const AUTO_TRAIN = process.env.AUTO_TRAIN === "1";

mkdirSync(DATA_DIR, { recursive: true });
const log = (m) => { const s = `[${new Date().toISOString()}] ${m}`; console.log(s); try { appendFileSync(LOG, s + "\n"); } catch {} };

// ---- env ----
const env = {};
for (const line of readFileSync(resolve(REPO, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// tag + recommended window per milestone (small datasets → shorter windows are fine)
function planFor(threshold) {
  if (threshold <= 50_000_000) return { tag: "run1-50m", window: 4096 };
  if (threshold <= 100_000_000) return { tag: "run2-100m", window: 6000 };
  return { tag: "run3-200m", window: 8192 };
}

async function main() {
  // ---- pick a milestone to process ----
  let q = supabase.from("training_milestones").select("threshold, label, reached, processed_at").eq("reached", true);
  if (!FORCE) q = q.is("processed_at", null);
  const { data: rows, error } = await q.order("threshold", { ascending: !FORCE });
  if (error) { log(`Query failed: ${error.message}`); return 1; }
  if (!rows || rows.length === 0) { log("No reached+unprocessed milestone. Nothing to do."); return 0; }

  const ms = FORCE ? rows[rows.length - 1] : rows[0];
  const { tag, window } = planFor(ms.threshold);
  log(`Processing milestone ${ms.threshold} (${ms.label}) → tag=${tag}, window=${window}`);

  // ---- 1. export ----
  try {
    const out = execFileSync("node", [resolve(__dirname, "export-training-data.mjs"), "--tag", tag, "--window-tokens", String(window)], { cwd: REPO, encoding: "utf8" });
    log("export:\n" + out.trim());
  } catch (e) {
    log(`Export FAILED: ${e.message}`); return 1;
  }

  const dataFile = resolve(DATA_DIR, "latest.jsonl");
  const outDir = resolve(DATA_DIR, `out-${tag}`);
  const trainCmd = `python scripts/train_qlora_gemma4.py --data "${dataFile}" --out "${outDir}" --seq-len ${Math.min(window, 4096)} --epochs 1`;

  // ---- 2. marker ----
  const marker = resolve(DATA_DIR, `READY-TO-TRAIN-${tag}.txt`);
  writeFileSync(marker, `Milestone ${ms.threshold} reached.\nDataset: ${dataFile}\n\nRun training with:\n  cd "${REPO}"\n  ${trainCmd}\n`, "utf8");
  log(`Marker written: ${marker}`);

  // ---- 3. optional auto-train ----
  if (AUTO_TRAIN && !DRY) {
    if (!existsSync(resolve(REPO, "scripts", "train_qlora_gemma4.py"))) {
      log("AUTO_TRAIN set but trainer script missing — skipping launch.");
    } else {
      log(`AUTO_TRAIN=1 → launching trainer (detached). Logs: ${resolve(outDir, "train.log")}`);
      mkdirSync(outDir, { recursive: true });
      const child = spawn("python", ["scripts/train_qlora_gemma4.py", "--data", dataFile, "--out", outDir, "--seq-len", String(Math.min(window, 4096)), "--epochs", "1"],
        { cwd: REPO, detached: true, stdio: ["ignore", "a", "a"] });
      child.unref();
      log(`Trainer launched (pid ${child.pid}).`);
    }
  } else {
    log(`AUTO_TRAIN not enabled — export only. To train: ${trainCmd}`);
  }

  // ---- 4. stamp ----
  if (DRY) { log("--dry: not stamping processed_at."); return 0; }
  const { error: upErr } = await supabase.from("training_milestones").update({ processed_at: new Date().toISOString() }).eq("threshold", ms.threshold);
  if (upErr) { log(`Failed to stamp processed_at: ${upErr.message}`); return 1; }
  log(`Stamped processed_at for milestone ${ms.threshold}. Done.`);
  return 0;
}

// Set exit code but let the event loop drain naturally — calling process.exit()
// while supabase's fetch handles are closing trips a libuv assert on Node/Windows.
main().then((code) => { process.exitCode = code; }).catch((e) => { log(`Fatal: ${e.message}`); process.exitCode = 1; });
