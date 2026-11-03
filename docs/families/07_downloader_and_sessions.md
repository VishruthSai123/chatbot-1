
---

## 6. The Downloader

Downloading a video is a separate concern from playing one, and it has its own
function: `/api/download`.

### The binary

`yt-dlp` is fetched at build time by `scripts/fetch-ytdlp.mjs` into `.ytdlp/`
and traced into the function that needs it. The version is pinned, with the
latest release as a fallback, so a yanked release cannot wedge the build and a
bad release cannot break everyone's deploy.

### The boundary

A download takes a URL from a conversation and hands it to a process that will
fetch it, so the URL is checked in two stages:

1. **Before anything is spawned** — the scheme must be `http` or `https`, the
   host must not be a blocked name, and a bare address in the URL must be a
   public one.
2. **Before the download starts** — the hostname is resolved and the *address*
   is checked. A name can look entirely public and still resolve to
   `10.0.0.1`, and a public name can be rebound to a private address. Only
   checking the address catches that.

### Two shapes of platform

Platforms publish media in two different shapes, and only one of them can be
downloaded as a single file:

| Platform | Shape | Result |
| --- | --- | --- |
| Instagram, TikTok, Facebook | one file carrying picture and sound | one file |
| YouTube | picture and sound as separate streams | two files |

Joining the two streams needs a muxer, and this deployment has no FFmpeg. So
the format expression is chosen from the platform's own description of its
streams, and when the streams arrive apart, **both are kept and both are
offered** — rather than one of them being passed off as the whole thing.

The downloader names its files after the format they came from
(`%(format_id)s.%(ext)s`), and the platform's description of that format says
whether it carries a picture, a sound, or both. That is how a picture and a
sound are told apart when they arrive as separate files: a WebM can be either.

### The MP3

The audio is never transcoded on the server. The browser decodes the stream it
already downloaded and encodes the MP3 locally, so there is no 80 MB binary in
the deployment and the converted file never leaves the user's machine.

---

## 7. Media Sessions

Instagram and Facebook serve most of their videos only to a signed-in visitor.
Rather than pretending otherwise, a user can connect their own session.

### What a session is

The `cookies.txt` a browser extension exports, in Netscape format. It is the
user's own credential for their own content.

### The rules that keep it safe

- The cookies are **encrypted** (AES-256-GCM) before they are stored, with a
  key derived from `MEDIA_COOKIE_SECRET` (falling back to `AUTH_SECRET`).
- They are read **only** for the user who stored them.
- They are **never** logged, **never** returned to the browser, and **never**
  given to the model.
- They are used for that user's own downloads and nothing else.
- The file is written to a temporary directory for the length of one download
  and deleted with it.

### Where it lives

`MediaSession`, one row per user per platform. It is reached through the
shared `/api/tools/media` route — a `GET` lists what is connected, a `POST`
connects or disconnects — so it costs no extra serverless function.

The user connects one from the chat with `/media`.

### YouTube

YouTube serves most videos anonymously, but it bot-checks datacenter addresses:
from a serverless function it often answers "Sign in to confirm you're not a
bot". The user's own YouTube session is the reliable way through, so `youtube`
is one of the platforms a session can be stored for.

### The fix that does not involve the user

Asking every user for their Google session is a bad trade: most will not do it,
and the ones who do are handing a session cookie to an app. The industry answer
is that **the deployment routes its requests through an address YouTube treats
as ordinary** — a residential or dedicated proxy. The public download sites do
exactly this, at their own cost, instead of asking.

So `YTDLP_PROXY` (or the platform's `HTTPS_PROXY`) is honoured on every yt-dlp
call, and it is the first thing the error suggests. Cookies remain available for
a personal deployment, or for a user who wants to download their own content
from a platform that refuses anonymous requests.

### Three smaller things help

- **Client rotation.** YouTube decides whether a request looks human partly by
  which player client it claims to be, and the clients that pass change over
  time. When a bot check fires, the download is retried with `tv`, then
  `web_safari`, then `android_vr` before the user is told anything. Only a bot
  check is retried — a private or removed video fails the same way on every
  client.
- every download is retried (`--retries 3`, `--fragment-retries 3`,
  `--extractor-retries 2`), because datacenter addresses see more transient
  failures;
- `YTDLP_EXTRACTOR_ARGS` lets a deployment pin a player client without a code
  change, e.g. `youtube:player_client=tv`. It is used for the first attempt;
  rotation is the fallback.
