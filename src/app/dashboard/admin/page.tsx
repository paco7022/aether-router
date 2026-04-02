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
    const data = await api("GET", { action: "keys", user_id: u.id });
    setUserKeys(data.keys || []);
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
      <h2 className="text-2xl font-bold mb-1">Admin Panel</h2>
      <p className="text-sm text-[var(--text-muted)] mb-6">Manage users, models, plans, and credits.</p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline">dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSelectedUser(null); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)] mb-4">Loading...</p>}

      {/* ── Stats Tab ── */}
      {tab === "stats" && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total Users" value={stats.totalUsers} />
            <StatCard label="Total Requests" value={stats.totalRequests} />
            <StatCard label="Today Requests" value={stats.todayRequests} />
          </div>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="font-semibold text-sm">Top Users Today</h3>
            </div>
            {stats.topUsersToday.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {stats.topUsersToday.map((u, i) => (
                  <div key={u.user_id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-[var(--text-muted)] w-5 text-right">{i + 1}.</span>
                      <span className="font-mono text-xs">{u.email}</span>
                    </div>
                    <span className="font-medium">{u.requests} reqs</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-4 text-sm text-[var(--text-muted)]">No requests today.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Users Tab ── */}
      {tab === "users" && (
        <div className="flex gap-6">
          {/* User list */}
          <div className="flex-1 min-w-0">
            <div className="mb-4">
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadUsers(userSearch)}
                placeholder="Search by email or name... (Enter)"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
              <div className="divide-y divide-[var(--border)]">
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
                        <p className="text-sm font-medium">{u.display_name || u.email}</p>
                        <p className="text-xs text-[var(--text-muted)] font-mono">{u.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{(u.credits + u.daily_credits).toLocaleString()} cr</p>
                        <p className="text-xs text-[var(--text-muted)]">{u.plan_id}</p>
                      </div>
                    </div>
                  </button>
                ))}
                {users.length === 0 && !loading && (
                  <p className="p-4 text-sm text-[var(--text-muted)]">No users found.</p>
                )}
              </div>
            </div>
          </div>

          {/* User detail panel */}
          {selectedUser && (
            <div className="w-96 shrink-0 space-y-4">
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
                <h3 className="font-semibold text-sm mb-1">{selectedUser.display_name || selectedUser.email}</h3>
                <p className="text-xs text-[var(--text-muted)] font-mono mb-3">{selectedUser.id}</p>

                {/* Credits */}
                <div className="space-y-2 mb-4">
                  <label className="text-xs text-[var(--text-muted)]">Permanent Credits</label>
                  <input
                    type="number"
                    value={creditInput}
                    onChange={(e) => setCreditInput(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                  <label className="text-xs text-[var(--text-muted)]">Daily Credits</label>
                  <input
                    type="number"
                    value={dailyCreditInput}
                    onChange={(e) => setDailyCreditInput(e.target.value)}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={handleSetCredits}
                    className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Set Credits
                  </button>
                </div>

                {/* Quick add */}
                <div className="space-y-2 mb-4">
                  <label className="text-xs text-[var(--text-muted)]">Add/Remove Credits (use negative to remove)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={addCreditAmount}
                      onChange={(e) => setAddCreditAmount(e.target.value)}
                      placeholder="e.g. 10000"
                      className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                    />
                    <button
                      onClick={handleAddCredits}
                      className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Plan */}
                <div className="space-y-2 mb-4">
                  <label className="text-xs text-[var(--text-muted)]">Plan</label>
                  <div className="flex gap-2">
                    <select
                      value={planSelect}
                      onChange={(e) => setPlanSelect(e.target.value)}
                      className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                    >
                      <option value="free">free</option>
                      <option value="basic">basic</option>
                      <option value="pro">pro</option>
                      <option value="creator">creator</option>
                      <option value="master">master</option>
                      <option value="ultra">ultra</option>
                      <option value="ultimate">ultimate</option>
                    </select>
                    <button
                      onClick={handleSetPlan}
                      className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
                    >
                      Set
                    </button>
                  </div>
                </div>

                {/* GM Claim */}
                <div className="space-y-2 mb-4">
                  <label className="text-xs text-[var(--text-muted)]">
                    GM Claimed: {selectedUser.gm_claimed_date || "never"}
                  </label>
                  <button
                    onClick={handleResetGmClaim}
                    className="w-full bg-[var(--warning)]/20 hover:bg-[var(--warning)]/30 text-[var(--warning)] text-xs font-medium rounded-lg px-3 py-1.5 transition-colors border border-[var(--warning)]/20"
                  >
                    Reset GM Claim
                  </button>
                </div>
              </div>

              {/* API Keys */}
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
                <div className="p-4 border-b border-[var(--border)]">
                  <h3 className="font-semibold text-sm">API Keys ({userKeys.length})</h3>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {userKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-xs font-medium">{k.name}</p>
                        <p className="text-xs text-[var(--text-muted)] font-mono">{k.key_prefix}...</p>
                      </div>
                      <button
                        onClick={() => handleToggleKey(k.id, !k.is_active)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                          k.is_active
                            ? "bg-green-500/10 text-green-400 hover:bg-red-500/10 hover:text-red-400"
                            : "bg-red-500/10 text-red-400 hover:bg-green-500/10 hover:text-green-400"
                        }`}
                      >
                        {k.is_active ? "Active" : "Inactive"}
                      </button>
                    </div>
                  ))}
                  {userKeys.length === 0 && (
                    <p className="p-4 text-xs text-[var(--text-muted)]">No API keys.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Models Tab ── */}
      {tab === "models" && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] text-left border-b border-[var(--border)]">
                  <th className="px-4 py-3 font-medium">Model ID</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Upstream</th>
                  <th className="px-4 py-3 font-medium">Input $/M</th>
                  <th className="px-4 py-3 font-medium">Output $/M</th>
                  <th className="px-4 py-3 font-medium">Margin</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 font-mono text-xs">{m.id}</td>
                    <td className="px-4 py-3">{m.provider}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">{m.upstream_model_id}</td>
                    <td className="px-4 py-3">${m.cost_per_m_input}</td>
                    <td className="px-4 py-3">${m.cost_per_m_output}</td>
                    <td className="px-4 py-3">{m.margin}x</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleModel(m.id, !m.is_active)}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                          m.is_active
                            ? "bg-green-500/10 text-green-400 hover:bg-red-500/10 hover:text-red-400"
                            : "bg-red-500/10 text-red-400 hover:bg-green-500/10 hover:text-green-400"
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
        </div>
      )}

      {/* ── Plans Tab ── */}
      {tab === "plans" && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] text-left border-b border-[var(--border)]">
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Credits/Day</th>
                  <th className="px-4 py-3 font-medium">GM Reqs/Day</th>
                  <th className="px-4 py-3 font-medium">GM Context</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3">${p.price_usd}/mo</td>
                    <td className="px-4 py-3">{p.credits_per_day.toLocaleString()}</td>
                    <td className="px-4 py-3">{p.gm_daily_requests > 0 ? p.gm_daily_requests : "Unlimited"}</td>
                    <td className="px-4 py-3">
                      {p.gm_max_context > 0 ? `${(p.gm_max_context / 1024).toFixed(0)}k` : "Unlimited"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleTogglePlan(p.id, !p.is_active)}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                          p.is_active
                            ? "bg-green-500/10 text-green-400 hover:bg-red-500/10 hover:text-red-400"
                            : "bg-red-500/10 text-red-400 hover:bg-green-500/10 hover:text-green-400"
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
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
