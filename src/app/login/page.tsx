"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { getFingerprint } from "@/lib/fingerprint";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const fpRef = useRef<string | null>(null);

  useEffect(() => {
    getFingerprint().then((fp) => { fpRef.current = fp; });
  }, []);

  async function handleGoogleLogin() {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setError(error.message);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      if (fpRef.current) {
        fetch("/api/v1/fingerprint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: fpRef.current }),
        }).catch(() => {});
      }
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      {/* Aurora background */}
      <div className="aurora-bg">
        <div className="aurora-orb-1" />
        <div className="aurora-orb-2" />
      </div>
      <div className="noise-overlay" />

      <div className="w-full max-w-md relative z-10 animate-in">
        {/* Logo + Title */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center text-2xl font-bold"
            style={{
              background: "linear-gradient(135deg, rgba(34, 211, 238, 0.15), rgba(139, 92, 246, 0.25))",
              border: "1px solid rgba(139, 92, 246, 0.2)",
              boxShadow: "0 0 60px -8px rgba(139, 92, 246, 0.25), 0 0 30px -4px rgba(34, 211, 238, 0.15)",
            }}
          >
            <span className="aurora-text">A</span>
          </div>
          <h1 className="text-3xl font-bold text-white/90 tracking-tight">Aether Router</h1>
          <p className="text-[var(--text-muted)] mt-2 text-sm">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleLogin}
          className="glass-card-elevated shimmer-line p-6 space-y-4"
        >
          {error && (
            <div className="badge-error rounded-xl p-3 text-sm flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-white/90 placeholder-[var(--text-dim)] transition-all"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-white/90 placeholder-[var(--text-dim)] transition-all"
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-aurora px-4 py-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/[0.06]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 text-[var(--text-dim)]" style={{ background: "var(--bg-card-solid)" }}>or</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full btn-ghost flex items-center justify-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-sm text-[var(--text-muted)]">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-violet-400 hover:text-violet-300 transition-colors font-medium">
              Sign up
            </Link>
          </p>
        </form>

        <p className="text-center text-xs text-[var(--text-dim)] mt-6 leading-relaxed">
          Aether Router is a model proxy. We don&apos;t control model availability or stability.
        </p>
        <p className="text-center text-xs text-[var(--text-dim)] mt-2">
          By signing in you agree to our{" "}
          <Link href="/policies" className="text-violet-400/80 hover:text-violet-300 transition-colors underline">
            policies
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
