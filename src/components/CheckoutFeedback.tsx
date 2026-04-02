"use client";

import { useSearchParams } from "next/navigation";

export function CheckoutFeedback() {
  const params = useSearchParams();
  const checkout = params.get("checkout");

  if (checkout === "success") {
    return (
      <div className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
        Payment successful! Your credits or subscription will be activated shortly.
      </div>
    );
  }

  if (checkout === "cancel") {
    return (
      <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
        Checkout was cancelled. No charges were made.
      </div>
    );
  }

  return null;
}
