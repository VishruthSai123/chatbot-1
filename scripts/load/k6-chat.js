// biome-ignore-all lint/correctness/noUndeclaredVariables: k6 provides __ENV

/*
 * Chat load test. This calls the real AI provider and costs money.
 *
 * Run it only against staging, with a dedicated test account, and start with
 * one virtual user. The scenario is intentionally separate from the read-only
 * baseline so a mistake in the cheap test cannot trigger paid traffic.
 *
 *   $env:LOAD_TEST_BASE_URL="https://staging.example.com"
 *   $env:LOAD_TEST_COOKIE="authjs.session-token=..."
 *   k6 run scripts/load/k6-chat.js
 */

import { check, sleep } from "k6";
import http from "k6/http";

const base = (__ENV.LOAD_TEST_BASE_URL ?? "").replace(/\/$/, "");
const cookie = __ENV.LOAD_TEST_COOKIE ?? "";
const chatId = __ENV.LOAD_TEST_CHAT_ID ?? "";

if (!base) {
  throw new Error("Set LOAD_TEST_BASE_URL to a staging deployment.");
}

if (!cookie) {
  throw new Error(
    "Set LOAD_TEST_COOKIE to a signed-in test account or guest session cookie."
  );
}

if (
  base.includes("chatbot-1-beige.vercel.app") &&
  __ENV.ALLOW_PRODUCTION_LOAD_TEST !== "true"
) {
  throw new Error(
    "Refusing to run paid chat traffic against production. Use staging."
  );
}

export const options = {
  scenarios: {
    chat: {
      executor: "ramping-vus",
      gracefulRampDown: "60s",
      stages: [
        { duration: "1m", target: Number(__ENV.CHAT_START_VUS ?? 1) },
        { duration: "2m", target: Number(__ENV.CHAT_PEAK_VUS ?? 5) },
        {
          duration: __ENV.CHAT_HOLD_DURATION ?? "3m",
          target: Number(__ENV.CHAT_PEAK_VUS ?? 5),
        },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<120000"],
    http_req_failed: ["rate<0.10"],
  },
};

function uuid() {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function () {
  const body = {
    id: chatId || uuid(),
    message: {
      id: uuid(),
      parts: [
        {
          text: __ENV.LOAD_TEST_PROMPT ?? "Reply with the single word: ready",
          type: "text",
        },
      ],
      role: "user",
    },
    selectedChatModel: __ENV.LOAD_TEST_MODEL ?? "gemini-3.1-flash-lite",
    selectedVisibilityType: "private",
  };

  const response = http.post(`${base}/api/chat`, JSON.stringify(body), {
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    tags: { endpoint: "chat" },
    timeout: "180s",
  });

  check(response, {
    "chat did not return 5xx": (result) => result.status < 500,
    "chat was accepted or rate limited": (result) =>
      result.status === 200 || result.status === 403 || result.status === 429,
  });

  sleep(Number(__ENV.CHAT_SLEEP_SECONDS ?? 5));
}
