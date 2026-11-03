# Search, Reading, and Capability Discovery

## 1. Why this exists

The chat runs on OpenRouter. Search, URL reading and OCR do not.

A model without a search tool cannot search: asked to "look up the latest
release", it answers from its training data and invents the links. That is
worse than saying nothing, because the answer looks current.

So the grounded half of the app keeps its own Gemini model. Only the work that
*needs* a tool goes through it:

| Work | Model | Why |
| --- | --- | --- |
| Chat, drafting, quizzes, notebooks | OpenRouter (`openrouter/free` or the chosen model) | The conversation model |
| Web search, deep research | Gemini 2.5 Flash + `google_search` | Live results with real citations |
| Reading a URL | Gemini 2.5 Flash + `url_context` | Renders the page the way a browser does |
| OCR | Gemini 2.5 Flash (vision) | A text-only model cannot read an image |

`lib/ai/search/grounding.ts` is the single place that decides this.

## 2. The search path

`lib/search/web.ts` tries two paths in order:

1. **Grounded search.** Gemini runs the query and returns an answer plus the
   pages it used. Best quality: the citations are real and the synthesis
   already knows what the sources said.
2. **Keyless search.** DuckDuckGo's HTML endpoint returns result links, the top
   three pages are read through the address checks below, and the chat model
   answers from that evidence. Slower and plainer, but it needs no key and it
   is still reading real, current pages.

A grounded call that fails — an exhausted key, a quota limit, a transient
error — falls through to the keyless path. The tool returns a `via` field so
the caller can be honest about which path answered.

`research` uses the same function, so a deep-research run behaves the same way.

## 3. The address boundary

`lib/net/page.ts` is the only place the server fetches a URL a user named.

Two stages, because a name alone is not enough:

1. **Before anything is fetched** — the scheme must be `http`/`https`, the host
   must not be a blocked name, and a bare IP must be public.
2. **Before every hop** — the hostname is resolved and the *address* is
   checked. A public name can resolve to `10.0.0.1`, and it can be rebound
   between the check and the request.

Redirects are followed by hand (`redirect: "manual"`) rather than by `fetch`,
because each redirect is a second URL that the first one chose — and it has to
pass the same check before it is followed.

`htmlToText` in `lib/net/html.ts` turns the page into the words a model should
read: scripts, styles, templates and comments are noise.

## 4. Capability discovery

The app has eight families of tools. A blank composer cannot communicate that,
and four generic prompts ("write an essay about Silicon Valley") actively
misrepresent it.

`lib/capabilities.ts` is the catalogue: eight families, one line each, and
three real example prompts per family. It is the single source for:

- the **empty state** (`components/chat/suggested-actions.tsx`) — a grid of
  eight tiles, each opening the panel on that family;
- the **capabilities panel** (`components/chat/capabilities-dialog.tsx`) — the
  map, opened by the ✨ button beside the composer or `/capabilities`;
- the four starter prompts shown under the grid — real tasks that work with no
  attachment and no setup.

Every example is a prompt, not a category name. Clicking one puts it in the
composer, where the user can edit it before sending.

## 5. The audio card

Audio had a studio but no card, so `audioInfo`, `audioTranscribe` and
`audioOpen` produced no visible feedback in the conversation.

`components/chat/audio-tool-card.tsx` is the missing surface: the file's
details (duration, format, bitrate, sample rate, channels), a transcript
preview with an expand control, and a way into the Audio Studio.
