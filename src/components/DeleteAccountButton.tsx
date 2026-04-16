"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteAccountButton() {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "deleting">("idle");
  const [error, setError] = useState("");

  async function handleDelete() {
    setStep("deleting");
    setError("");

    const res = await fetch("/api/v1/account", { method: "DELETE", headers: { "X-Requested-With": "AetherRouter" } });

    if (!res.ok) {
      setError("Something went wrong. Please try again.");
      setStep("idle");
      return;
    }

    router.push("/login");
  }

  if (step === "confirm") {
    return (
      <div className="space-y-3">
        <div className="p-3 rounded-xl text-sm flex items-start gap-2" style={{
          background: "rgba(239, 68, 68, 0.06)",
          border: "1px solid rgba(239, 68, 68, 0.15)",
          color: "rgba(252, 165, 165, 0.9)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p>
            This will permanently delete your account, all API keys, usage history, and credits. This action cannot be undone.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleDelete}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-all cursor-pointer"
            style={{
              background: "linear-gradient(135deg, rgba(239, 68, 68, 0.6), rgba(220, 38, 38, 0.8))",
              border: "1px solid rgba(239, 68, 68, 0.3)",
            }}
          >
            Yes, delete my account
          </button>
          <button
            onClick={() => setStep("idle")}
            className="px-4 py-2 rounded-xl text-sm btn-ghost"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        onClick={() => setStep("confirm")}
        disabled={step === "deleting"}
        className="px-4 py-2 rounded-xl text-sm text-red-400/80 hover:text-red-300 transition-all cursor-pointer"
        style={{ border: "1px solid rgba(239, 68, 68, 0.15)" }}
      >
        {step === "deleting" ? "Deleting..." : "Delete Account"}
      </button>
    </div>
  );
}
