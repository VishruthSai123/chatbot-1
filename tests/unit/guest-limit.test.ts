import { expect, test } from "@playwright/test";

import { getMessageByErrorCode } from "../../lib/errors";
import { GUEST_MESSAGE_LIMIT } from "../../lib/guest";

test.describe("guest trial limit", () => {
  test("allows exactly three guest messages", () => {
    expect(GUEST_MESSAGE_LIMIT).toBe(3);
  });

  test("the limit error prompts for a free account", () => {
    const message = getMessageByErrorCode("guest_limit:chat");

    expect(message).toContain("3 free guest messages");
    expect(message.toLowerCase()).toContain("free account");
  });
});
