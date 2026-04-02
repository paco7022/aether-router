import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";

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
        query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
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
      const { error } = await supabase.from("profiles").update({ plan_id }).eq("id", user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
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
