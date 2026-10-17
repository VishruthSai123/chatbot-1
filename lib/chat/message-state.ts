/**
 * Body an assistant message should render while a response is streaming.
 *
 * - `waiting`  nothing has arrived yet, so show the "Thinking…" shimmer
 * - `empty`    the turn finished without producing anything
 * - `content`  render the live parts (text, tool cards, …) as they stream in
 *
 * The important case is `hasAnyContent && isLoading`: the message is still
 * streaming but already has something to show, so it must render `content`.
 * Gating on `isLoading` alone hid every streamed token until the response
 * finished, which made the chat look stuck on "Thinking…".
 */
export type AssistantMessageBody = "content" | "empty" | "waiting";

export function assistantMessageBody({
  hasAnyContent,
  isLoading,
  isAssistant,
}: {
  hasAnyContent: boolean;
  isLoading: boolean;
  isAssistant: boolean;
}): AssistantMessageBody {
  if (!(isAssistant && !hasAnyContent)) {
    return "content";
  }

  return isLoading ? "waiting" : "empty";
}
