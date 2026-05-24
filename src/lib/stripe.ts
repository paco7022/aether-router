import Stripe from "stripe";

// On Cloudflare Workers (OpenNext) with `nodejs_compat`, the Stripe SDK
// otherwise resolves to its Node build and uses the Node `https` transport,
// which hangs under the workerd runtime (checkout/portal/webhook calls never
// resolve). Forcing the fetch-based HTTP client makes outbound Stripe calls
// work on Workers and stays valid on Node too.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
  typescript: true,
  httpClient: Stripe.createFetchHttpClient(),
});
