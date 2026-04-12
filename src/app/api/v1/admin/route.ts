import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";
import { hashApiKey } from "@/lib/auth";
import { API_KEY_PREFIX } from "@/lib/constants";

async function requireAdmin(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return null;
  }
  return user;
}

// GET /api/v1/admin?action=users|stats|plans|models|keys
export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const action = req.nextUrl.searchParams.get("action");

  switch (action) {
    case "users": {
      const search = req.nextUrl.searchParams.get("search") || "";
      let query = supabase
        .from("profiles")
        .select("id, email, display_name, credits, daily_credits, plan_id, gm_claimed_date, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (search) {
        // Use separate .ilike() filters to avoid PostgREST .or() parsing issues with special chars
        const [{ data: byEmail }, { data: byName }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, email, display_name, credits, daily_credits, plan_id, gm_claimed_date, created_at, updated_at")
            .ilike("email", `%${search}%`)
            .order("created_at", { ascending: false })
            .limit(100),
          supabase
            .from("profiles")
            .select("id, email, display_name, credits, daily_credits, plan_id, gm_claimed_date, created_at, updated_at")
            .ilike("display_name", `%${search}%`)
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

      // Check which fingerprints are banned
      const fpValues = (fps || []).map((f) => f.fingerprint);
      const { data: bans } = fpValues.length > 0
        ? await supabase.from("banned_fingerprints").select("fingerprint").in("fingerprint", fpValues)
        : { data: [] };
      const bannedSet = new Set((bans || []).map((b) => b.fingerprint));

      return NextResponse.json({
        fingerprints: (fps || []).map((fp) => ({
          ...fp,
          is_banned: bannedSet.has(fp.fingerprint),
          linked_accounts: linkedAccounts[fp.fingerprint] || [],
        })),
      });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

// POST /api/v1/admin
export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const body = await req.json();
  const { action } = body;

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
      const { error } = await supabase.from("plans").update(updates).eq("id", plan_id);
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

    // ── Custom key management ──
    case "create_custom_key": {
      const { user_id, name, custom_credits, max_context, allowed_providers, daily_request_limit, rate_limit_seconds, expires_at, note } = body;
      if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

      // Generate a random API key
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const rawKey = API_KEY_PREFIX + Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const keyHash = await hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12);

      const { data: inserted, error: insertErr } = await supabase.from("api_keys").insert({
        user_id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: name || "Custom Key",
        is_active: true,
        is_custom: true,
        custom_credits: custom_credits ?? null,
        max_context: max_context ?? null,
        allowed_providers: allowed_providers?.length ? allowed_providers : null,
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

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
