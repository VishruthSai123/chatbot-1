import { expect, test } from "@playwright/test";

import { resolveChatModel } from "../../lib/ai/router";
import { limitsForPlan } from "../../lib/plans";

test.describe("chat model routing", () => {
  test("every plan uses the one supported model", () => {
    for (const plan of ["free", "go", "plus", "pro", "business", "daypass"]) {
      const routed = resolveChatModel({
        plan: limitsForPlan(plan),
        requestedModel: "gemini-3.5-flash-lite",
      });

      expect(routed.id).toBe("gemini-3.5-flash-lite");
    }
  });

  test("the free budget is large enough for tool arguments", () => {
    const routed = resolveChatModel({
      plan: limitsForPlan("free"),
      requestedModel: "gemini-3.5-flash-lite",
    });

    expect(routed.maxOutputTokens).toBeGreaterThanOrEqual(2048);
  });
});
