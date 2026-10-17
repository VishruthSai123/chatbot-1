import { expect, test } from "@playwright/test";

import { postRequestBodySchema } from "../../app/(chat)/api/chat/schema";

const baseBody = {
  id: "00000000-0000-4000-8000-000000000000",
  selectedChatModel: "gemini-2.5-flash",
  selectedVisibilityType: "private" as const,
};

test.describe("postRequestBodySchema activeImage", () => {
  test("accepts a request without activeImage", () => {
    expect(postRequestBodySchema.safeParse(baseBody).success).toBe(true);
  });

  test("preserves the active workbench document id and tool mode", () => {
    const parsed = postRequestBodySchema.parse({
      ...baseBody,
      activeImage: {
        documentId: "11111111-1111-4111-8111-111111111111",
        toolMode: "resize",
      },
    });
    expect(parsed.activeImage?.documentId).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(parsed.activeImage?.toolMode).toBe("resize");
  });

  test("accepts an activeImage with only a tool mode", () => {
    const parsed = postRequestBodySchema.parse({
      ...baseBody,
      activeImage: { toolMode: "crop" },
    });
    expect(parsed.activeImage?.documentId).toBeUndefined();
    expect(parsed.activeImage?.toolMode).toBe("crop");
  });

  test("does not throw on an unexpected tool mode string", () => {
    const result = postRequestBodySchema.safeParse({
      ...baseBody,
      activeImage: { toolMode: "not-a-real-mode" },
    });
    expect(result.success).toBe(true);
  });
});
