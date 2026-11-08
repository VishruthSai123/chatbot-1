import { auth } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { getMessageCountByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const DEFAULT_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest";
const TOKEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

type AuthTokenResponse = {
  name?: string;
};

type TokenAttempt = {
  body: Record<string, unknown>;
  detail?: string;
  ok: boolean;
  status?: number;
};

async function requestToken(
  apiKey: string,
  body: Record<string, unknown>
): Promise<TokenAttempt> {
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
    });

    if (!response.ok) {
      return {
        body,
        detail: (await response.text()).slice(0, 400),
        ok: false,
        status: response.status,
      };
    }

    const data = (await response.json()) as AuthTokenResponse;
    if (!data.name) {
      return { body, detail: "missing token name", ok: false, status: 502 };
    }

    return { body, detail: data.name, ok: true };
  } catch (error) {
    return {
      body,
      detail: error instanceof Error ? error.message : "token request failed",
      ok: false,
    };
  }
}

/**
 * Mints a single-use Gemini Live ephemeral token so the Android client can open
 * a direct WebSocket. A serverless proxy cannot carry full-duplex audio, and
 * the raw production key must never reach the device.
 */
export async function handleLiveTokenRequest() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const userType = session.user.type;
  const messageCount = await getMessageCountByUserId({
    differenceInHours: 1,
    id: session.user.id,
  });

  if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
    return new ChatbotError("rate_limit:chat").toResponse();
  }

  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();

  if (!apiKey) {
    return Response.json(
      { error: "live_not_configured" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const now = Date.now();
  const expireTime = new Date(now + 20 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 2 * 60 * 1000).toISOString();

  const constrainedBody = {
    expireTime,
    liveConnectConstraints: { model },
    newSessionExpireTime,
    uses: 1,
  };

  let attempt = await requestToken(apiKey, constrainedBody);

  // Older/alternate Gemini keys reject `liveConnectConstraints`. The client
  // still sends a full setup message, so a plain token is a safe fallback.
  if (!attempt.ok && (attempt.status === 400 || attempt.status === 404)) {
    attempt = await requestToken(apiKey, {
      expireTime,
      newSessionExpireTime,
      uses: 1,
    });
  }

  if (!(attempt.ok && attempt.detail)) {
    console.error("Live token request failed:", attempt.status, attempt.detail);
    return Response.json(
      { error: "live_token_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  return Response.json(
    {
      expiresAt: expireTime,
      model,
      token: attempt.detail,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
