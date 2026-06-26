// Discord OAuth2 — signed `state` helper (CSRF + carries the user id) and
// authorize-URL builder. Uses Web Crypto (HMAC-SHA256) so it runs on the
// Cloudflare Workers / OpenNext runtime without node:crypto.
//
// The state is `base64url(payload).base64url(hmac)` where payload = { uid,
// nonce, exp }. A matching `nonce` is also stored in an httpOnly cookie; the
// callback requires both the signature AND the cookie nonce to match
// (double-submit) to defeat login-CSRF.

const enc = new TextEncoder();

// Return a standalone ArrayBuffer (a valid BufferSource) from a view, sidestepping
// the Uint8Array<ArrayBufferLike> vs BufferSource mismatch in recent TS lib types.
function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    ab(enc.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export interface StatePayload {
  uid: string;
  nonce: string;
  exp: number;
}

export async function signState(
  secret: string,
  uid: string,
  ttlSeconds = 600
): Promise<{ state: string; nonce: string }> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload: StatePayload = {
    uid,
    nonce,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await importKey(secret), ab(enc.encode(body)));
  return { state: `${body}.${b64url(sig)}`, nonce };
}

export async function verifyState(
  secret: string,
  state: string,
  cookieNonce: string | undefined
): Promise<StatePayload | null> {
  const [body, sig] = (state || "").split(".");
  if (!body || !sig) return null;

  const ok = await crypto.subtle.verify(
    "HMAC",
    await importKey(secret),
    ab(fromB64url(sig)),
    ab(enc.encode(body))
  );
  if (!ok) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  // Double-submit: the nonce in the signed state must match the cookie.
  if (!cookieNonce || cookieNonce !== payload.nonce) return null;

  return payload;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    scope: "identify email",
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export const DISCORD_NONCE_COOKIE = "discord_oauth_nonce";
