"use client";

import { useSearchParams } from "next/navigation";

export function CheckoutFeedback() {
  const params = useSearchParams();
  const checkout = params.get("checkout");

  if (checkout === "success") {
    return (
      <div className="mb-6 p-4 rounded-xl text-sm" style={{
        background: "rgba(52, 211, 153, 0.06)",
        border: "1px solid rgba(52, 211, 153, 0.15)",
        color: "#34d399",
      }}>
        Payment successful! Your credits or subscription will be activated shortly.
      </div>
    );
  }

  if (checkout === "cancel") {
    return (
      <div className="mb-6 p-4 rounded-xl text-sm" style={{
        background: "rgba(251, 191, 36, 0.06)",
        border: "1px solid rgba(251, 191, 36, 0.15)",
        color: "#fbbf24",
      }}>
        Checkout was cancelled. No charges were made.
      </div>
    );
  }

  return null;
}
