import { createAdminClient } from "./supabase/admin";

export interface ApiKeyInfo {
  keyId: string;
  userId: string;
  credits: number;
}

export async function validateApiKey(key: string): Promise<ApiKeyInfo | null> {
  const supabase = createAdminClient();

  // Hash the key with SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Look up key and join with profile for credits
  const { data: result, error } = await supabase
    .from("api_keys")
    .select("id, user_id, is_active, profiles(credits)")
    .eq("key_hash", keyHash)
    .single();

  if (error || !result || !result.is_active) {
    return null;
  }

  // Update last_used
  await supabase
    .from("api_keys")
    .update({ last_used: new Date().toISOString() })
    .eq("id", result.id);

  const profile = result.profiles as unknown as { credits: number };

  return {
    keyId: result.id,
    userId: result.user_id,
    credits: profile?.credits ?? 0,
  };
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
