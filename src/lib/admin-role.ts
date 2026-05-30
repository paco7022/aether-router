// Server-only role resolution for the admin panel. Keep this separate from
// lib/admin.ts (which is pure + client-safe) because it pulls in the
// service-role Supabase client.
import { createServerSupabase } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { isAdmin } from "./admin";

// "admin": full access (env allowlist). "mod": gifted moderators on the `mod`
// plan — Pro benefits + a tightly-scoped slice of the admin panel (toggle
// free-tier activation / Claude access only).
export type AdminRole = "admin" | "mod";

export interface AdminIdentity {
  userId: string;
  email: string | null;
  role: AdminRole;
}

export async function getAdminRole(): Promise<AdminIdentity | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (isAdmin(user.email, user.id)) {
    return { userId: user.id, email: user.email ?? null, role: "admin" };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan_id")
    .eq("id", user.id)
    .single();

  if (profile?.plan_id === "mod") {
    return { userId: user.id, email: user.email ?? null, role: "mod" };
  }

  return null;
}
