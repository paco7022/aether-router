import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicKey, getSupabaseUrl } from "./env";

export function createClient() {
  return createBrowserClient(
    getSupabaseUrl(),
    getSupabasePublicKey()
  );
}
