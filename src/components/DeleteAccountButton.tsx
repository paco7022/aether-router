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

    const res = await fetch("/api/v1/account", { method: "DELETE" });

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
        <p className="text-sm text-red-400/90">
          This will permanently delete your account, all API keys, usage history, and credits. This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleDelete}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(239, 68, 68, 0.6), rgba(220, 38, 38, 0.8))",
              border: "1px solid rgba(239, 68, 68, 0.3)",
            }}
          >
            Yes, delete my account
          </button>
          <button
            onClick={() => setStep("idle")}
            className="px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-white/80 transition-colors"
            style={{ border: "1px solid rgba(255, 255, 255, 0.08)" }}
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
        className="px-4 py-2 rounded-lg text-sm text-red-400/80 hover:text-red-300 transition-all"
        style={{ border: "1px solid rgba(239, 68, 68, 0.15)" }}
      >
        {step === "deleting" ? "Deleting..." : "Delete Account"}
      </button>
    </div>
  );
}
