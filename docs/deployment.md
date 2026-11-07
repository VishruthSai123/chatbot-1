# Deploying to Vercel

## Environment variables

Set these in **Vercel → Settings → Environment Variables**, then **redeploy** —
Vercel does not apply a new variable to a running deployment.

| Variable | Required | What it does |
|---|---|---|
| `POSTGRES_URL` | yes | Supabase Postgres. The session pooler (port 5432) works; the app caps its pool at 3 connections. |
| `AUTH_SECRET` | yes | NextAuth sessions. Also the fallback key for encrypting media sessions. |
| `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` | yes | The single Gemini model used for chat, title and vision. Without one, requests fail with a clear configuration error. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Storage and the browser client. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Storage, browser side. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Storage, server side (signed uploads and reads). |
| `SERPER_API_KEY` | strongly recommended | Web search. Without it search falls back to DuckDuckGo, which answers 403 to datacenter addresses. |
| `MEDIA_COOKIE_SECRET` | optional | Key for encrypting media sessions. Falls back to `AUTH_SECRET`. |
| `YTDLP_PROXY` | optional | Routes yt-dlp through a proxy, which is the fix for YouTube bot-checking the server. |
| `YTDLP_EXTRACTOR_ARGS` | optional | e.g. `youtube:player_client=tv`, to pin a player client. |
| `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` | optional | Alternative search providers. |
| `AI_FALLBACK_PROVIDER` | optional | Set to `openrouter` to enable the explicit fallback. Disabled otherwise. |
| `OPENROUTER_API_KEY` | optional | Only used when `AI_FALLBACK_PROVIDER=openrouter`. |
| `OPENROUTER_FALLBACK_MODEL` | optional | Fallback model id, e.g. `google/gemini-3.5-flash-lite`. |
| `GOOGLE_GENERATIVE_AI_API_BASE` | optional | Proxy or mock base URL for the Google provider. |

## Models

There is exactly one model. It was verified against Google's `models` endpoint
and model card:

| Role | Model id | Notes |
|---|---|---|
| Chat, title and vision | `gemini-3.5-flash-lite` | GA, 1,048,576 input / 65,536 output, image/PDF input, function calling, streaming. $0.30 / $2.50 per 1M tokens. |

Chat uses `thinkingLevel: "low"`; title and OCR use `"minimal"`. There is no
user-facing model picker and no other model in `allowedModelIds`.

## Build

`pnpm build` is:

```
sync-pdfjs-assets → fetch-ytdlp → db:migrate → next build
```

- **`fetch-ytdlp`** downloads a pinned yt-dlp binary (~39 MB) into `.ytdlp/`,
  which `next.config.ts` traces into the two functions that need it. The first
  build after a dependency change therefore takes a minute longer.
- **`db:migrate`** applies the Drizzle migrations. It is idempotent.
- **Type check** runs as part of `next build`. It is strict; a missing
  dependency declaration shows up here as `Cannot find module` even if the
  package is present in a local `node_modules`.

## Functions

The deployment stays inside Hobby's twelve-function limit:

| Function | Purpose |
|---|---|
| `/api/chat` | The conversation and every chat tool |
| `/api/download` | yt-dlp, on its own because of the binary |
| `/api/tools/[family]` | Image, PDF, sheet, document, audio, notebook, media sessions |
| `/api/document` | One document, or the Library list |
| `/api/files/upload` | Signed upload, then complete |
| `/api/auth/*`, `/api/history`, `/api/messages`, `/api/models`, `/api/vote` | Platform routes |

`/api/download` sets `maxDuration = 120`. yt-dlp itself is capped at 100
seconds so a client rotation can never outlive the function.

## PWA

`app/manifest.ts`, `public/sw.js` and `public/icons/` make the app installable.
`proxy.ts` keeps `/.well-known/`, `/manifest.webmanifest`, `/sw.js` and
`/icons/` public — without that, the auth proxy would answer the install checks
with a login redirect.

## Common build failures

| Symptom | Cause |
|---|---|
| `Running TypeScript …` then `Cannot find module "x"` | A package used but not in `package.json`. Locally pnpm hoists it; a clean install does not. |
| `Cannot find module "./Foo"` | An import whose case differs from the file. Windows ignores case; Linux does not. |
| `The Edge Function "proxy" is referencing unsupported module` | `proxy.ts` must stay free of Node-only APIs. |
| Function too large | Check `outputFileTracingIncludes`; the ONNX model chunks and yt-dlp are the big items, and both are traced deliberately. |
