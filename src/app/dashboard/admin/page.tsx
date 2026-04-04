"use client";

import { useEffect, useState, useCallback } from "react";

type Tab = "stats" | "users" | "models" | "plans";

interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  credits: number;
  daily_credits: number;
  plan_id: string;
  gm_claimed_date: string | null;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used: string | null;
}

interface DeviceFingerprint {
  id: string;
  fingerprint: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  is_banned: boolean;
  linked_accounts: { user_id: string; email: string }[];
}

interface Model {
  id: string;
  provider: string;
  upstream_model_id: string;
  display_name: string;
  is_active: boolean;
  cost_per_m_input: number;
  cost_per_m_output: number;
  margin: number;
  context_length: number;
}

interface Plan {
  id: string;
  name: string;
  price_usd: number;
  credits_per_day: number;
  gm_daily_requests: number;
  gm_max_context: number;
  is_active: boolean;
  sort_order: number;
}

interface Stats {
  totalUsers: number;
  totalRequests: number;
  todayRequests: number;
  topUsersToday: { user_id: string; email: string; requests: number }[];
}

async function api(method: "GET" | "POST", params?: Record<string, string>, body?: unknown) {
  if (method === "GET") {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/v1/admin?${qs}`);
    return res.json();
  }
  const res = await fetch("/api/v1/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("stats");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<Stats | null>(null);

  // Users
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userKeys, setUserKeys] = useState<ApiKeyRow[]>([]);
  const [userFingerprints, setUserFingerprints] = useState<DeviceFingerprint[]>([]);
  const [creditInput, setCreditInput] = useState("");
  const [dailyCreditInput, setDailyCreditInput] = useState("");
  const [addCreditAmount, setAddCreditAmount] = useState("");
  const [planSelect, setPlanSelect] = useState("");

  // Models
  const [models, setModels] = useState<Model[]>([]);

  // Plans
  const [plans, setPlans] = useState<Plan[]>([]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    const data = await api("GET", { action: "stats" });
    if (data.error) setError(data.error);
    else setStats(data.stats);
    setLoading(false);
  }, []);

  const loadUsers = useCallback(async (search?: string) => {
    setLoading(true);
    const data = await api("GET", { action: "users", search: search || "" });
    if (data.error) setError(data.error);
    else setUsers(data.users || []);
    setLoading(false);
  }, []);

  const loadModels = useCallback(async () => {
    setLoading(true);
    const data = await api("GET", { action: "models" });
    if (data.error) setError(data.error);
    else setModels(data.models || []);
    setLoading(false);
  }, []);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    const data = await api("GET", { action: "plans" });
    if (data.error) setError(data.error);
    else setPlans(data.plans || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "stats") loadStats();
    else if (tab === "users") loadUsers();
    else if (tab === "models") loadModels();
    else if (tab === "plans") loadPlans();
  }, [tab, loadStats, loadUsers, loadModels, loadPlans]);

  async function selectUser(u: UserProfile) {
    setSelectedUser(u);
    setCreditInput(String(u.credits));
    setDailyCreditInput(String(u.daily_credits));
    setPlanSelect(u.plan_id);
    setAddCreditAmount("");
    const [keysData, fpData] = await Promise.all([
      api("GET", { action: "keys", user_id: u.id }),
      api("GET", { action: "fingerprints", user_id: u.id }),
    ]);
    setUserKeys(keysData.keys || []);
    setUserFingerprints(fpData.fingerprints || []);
  }

  async function handleBanFingerprint(fingerprint: string) {
    await api("POST", undefined, { action: "ban_fingerprint", fingerprint, reason: "Banned by admin" });
    setUserFingerprints((prev) =>
      prev.map((fp) => (fp.fingerprint === fingerprint ? { ...fp, is_banned: true } : fp))
    );
  }

  async function handleUnbanFingerprint(fingerprint: string) {
    await api("POST", undefined, { action: "unban_fingerprint", fingerprint });
    setUserFingerprints((prev) =>
      prev.map((fp) => (fp.fingerprint === fingerprint ? { ...fp, is_banned: false } : fp))
    );
  }

  async function handleSetCredits() {
    if (!selectedUser) return;
    await api("POST", undefined, {
      action: "set_credits",
      user_id: selectedUser.id,
      credits: Number(creditInput),
      daily_credits: Number(dailyCreditInput),
    });
    setSelectedUser({ ...selectedUser, credits: Number(creditInput), daily_credits: Number(dailyCreditInput) });
    loadUsers(userSearch);
  }

  async function handleAddCredits() {
    if (!selectedUser || !addCreditAmount) return;
    const result = await api("POST", undefined, {
      action: "add_credits",
      user_id: selectedUser.id,
      amount: Number(addCreditAmount),
    });
    if (result.ok) {
      setSelectedUser({ ...selectedUser, credits: result.newBalance });
      setCreditInput(String(result.newBalance));
      setAddCreditAmount("");
      loadUsers(userSearch);
    }
  }

  async function handleSetPlan() {
    if (!selectedUser) return;
    await api("POST", undefined, {
      action: "set_plan",
      user_id: selectedUser.id,
      plan_id: planSelect,
    });
    setSelectedUser({ ...selectedUser, plan_id: planSelect });
    loadUsers(userSearch);
  }

  async function handleToggleKey(keyId: string, active: boolean) {
    await api("POST", undefined, { action: "toggle_key", key_id: keyId, is_active: active });
    setUserKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, is_active: active } : k)));
  }

  async function handleResetGmClaim() {
    if (!selectedUser) return;
    await api("POST", undefined, { action: "reset_gm_claim", user_id: selectedUser.id });
    setSelectedUser({ ...selectedUser, gm_claimed_date: null });
  }

  async function handleToggleModel(modelId: string, active: boolean) {
    await api("POST", undefined, { action: "toggle_model", model_id: modelId, is_active: active });
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, is_active: active } : m)));
  }

  async function handleTogglePlan(planId: string, active: boolean) {
    await api("POST", undefined, { action: "toggle_plan", plan_id: planId, is_active: active });
    setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, is_active: active } : p)));
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "stats", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "models", label: "Models" },
    { id: "plans", label: "Plans" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90">Admin Panel</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Manage users, models, plans, and credits.</p>
      </div>

      {error && (
        <div className="badge-error rounded-xl p-3 mb-4 text-sm flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-xs underline opacity-70 hover:opacity-100">dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 w-fit rounded-xl" style={{
        background: "rgba(15, 15, 35, 0.6)",
        border: "1px solid rgba(255, 255, 255, 0.04)",
      }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSelectedUser(null); }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? "text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
            style={tab === t.id ? {
              background: "linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(34, 211, 238, 0.15))",
            } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)] mb-4">Loading...</p>}

      {/* Stats Tab */}
      {tab === "stats" && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <StatCard label="Total Users" value={stats.totalUsers} color="violet" />
            <StatCard label="Total Requests" value={stats.totalRequests} color="blue" />
            <StatCard label="Today Requests" value={stats.todayRequests} color="cyan" />
          </div>

          <div className="glass-card shimmer-line overflow-hidden">
            <div className="p-4 border-b border-white/[0.04]">
              <h3 className="font-semibold text-sm text-white/85">Top Users Today</h3>
            </div>
            {stats.topUsersToday.length > 0 ? (
              <div className="divide-y divide-white/[0.04]">
                {stats.topUsersToday.map((u, i) => (
                  <div key={u.user_id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--text-dim)] w-5 text-right text-xs">{i + 1}.</span>
                      <span className="font-mono text-xs text-cyan-300/60">{u.email}</span>
                    </div>
                    <span className="font-medium text-white/80">{u.requests} reqs</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-4 text-sm text-[var(--text-dim)]">No requests today.</p>
            )}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {tab === "users" && (
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <div className="mb-4">
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadUsers(userSearch)}
                placeholder="Search by email or name... (Enter)"
                className="w-full bg-[var(--bg-input)] border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-white/90 placeholder-[var(--text-dim)] transition-all"
              />
            </div>

            <div className="glass-card overflow-hidden">
              <div className="divide-y divide-white/[0.04]">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => selectUser(u)}
                    className={`w-full text-left px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors ${
                      selectedUser?.id === u.id ? "bg-[var(--bg-hover)]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white/85">{u.display_name || u.email}</p>
                        <p className="text-xs text-cyan-300/50 font-mono">{u.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-white/80">{(u.credits + u.daily_credits).toLocaleString()} cr</p>
                        <p className="text-xs text-[var(--text-dim)]">{u.plan_id}</p>
                      </div>
                    </div>
                  </button>
                ))}
                {users.length === 0 && !loading && (
                  <p className="p-4 text-sm text-[var(--text-dim)]">No users found.</p>
                )}
              </div>
            </div>
          </div>

          {/* User detail panel */}
          {selectedUser && (
            <div className="w-96 shrink-0 space-y-4">
              <div className="glass-card shimmer-line p-4">
                <h3 className="font-semibold text-sm text-white/85 mb-1">{selectedUser.display_name || selectedUser.email}</h3>
                <p className="text-xs text-cyan-300/50 font-mono mb-3">{selectedUser.id}</p>

                {/* Credits */}
                <div className="space-y-2 mb-4">
                  <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Permanent Credits</label>
                  <input type="number" value={creditInput} onChange={(e) => setCreditInput(e.target.value)}
                    className="w-full bg-[var(--bg-input)] border border-white/[0.06] rounded-lg px-3 py-1.5 text-sm text-white/90" />
                  <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Daily Credits</label>
                  <input type="number" value={dailyCreditInput} onChange={(e) => setDailyCreditInput(e.target.value)}
                    className="w-full bg-[var(--bg-input)] border border-white/[0.06] rounded-lg px-3 py-1.5 text-sm text-white/90" />
                  <button onClick={handleSetCredits}
                    className="w-full btn-aurora text-xs font-medium px-3 py-1.5">
                    Set Credits
                  </button>
                </div>

                {/* Quick add */}
                <div className="space-y-2 mb-4">
                  <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Add/Remove Credits</label>
                  <div className="flex gap-2">
                    <input type="number" value={addCreditAmount} onChange={(e) => setAddCreditAmount(e.target.value)}
                      placeholder="e.g. 10000"
                      className="flex-1 bg-[var(--bg-input)] border border-white/[0.06] rounded-lg px-3 py-1.5 text-sm text-white/90 placeholder-[var(--text-dim)]" />
                    <button onClick={handleAddCredits}
                      className="text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-all"
                      style={{ background: "linear-gradient(135deg, #14b8a6, #22d3ee)" }}>
                      Add
                    </button>
                  </div>
                </div>

                {/* Plan */}
                <div className="space-y-2 mb-4">
                  <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Plan</label>
                  <div className="flex gap-2">
                    <select value={planSelect} onChange={(e) => setPlanSelect(e.target.value)}
                      className="flex-1 bg-[var(--bg-input)] border border-white/[0.06] rounded-lg px-3 py-1.5 text-sm text-white/90">
                      <option value="free">free</option>
                      <option value="basic">basic</option>
                      <option value="pro">pro</option>
                      <option value="creator">creator</option>
                      <option value="master">master</option>
                      <option value="ultra">ultra</option>
                      <option value="ultimate">ultimate</option>
                    </select>
                    <button onClick={handleSetPlan} className="btn-aurora text-xs font-medium px-3 py-1.5">Set</button>
                  </div>
                </div>

                {/* GM Claim */}
                <div className="space-y-2 mb-4">
                  <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">
                    GM Claimed: {selectedUser.gm_claimed_date || "never"}
                  </label>
                  <button onClick={handleResetGmClaim}
                    className="w-full text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
                    style={{
                      background: "rgba(251, 191, 36, 0.08)",
                      border: "1px solid rgba(251, 191, 36, 0.15)",
                      color: "#fbbf24",
                    }}>
                    Reset GM Claim
                  </button>
                </div>
              </div>

              {/* API Keys */}
              <div className="glass-card overflow-hidden">
                <div className="p-4 border-b border-white/[0.04]">
                  <h3 className="font-semibold text-sm text-white/85">API Keys ({userKeys.length})</h3>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {userKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-xs font-medium text-white/80">{k.name}</p>
                        <p className="text-xs text-cyan-300/50 font-mono">{k.key_prefix}...</p>
                      </div>
                      <button
                        onClick={() => handleToggleKey(k.id, !k.is_active)}
                        className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors ${
                          k.is_active
                            ? "badge-success hover:badge-error"
                            : "badge-error hover:badge-success"
                        }`}
                      >
                        {k.is_active ? "Active" : "Inactive"}
                      </button>
                    </div>
                  ))}
                  {userKeys.length === 0 && (
                    <p className="p-4 text-xs text-[var(--text-dim)]">No API keys.</p>
                  )}
                </div>
              </div>

              {/* Device Fingerprints */}
              <div className="glass-card overflow-hidden">
                <div className="p-4 border-b border-white/[0.04]">
                  <h3 className="font-semibold text-sm text-white/85">Device Fingerprints ({userFingerprints.length})</h3>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {userFingerprints.map((fp) => (
                    <div key={fp.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-cyan-300/50 truncate" title={fp.fingerprint}>
                            {fp.fingerprint}
                          </p>
                          <p className="text-xs text-[var(--text-dim)]">
                            Last seen: {new Date(fp.last_seen_at).toLocaleDateString()}
                          </p>
                          {fp.ip_address && (
                            <p className="text-xs text-[var(--text-dim)]">IP: {fp.ip_address}</p>
                          )}
                        </div>
                        <button
                          onClick={() =>
                            fp.is_banned
                              ? handleUnbanFingerprint(fp.fingerprint)
                              : handleBanFingerprint(fp.fingerprint)
                          }
                          className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors shrink-0 ml-2 ${
                            fp.is_banned
                              ? "badge-error"
                              : "badge-success"
                          }`}
                        >
                          {fp.is_banned ? "Banned" : "Active"}
                        </button>
                      </div>
                      {fp.linked_accounts.length > 0 && (
                        <div className="rounded-lg p-2" style={{
                          background: "rgba(251, 191, 36, 0.04)",
                          border: "1px solid rgba(251, 191, 36, 0.1)",
                        }}>
                          <p className="text-xs font-medium mb-1" style={{ color: "rgba(251, 191, 36, 0.8)" }}>
                            Linked accounts ({fp.linked_accounts.length}):
                          </p>
                          {fp.linked_accounts.map((la) => (
                            <p key={la.user_id} className="text-xs font-mono" style={{ color: "rgba(251, 191, 36, 0.6)" }}>
                              {la.email}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {userFingerprints.length === 0 && (
                    <p className="p-4 text-xs text-[var(--text-dim)]">No fingerprints recorded yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Models Tab */}
      {tab === "models" && (
        <div className="glass-card shimmer-line overflow-hidden">
          <table className="w-full text-sm aurora-table">
            <thead>
              <tr className="text-[var(--text-muted)] text-left">
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Model ID</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Provider</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Upstream</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Input $/M</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Output $/M</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Margin</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-300/60">{m.id}</td>
                  <td className="px-4 py-3 text-white/70">{m.provider}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">{m.upstream_model_id}</td>
                  <td className="px-4 py-3 text-white/70">${m.cost_per_m_input}</td>
                  <td className="px-4 py-3 text-white/70">${m.cost_per_m_output}</td>
                  <td className="px-4 py-3 text-white/70">{m.margin}x</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleModel(m.id, !m.is_active)}
                      className={`text-[11px] px-3 py-1 rounded-full font-medium transition-colors ${
                        m.is_active ? "badge-success" : "badge-error"
                      }`}
                    >
                      {m.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plans Tab */}
      {tab === "plans" && (
        <div className="glass-card shimmer-line overflow-hidden">
          <table className="w-full text-sm aurora-table">
            <thead>
              <tr className="text-[var(--text-muted)] text-left">
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Plan</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Price</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Credits/Day</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">GM Reqs/Day</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">GM Context</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-white/85">{p.name}</td>
                  <td className="px-4 py-3 text-white/70">${p.price_usd}/mo</td>
                  <td className="px-4 py-3 text-white/70">{p.credits_per_day.toLocaleString()}</td>
                  <td className="px-4 py-3 text-white/70">{p.gm_daily_requests > 0 ? p.gm_daily_requests : "Unlimited"}</td>
                  <td className="px-4 py-3 text-white/70">
                    {p.gm_max_context > 0 ? `${(p.gm_max_context / 1024).toFixed(0)}k` : "Unlimited"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleTogglePlan(p.id, !p.is_active)}
                      className={`text-[11px] px-3 py-1 rounded-full font-medium transition-colors ${
                        p.is_active ? "badge-success" : "badge-error"
                      }`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: "violet" | "blue" | "cyan" }) {
  const glowClass = color === "violet" ? "glow-violet" : color === "blue" ? "glow-blue" : "glow-cyan";
  const iconColors: Record<string, string> = {
    violet: "rgba(139, 92, 246, 0.1)",
    blue: "rgba(59, 130, 246, 0.1)",
    cyan: "rgba(34, 211, 238, 0.1)",
  };
  const borderColors: Record<string, string> = {
    violet: "rgba(139, 92, 246, 0.12)",
    blue: "rgba(59, 130, 246, 0.12)",
    cyan: "rgba(34, 211, 238, 0.12)",
  };

  return (
    <div className={`glass-card aurora-border shimmer-line p-5 ${glowClass}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: iconColors[color], border: `1px solid ${borderColors[color]}` }}>
        </div>
      </div>
      <p className="text-3xl font-bold text-white/90">{value.toLocaleString()}</p>
    </div>
  );
}
