# Load and failure testing

These scripts are for a **staging** deployment. They are not run by CI and are
not part of the production build. Nothing here should be executed against
production without explicit approval.

## Prerequisites

- A staging deployment with its own Supabase database and storage.
- [k6](https://k6.io/docs/get-started/installation/) on `PATH`.
- A dedicated test account, or a guest session cookie for the read-only test.
- `LOAD_TEST_BASE_URL` set to the staging origin.

The scripts refuse the production alias unless `ALLOW_PRODUCTION_LOAD_TEST=true`
is set explicitly.

## 1. Target check

```powershell
$env:LOAD_TEST_BASE_URL = "https://your-staging-url.vercel.app"
pnpm load:check
```

This performs one `/ping` request. It does not create users or call AI.

## 2. Read-only baseline

```powershell
$env:LOAD_TEST_COOKIE = "authjs.session-token=..."   # optional
$env:RAMP_TO = "25"
pnpm load:api
```

Measured paths: `/`, `/api/models`, `/api/history` when a cookie is supplied,
and `/ping`. Thresholds: under 2% failures, p95 under 2 s, p99 under 5 s.

Increase `RAMP_TO` in steps (25 → 100 → 250 → 500). Record the first point where
database connection errors, 5xx responses, or latency thresholds fail.

## 3. Chat test (paid)

This calls the real provider. Start with one virtual user and a short prompt.

```powershell
$env:LOAD_TEST_BASE_URL = "https://your-staging-url.vercel.app"
$env:LOAD_TEST_COOKIE = "authjs.session-token=..."
$env:CHAT_START_VUS = "1"
$env:CHAT_PEAK_VUS = "5"
$env:CHAT_HOLD_DURATION = "3m"
pnpm load:chat
```

A dedicated test account with a known quota is required; a guest cookie stops
working after three messages by design. Watch:

- provider rate-limit responses (429) and fallback events
- first-token latency and total duration
- usage ledger cost per request
- database connection errors
- function duration limits

Do not increase virtual users until the previous step is clean.

## 4. Failure scenarios

Run each scenario on staging, then restore the environment.

### Invalid primary credential, valid next credential

1. Set `GEMINI_API_KEY` to an invalid value and `GEMINI_API_KEY_NEXT` to a
   valid test key.
2. Redeploy staging.
3. Send one chat request.
4. Expect a successful response and an `ai_credential_fallback` log with
   `fromCredential: 1`.
5. Restore the original environment and redeploy.

### Full provider outage

1. Set both Google credentials to invalid values.
2. Set `AI_FALLBACK_PROVIDER` to an empty value.
3. Send one chat request.
4. Expect a friendly error response, no process crash, and no retry loop.
5. Restore the environment.

### Database unavailable

1. Point the staging `POSTGRES_TRANSACTION_URL` at a closed port.
2. Request `/` and `/api/chat`.
3. Expect controlled failures, not silent success or data corruption.
4. Restore the database URL and confirm the next request recovers.

### Interrupted stream

1. Start a chat request and abort it after the first token.
2. Confirm the original input remains available in the client and a retry does
   not duplicate a billable request.

### Quota bypass

1. Use a guest cookie and send four messages.
2. The fourth must be rejected server-side with the guest-limit response.
3. Repeat by calling `/api/chat` directly, not only through the UI.

### Duplicate submission

1. Submit the same message twice within one second.
2. Confirm the second request does not create a second uncontrolled billable
   generation.

Record each result with the deployment ID, date, environment, expected result,
actual result, and logs (without secrets).
