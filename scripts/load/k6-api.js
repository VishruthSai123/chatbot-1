// biome-ignore-all lint/correctness/noUndeclaredVariables: k6 provides __ENV

/*
 * Read-only staging load test.
 *
 * This does not create guests, send chat messages, or call an AI provider.
 * Use it to establish a baseline for the static app, public endpoints, and
 * authenticated read paths before running the paid chat scenario.
 *
 *   k6 run scripts/load/k6-api.js
 */

import { check, sleep } from "k6";
import http from "k6/http";

const base = (__ENV.LOAD_TEST_BASE_URL ?? "").replace(/\/$/, "");
const cookie = __ENV.LOAD_TEST_COOKIE ?? "";

if (!base) {
  throw new Error("Set LOAD_TEST_BASE_URL to a staging deployment.");
}

if (
  base.includes("chatbot-1-beige.vercel.app") &&
  __ENV.ALLOW_PRODUCTION_LOAD_TEST !== "true"
) {
  throw new Error(
    "Refusing to load-test production. Use a staging URL or set ALLOW_PRODUCTION_LOAD_TEST=true explicitly."
  );
}

export const options = {
  scenarios: {
    read_paths: {
      executor: "ramping-vus",
      gracefulRampDown: "30s",
      stages: [
        { duration: "1m", target: Number(__ENV.RAMP_TO ?? 25) },
        {
          duration: __ENV.HOLD_DURATION ?? "3m",
          target: Number(__ENV.RAMP_TO ?? 25),
        },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.02"],
  },
};

function headers() {
  const result = { Accept: "text/html,application/json" };
  if (cookie) {
    result.Cookie = cookie;
  }
  return result;
}

export default function () {
  const root = http.get(`${base}/`, {
    headers: headers(),
    redirects: 0,
    tags: { endpoint: "root" },
  });
  check(root, { "root is not a 5xx": (response) => response.status < 500 });

  const models = http.get(`${base}/api/models`, {
    headers: headers(),
    tags: { endpoint: "models" },
  });
  check(models, {
    "models status is 200": (response) => response.status === 200,
  });

  if (cookie) {
    const history = http.get(`${base}/api/history?limit=10`, {
      headers: headers(),
      tags: { endpoint: "history" },
    });
    check(history, {
      "history is 200": (response) => response.status === 200,
    });
  }

  const ping = http.get(`${base}/ping`, {
    tags: { endpoint: "ping" },
  });
  check(ping, { "ping is 200": (response) => response.status === 200 });

  sleep(Number(__ENV.SLEEP_SECONDS ?? 1));
}
