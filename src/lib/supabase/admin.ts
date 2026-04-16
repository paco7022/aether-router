import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Singleton service-role client — bypasses RLS.
// Reused across requests within the same process to avoid repeated
// connection/initialization overhead. Safe because the service-role
// client is stateless (no user session, no cookies).
let _adminClient: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
