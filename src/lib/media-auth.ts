// Auth compartida por las rutas de media. Mismos gates que
// /v1/chat/completions (Bearer o sesión + CSRF, ban, activación, Discord),
// solo que sin nada de lo específico de chat.

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, validateSession, type ApiKeyInfo } from "@/lib/auth";
import { isApiKeyAuthHeader, getRequestFingerprint } from "@/lib/chat-preflight";
import { evaluateBanStatus } from "@/lib/ban";
import { requireCsrf } from "@/lib/csrf";

export async function authenticateMediaRequest(
  req: NextRequest,
  options: { mutating: boolean },
): Promise<{ keyInfo: ApiKeyInfo } | { response: NextResponse }> {
  const authHeader = req.headers.get("authorization");

  let keyInfo: ApiKeyInfo | null;
  if (isApiKeyAuthHeader(authHeader)) {
    keyInfo = await validateApiKey((authHeader ?? "").slice(7));
    if (!keyInfo) {
      return {
        response: NextResponse.json(
          { error: { message: "Invalid API key", type: "auth_error" } },
          { status: 401 },
        ),
      };
    }
  } else {
    // Con cookies, cualquier POST cross-site podría gastar créditos ajenos.
    if (options.mutating) {
      const csrfError = requireCsrf(req);
      if (csrfError) return { response: csrfError };
    }
    keyInfo = await validateSession();
    if (!keyInfo) {
      return {
        response: NextResponse.json(
          { error: { message: "Missing Authorization header", type: "auth_error" } },
          { status: 401 },
        ),
      };
    }
  }

  const banDecision = await evaluateBanStatus({
    headers: req.headers,
    userId: keyInfo.userId,
    fingerprint: getRequestFingerprint(req.headers),
  });
  if (banDecision?.blocked) {
    return {
      response: NextResponse.json(
        { error: { message: banDecision.reason, type: "account_banned" } },
        { status: banDecision.statusCode },
      ),
    };
  }

  if (
    keyInfo.source === "api" &&
    !keyInfo.isCustom &&
    keyInfo.planId === "free" &&
    !keyInfo.isActivated
  ) {
    return {
      response: NextResponse.json(
        {
          error: {
            message:
              "This account is not yet activated for API key usage. Message an admin on Discord to request activation.",
            type: "account_not_activated",
          },
        },
        { status: 403 },
      ),
    };
  }

  if (
    !keyInfo.isCustom &&
    keyInfo.planId === "free" &&
    !keyInfo.discordVerified &&
    keyInfo.discordLinkRequiredBy !== null &&
    new Date(keyInfo.discordLinkRequiredBy) < new Date()
  ) {
    return {
      response: NextResponse.json(
        {
          error: {
            message:
              "Free plan requires Discord verification. Verify your account at /dashboard/discord to continue.",
            type: "discord_verification_required",
          },
        },
        { status: 403 },
      ),
    };
  }

  return { keyInfo };
}
