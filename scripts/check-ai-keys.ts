// biome-ignore-all lint/performance/noAwaitInLoops: key probes run sequentially to keep the output attributable

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { loadEnvConfig } from "@next/env";
import { generateText } from "ai";
import "dotenv/config";

import { readGoogleApiKeys } from "../lib/ai/api-keys";
import { errorStatusCode } from "../lib/ai/observability";

/*
 * Operational key probe. It prints only the credential index and a status
 * class, never the credential itself. Add a new key as GEMINI_API_KEY_NEXT,
 * run `pnpm keys:check`, then promote it only if it reports ok.
 */

async function main() {
  loadEnvConfig(process.cwd(), false);

  const modelId =
    process.env.KEY_PROBE_MODEL?.trim() || "gemini-3.1-flash-lite";
  const keys = readGoogleApiKeys();

  if (keys.length === 0) {
    console.error("No Google API keys are configured.");
    process.exit(1);
  }

  let failures = 0;

  for (let index = 0; index < keys.length; index += 1) {
    const provider = createGoogleGenerativeAI({ apiKey: keys[index] });

    try {
      const result = await generateText({
        maxOutputTokens: 4,
        maxRetries: 0,
        model: provider(modelId),
        prompt: "Reply with OK.",
        temperature: 0,
      });
      console.log(
        `key #${index + 1}: ok (${result.text.trim().slice(0, 12) || "empty"})`
      );
    } catch (error) {
      failures += 1;
      const status = errorStatusCode(error);
      const name = error instanceof Error ? error.name : "UnknownError";
      console.log(`key #${index + 1}: failed (${status ?? name})`);
    }
  }

  if (failures > 0) {
    console.error(`${failures} of ${keys.length} keys failed validation.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.name : "Key probe failed");
  process.exit(1);
});
