import { createServerSupabase } from "@/lib/supabase/server";

export default async function BillingPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", user!.id)
    .single();

  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const credits = profile?.credits || 0;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Billing</h2>

      {/* Current balance */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--text-muted)]">Current Balance</p>
            <p className="text-4xl font-bold mt-1">{credits.toLocaleString()} <span className="text-lg font-normal text-[var(--text-muted)]">credits</span></p>
            <p className="text-sm text-[var(--text-muted)]">${(credits / 10_000).toFixed(2)} USD</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--text-muted)] mb-2">10,000 credits = $1.00 USD</p>
            <p className="text-xs text-[var(--text-muted)]">Contact admin to add credits</p>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold">Transaction History</h3>
        </div>

        {transactions && transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] text-left border-b border-[var(--border)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-[var(--border)]">
                    <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                          tx.type === "usage"
                            ? "bg-blue-500/10 text-blue-400"
                            : tx.type === "purchase" || tx.type === "admin_grant"
                            ? "bg-green-500/10 text-green-400"
                            : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)]">{tx.description || "-"}</td>
                    <td
                      className={`px-5 py-3 text-right font-medium ${
                        tx.amount > 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {tx.amount.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-[var(--text-muted)]">
                      {tx.balance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-[var(--text-muted)]">
            <p>No transactions yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
