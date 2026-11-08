export type DeviceActionName =
  | "open_app"
  | "create_reminder"
  | "create_note"
  | "search";

export type DeviceActionInput = {
  action: DeviceActionName;
  content?: string;
  dueAtMillis?: number;
  dueText?: string;
  query?: string;
  title?: string;
};

export type DeviceActionResult = {
  message: string;
  status: "ok" | "cancelled" | "error" | "unavailable";
};

type NativeBridge = {
  requestAction: (requestId: string, action: string, argsJson: string) => void;
  startLive?: () => void;
};

declare global {
  interface Window {
    __spireBridgeResult?: (
      requestId: string,
      status: string,
      message: string
    ) => void;
    SpireAndroid?: NativeBridge;
  }
}

const pending = new Map<string, (result: DeviceActionResult) => void>();

/**
 * Resolves every pending native action as cancelled.
 *
 * Used when the user stops a generation or the stream errors. Without this the
 * `onToolCall` promise can stay pending forever, leaving a tool call with no
 * result and causing `AI_MissingToolResultsError` on the next turn.
 */
export function cancelPendingDeviceActions(
  message = "The action was cancelled."
): void {
  for (const [requestId, resolve] of pending) {
    pending.delete(requestId);
    resolve({ message, status: "cancelled" });
  }
}

if (typeof window !== "undefined") {
  window.__spireBridgeResult = (requestId, status, message) => {
    const resolve = pending.get(requestId);
    if (!resolve) {
      return;
    }
    pending.delete(requestId);
    resolve({
      message,
      status:
        status === "ok" || status === "cancelled" || status === "error"
          ? status
          : "error",
    });
  };
}

/**
 * Sends a device action to the Android host and waits for the native
 * Allow/Cancel dialog. Outside the Quick Search Android app it resolves as
 * unavailable instead of throwing, so the web UI remains usable everywhere.
 */
export function requestDeviceAction(
  input: DeviceActionInput
): Promise<DeviceActionResult> {
  if (typeof window === "undefined" || !window.SpireAndroid) {
    return Promise.resolve({
      message:
        "Device actions are only available in the Quick Search Android app.",
      status: "unavailable",
    });
  }

  const requestId = `spire-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({
        message: "Timed out waiting for confirmation.",
        status: "error",
      });
    }, 120_000);

    pending.set(requestId, (result) => {
      window.clearTimeout(timeout);
      resolve(result);
    });

    window.SpireAndroid?.requestAction(
      requestId,
      input.action,
      JSON.stringify(input)
    );
  });
}
