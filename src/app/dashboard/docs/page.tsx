export default function DocsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white/90">API Documentation</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Everything you need to integrate with Aether Router.
        </p>
      </div>

      {/* Quick Start */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Quick Start</h3>
        <div className="glass-card shimmer-line p-5 space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            Aether Router is compatible with the OpenAI API format. Just point your base URL to Aether Router and use your API key.
          </p>
          <div>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">Base URL</p>
            <code className="block bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono text-cyan-300/70">
              https://aether-router.vercel.app/api/v1
            </code>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">Example Request (cURL)</p>
            <pre className="bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre text-white/60">
{`curl https://aether-router.vercel.app/api/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`}
            </pre>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">Example with Python (OpenAI SDK)</p>
            <pre className="bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre text-white/60">
{`from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://aether-router.vercel.app/api/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`}
            </pre>
          </div>
        </div>
      </section>

      {/* Endpoints */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Endpoints</h3>
        <div className="space-y-4">
          <EndpointCard
            method="POST"
            path="/api/v1/chat/completions"
            description="Send a chat completion request. Supports streaming."
            auth
            body={[
              { field: "model", type: "string", required: true, desc: "Model ID (see Models page)" },
              { field: "messages", type: "array", required: true, desc: "Array of {role, content} objects" },
              { field: "stream", type: "boolean", required: false, desc: "Enable streaming (default: false)" },
              { field: "temperature", type: "number", required: false, desc: "Sampling temperature (passed to provider)" },
              { field: "max_tokens", type: "number", required: false, desc: "Max tokens to generate (passed to provider)" },
            ]}
          />
        </div>
      </section>

      {/* Authentication */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Authentication</h3>
        <div className="glass-card shimmer-line p-5">
          <p className="text-sm mb-3 text-white/80">
            All requests to <code className="text-violet-400 font-mono text-xs">/chat/completions</code> require a valid API key in the Authorization header:
          </p>
          <code className="block bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono text-cyan-300/70">
            Authorization: Bearer sk-aether-...
          </code>
          <p className="text-sm text-[var(--text-muted)] mt-3">
            Create API keys from the <a href="/dashboard/api-keys" className="text-violet-400 hover:text-violet-300 transition-colors">API Keys</a> page. Keys are hashed on our side and cannot be retrieved after creation — save them securely.
          </p>
        </div>
      </section>

      {/* Streaming */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Streaming</h3>
        <div className="glass-card shimmer-line p-5">
          <p className="text-sm mb-3 text-white/80">
            Set <code className="text-violet-400 font-mono text-xs">{'"stream": true'}</code> in your request body to receive Server-Sent Events (SSE).
            Credits are deducted after the stream finishes, based on actual token usage.
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            The stream format is identical to the OpenAI API — any OpenAI-compatible client library will work out of the box.
          </p>
        </div>
      </section>

      {/* Gameron Models */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Premium Models (gm/, an/)</h3>
        <div className="glass-card shimmer-line p-5 space-y-3">
          <p className="text-sm text-white/80">
            Models prefixed with <code className="text-violet-400 font-mono text-xs">gm/</code> or <code className="text-amber-400 font-mono text-xs">an/</code> are premium models with additional restrictions:
          </p>
          <ul className="text-sm space-y-2 ml-4 list-disc text-[var(--text-muted)]">
            <li>You must <strong className="text-white/80">claim daily requests</strong> from the Billing page before using them each day.</li>
            <li>Each plan has a <strong className="text-white/80">daily request limit</strong> — upgrade your plan for more.</li>
            <li>Each plan has a <strong className="text-white/80">max context length</strong> — longer conversations may be rejected.</li>
          </ul>
        </div>
      </section>

      {/* Error Reference */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Error Reference</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          All errors return a JSON object with this structure:
        </p>
        <pre className="bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono mb-6 overflow-x-auto whitespace-pre text-white/60">
{`{
  "error": {
    "message": "Human-readable description",
    "type": "error_type"
  }
}`}
        </pre>
        <div className="glass-card shimmer-line overflow-hidden">
          <table className="w-full text-sm aurora-table">
            <thead>
              <tr className="text-[var(--text-muted)] text-left">
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Type</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Cause & Fix</th>
              </tr>
            </thead>
            <tbody>
              <ErrorRow status={400} type="invalid_request" cause="Missing or malformed request body." fix='Check that "model" and "messages" fields are present and valid JSON.' />
              <ErrorRow status={401} type="auth_error" cause="Missing or invalid API key." fix="Ensure your Authorization header is: Bearer sk-aether-..." />
              <ErrorRow status={402} type="billing_error" cause="Not enough credits to complete the request." fix="Buy more credits or claim daily credits from the Billing page." />
              <ErrorRow status={403} type="claim_required" cause="Premium model (gm/) used without claiming daily requests." fix='Go to Billing > "Claim Daily GM Requests" before making requests.' />
              <ErrorRow status={403} type="invalid_request" cause="Model is restricted or not in the allowed pool." fix="Check the Models page for currently available models." />
              <ErrorRow status={404} type="invalid_request" cause="The requested model ID doesn't exist or is disabled." fix="Check exact model ID on the Models page (IDs are case-sensitive)." />
              <ErrorRow status={413} type="context_limit" cause="Your prompt exceeds the max context length for your plan." fix="Shorten your messages or upgrade your plan for a higher context limit." />
              <ErrorRow status={429} type="rate_limit" cause="You've hit the daily request limit for premium models." fix="Wait until tomorrow (UTC reset) or upgrade your plan." />
              <ErrorRow status={502} type="upstream_error" cause="The upstream AI provider returned an error or is down." fix="Retry after a few seconds. If persistent, the provider may be experiencing issues." />
              <ErrorRow status={503} type="server_error" cause="The provider for this model is not configured or unavailable." fix="Try a different model or check back later." />
              <ErrorRow status={500} type="server_error" cause="Unexpected internal error." fix="If this persists, contact support with the request details." />
            </tbody>
          </table>
        </div>
      </section>

      {/* Credits & Pricing */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Credits & Pricing</h3>
        <div className="glass-card shimmer-line p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold aurora-text">10,000</span>
            <span className="text-sm text-[var(--text-muted)]">credits = $1.00 USD</span>
          </div>
          <ul className="text-sm space-y-2 ml-4 list-disc text-[var(--text-muted)]">
            <li>Credits are deducted per request based on token usage (input + output).</li>
            <li>Minimum charge is <strong className="text-white/80">1 credit</strong> per request.</li>
            <li>Daily credits are consumed first, then permanent credits.</li>
            <li>Per-model pricing is visible on the <a href="/dashboard/models" className="text-violet-400 hover:text-violet-300 transition-colors">Models</a> page.</li>
          </ul>
        </div>
      </section>

      <p className="text-xs text-[var(--text-dim)] mt-6">
        Aether Router is a proxy service. We do not control model availability, uptime, or output quality from upstream providers.
      </p>
    </div>
  );
}

function EndpointCard({
  method,
  path,
  description,
  auth,
  body,
}: {
  method: string;
  path: string;
  description: string;
  auth?: boolean;
  body: { field: string; type: string; required: boolean; desc: string }[];
}) {
  return (
    <div className="glass-card shimmer-line p-5">
      <div className="flex items-center gap-3 mb-2">
        <span
          className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
            method === "GET"
              ? "badge-success"
              : "text-blue-400 bg-blue-400/10 border border-blue-400/15"
          }`}
        >
          {method}
        </span>
        <code className="font-mono text-sm text-cyan-300/70">{path}</code>
        {auth && (
          <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-medium text-amber-400 bg-amber-400/10 border border-amber-400/15">
            Auth Required
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-3">{description}</p>
      {body.length > 0 && (
        <div className="border-t border-white/[0.04] pt-3">
          <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">Request Body</p>
          <div className="space-y-1.5">
            {body.map((param) => (
              <div key={param.field} className="flex items-start gap-2 text-sm">
                <code className="font-mono text-xs text-violet-400 min-w-[120px]">{param.field}</code>
                <span className="text-xs text-[var(--text-dim)] min-w-[60px]">{param.type}</span>
                {param.required && (
                  <span className="text-[10px] text-red-400/80 font-medium">required</span>
                )}
                <span className="text-xs text-[var(--text-muted)]">{param.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorRow({
  status,
  type,
  cause,
  fix,
}: {
  status: number;
  type: string;
  cause: string;
  fix: string;
}) {
  const statusColor =
    status >= 500
      ? "text-red-400"
      : status >= 400
      ? "text-amber-400"
      : "text-emerald-400";

  return (
    <tr>
      <td className="px-5 py-3 align-top">
        <span className={`font-mono font-bold ${statusColor}`}>{status}</span>
      </td>
      <td className="px-5 py-3 align-top">
        <code className="text-xs font-mono text-cyan-300/50">{type}</code>
      </td>
      <td className="px-5 py-3">
        <p className="text-sm text-white/80">{cause}</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">{fix}</p>
      </td>
    </tr>
  );
}
