import "server-only";

import { sendEmail } from "./send";

const BRAND = "Spire";

function layout({
  body,
  heading,
  link,
  linkLabel,
}: {
  body: string;
  heading: string;
  link: string;
  linkLabel: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f6f4;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e2;border-radius:14px">
      <tr>
        <td style="padding:28px 24px">
          <p style="margin:0 0 18px;font-size:14px;font-weight:600;letter-spacing:.02em">${BRAND}</p>
          <h1 style="margin:0 0 12px;font-size:21px;line-height:1.3">${heading}</h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#525252">${body}</p>
          <p style="margin:0 0 22px">
            <a href="${link}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#171717;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600">${linkLabel}</a>
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#737373">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all">${link}</span></p>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#737373">If you did not request this, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function sendVerificationEmail({
  origin,
  to,
  token,
}: {
  origin: string;
  to: string;
  token: string;
}) {
  const link = `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  return sendEmail({
    html: layout({
      body: "Confirm this address to secure your Spire account. The link expires in 24 hours.",
      heading: "Verify your email",
      link,
      linkLabel: "Verify email",
    }),
    subject: "Verify your Spire email",
    text: `Verify your Spire email\n\nOpen this link to confirm your address. It expires in 24 hours:\n${link}\n\nIf you did not create a Spire account, ignore this email.`,
    to,
  });
}

export function sendPasswordResetEmail({
  origin,
  to,
  token,
}: {
  origin: string;
  to: string;
  token: string;
}) {
  const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

  return sendEmail({
    html: layout({
      body: "Use the button below to choose a new password. The link expires in one hour and can be used once.",
      heading: "Reset your password",
      link,
      linkLabel: "Reset password",
    }),
    subject: "Reset your Spire password",
    text: `Reset your Spire password\n\nOpen this link to choose a new password. It expires in one hour and can be used once:\n${link}\n\nIf you did not request a reset, ignore this email.`,
    to,
  });
}
