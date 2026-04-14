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
  const [copied, setCopied] = useState(false);
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90">API Keys</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Manage your authentication keys</p>
      </div>

      {/* Create new key */}
      <div className="glass-card shimmer-line p-5 mb-6">
        <h3 className="font-semibold text-white/85 mb-3">Create New Key</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (optional)"
            className="flex-1 bg-[var(--bg-input)] border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-white/90 placeholder-[var(--text-dim)] transition-all"
          />
          <button
            onClick={createKey}
            disabled={loading}
            className="btn-aurora px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Key"}
          </button>
        </div>

        {createdKey && (
          <div className="mt-4 rounded-xl p-4" style={{
            background: "rgba(52, 211, 153, 0.06)",
            border: "1px solid rgba(52, 211, 153, 0.15)",
          }}>
            <p className="text-sm text-emerald-400 font-medium mb-2">
              Key created! Copy it now — it won&apos;t be shown again.
            </p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 bg-[var(--bg-input)] rounded-lg p-3 text-sm font-mono break-all select-all text-white/80">
                {createdKey}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="shrink-0 px-4 py-2.5 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Key list */}
      <div className="glass-card shimmer-line overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h3 className="font-semibold text-white/85">Your Keys</h3>
        </div>

        {keys.length > 0 ? (
          <div className="divide-y divide-white/[0.04]">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between px-5 py-4 hover:bg-[var(--bg-hover)] transition-colors">
                <div>
                  <p className="font-medium text-sm text-white/85">{key.name}</p>
                  <p className="text-xs text-cyan-300/50 font-mono mt-0.5">
                    {key.key_prefix}...
                  </p>
                  <p className="text-xs text-[var(--text-dim)] mt-0.5">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used && ` | Last used ${new Date(key.last_used).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteKey(key.id)}
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--danger)] transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/5"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.08))",
                border: "1px solid rgba(139, 92, 246, 0.1)",
              }}
            >
              <span className="text-[var(--text-dim)] text-lg font-mono">#</span>
            </div>
            <p className="text-sm font-medium text-white/60 mb-1">No API keys yet</p>
            <p className="text-xs text-[var(--text-dim)]">Create your first key above to start making requests.</p>
          </div>
        )}
      </div>

      <div className="glass-card shimmer-line mt-6 p-5">
        <h3 className="font-semibold text-white/85 mb-2">Quick Start</h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          Use your API key with any OpenAI-compatible client:
        </p>
        <pre className="bg-[var(--bg-input)] rounded-xl p-4 text-xs font-mono overflow-x-auto text-white/70 border border-white/[0.04]">
{`curl -X POST https://aether-router.vercel.app/api/v1/chat/completions \\
  -H "Authorization: Bearer ak_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "w/gemini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
        </pre>
      </div>
    </div>
  );
}
