import { expect, test } from "@playwright/test";

import { assistantMessageBody } from "../../lib/chat/message-state";

test.describe("assistantMessageBody", () => {
  test("renders streamed content while the response is still streaming", () => {
    // Regression: gating on isLoading alone hid every streamed token behind the
    // "Thinking…" shimmer until the whole response had finished.
    expect(
      assistantMessageBody({
        hasAnyContent: true,
        isAssistant: true,
        isLoading: true,
      })
    ).toBe("content");
  });

  test("shows the waiting shimmer before anything arrives", () => {
    expect(
      assistantMessageBody({
        hasAnyContent: false,
        isAssistant: true,
        isLoading: true,
      })
    ).toBe("waiting");
  });

  test("reports an empty turn once loading finishes", () => {
    expect(
      assistantMessageBody({
        hasAnyContent: false,
        isAssistant: true,
        isLoading: false,
      })
    ).toBe("empty");
  });

  test("renders a settled assistant message normally", () => {
    expect(
      assistantMessageBody({
        hasAnyContent: true,
        isAssistant: true,
        isLoading: false,
      })
    ).toBe("content");
  });

  test("never applies the waiting state to user messages", () => {
    expect(
      assistantMessageBody({
        hasAnyContent: false,
        isAssistant: false,
        isLoading: true,
      })
    ).toBe("content");
    expect(
      assistantMessageBody({
        hasAnyContent: false,
        isAssistant: false,
        isLoading: false,
      })
    ).toBe("content");
  });
});
