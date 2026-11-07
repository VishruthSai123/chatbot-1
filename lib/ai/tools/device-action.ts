import { tool } from "ai";
import { z } from "zod";

/**
 * A client-side tool. The server never executes it; the Android WebView
 * receives the call, shows a native confirmation, performs the action, and
 * returns a result through `addToolResult`.
 */
export const deviceAction = tool({
  description:
    "Perform a confirmed action on the user's Android phone through Quick Search. " +
    "Use only when the user explicitly asks to open an app, create a reminder or note, or search their phone. " +
    "Never use it for general questions, and never invent a reminder time. " +
    "The user sees a native Allow/Cancel dialog before anything happens.",
  inputSchema: z.object({
    action: z
      .enum(["open_app", "create_reminder", "create_note", "search"])
      .describe("The device action to request."),
    content: z
      .string()
      .optional()
      .describe("Note body when action is create_note."),
    dueAtMillis: z
      .number()
      .optional()
      .describe(
        "Reminder due time as Unix epoch milliseconds, only when you know the exact timestamp."
      ),
    dueText: z
      .string()
      .optional()
      .describe(
        "Reminder due time in the user's words, e.g. 'tomorrow at 6pm' or 'in 2 hours'. Prefer this when the user gives a relative time."
      ),
    query: z
      .string()
      .optional()
      .describe("App name for open_app, or search text for search."),
    title: z
      .string()
      .optional()
      .describe("Reminder or note title when creating one."),
  }),
  outputSchema: z.object({
    message: z.string(),
    status: z.enum(["ok", "cancelled", "error", "unavailable"]),
  }),
});
