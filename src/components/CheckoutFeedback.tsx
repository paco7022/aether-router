"use client";

import { useSearchParams } from "next/navigation";

export function CheckoutFeedback() {
  const params = useSearchParams();
  const checkout = params.get("checkout");

  if (checkout === "success") {
    return (
      <div className="mb-6 p-4 rounded-xl text-sm flex items-center gap-3" style={{
        background: "rgba(52, 211, 153, 0.06)",
        border: "1px solid rgba(52, 211, 153, 0.15)",
        color: "#34d399",
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        Payment successful! Your credits or subscription will be activated shortly.
      </div>
    );
  }

  if (checkout === "cancel") {
    return (
      <div className="mb-6 p-4 rounded-xl text-sm flex items-center gap-3" style={{
        background: "rgba(251, 191, 36, 0.06)",
        border: "1px solid rgba(251, 191, 36, 0.15)",
        color: "#fbbf24",
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        Checkout was cancelled. No charges were made.
      </div>
    );
  }

  return null;
}
