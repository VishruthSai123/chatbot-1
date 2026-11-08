# Quick Search × SuperiorAI — Integration Plan

Status: design proposal (no production code changed yet)
Repos:
- `quick-search/` — native Android launcher/search app (Kotlin, Jetpack Compose)
- root `superiorai` — Next.js chatbot/PWA (the "Bot")

This document answers one question: **how do we put the SuperiorAI chatbot inside Quick Search as a first-class "Bot" scene, with sharing and shortcuts, without breaking Quick Search's search/launcher behavior?**

---

## 1. What each project actually is

### Quick Search (Android)

- Kotlin + Jetpack Compose + Material 3, `minSdk 24`, `targetSdk 37`.
- Two main entry points:
  - `HomeActivity` — the `CATEGORY_HOME` launcher surface, transparent wallpaper backdrop.
  - `MainActivity` — normal launches, share, assistant, web search, process-text, overlay hand-off.
- Root navigation is a 3-value enum, not a nav graph:
  - `RootDestination { WidgetsPanel, Search, Settings }`
  - `NavigationManager.kt` — `MainContent()` → `NavigationContent()` → `AnimatedContent(destination)`.
- There is **no bottom navigation bar today**. The search bar can be moved to the bottom (`bottomSearchBarEnabled`), but that is not a tab bar.
- There is **no WebView** anywhere. `androidx.browser` is already a dependency and is used only for Custom Tabs (`SearchIntents.kt`).
- Existing AI is an **inline AI Search card**: `tools/aiSearch/` talks directly to Gemini / OpenAI / Anthropic / Groq / Meta / OpenCode using a key the user stores in encrypted preferences. It is not a chat product.
- Share support today is minimal: `ACTION_SEND` is registered only for `text/plain`, and shared text simply populates the search field. There is no `image/*`, no `ACTION_SEND_MULTIPLE`, no `EXTRA_STREAM` handling.
- Static shortcuts exist in `res/xml/shortcuts.xml` (voice search, manage apps, widgets, notification history). No dynamic shortcuts, no direct-share targets.
- Release builds currently sign with the **debug** keystore (`app/build.gradle.kts`), which matters for TWA/App Links fingerprints.

### SuperiorAI (Next.js)

- Next.js 16 App Router + React 19 + AI SDK 7, deployed as a PWA.
- Already has:
  - `app/manifest.ts` — name, 192/512/maskable icons, `standalone`, `start_url`, scope.
  - `public/sw.js` — static-asset cache only; never HTML or API.
  - Automatic **guest** auth: `proxy.ts` redirects cookieless requests to `/api/auth/guest`, which creates a real user row + session cookie.
  - Chat persistence in Postgres (Supabase), file uploads to Supabase Storage, SSE streaming from `POST /api/chat`.
  - Text deep link: `?query=` **auto-sends** a message (only text, only once per page mount).
- Missing for a first-class Android/TWA integration:
  - No `/.well-known/assetlinks.json`.
  - `proxy.ts` intercepts `/.well-known/*`, `manifest.webmanifest`, `sw.js`, and icons, so verification/PWA crawlers get redirected.
  - `proxy.ts` drops the query string when it redirects a cold visitor to guest login, so a first-launch deep link loses its `?query=`.
  - No image/attachment deep link, no share target, no JS bridge, no embed/mobile-only shell.
- Auth is Credentials + guest only — **no Google/OAuth provider** — so an Android WebView is not blocked by Google's embedded-WebView OAuth policy today.
- Chat attachments:
  - `POST /api/files/upload` supports sign → PUT → complete, 16 MiB cap, direct-to-Supabase.
  - The composer accepts images, PDFs, docs, sheets, audio, video and builds `file` parts with `documentId`, `url`, `mediaType`, `filename`.
  - Guests can upload, but are rate-limited (10 messages/hour) and some studios/tools require an account.

---

## 2. The important constraint: a TWA cannot be a tab

A Trusted Web Activity is **not a View**. It is a Custom-Tabs protocol where the user's browser app renders the page in its own Activity/window. The native app launches it and cannot embed it inside a Compose screen.

Consequences:

| Requirement | True TWA | Embedded WebView | Custom Tab | Native chat |
|---|---|---|---|---|
| Native bottom nav stays visible while chatting | ❌ | ✅ | ❌ | ✅ |
| One activity / one navigation state | ❌ | ✅ | ❌ | ✅ |
| Browser cookie jar / web push / PWA install | ✅ | ⚠️ no web push | ✅ | ❌ |
| Google OAuth later | ✅ | ❌ (blocked in WebView) | ✅ | via AppAuth |
| Android share intent can feed the composer | ⚠️ via share-target metadata | ✅ direct bridge | ⚠️ | ✅ |
| Maintenance | low Android, high ops (DAL/Play/Chrome) | medium/high native plumbing | lowest | highest |

**Recommendation:** use an **embedded WebView for the Bot tab** (so the native bottom nav and share bridge work), and keep the web app **TWA-installable** so it can also be installed/opened full-screen from a browser or a future standalone launcher. Do not try to put a TWA inside the tab.

If "true TWA" is non-negotiable, the product model changes: the Bot surface is a separate full-screen Activity, and the bottom nav has to be rebuilt **inside the web app**. See §6.

---

## 3. Target product model

```
MainActivity (or HomeActivity)
└─ MainShell
   ├─ bottom NavigationBar:  [ Search ]   [ Bot ]
   ├─ Search scene  = existing SearchRoute + settings gear + widgets swipe
   └─ Bot scene     = ChatScene
                      └─ WebView (SuperiorAI PWA, ?embed=android)
                         + native share intake
                         + native file chooser/camera/download
                         + JS bridge for shared media + last-chat sync
```

### Bottom-nav behavior

- Two items only: **Search** and **Bot** (settings stays inside Search's gear, as today).
- Hide the bar on:
  - onboarding screens,
  - `Settings` and `WidgetsPanel` destinations,
  - overlay mode (`OverlayActivity` composes `SearchRoute` directly),
  - while the IME is visible (optional but recommended, especially for chat),
  - Home/launcher mode if the user chooses the "launcher clean" setting.
- Make it configurable: `Settings → Appearance → Show Bot tab` (default on) and `Bot tab position` if needed.
- Preserve the WebView across tab switches. Recreating it reloads the chat and kills streaming; keep one WebView owned by `MainContent`/`MainActivity` and move it between compositions (`movableContentOf`) or keep the Bot scene in a retained holder.
- Insets: wrap the shell in a `Scaffold` with `contentWindowInsets = WindowInsets(0)`, pass `PaddingValues` to `NavigationContent`, and call `consumeWindowInsets(innerPadding)` so `SearchScreenContent`'s `safeDrawingPaddingWithImeSlide` does not double-pad. Verify:
  - top search bar + bottom nav,
  - bottom search bar + bottom nav,
  - one-handed mode,
  - IME open/closed,
  - transparent wallpaper launcher backdrop.

### Search scene

Keep all current functionality. Add the bot at the top of the result hierarchy:

1. **Empty query / home**
   - A compact "Ask SuperiorAI" card above suggestions: last conversation title + "Continue" + "New chat".
   - Optional quick chips: "Summarize a screenshot", "Ask about this file", "New chat".
2. **Typing**
   - A top-match row: `Ask SuperiorAI: "<query>"` (robot icon, "Chat" subtitle).
   - Tapping it opens the Bot tab with `?draft=<query>` (prefill, not auto-send) or `?query=<query>` (send immediately) depending on the user's "Ask behavior" setting.
   - Enter/submit can use the bot as the primary target when `Bot` is enabled; long-press still exposes normal web engines.
3. **Contextual**
   - Long-press a contact/file/note/calendar result → "Ask SuperiorAI about this" (optional later).
   - `PROCESS_TEXT` selection → "Ask SuperiorAI" sends the selected text into the Bot composer.
4. **AI Search coexistence**
   - Quick Search's inline AI Search and the bot are two different products. Recommendation: keep inline AI Search as a "quick answer" option, but make the Bot the default AI surface. In settings: `AI mode: Native quick answer / SuperiorAI bot` (or remove `DIRECT_SEARCH` from the primary target list when the bot is configured). Do not silently route both; users will be confused about where history lives.

### Bot scene

- Full-height WebView with the existing web chat UI.
- Native top bar options:
  - **Option 1 (least work):** keep the web `ChatHeader` and mobile sidebar sheet inside the WebView; native bar only for tab switching. This is fine because the web sidebar already becomes a bottom sheet on mobile.
  - **Option 2 (more native):** native `TopAppBar` with "New chat", "History", "More"; hide the web header via `?embed=android`; history opens the web sheet through a JS bridge.
  - Recommended start: Option 1 + a thin loading/progress bar; revisit after usability testing.
- Back:
  - If `webView.canGoBack()` → `goBack()`.
  - Else if current tab is Bot → switch to Search tab.
  - Else use the existing `onSearchBackPressed()` / `HomeActivity` no-op behavior.
- External links (Vercel template link, docs, source links) → open in Custom Tabs, not inside the chat WebView.
- Downloads → `DownloadListener`; `blob:` downloads need a JS fetch → base64 → MediaStore fallback. PDFs/images inside the chat should stay in the web viewer.
- File chooser → `WebChromeClient.onShowFileChooser` with `OpenMultipleDocuments` + camera intent via `FileProvider`; respect `acceptTypes` and `multiple`.
- Mic/camera (`getUserMedia`) → `onPermissionRequest` + runtime permissions; only grant to the chatbot origin.
- Offline/error → native error view with Retry; do not show a blank WebView.

### Share / "real image sharing"

Register a dedicated share entry point or extend `MainActivity`:

- `ACTION_SEND` `text/plain` → open Bot tab, prefill the composer (do not auto-send by default). A setting can make text auto-send.
- `ACTION_SEND` `image/*` → open Bot tab, attach image(s) to the composer, focus the input.
- `ACTION_SEND_MULTIPLE` `image/*` → same, capped (e.g. 5 images / 20 MiB total).
- Optional: `application/pdf`, `audio/*`, `video/*` if the product wants file sharing everywhere.
- `ACTION_VIEW` for image/pdf opens from other apps → same intake (optional; avoid hijacking generic image viewing).
- `ACTION_PROCESS_TEXT` → "Ask SuperiorAI" with the selected text.
- Assistant (`ACTION_ASSIST`) → setting: "Assistant opens: Search / Bot".

Pipeline for an image:

```
Gallery/Files → ACTION_SEND image/* → MainActivity
  → read EXTRA_STREAM / clipData (temporary URI grant)
  → ContentResolver.getType; query size
  → copy to cache immediately (bounded stream)
  → downscale/EXIF-strip (long edge ~2048px, JPEG/WebP ~85)
  → hand to ChatScene (token + metadata)
  → WebView page fetches bytes via WebViewAssetLoader (appassets origin)
  → existing uploadFile() → Supabase sign/PUT/complete
  → attachment appears in composer; user types and sends
```

Do **not** pass bitmaps in Intent extras (`TransactionTooLargeException`) and do **not** pass `file://` URIs.

Two clean ways to hand bytes to the web page:

1. **WebViewAssetLoader (recommended).**
   - Native copies the file to `cacheDir/shares/<token>/file.jpg` and serves it at `https://appassets.androidplatform.net/share/<token>/file.jpg` with `Access-Control-Allow-Origin: https://<chat-host>`.
   - The page reads `?share=<token>`, fetches the appassets URL, constructs a `File`, and calls the existing `uploadFile(file, { chatId })`.
   - Auth remains entirely in the WebView session; native never needs the session cookie.
2. **JS bridge + base64 (fallback).**
   - Only for small images; base64 inflates 33% and `evaluateJavascript` is not a file channel. Not recommended beyond tiny payloads.

For text, pass `?draft=<encoded>` (new web param) rather than `?query=` so the user can edit before sending. Add a `?shareToken=`/`?share=` param for files.

### Shortcuts and system integration

Add all of these; each is independently useful:

1. **Static app shortcut** `new_chat` → `ACTION_OPEN_NEW_CHAT` on `MainActivity` → open Bot tab with a fresh chat.
2. **Static app shortcut** `ask_superiorai` → open Bot tab with the keyboard focused (optionally voice input).
3. **Dynamic shortcuts** for the last 3–5 chats (`ShortcutManagerCompat.pushDynamicShortcut`), so long-pressing the icon shows "Continue: <title>".
4. **Direct Share** (optional): sharing shortcuts with categories so the bot appears as a share target for recent conversations.
5. **Quick Search result** `Ask SuperiorAI: <query>` (top match) + alias `bot`/`@bot`.
6. **PROCESS_TEXT** "Ask SuperiorAI" for selected text anywhere.
7. **Assistant role**: if Quick Search is the default assistant, setting "Open Bot on assistant gesture" (or "Search first").
8. **Quick Settings tile / widget** (later): "New chat", "Ask".
9. **App Links** `https://<host>/chat/<id>` → Bot tab (requires `assetlinks.json` and `android:autoVerify`, separate from TWA verification).
10. **Share target** for images/text (the most important one for "share and chat").

### Settings

Add a `SuperiorAI` settings detail (new `SettingsDetailType` or a section inside AI settings):

- Enable Bot tab (default on).
- Chat server URL (default `https://chatbot-1-beige.vercel.app`; advanced users can point at self-hosted).
- Open behavior: prefill vs auto-send for shared text.
- Assistant launch: Search / Bot.
- Ask from search: show top match / default submit target.
- Account: "Sign in" (opens the web `/login`), "Sign out", "Clear chat data and cookies".
- Storage: "Clear cached shared files".
- Privacy notice: chat content is sent to the self-hosted/hosted backend; guest session is a server-side identity.
- Optional: "Open in browser" / "Install app" (PWA/TWA).

---

## 4. Android implementation map (recommended WebView path)

### Navigation / shell

| Change | File(s) |
|---|---|
| Add `RootDestination.Bot` | `app/navigation/NavigationManager.kt` (`RootDestination`, ~line 59) |
| New two-tab shell + `NavigationBar` | **new** `app/navigation/MainSceneShell.kt`; call around `NavigationContent` in `MainContent` |
| Keep Search as first tab | `MainContent` initial destination / `NavigationRequest` handling |
| Hide nav for Settings/Widgets/onboarding/overlay | condition in the shell; `OverlayRoot.kt` is unaffected because it calls `SearchRoute` directly |
| Preserve WebView across tabs | `movableContentOf` or a retained `ChatWebViewStore` owned by `MainContent` |
| Bottom insets | `Scaffold(contentWindowInsets = WindowInsets(0))` + `consumeWindowInsets(innerPadding)`; verify `SearchScreenContent.kt` (bottom padding ~433–453) and `SearchScreenBottomChrome.kt` (156–203) |

> `NavigationManager.kt` is already 784 lines and the repo enforces ≤800 lines per Kotlin file. Put the shell and Bot scene in new files. Same for `SearchRoute.kt` (795) and `SearchScreenContent.kt` (800).

### Bot scene

New files:

```
app/chat/ChatScene.kt              // Compose host + state
app/chat/ChatWebView.kt            // WebView factory/config/client/chrome client
app/chat/ChatWebViewStore.kt       // retained WebView + state
app/chat/ShareIntake.kt            // URI validation, copy, downscale
app/chat/ShareAssetProvider.kt     // WebViewAssetLoader for shared files
app/chat/ChatBridge.kt             // WebMessageListener (draft/attachments/last chat)
app/chat/ChatPreferences.kt        // server URL, tab enabled, share behavior
app/navigation/MainSceneShell.kt   // bottom nav
```

WebView configuration (baseline):

```kotlin
settings.javaScriptEnabled = true
settings.domStorageEnabled = true
settings.databaseEnabled = true
settings.allowFileAccess = false
settings.allowContentAccess = false
settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
settings.loadsImagesAutomatically = true
settings.mediaPlaybackRequiresUserGesture = false // only if voice/media needs it

CookieManager.getInstance().setAcceptCookie(true)
// persist the authjs session cookie; flush on activity pause
```

Client rules:

- `shouldOverrideUrlLoading`: allow only `https://<chat-host>` inside the WebView; everything else → `CustomTabsIntent` (reuse `SearchIntents.openUrlInCustomTabsOrFallback`).
- `onReceivedSslError`: `handler.cancel()` — never proceed.
- `onShowFileChooser`: `OpenMultipleDocuments` / `GetContent` + camera; pass `acceptTypes`.
- `onPermissionRequest`: grant only for the chat origin, and only after Android runtime permission.
- `DownloadListener`: http/https via `DownloadManager`; `blob:` via JS bridge later.
- `onPageFinished`: inject only a tiny `window.__SUPERIORAI_ANDROID__ = true` flag if needed; avoid DOM surgery. Prefer a web-side `?embed=android` mode.
- No `addJavascriptInterface`. Use `WebViewCompat.addWebMessageListener` with an explicit allowed-origin set.

### Share intake

- Manifest: add `ACTION_SEND` filters for `image/*`, `application/pdf`, `audio/*`, `video/*` (as desired) and `ACTION_SEND_MULTIPLE` for `image/*`; add a separate exported `ShareToChatActivity` if you want a cleaner share sheet label ("SuperiorAI") rather than "Quick Search".
- `MainActivity`:
  - new `extractSharedContent(intent): SharedContent(text, uris, mimeTypes)`
  - handle `EXTRA_STREAM`, `clipData`, `EXTRA_TEXT`, `EXTRA_TITLE`
  - pass into `ChatScene`/`MainContent` via a state holder or a navigation request with a `shareId`
- `OverlayModeController` only needs to forward text; images can force a normal launch (recommended, overlay is not a good image composer).
- Copy URIs immediately; the grant is temporary. Persist pending shares across process death (small metadata JSON + cache file).
- Downscale images before upload; HEIC → JPEG for compatibility; strip EXIF.

### Search integration

- Add a `TopMatchItem.Chat` (or equivalent) in `TopMatchesSection.kt`:
  - `buildTopMatches` inserts it with a high priority when the query is non-blank and the bot is enabled.
  - `TopMatchesRendering.kt` renders a robot icon + "Ask SuperiorAI" subtitle.
  - `openTopMatch` opens the Bot tab with `draft`/`query`.
- Or, simpler first step: add a `SearchEngine` entry `SUPERIOR_AI` with a special handler that opens the Bot tab. This automatically gets an alias and a settings toggle, but not a top-match row.
- Recent chats: v1 can show "Continue last chat" from a locally cached `chatId/title` (updated by the JS bridge). v2 can call `/api/history` with the WebView cookie jar or render recents in the Bot scene.
- Aliases: reserve `bot`, `ai`, `ask` (check collision with existing `dsh` / AI mode aliases).

### Shortcuts

- `res/xml/shortcuts.xml`: add `new_chat` and `ask_superiorai` entries with explicit `MainActivity` intents.
- `MainActivity` companion: add `ACTION_OPEN_NEW_CHAT`, `ACTION_OPEN_BOT`, `EXTRA_CHAT_QUERY`, `EXTRA_CHAT_DRAFT`.
- `handleIntentAfterImportClassification`: route these before/next to the existing shortcut handling (~lines 583–602).
- Dynamic shortcuts: new `ChatShortcutManager` using `ShortcutManagerCompat`; update after each chat open/send (bridge callback), keep at most 4, `setLongLived(true)`.
- Direct Share: only if desired; requires share-target shortcut categories and careful intent design.
- Assistant: `ACTION_ASSIST` currently ignores text and only starts voice. Add a preference and branch:
  - `Assistant → Search` (current behavior)
  - `Assistant → Bot` (open Bot scene, optionally voice)
- `PROCESS_TEXT`: change "Quick Search" label/behavior to "Ask SuperiorAI" (or add a second activity alias) so selection doesn't always fill the search field.

### Lifecycle / performance

- Build the WebView lazily on first Bot visit, but keep it alive after that.
- Preload after first draw only if the user has opened Bot before (avoid startup cost for search-first users).
- `onPause`: `webView.onPause()`; `CookieManager.flush()`; do not destroy.
- `onResume`: `webView.onResume()`.
- Process death: restore last URL and draft; a streaming response cannot be resumed (the app has no working `/api/chat/[id]/stream` route) — re-fetch messages via `/api/messages` and show "response interrupted".
- Do not clear WebView cookies when the app is backgrounded; the guest session is the account.

---

## 5. Web app changes (SuperiorAI)

These are small but required for a good embedded experience.

### 5.1 Preserve deep-link query on guest bootstrap

`proxy.ts` currently does:

```ts
const redirectUrl = encodeURIComponent(new URL(request.url).pathname);
```

Change to preserve `search` (and maybe `hash` is not sent to server):

```ts
const url = new URL(request.url);
const redirectUrl = encodeURIComponent(url.pathname + url.search);
```

Also skip the auth redirect for paths that must be public:

- `/.well-known/*`
- `/manifest.webmanifest`
- `/sw.js`
- `/icons/*`
- `/favicon.ico`
- `/robots.txt`, `/sitemap.xml`
- the share-target route (if added)
- `/api/auth/*`, `/ping` (already)

Without this, Chrome/DAL verification, PWA install checks, and cold-start deep links are unreliable.

### 5.2 Add an embed/mobile mode

Add `?embed=android` (or detect `window.__SUPERIORAI_ANDROID__` + UA):

- Hide desktop-only sidebar behavior where it conflicts with the native tab bar; keep the mobile sidebar bottom sheet.
- Remove the Vercel "Deploy" link and other external promos in the header.
- Ensure `100dvh` and `visualViewport` handle the native bottom bar + IME. Add bottom padding only when the native bar is expected to overlay; with the Compose `Scaffold` the WebView is already shorter, so avoid double padding.
- Keep the chat composer above the keyboard; test Android 13/14/15 resize behavior.
- Add `env(safe-area-inset-*)` handling for gesture navigation.
- Add a small `data-embed` class on `<body>` so CSS can adapt.

### 5.3 Add draft + share parameters

In `hooks/use-active-chat.tsx` (currently `?query=` at ~287–303):

- `?query=` — keep auto-send (existing behavior).
- `?draft=` — put text into the composer via `setInput` / localStorage, do not send.
- `?chat=<uuid>` — open an existing chat.
- `?new=1` — force a new chat (fresh UUID).
- `?share=<token>` — fetch shared files from the appassets origin, upload with the existing `uploadFile`, add to attachments, focus the composer. Do not auto-send.
- `?source=android` — analytics-free marker for layout/debug.

For a native WebView, the page can also receive a bridge message:

```ts
window.SuperiorAIAndroid?.postMessage({ type: "getSharedFiles" })
```

Prefer URL + appassets for files; use the bridge only for small control messages (new chat, open history, last chat id).

### 5.4 Add a mobile/TWA-ready web shell (only if true TWA is chosen)

If the Bot is a standalone TWA rather than an embedded WebView, the web app needs its own bottom nav:

- `Search` → deep link `superiorai://search` or closes the TWA.
- `Bot` → `/`.
- Match Quick Search's colors/spacing so the transition feels like one app.
- Add a TWA `share_target` + service-worker POST handler or native trampoline.

This is the "Path B" in §6. Do not do both a native bottom nav and a web bottom nav at the same time.

### 5.5 TWA/install readiness (keep even if using WebView)

- Add `public/.well-known/assetlinks.json` (served by Next; ensure it is not blocked by the proxy).
- Content:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.tk.quicksearch",
    "sha256_cert_fingerprints": ["<PLAY_APP_SIGNING_SHA256>", "<DEBUG_SHA256>"]
  }
}]
```

- Include `com.tk.quicksearch.debug` and the F-Droid certificate if that flavor must verify.
- The release build currently signs with `signingConfigs.getByName("debug")`. Fix release signing before shipping; add the **Play App Signing** fingerprint, not just the upload key.
- Add `id`, `screenshots`, `shortcuts`, and optionally `display_override` to the manifest.
- Consider removing `orientation: "portrait-primary"` if tablet/landscape matters.
- Update `metadataBase` (`app/layout.tsx`) and the OpenRouter `HTTP-Referer` if the host changes from `chatbot-1-beige.vercel.app`.

### 5.6 Auth / session

- Keep guest auth; it is the right default for a share-to-chat flow (no login wall).
- Persist the WebView cookie jar. Do not copy the `HttpOnly` session cookie into native code.
- If users sign in with email/password, the session persists in the same WebView. There is no OAuth provider today, so WebView is safe.
- Add a native "Sign in" row that opens the web `/login` inside the Bot WebView (not an external browser, or the session won't be in the WebView).
- Add "Sign out" + "Clear chat data" that clears WebView cookies/storage and local cache.
- Guest chats are not migrated to a new account. If account migration matters, add a `guest → account` endpoint later.

### 5.7 BotID / rate limits

- `POST /api/chat` is protected by BotID. A real WebView is a browser and should pass, but test on a release build. If it fails, exempt the Android embed origin/UA carefully or add a signed app token.
- Guests are limited to 10 messages/hour. If the Bot becomes the primary search AI, consider a higher entitlement or a server-side app token.
- File uploads: 16 MiB per file; the Vercel multipart fallback is 4 MiB. Use the direct sign → PUT → complete path for images.

---

## 6. Path B — if "true TWA" is mandatory

Architecture:

```
Quick Search (native)                    SuperiorAI PWA (TWA)
┌────────────────────────┐   launch    ┌─────────────────────────────┐
│ bottom nav: Search|Bot │ ──────────▶ │ web bottom nav: Search|Bot  │
│ Search = native        │             │ Chat = web                  │
│ Bot = ChatTwaActivity  │ ◀────────── │ "Search" → close/deep link  │
└────────────────────────┘             └─────────────────────────────┘
```

What it requires:

- `androidx.browser` + `com.google.androidbrowserhelper:androidbrowserhelper` (2.7.4).
- `ChatTwaActivity` (`LauncherActivity` subclass) with:
  - `android.support.customtabs.trusted.DEFAULT_URL` → `https://<host>/?embed=twa`
  - `VIEW`/`BROWSABLE` intent filter for the host, `autoVerify="true"`
  - `asset_statements` metadata
  - `DelegationService` for share target/notifications
  - `FALLBACK_STRATEGY=customtabs` (or webview)
  - splash screen + status/nav bar colors matching Quick Search
- Web app:
  - web bottom nav (Search | Bot),
  - `share_target` + `/share-target` route or service-worker interception,
  - `?embed=twa` layout,
  - assetlinks + proxy exclusions.
- Sharing:
  - TWA `share_target` metadata (Android side) + `DelegationService` + `POST /share-target`.
  - Service worker intercepts, uploads directly to Supabase (bypasses Vercel 4.5 MB limit), redirects to `/chat?attach=<documentId>`.
  - Or native `ShareToChatActivity` uploads with a scoped token and launches the TWA at `/chat?attach=...`.
- Shortcuts:
  - Static shortcut opens `ChatTwaActivity` (not WebView).
  - Dynamic recent chats can still be `ShortcutManagerCompat` intents.
  - App Links open the TWA.
- Tradeoffs:
  - No native bottom nav while chatting; the web nav must be perfect.
  - Activity transition/splash; back stack is browser-owned.
  - Separate cookie jar from any WebView; choose one surface and stay on it.
  - TWA verification is an ongoing operational task: Play signing key, assetlinks, Chrome version, DAL re-verification, manifest quality. If DAL fails, users see a Custom Tab with a URL bar.
  - Web push becomes possible (DelegationService); WebView cannot do web push.
  - Google OAuth becomes possible later; WebView cannot.
  - Share target is more complex and capped by serverless body limits unless SW uploads directly.
- When to choose it:
  - The product is web-first and Quick Search is only a launcher shell.
  - You need web push or OAuth.
  - You accept a web-owned bottom nav and two-surface UX.
  - You want a separate "SuperiorAI" installable app rather than an in-app tab.

If you want a single app with a persistent native nav, **do not choose TWA**. Choose WebView now; you can add a TWA launcher later for full-screen/push without changing the in-app tab.

---

## 7. Phased delivery

### Phase 0 — Web foundation (1–2 days)

- Fix `proxy.ts` query preservation + public paths.
- Add `?draft=`, `?chat=`, `?new=`, `?embed=android` handling.
- Add mobile CSS/safe-area polish and hide desktop promos in embed mode.
- Add `assetlinks.json` route/file (even if TWA is later).
- Test guest cold start with a deep link, file upload, and login persistence in an Android WebView.

### Phase 1 — Native Bot scene (3–5 days)

- `RootDestination.Bot`, `MainSceneShell`, bottom nav, settings toggle.
- `ChatScene` + `ChatWebView` with security, cookie persistence, back, file chooser, external links, progress/error states.
- Preserve WebView across tabs.
- Verify insets with top/bottom search bar, one-handed mode, IME, launcher wallpaper.

### Phase 2 — Sharing (2–4 days)

- Manifest `ACTION_SEND`/`SEND_MULTIPLE` image/text.
- `ShareIntake` (copy, validate, downscale, EXIF strip).
- `WebViewAssetLoader` + web `?share=` upload/attachment flow.
- Text `?draft=`.
- Optional `ACTION_PROCESS_TEXT` → "Ask SuperiorAI".
- Process-death restore + cache cleanup.

### Phase 3 — Search + shortcuts (2–4 days)

- "Ask SuperiorAI" top match + empty-state card.
- Alias `bot`/`@bot`.
- Static shortcuts + handling.
- Dynamic recent-chat shortcuts.
- Assistant preference (Search/Bot).
- Settings detail + account/clear-data rows.
- Optional Quick Settings tile / widget entry.

### Phase 4 — Polish (2–3 days)

- Preload/warm-up if used before.
- Offline/retry, download handling, blob downloads.
- Analytics-free diagnostics; privacy strings.
- Play Store policy review (QUERY_ALL_PACKAGES already exists; don't add broad file permissions).
- Accessibility: content descriptions, TalkBack, keyboard/IME.

### Phase 5 — Optional true TWA (3–5 days + ops)

- Only if chosen. Add `androidbrowserhelper`, `ChatTwaActivity`, assetlinks, share target, web bottom nav, push delegation.

---

## 8. Decisions needed before coding

1. **Bot tab implementation:** embedded WebView (recommended) or true TWA full-screen Activity?
2. **Search submit behavior:** does Enter go to the bot, or stay on regular web search with "Ask SuperiorAI" as a separate row?
3. **Share behavior:** prefill the composer (recommended) or auto-send the shared text/image?
4. **Existing AI Search:** keep both, make Bot the default, or replace inline AI Search entirely?
5. **Hosting domain:** keep `chatbot-1-beige.vercel.app` or move to a branded domain (required for a polished TWA/App Links setup)?
6. **Launcher behavior:** show the bottom nav on the Home screen, or only in normal launches? Hide it while typing?
7. **Account:** guest-only for v1, or surface sign-in and chat migration?
8. **File types:** images only, or also PDFs/docs/audio/video in the share sheet?

---

## 9. Risks / gotchas checklist

- [ ] `proxy.ts` drops query on guest redirect → deep-linked text lost.
- [ ] `proxy.ts` intercepts `/.well-known/assetlinks.json`, manifest, SW, icons → TWA/PWA verification fails.
- [ ] Release signing uses debug keystore; Play App Signing fingerprint must be in assetlinks.
- [ ] F-Droid flavor has a different signing cert; either add it or exclude TWA from fdroid.
- [ ] WebView and Chrome have separate cookie jars; pick one chat surface for a given user.
- [ ] WebView has no Web Push/Notification API; plan FCM if push matters.
- [ ] Google OAuth (if added later) is blocked in WebView; need Custom Tabs/AppAuth.
- [ ] BotID may reject an embedded WebView; test production builds.
- [ ] Guest rate limit (10/hour) may be too low for a primary AI surface.
- [ ] Vercel's 4.5 MB body limit; use direct Supabase sign/PUT for images.
- [ ] Android Intent extras ~1 MB; never pass bitmaps.
- [ ] Image URI grants are temporary; copy immediately.
- [ ] Do not double-apply bottom insets (Scaffold + safeDrawingPadding).
- [ ] Preserve WebView across tab switches or streaming dies.
- [ ] `NavigationManager.kt` (784), `SearchRoute.kt` (795), `SearchScreenContent.kt` (800) are at the 800-line guardrail; put new code in new files.
- [ ] `SearchSectionRegistry` requires matching `SearchSectionUiMetadata`, preferences, backup, and strings if a full section is added. A TopMatch row avoids that.
- [ ] All new user-facing strings must be added to `values/strings.xml` + 16 localized files, and `StringResourceParityTest` must pass.
- [ ] Overlay mode bypasses the shell; sharing an image from overlay should force a normal launch.
- [ ] Home re-launch currently forces `RootDestination.Search`; decide whether to preserve the last Bot tab or always reset to Search.

---

## 10. Bottom line

- The product shape is right: **Search first, Bot one tap away, share straight into chat.**
- Technically, the Bot tab must be an **embedded WebView**, not a TWA. A TWA is a separate browser Activity and would remove the native bottom nav.
- Keep the web app TWA-installable and share-target-ready, but ship the in-app tab as WebView. This gives the best of both: native shell + web chat, without a dual-app feel.
- The highest-value first slice is: bottom nav + Bot WebView + text/image share intake + `Ask SuperiorAI` top match + `new_chat` shortcut. That is a usable product; history sync, dynamic shortcuts, TWA, push, and OAuth can follow.

---

## 11. Implementation status (this workspace)

### Android (quick-search/)

- Removed the bottom navigation bar. Bot opens from the circular chat button beside the search bar's voice action, the chat button on the Open Keyboard pill, and the **Ask SuperiorAI** row.
- Added RootDestination.Bot and the embedded WebView scene (ChatScene.kt, ChatWebViewStore.kt).
- The WebView is owned above the destination and survives leaving the scene, so a streaming chat is not reloaded.
- Added a native Material 3 top bar with back-to-search, title, history, new chat, and a determinate/indeterminate loading bar.
- Added a shimmering chat skeleton while the page loads, plus a retry error state.
- The web header is hidden in `?embed=android`; the native top bar owns that chrome.
- Added the **Ask SuperiorAI** row above the search result list (BotAskRow.kt), aligned to the same content width as other result components; it opens the Bot with the current query.
- Added Android share intake for text, images, and PDFs (ChatIntentParser.kt, ChatShare.kt), including a WebViewAssetLoader-style appassets bridge for images. Text-only shares use the existing live ?query= path; image shares use the new ?share= hand-off.
- Added static launcher shortcuts **New chat** and **Ask SuperiorAI** (es/xml/shortcuts.xml).
- Added App Links handling for https://chatbot-1-beige.vercel.app/chat/*.
- Added WebView security defaults: HTTPS host allowlist, external links in Custom Tabs, file/content access off, mixed content blocked, SSL errors fail closed, WebMessage not exposed, file chooser via SAF.
- Session cookies are persisted on activity pause.
- Added English fallback strings to all 16 locales (parity passes).
- Debug APK: quick-search/app/build/outputs/apk/standard/debug/app-standard-debug.apk`n
### Web (root SuperiorAI)

- proxy.ts: preserves query strings through guest bootstrap and keeps /.well-known, manifest, service worker, icons, robots, sitemap public.
- use-active-chat.tsx: supports ?draft= (prefill), ?share=<token> (fetch shared files from https://appassets.androidplatform.net, upload via the normal attachment pipeline, then attach to the composer), and ?embed=android.
- components/chat/shell.tsx: appends Android shared attachments to the composer.
- public/.well-known/assetlinks.json: debug/local signing fingerprint for com.tk.quicksearch and com.tk.quicksearch.debug (add the Play App Signing fingerprint before publishing).
- pp/globals.css: embed-mode cleanup for the WebView shell.

### Remaining deployment step

The Android **text share / Ask / Bot tab** paths work against the current live site. **Image/PDF sharing** also has a compatibility bridge: when the deployed web build does not handle `?share=` yet, the WebView feeds the files into the existing composer file input. Deploying this web change is still recommended because it is cleaner, faster, and handles shared captions/PDF metadata directly. The `assetlinks.json` needs the Play App Signing SHA-256 if App Links/TWA verification is required on Play-distributed builds.

