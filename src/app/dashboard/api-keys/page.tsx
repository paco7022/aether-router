"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    const { data } = await supabase
      .from("api_keys")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    setKeys(data || []);
  }

  async function createKey() {
    setLoading(true);
    setCreatedKey(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Generate a random API key
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(raw)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const plainKey = `ak_${hex}`;
    const prefix = plainKey.slice(0, 11);

    // Hash it
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(plainKey));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error } = await supabase.from("api_keys").insert({
      user_id: user.id,
      key_hash: keyHash,
      key_prefix: prefix,
      name: newKeyName || "Default",
    });

    if (!error) {
      setCreatedKey(plainKey);
      setNewKeyName("");
      loadKeys();
    }
    setLoading(false);
  }

  async function deleteKey(id: string) {
    await supabase.from("api_keys").update({ is_active: false }).eq("id", id);
    loadKeys();
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">API Keys</h2>

      {/* Create new key */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 mb-6">
        <h3 className="font-semibold mb-3">Create New Key</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (optional)"
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={createKey}
            disabled={loading}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium rounded-lg px-5 py-2 text-sm transition-colors disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Key"}
          </button>
        </div>

        {createdKey && (
          <div className="mt-4 bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <p className="text-sm text-green-400 font-medium mb-1">
              Key created! Copy it now — it won&apos;t be shown again.
            </p>
            <code className="block bg-[var(--bg)] rounded-lg p-3 text-sm font-mono break-all select-all">
              {createdKey}
            </code>
          </div>
        )}
      </div>

      {/* Key list */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold">Your Keys</h3>
        </div>

        {keys.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="font-medium text-sm">{key.name}</p>
                  <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                    {key.key_prefix}...
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used && ` | Last used ${new Date(key.last_used).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteKey(key.id)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-[var(--text-muted)]">
            <p>No API keys yet. Create one to get started.</p>
          </div>
        )}
      </div>

      <div className="mt-6 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="font-semibold mb-2">Quick Start</h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          Use your API key with any OpenAI-compatible client:
        </p>
        <pre className="bg-[var(--bg)] rounded-lg p-4 text-xs font-mono overflow-x-auto">
{`curl -X POST https://your-domain.vercel.app/api/v1/chat/completions \\
  -H "Authorization: Bearer ak_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v3.2",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
        </pre>
      </div>
    </div>
  );
}
