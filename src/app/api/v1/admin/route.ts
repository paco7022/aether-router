import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/auth";
import { API_KEY_PREFIX } from "@/lib/constants";
import { requireCsrf } from "@/lib/csrf";
import { banUserForViolation } from "@/lib/content-moderation";
import { getAdminRole, type AdminRole } from "@/lib/admin-role";

// Escape LIKE/ILIKE wildcards so user input is treated literally.
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

// GET actions a "mod" (gifted moderator) may call. Everything else is admin-only.
const MOD_GET_ACTIONS = new Set(["whoami", "users"]);
// POST actions a "mod" may call. Both are further restricted to free-tier
// targets inside their handlers.
const MOD_POST_ACTIONS = new Set(["set_activation", "set_claude_activation"]);

async function requireAdmin(
  _req: NextRequest,
): Promise<{ user: { id: string; email: string | null }; role: AdminRole } | null> {
  const identity = await getAdminRole();
  if (!identity) return null;
  return { user: { id: identity.userId, email: identity.email }, role: identity.role };
}

// Moderators may only act on free-tier accounts. Returns a 403 response when a
// mod targets a non-free user (paid, another mod, or an admin); null otherwise.
async function assertModFreeTarget(
  supabase: ReturnType<typeof createAdminClient>,
  role: AdminRole,
  userId: string,
): Promise<NextResponse | null> {
  if (role !== "mod") return null;
  const { data: target } = await supabase
    .from("profiles")
    .select("plan_id")
    .eq("id", userId)
    .single();
  if (!target || target.plan_id !== "free") {
    return NextResponse.json(
      { error: "Moderators can only toggle free-tier users" },
      { status: 403 },
    );
  }
  return null;
}

// GET /api/v1/admin?action=users|stats|plans|models|keys
export async function GET(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const auth = await requireAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { role } = auth;

  const supabase = createAdminClient();
  const action = req.nextUrl.searchParams.get("action");

  // "whoami" lets the client discover its own role to render the right panel.
  if (action === "whoami") {
    return NextResponse.json({ role });
  }

  // Moderators get a tiny slice of the panel — reject everything else early.
  if (role === "mod" && !MOD_GET_ACTIONS.has(action ?? "")) {
    return NextResponse.json({ error: "Forbidden for moderator role" }, { status: 403 });
  }

  switch (action) {
    case "users": {
      const search = req.nextUrl.searchParams.get("search") || "";
      let query = supabase
        .from("profiles")
        .select("id, email, display_name, credits, daily_credits, plan_id, gm_claimed_date, is_activated, claude_activated, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (search) {
        // Escape LIKE wildcards (%, _) so user input is treated literally
        const safeSearch = escapeLike(search);
        const [{ data: byEmail }, { data: byName }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, email, display_name, credits, daily_credits, plan_id, gm_claimed_date, is_activated, claude_activated, created_at, updated_at")
            .ilike("email", `%${safeSearch}%`)
            .order("created_at", { ascending: false })
            .limit(100),
          supabase
            .from("profiles")
            .select("id, email, display_name, credits, daily_credits, plan_id, gm_claimed_date, is_activated, claude_activated, created_at, updated_at")
            .ilike("display_name", `%${safeSearch}%`)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        // Merge and deduplicate
        const seen = new Set<string>();
        const merged = [...(byEmail || []), ...(byName || [])].filter((u) => {
          if (seen.has(u.id)) return false;
          seen.add(u.id);
          return true;
        });
        return NextResponse.json({ users: merged });
      }

      const { data, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ users: data });
    }

    case "stats": {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const [
        { count: totalUsers },
        { count: totalRequests },
        { count: todayRequests },
        { data: topUsers },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("usage_logs").select("*", { count: "exact", head: true }),
        supabase.from("usage_logs").select("*", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
        supabase.rpc("get_top_users_today", { p_date: todayStart.toISOString() }).limit(10),
      ]);

      // If the RPC doesn't exist, fallback to a simple query
      let topUsersData = topUsers;
      if (!topUsersData) {
        const { data } = await supabase
          .from("usage_logs")
          .select("user_id, profiles(email)")
          .gte("created_at", todayStart.toISOString())
          .limit(50);
        // Aggregate manually
        const counts: Record<string, { email: string; count: number }> = {};
        for (const row of data || []) {
          const uid = row.user_id;
          const email = (row.profiles as unknown as { email: string })?.email || uid;
          counts[uid] = counts[uid] || { email, count: 0 };
          counts[uid].count++;
        }
        topUsersData = Object.entries(counts)
          .map(([user_id, v]) => ({ user_id, email: v.email, requests: v.count }))
          .sort((a, b) => b.requests - a.requests)
          .slice(0, 10);
      }

      return NextResponse.json({
        stats: {
          totalUsers: totalUsers || 0,
          totalRequests: totalRequests || 0,
          todayRequests: todayRequests || 0,
          topUsersToday: topUsersData || [],
        },
      });
    }

    case "plans": {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .order("sort_order");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ plans: data });
    }

    case "models": {
      const { data, error } = await supabase
        .from("models")
        .select("*")
        .order("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ models: data });
    }

    case "keys": {
      const userId = req.nextUrl.searchParams.get("user_id");
      if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, key_prefix, name, is_active, created_at, last_used")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ keys: data });
    }

    case "custom_keys": {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, key_prefix, name, is_active, is_custom, custom_credits, max_context, allowed_providers, daily_request_limit, rate_limit_seconds, expires_at, note, user_id, created_at, last_used, profiles(email)")
        .eq("is_custom", true)
        .order("created_at", { ascending: false });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ custom_keys: data });
    }

    case "events": {
      const scope = req.nextUrl.searchParams.get("scope") || "all"; // all | active | past
      let query = supabase.from("free_events").select("*").order("starts_at", { ascending: false });
      const nowIso = new Date().toISOString();
      if (scope === "active") {
        query = query.eq("is_active", true).lte("starts_at", nowIso).gte("ends_at", nowIso);
      } else if (scope === "past") {
        query = query.lt("ends_at", nowIso);
      }
      const { data, error } = await query.limit(100);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ events: data });
    }

    case "fingerprints": {
      const userId = req.nextUrl.searchParams.get("user_id");
      if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });

      // Get this user's fingerprints
      const { data: fps, error } = await supabase
        .from("device_fingerprints")
        .select("*")
        .eq("user_id", userId)
        .order("last_seen_at", { ascending: false });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // For each fingerprint, find other accounts sharing it
      const linkedAccounts: Record<string, { email: string; user_id: string }[]> = {};
      for (const fp of fps || []) {
        const { data: linked } = await supabase
          .from("device_fingerprints")
          .select("user_id, profiles(email)")
          .eq("fingerprint", fp.fingerprint)
          .neq("user_id", userId);
        linkedAccounts[fp.fingerprint] = (linked || []).map((l) => ({
          user_id: l.user_id,
          email: (l.profiles as unknown as { email: string })?.email || l.user_id,
        }));
      }

      // Check which rows are banned by fingerprint and/or IP.
      const fpValues = (fps || []).map((f) => f.fingerprint);
      const ipValues = (fps || [])
        .map((f) => f.ip_address)
        .filter((ip): ip is string => typeof ip === "string" && ip.length > 0 && ip !== "unknown");

      const { data: fpBans } = fpValues.length > 0
        ? await supabase.from("banned_fingerprints").select("fingerprint").in("fingerprint", fpValues)
        : { data: [] };
      const { data: ipBans } = ipValues.length > 0
        ? await supabase.from("banned_fingerprints").select("ip_address").in("ip_address", ipValues)
        : { data: [] };

      const bannedFingerprintSet = new Set((fpBans || []).map((b) => b.fingerprint));
      const bannedIpSet = new Set((ipBans || []).map((b) => b.ip_address));

      return NextResponse.json({
        fingerprints: (fps || []).map((fp) => ({
          ...fp,
          is_banned:
            bannedFingerprintSet.has(fp.fingerprint) ||
            (typeof fp.ip_address === "string" && bannedIpSet.has(fp.ip_address)),
          linked_accounts: linkedAccounts[fp.fingerprint] || [],
        })),
      });
    }

    // ── Moderation review queue ──
    // List flagged messages awaiting manual review. status filter defaults to
    // 'pending'; pass status=all to see history. Joins the user's email so the
    // admin can identify the account at a glance.
    case "moderation_reviews": {
      const status = req.nextUrl.searchParams.get("status") || "pending";
      let query = supabase
        .from("moderation_reviews")
        .select("id, user_id, content_hash, flagged_text, context, categories, category_scores, source, status, reviewed_by, reviewed_at, created_at, profiles(email)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (status !== "all") query = query.eq("status", status);

      const { data, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        reviews: (data || []).map((r) => ({
          ...r,
          email: (r.profiles as unknown as { email: string })?.email || r.user_id,
          profiles: undefined,
        })),
      });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

// POST /api/v1/admin
export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const auth = await requireAdmin(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { user, role } = auth;

  const supabase = createAdminClient();
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { action } = body;

  // Moderators may only flip free-tier activation gates — reject anything else.
  if (role === "mod" && !MOD_POST_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Forbidden for moderator role" }, { status: 403 });
  }

  switch (action) {
    // ── User credit management ──
    case "set_credits": {
      const { user_id, credits, daily_credits } = body;
      const update: Record<string, unknown> = {};
      if (credits !== undefined) update.credits = credits;
      if (daily_credits !== undefined) update.daily_credits = daily_credits;
      const { error } = await supabase.from("profiles").update(update).eq("id", user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "add_credits": {
      const { user_id, amount } = body;
      const { data: newBalance, error } = await supabase.rpc("add_credits", {
        p_user_id: user_id,
        p_amount: amount,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Log transaction
      await supabase.from("transactions").insert({
        user_id,
        amount,
        balance: newBalance,
        type: "admin_grant",
        description: `Admin grant by ${user.email}`,
      });

      return NextResponse.json({ ok: true, newBalance });
    }

    // ── User plan management ──
    case "set_plan": {
      const { user_id, plan_id } = body;

      // Fetch the plan to get its daily credits
      const { data: plan } = await supabase
        .from("plans")
        .select("credits_per_day")
        .eq("id", plan_id)
        .single();

      const update: Record<string, unknown> = { plan_id };
      if (plan) {
        update.daily_credits = plan.credits_per_day;
      }

      const { error } = await supabase.from("profiles").update(update).eq("id", user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Also update the active subscription so claim_daily_credits uses the correct plan
      await supabase
        .from("subscriptions")
        .update({ plan_id })
        .eq("user_id", user_id)
        .eq("status", "active");

      return NextResponse.json({ ok: true, daily_credits: plan?.credits_per_day ?? null });
    }

    // ── API key management ──
    case "toggle_key": {
      const { key_id, is_active } = body;
      const { error } = await supabase.from("api_keys").update({ is_active }).eq("id", key_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Model management ──
    case "toggle_model": {
      const { model_id, is_active } = body;
      const { error } = await supabase.from("models").update({ is_active }).eq("id", model_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "update_model_capabilities": {
      const { model_id, capabilities } = body;
      if (!model_id) return NextResponse.json({ error: "model_id required" }, { status: 400 });
      if (!Array.isArray(capabilities)) return NextResponse.json({ error: "capabilities must be an array" }, { status: 400 });

      const validCaps = ["tool_calling", "vision", "web_search", "streaming", "json_mode", "system_message", "reasoning", "pdf_input"];
      const filtered = capabilities.filter((c: string) => validCaps.includes(c));

      const { error } = await supabase.from("models").update({ capabilities: filtered }).eq("id", model_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Plan management ──
    case "toggle_plan": {
      const { plan_id, is_active } = body;
      const { error } = await supabase.from("plans").update({ is_active }).eq("id", plan_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "update_plan": {
      const { plan_id, ...updates } = body;
      delete updates.action;
      if (!plan_id) {
        return NextResponse.json({ error: "plan_id required" }, { status: 400 });
      }

      // Whitelist of fields an admin may update on a plan. Everything else
      // (id, created_at, stripe_price_id, etc.) is rejected so a compromised
      // admin session or a future XSS can't repoint billing to attacker-owned
      // Stripe products or rewrite arbitrary columns.
      const ALLOWED_PLAN_FIELDS = [
        "name",
        "description",
        "price_usd",
        "credits_per_day",
        "monthly_credit_grant",
        "gm_daily_requests",
        "gm_max_context",
        "is_active",
        "sort_order",
        "features",
      ];

      const filtered: Record<string, unknown> = {};
      for (const field of ALLOWED_PLAN_FIELDS) {
        if (updates[field] !== undefined) filtered[field] = updates[field];
      }

      if (Object.keys(filtered).length === 0) {
        return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });
      }

      const { error } = await supabase.from("plans").update(filtered).eq("id", plan_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Fingerprint banning ──
    case "ban_fingerprint": {
      const { fingerprint, reason } = body;
      if (!fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
      const { error } = await supabase.from("banned_fingerprints").upsert(
        { fingerprint, reason: reason || "Banned by admin", banned_by: user.email },
        { onConflict: "fingerprint" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "unban_fingerprint": {
      const { fingerprint } = body;
      if (!fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
      const { error } = await supabase.from("banned_fingerprints").delete().eq("fingerprint", fingerprint);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "ban_ip": {
      const { ip_address, reason } = body;
      if (!ip_address) return NextResponse.json({ error: "ip_address required" }, { status: 400 });
      const normalizedIp = String(ip_address).trim();
      if (!normalizedIp || normalizedIp === "unknown") {
        return NextResponse.json({ error: "valid ip_address required" }, { status: 400 });
      }

      const { error } = await supabase.from("banned_fingerprints").upsert(
        { ip_address: normalizedIp, reason: reason || "IP banned by admin", banned_by: user.email },
        { onConflict: "ip_address" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "unban_ip": {
      const { ip_address } = body;
      if (!ip_address) return NextResponse.json({ error: "ip_address required" }, { status: 400 });
      const { error } = await supabase.from("banned_fingerprints").delete().eq("ip_address", String(ip_address).trim());
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Custom key management ──
    case "create_custom_key": {
      const { user_id, name, custom_credits, max_context, allowed_providers, daily_request_limit, rate_limit_seconds, expires_at, note } = body;
      // user_id defaults to the admin creating the key — admin-managed custom
      // keys don't need a target user, the admin owns them.
      const ownerId = user_id || user.id;
      const allowedProviderList = Array.isArray(allowed_providers) && allowed_providers.length > 0
        ? allowed_providers
        : null;

      // Generate a random API key
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const rawKey = API_KEY_PREFIX + Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const keyHash = await hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12);

      const { data: inserted, error: insertErr } = await supabase.from("api_keys").insert({
        user_id: ownerId,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: name || "Custom Key",
        is_active: true,
        is_custom: true,
        custom_credits: custom_credits ?? null,
        max_context: max_context ?? null,
        allowed_providers: allowedProviderList,
        daily_request_limit: daily_request_limit ?? null,
        rate_limit_seconds: rate_limit_seconds ?? null,
        expires_at: expires_at || null,
        note: note || null,
      }).select("id").single();

      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, key: rawKey, key_id: inserted.id });
    }

    case "update_custom_key": {
      const { key_id, ...updates } = body;
      delete updates.action;
      if (!key_id) return NextResponse.json({ error: "key_id required" }, { status: 400 });

      // Only allow updating safe fields
      const allowed: Record<string, unknown> = {};
      for (const field of ["name", "custom_credits", "max_context", "allowed_providers", "daily_request_limit", "rate_limit_seconds", "expires_at", "note", "is_active"]) {
        if (updates[field] !== undefined) allowed[field] = updates[field];
      }

      const { error } = await supabase.from("api_keys").update(allowed).eq("id", key_id).eq("is_custom", true);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "delete_custom_key": {
      const { key_id } = body;
      if (!key_id) return NextResponse.json({ error: "key_id required" }, { status: 400 });
      const { error } = await supabase.from("api_keys").delete().eq("id", key_id).eq("is_custom", true);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Free event management ──
    case "create_event": {
      const {
        name,
        model_prefix,
        target_plan_ids,
        starts_at,
        duration_minutes,
        ends_at,
        token_pool_limit,
        per_user_msg_limit,
        max_context,
        rate_limit_seconds,
      } = body;

      if (!name || !model_prefix) {
        return NextResponse.json({ error: "name and model_prefix required" }, { status: 400 });
      }

      const startIso = starts_at ? new Date(starts_at).toISOString() : new Date().toISOString();
      let endIso: string;
      if (ends_at) {
        endIso = new Date(ends_at).toISOString();
      } else if (duration_minutes) {
        endIso = new Date(new Date(startIso).getTime() + Number(duration_minutes) * 60_000).toISOString();
      } else {
        return NextResponse.json({ error: "ends_at or duration_minutes required" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("free_events")
        .insert({
          name,
          model_prefix,
          target_plan_ids: Array.isArray(target_plan_ids) && target_plan_ids.length > 0 ? target_plan_ids : null,
          starts_at: startIso,
          ends_at: endIso,
          token_pool_limit: token_pool_limit ?? 5_000_000,
          per_user_msg_limit: per_user_msg_limit ?? 20,
          max_context: max_context ?? 32768,
          rate_limit_seconds: rate_limit_seconds ?? 120,
          created_by: user.email,
        })
        .select("*")
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, event: data });
    }

    case "update_event": {
      const { event_id, ...updates } = body;
      delete updates.action;
      if (!event_id) return NextResponse.json({ error: "event_id required" }, { status: 400 });

      const allowed: Record<string, unknown> = {};
      for (const field of [
        "name",
        "model_prefix",
        "target_plan_ids",
        "starts_at",
        "ends_at",
        "token_pool_limit",
        "per_user_msg_limit",
        "max_context",
        "rate_limit_seconds",
        "is_active",
      ]) {
        if (updates[field] !== undefined) allowed[field] = updates[field];
      }

      const { error } = await supabase.from("free_events").update(allowed).eq("id", event_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "end_event": {
      const { event_id } = body;
      if (!event_id) return NextResponse.json({ error: "event_id required" }, { status: 400 });
      const { error } = await supabase
        .from("free_events")
        .update({ is_active: false, ends_at: new Date().toISOString() })
        .eq("id", event_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "delete_event": {
      const { event_id } = body;
      if (!event_id) return NextResponse.json({ error: "event_id required" }, { status: 400 });
      const { error } = await supabase.from("free_events").delete().eq("id", event_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Reset gm claimed date ──
    case "reset_gm_claim": {
      const { user_id } = body;
      const { error } = await supabase.from("profiles").update({ gm_claimed_date: null }).eq("id", user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── API-key activation gate (free-tier only) ──
    case "set_activation": {
      const { user_id, activated } = body;
      if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
      const modError = await assertModFreeTarget(supabase, role, user_id);
      if (modError) return modError;
      const { error } = await supabase
        .from("profiles")
        .update({ is_activated: !!activated })
        .eq("id", user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, activated: !!activated });
    }

    // ── Claude-route activation gate (free-tier only) ──
    case "set_claude_activation": {
      const { user_id, activated } = body;
      if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
      const modError = await assertModFreeTarget(supabase, role, user_id);
      if (modError) return modError;
      const { error } = await supabase
        .from("profiles")
        .update({ claude_activated: !!activated })
        .eq("id", user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, claude_activated: !!activated });
    }

    // ── Moderation review actions ──
    // Dismiss a queued flag as a false positive. No account change — just
    // marks the row reviewed so it leaves the pending queue.
    case "review_dismiss": {
      const { review_id } = body;
      if (!review_id) return NextResponse.json({ error: "review_id required" }, { status: 400 });
      const { error } = await supabase
        .from("moderation_reviews")
        .update({ status: "dismissed", reviewed_by: user.email, reviewed_at: new Date().toISOString() })
        .eq("id", review_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // Confirm a queued flag as a real violation: permanently ban the account,
    // disable its keys, and write the hash-only csam_incidents audit row. Marks
    // the review 'actioned'.
    case "review_ban": {
      const { review_id } = body;
      if (!review_id) return NextResponse.json({ error: "review_id required" }, { status: 400 });

      const { data: review, error: fetchErr } = await supabase
        .from("moderation_reviews")
        .select("user_id, content_hash, categories, category_scores, source")
        .eq("id", review_id)
        .single();
      if (fetchErr || !review) {
        return NextResponse.json({ error: fetchErr?.message || "Review not found" }, { status: 404 });
      }

      await banUserForViolation({
        userId: review.user_id,
        source: (review.source as "api" | "chat") ?? "api",
        flaggedItems: [{
          hash: review.content_hash,
          text: "",
          categories: review.categories || [],
          scores: (review.category_scores as Record<string, number>) || {},
        }],
      });

      const { error } = await supabase
        .from("moderation_reviews")
        .update({ status: "actioned", reviewed_by: user.email, reviewed_at: new Date().toISOString() })
        .eq("id", review_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, banned_user: review.user_id });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
