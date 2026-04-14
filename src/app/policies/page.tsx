import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Policies | Aether Router",
  description:
    "Aether Router terms of service, acceptable use, and refund policy.",
};

export default function PoliciesPage() {
  const lastUpdated = "April 10, 2026";

  return (
    <div className="min-h-screen relative">
      {/* Aurora background */}
      <div className="aurora-bg">
        <div className="aurora-orb-1" />
        <div className="aurora-orb-2" />
      </div>
      <div className="noise-overlay" />

      <main className="relative z-10 max-w-3xl mx-auto px-6 py-12 lg:py-16">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition-colors mb-6"
          >
            <span className="font-mono">&larr;</span> Back to Aether Router
          </Link>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-white/90">
            Policies
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Please read these policies carefully before using Aether Router or
            subscribing to a plan.
          </p>
          <p className="text-[11px] text-[var(--text-dim)] mt-2 uppercase tracking-[0.15em]">
            Last updated: {lastUpdated}
          </p>
        </div>

        {/* Why these policies exist */}
        <section className="mb-10">
          <div
            className="rounded-xl px-5 py-4 text-sm leading-relaxed"
            style={{
              background:
                "linear-gradient(135deg, rgba(251, 191, 36, 0.08), rgba(239, 68, 68, 0.06))",
              border: "1px solid rgba(251, 191, 36, 0.2)",
              color: "rgba(252, 211, 77, 0.95)",
            }}
          >
            <p className="font-semibold text-amber-200/95 mb-1">
              Why these policies exist
            </p>
            <p className="text-amber-100/80">
              Aether Router offers access to multiple AI providers at prices
              far below their native cost. To keep these prices viable we
              route through small third-party providers that we do not own
              and do not control. We cannot guarantee their uptime, response
              quality, latency, or long-term availability. These policies
              exist so the service stays sustainable for everyone and so
              expectations are clear before you pay.
            </p>
          </div>
        </section>

        {/* 1. API keys */}
        <Section number="1" title="API key sharing is prohibited">
          <p>
            Your API keys are personal and tied to your account. You must not
            share, publish, resell, leak, or otherwise distribute them to any
            third party. This includes posting keys in public repositories,
            Discord servers, forums, paste sites, or shared documents.
          </p>
          <p>
            If we detect that a key is being shared, or traffic patterns
            suggest multiple unrelated users are using the same key, we
            reserve the right to immediately revoke the key, suspend the
            associated account, and cancel any active subscription without
            refund.
          </p>
        </Section>

        {/* 2. Multi-accounting */}
        <Section number="2" title="Multi-accounting is prohibited">
          <p>
            Each person may hold only one Aether Router account. Creating
            additional accounts to claim daily free credits, bypass plan
            limits, stack free trials, or otherwise abuse the service is not
            allowed.
          </p>
          <p>
            We use a combination of device fingerprinting, IP signals, and
            behavioral analysis to detect duplicate accounts. When duplicates
            are detected we reserve the right to merge, disable, or
            permanently ban any and all associated accounts without
            notice and without refund.
          </p>
        </Section>

        {/* 3. Subscriptions and refunds */}
        <Section number="3" title="Subscriptions have no guarantees and are non-refundable">
          <p>
            All Aether Router subscription plans and credit purchases are
            sold <span className="text-white/80 font-semibold">as-is</span>,
            with <span className="text-white/80 font-semibold">no uptime
            guarantee</span>, no SLA, and{" "}
            <span className="text-white/80 font-semibold">
              no eligibility for refunds, chargebacks, or pro-rated credits
            </span>{" "}
            once the purchase has been processed.
          </p>
          <p>
            The reason is structural: the models exposed under the{" "}
            <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-white/[0.04]">
              w/
            </code>
            ,{" "}
            <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-white/[0.04]">
              c/
            </code>{" "}
            and{" "}
            <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-white/[0.04]">
              an/
            </code>{" "}
            prefixes are routed through small third-party providers. We are
            able to offer them at a fraction of the native provider price
            precisely because we do not own or operate the upstream
            infrastructure. This means:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--text-muted)]">
            <li>
              Upstream providers may degrade, rate-limit, or disappear at any
              time, without notice to us or to you.
            </li>
            <li>
              A specific model may stop working, change behavior, or be
              removed from the catalog mid-billing-cycle.
            </li>
            <li>
              We cannot reimburse subscriptions because we have already paid
              the upstream providers on your behalf.
            </li>
          </ul>
          <p>
            By subscribing or purchasing credits you acknowledge and accept
            this risk. If you need SLAs, uptime guarantees, or refunds, you
            should use the AI providers directly at their native prices.
          </p>
        </Section>

        {/* 4. Acceptable use */}
        <Section number="4" title="Acceptable use">
          <p>
            You agree not to use Aether Router to:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--text-muted)]">
            <li>
              Generate content that is illegal in your jurisdiction or ours,
              including CSAM, targeted harassment, or content that incites
              violence.
            </li>
            <li>
              Attempt to overload, scrape, reverse-engineer, or deny service
              to Aether Router or any upstream provider.
            </li>
            <li>
              Resell Aether Router access as your own service without a prior
              written agreement.
            </li>
            <li>
              Bypass, disable, or interfere with billing, rate limiting,
              abuse detection, or account verification.
            </li>
          </ul>
          <p>
            Violations may result in immediate account termination without
            refund. We also reserve the right to cooperate with law
            enforcement when required.
          </p>
        </Section>

        {/* 5. Service changes */}
        <Section number="5" title="Service changes">
          <p>
            Aether Router is evolving software. Models, prices, plan limits,
            daily credits, and provider availability may change at any time.
            We will try to communicate significant changes in advance, but
            we are not obligated to do so when the change is forced on us by
            an upstream provider.
          </p>
          <p>
            Continued use of the service after a change constitutes
            acceptance of the updated terms.
          </p>
        </Section>

        {/* 6. Account termination */}
        <Section number="6" title="Account termination">
          <p>
            You may delete your account at any time from your dashboard
            settings. We may suspend or terminate accounts that violate
            these policies, abuse the service, or pose a security risk. In
            all cases of termination for cause, any remaining subscription
            time and credits are forfeited without refund.
          </p>
        </Section>

        {/* 7. Liability */}
        <Section number="7" title="Limitation of liability">
          <p>
            Aether Router is provided on an &quot;as is&quot; and &quot;as
            available&quot; basis. To the maximum extent permitted by law,
            Aether Router and its operators are not liable for any indirect,
            incidental, consequential, or special damages arising from your
            use of the service, including lost profits, lost data, or
            business interruption.
          </p>
          <p>
            Our total liability for any claim related to the service is
            limited to the amount you paid us in the last 30 days.
          </p>
        </Section>

        {/* 8. Contact */}
        <Section number="8" title="Contact">
          <p>
            Questions about these policies? Reach out from your dashboard
            support channels before opening a chargeback — most issues can be
            resolved directly.
          </p>
        </Section>

        <div className="mt-12 pt-6 border-t border-white/[0.04] text-[11px] text-[var(--text-dim)]">
          By using Aether Router you confirm that you have read, understood,
          and agree to these policies.
        </div>
      </main>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-white/85 mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[13px] text-cyan-300/70">{number}.</span>
        {title}
      </h2>
      <div className="glass-card shimmer-line p-5 space-y-3 text-sm leading-relaxed text-[var(--text-muted)]">
        {children}
      </div>
    </section>
  );
}
