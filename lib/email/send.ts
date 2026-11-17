import "server-only";

export type EmailDelivery =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "provider_error" };

export type EmailMessage = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

function configured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()
  );
}

/**
 * Sends transactional mail through Resend's HTTPS API.
 *
 * No provider SDK is needed, and no recipient, token or message body is logged.
 * Development without a provider prints the message locally so the flow can be
 * exercised; production fails closed and reports only the reason.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailDelivery> {
  if (!configured()) {
    if (process.env.NODE_ENV === "development") {
      console.info(
        `[auth-email:development] ${message.subject}\n${message.text}`
      );
    } else {
      console.warn(
        JSON.stringify({
          event: "auth_email_not_configured",
          subject: message.subject,
        })
      );
    }
    return { delivered: false, reason: "not_configured" };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();

  if (!(apiKey && from)) {
    return { delivered: false, reason: "not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from,
        html: message.html,
        subject: message.subject,
        text: message.text,
        to: [message.to],
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "auth_email_failed",
          status: response.status,
        })
      );
      return { delivered: false, reason: "provider_error" };
    }

    return { delivered: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        errorClass: error instanceof Error ? error.name : "UnknownError",
        event: "auth_email_failed",
      })
    );
    return { delivered: false, reason: "provider_error" };
  }
}
