#!/usr/bin/env node
/*
 * Validates the load-test target before any traffic is generated.
 * This is not a load test; it makes one request to /ping.
 */

const base = (process.env.LOAD_TEST_BASE_URL ?? "").replace(/\/$/, "");

if (!base) {
  console.error("Set LOAD_TEST_BASE_URL to a staging deployment.");
  process.exit(1);
}

if (
  base.includes("chatbot-1-beige.vercel.app") &&
  process.env.ALLOW_PRODUCTION_LOAD_TEST !== "true"
) {
  console.error(
    "Refusing to target production. Use staging or set ALLOW_PRODUCTION_LOAD_TEST=true explicitly."
  );
  process.exit(1);
}

const started = Date.now();

try {
  const response = await fetch(`${base}/ping`, {
    signal: AbortSignal.timeout(10_000),
  });
  const elapsed = Date.now() - started;

  console.log(`target: ${base}`);
  console.log(`/ping: ${response.status} in ${elapsed} ms`);

  if (!response.ok) {
    process.exit(1);
  }

  if (process.env.LOAD_TEST_COOKIE) {
    const models = await fetch(`${base}/api/models`, {
      headers: { Cookie: process.env.LOAD_TEST_COOKIE },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`/api/models: ${models.status}`);
  }
} catch (error) {
  console.error(
    `Target check failed: ${error instanceof Error ? error.name : "unknown error"}`
  );
  process.exit(1);
}
