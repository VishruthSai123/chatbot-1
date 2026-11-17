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

const PUBLIC_MAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "yandex.com",
]);

/** Strips wrapping quotes and whitespace from a configured mail header. */
export function normalizeEmailHeader(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractEmail(value: string): string {
  const bracketed = value.match(/<([^<>]+)>/);
  const candidate = (bracketed?.[1] ?? value).trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate) ? candidate : "";
}

export function emailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = normalizeEmailHeader(process.env.EMAIL_FROM);
  const replyTo = normalizeEmailHeader(process.env.EMAIL_REPLY_TO);
  const fromEmail = extractEmail(from);
  const domain = fromEmail.split("@").at(-1)?.toLowerCase() ?? "";

  return {
    apiKeyPresent: Boolean(apiKey),
    configured: Boolean(apiKey && fromEmail),
    fromDomain: domain,
    fromValid: Boolean(fromEmail),
    publicMailDomain: PUBLIC_MAIL_DOMAINS.has(domain),
    replyToValid: replyTo ? Boolean(extractEmail(replyTo)) : true,
  };
}

/**
 * Sends transactional mail through Resend's HTTPS API.
 *
 * No provider SDK is needed, and no recipient, token or message body is logged.
 * Development without a provider prints the message locally so the flow can be
 * exercised; production fails closed and reports only the reason.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailDelivery> {
  const config = emailConfiguration();

  if (!config.configured) {
    if (process.env.NODE_ENV === "development") {
      console.info(
        `[auth-email:development] ${message.subject}\n${message.text}`
      );
    } else {
      console.warn(
        JSON.stringify({
          event: "auth_email_not_configured",
          fromValid: config.fromValid,
          publicMailDomain: config.publicMailDomain,
          subject: message.subject,
        })
      );
    }
    return { delivered: false, reason: "not_configured" };
  }

  if (config.publicMailDomain) {
    console.error(
      JSON.stringify({
        event: "auth_email_public_domain",
        fromDomain: config.fromDomain,
        subject: message.subject,
      })
    );
    return { delivered: false, reason: "not_configured" };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = normalizeEmailHeader(process.env.EMAIL_FROM);
  const replyTo = normalizeEmailHeader(process.env.EMAIL_REPLY_TO);

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
      let providerMessage = "";
      let providerName = "";

      try {
        const body = (await response.json()) as {
          message?: unknown;
          name?: unknown;
        };
        providerName =
          typeof body.name === "string" ? body.name.slice(0, 80) : "";
        providerMessage =
          typeof body.message === "string" ? body.message.slice(0, 300) : "";
      } catch {
        // The provider did not return JSON. Status is enough.
      }

      console.error(
        JSON.stringify({
          event: "auth_email_failed",
          fromDomain: config.fromDomain,
          providerMessage,
          providerName,
          publicMailDomain: config.publicMailDomain,
          status: response.status,
        })
      );
      return { delivered: false, reason: "provider_error" };
    }

    let providerId: string | undefined;

    try {
      const body = (await response.json()) as { id?: unknown };
      providerId = typeof body.id === "string" ? body.id : undefined;
    } catch {
      // A successful response without a JSON body still means accepted.
    }

    console.info(
      JSON.stringify({
        event: "auth_email_sent",
        fromDomain: config.fromDomain,
        providerId,
        subject: message.subject,
      })
    );

    return { delivered: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        errorClass: error instanceof Error ? error.name : "UnknownError",
        event: "auth_email_failed",
        fromDomain: config.fromDomain,
      })
    );
    return { delivered: false, reason: "provider_error" };
  }
}
