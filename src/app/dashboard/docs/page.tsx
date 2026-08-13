import { PUBLIC_API_BASE_URL } from "@/lib/public-endpoints";

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
              {PUBLIC_API_BASE_URL}
            </code>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">Example Request (cURL)</p>
            <pre className="bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre text-white/60">
{`curl ${PUBLIC_API_BASE_URL}/chat/completions \\
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
    base_url="${PUBLIC_API_BASE_URL}"
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

      {/* Image & video generation */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Image &amp; Video Generation</h3>
        <div className="glass-card shimmer-line p-5 space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            Models with the <code className="text-violet-400 font-mono text-xs">img/</code> and{" "}
            <code className="text-cyan-400 font-mono text-xs">vid/</code> prefixes run on our own GPU.
            They are billed <strong className="text-white/80">per generation</strong>, not per token:
            the price scales with resolution, steps and (for video) frames. Available on paid plans.
          </p>

          <div>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">
              OpenAI-compatible (images, waits for the result)
            </p>
            <pre className="bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre text-white/60">
{`curl ${PUBLIC_API_BASE_URL}/images/generations \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "img/flux-dev",
    "prompt": "a vintage motorcycle on a neon-lit street",
    "size": "1024x1024",
    "response_format": "url"
  }'`}
            </pre>
          </div>

          <div>
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-2">
              Async jobs (required for video, recommended for batches)
            </p>
            <pre className="bg-[var(--bg-input)] border border-white/[0.04] rounded-xl px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre text-white/60">
{`# 1. enqueue -> 202 {"id": "...", "status": "queued"}
curl ${PUBLIC_API_BASE_URL}/media/jobs \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "vid/wan-2.2-5b", "prompt": "a fox running in the snow", "length": 49}'

# 2. poll until status is "succeeded"
curl ${PUBLIC_API_BASE_URL}/media/jobs/JOB_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
            </pre>
          </div>

          <ul className="text-sm space-y-2 ml-4 list-disc text-[var(--text-muted)]">
            <li>
              <code className="text-violet-400 font-mono text-xs">GET /media/models</code> lists the
              models with their defaults, limits and price per generation.
            </li>
            <li>
              Optional fields: <code className="font-mono text-xs">negative_prompt</code>,{" "}
              <code className="font-mono text-xs">steps</code>,{" "}
              <code className="font-mono text-xs">seed</code>,{" "}
              <code className="font-mono text-xs">batch</code>,{" "}
              <code className="font-mono text-xs">init_image</code> (base64, for img2img and
              image-to-video), <code className="font-mono text-xs">length</code> and{" "}
              <code className="font-mono text-xs">fps</code> for video.
            </li>
            <li>
              LoRAs: pass up to 4 as{" "}
              <code className="font-mono text-xs">{`"loras": [{"name": "file.safetensors", "strength": 0.8}]`}</code>.
              The installed list comes back in{" "}
              <code className="font-mono text-xs">GET /media/models</code> under{" "}
              <code className="font-mono text-xs">loras</code>; names must match exactly.
            </li>
            <li>
              Result files are served as <strong className="text-white/80">signed URLs valid for 1 hour</strong>.
              Download what you want to keep.
            </li>
            <li>
              Credits are reserved when the job is queued and{" "}
              <strong className="text-white/80">refunded automatically</strong> if the generation fails.
            </li>
            <li>
              A failed video job can take minutes to detect — poll the job instead of holding an
              HTTP connection open.
            </li>
          </ul>
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

      {/* Premium Models */}
      <section className="mb-10">
        <h3 className="text-xl font-bold text-white/85 mb-4">Premium Models (w/, an/)</h3>
        <div className="glass-card shimmer-line p-5 space-y-3">
          <p className="text-sm text-white/80">
            Models prefixed with <code className="text-violet-400 font-mono text-xs">w/</code> or <code className="text-amber-400 font-mono text-xs">an/</code> are premium models with additional restrictions:
          </p>
          <ul className="text-sm space-y-2 ml-4 list-disc text-[var(--text-muted)]">
            <li><code className="text-amber-400 font-mono text-xs">an/</code> models require you to <strong className="text-white/80">claim daily requests</strong> from the Billing page. <code className="text-violet-400 font-mono text-xs">w/</code> models do not.</li>
            <li>Each plan has a <strong className="text-white/80">daily premium request limit</strong> — upgrade for more.</li>
            <li>Each plan has a <strong className="text-white/80">max context length</strong> — longer conversations may be rejected.</li>
            <li>
              <strong className="text-white/80">Not all models cost the same:</strong>{" "}
              Claude models use <span className="text-red-400">2 requests</span> per call,
              Gemini Pro uses <span className="text-amber-400">1 request</span>,
              and Gemini Flash uses <span className="text-green-400">0.5 requests</span>.
            </li>
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
              <ErrorRow status={402} type="billing_error" cause="Not enough credits to complete the request." fix="Buy more credits or choose a model covered by your remaining premium-request allowance." />
              <ErrorRow status={403} type="claim_required" cause="Premium model (an/) used without claiming daily requests." fix='Go to Billing > "Claim Daily Premium Requests" before making requests.' />
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
