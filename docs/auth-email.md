# Auth email: verification and password reset

Spire sends two transactional emails through Resend:

- **Verify email** — sent after registration, and from Account & data when the
  address is not verified. The link is valid for 24 hours.
- **Reset password** — sent from Forgot password. The link is valid for one
  hour and works once.

Only a SHA-256 hash of each token is stored in `EmailToken`. Passwords are
bcrypt-hashed. The reset action marks the address verified because the link
proves ownership.

## Required environment variables

Set these in Vercel **Production** (and Preview if you want to test email there):

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key with permission to send from the domain |
| `EMAIL_FROM` | Verified sender, e.g. `Spire <no-reply@yourdomain.com>` |
| `EMAIL_REPLY_TO` | Optional reply-to address |
| `APP_URL` | Canonical origin used in links, e.g. `https://chatbot-1-beige.vercel.app` |

Without `RESEND_API_KEY` and `EMAIL_FROM`, production logs
`auth_email_not_configured` and does not send. Development prints the message
locally instead.

## Domain setup

1. Add the sending domain in Resend.
2. Publish the DNS records Resend shows (SPF, DKIM, and DMARC recommended).
3. Verify the domain.
4. Use an address on that domain for `EMAIL_FROM`.
5. Send a test verification and reset to a real mailbox before launch.

## Abuse controls

- Reset requests: 10 per IP per hour, 3 per email per hour.
- Reset submissions: 10 per IP per hour.
- Verification resends: 5 per IP per hour, 3 per account per hour.
- Reset requests always return the same response, so they cannot be used to
  enumerate accounts.
- Tokens are single-use and rate limits are server-side.

## Operational notes

- Email addresses are normalized to lowercase before lookup and storage.
- The reset link does not sign the user in; it only changes the password.
- Existing JWT sessions are not revoked by a password reset. They expire at the
  normal session lifetime. Add server-side session revocation if that becomes a
  requirement.
- Never log the raw token. The sender logs only an event name and provider
  status.
