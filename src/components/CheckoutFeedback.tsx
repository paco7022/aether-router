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

  if (checkout === "gift_success") {
    return (
      <div className="mb-6 p-4 rounded-xl text-sm flex items-center gap-3" style={{
        background: "rgba(52, 211, 153, 0.06)",
        border: "1px solid rgba(52, 211, 153, 0.15)",
        color: "#34d399",
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <polyline points="20 12 20 22 4 22 4 12" />
          <rect x="2" y="7" width="20" height="5" />
          <line x1="12" y1="22" x2="12" y2="7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
        Gift sent! If your friend already has an account it&apos;s applied now; otherwise it&apos;s waiting for them to sign up with that email.
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
