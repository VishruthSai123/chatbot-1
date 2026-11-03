# Search, Reading, and Capability Discovery

## 1. One provider, and what it can and cannot do

Everything runs on **OpenRouter free models**. There is no second provider and
no fallback to one: `lib/ai/providers.ts` resolves every model through
OpenRouter, and `@ai-sdk/google` is not a dependency.

That has one important consequence. **None of these models can search the web.**
A model asked to "look up the latest release" without a search tool answers
from its training data and invents the links — which looks current and is
wrong. So searching is not delegated to a model; it is done in the app.

## 2. The search path

`lib/search/web.ts` does three things:

1. **Find pages.** `lib/search/engines.ts` tries providers in order and stops at
   the first that answers:

   | Provider | Needs | Why |
   | --- | --- | --- |
   | Serper | `SERPER_API_KEY` | Google results from an API built for servers |
   | Brave | `BRAVE_SEARCH_API_KEY` | Server-first, generous free tier |
   | Tavily | `TAVILY_API_KEY` | Retrieval-oriented, clean result text |
   | DuckDuckGo HTML | nothing | Works from residential addresses |
   | DuckDuckGo Lite | nothing | A different endpoint, blocked independently |

   The keyless endpoints treat datacenter addresses with suspicion — a
   serverless function is one — so they can answer `403`. That is why the keyed
   providers come first: without a key, search works or not depending on where
   the function runs, and the error says so rather than showing a bare 403.

   Result pages are parsed by `lib/search/duckduckgo-parse.ts` (pure,
   unit-tested): redirect links are unwrapped, duplicates and internal links are
   dropped, and titles and snippets are reduced to text.
2. **Read them.** The top three pages are fetched through the address checks
   below, and their text is extracted.
3. **Answer from them.** The model is given the question and the page text,
   and told to cite the URLs it used and to say plainly when the evidence does
   not answer the question.

`research` uses the same function, so a deep-research run behaves identically.

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

## 4. Images

OCR goes to the vision model (`getVisionModel()` in
`lib/ai/search/grounding.ts`), which defaults to `openrouter/free` and can be
pointed at a specific model with `OPENROUTER_VISION_MODEL`. A text-only model
is never asked to read a picture.

## 5. Capability discovery

The app has eight families of tools. A blank composer cannot communicate that,
and four generic prompts ("write an essay about Silicon Valley") actively
misrepresent it.

`lib/capabilities.ts` is the catalogue: eight families, one line each, and
three real example prompts per family. It is the single source for:

- the **empty state** (`components/chat/suggested-actions.tsx`) — a grid of
  eight tiles, centred with the greeting;
- the **capabilities panel** (`components/chat/capabilities-dialog.tsx`) — the
  map, opened by the ✨ button beside the composer or `/capabilities`;
- the starter prompts shown under the grid — real tasks that work with no
  attachment and no setup.

Every example is a prompt, not a category name. Clicking one puts it in the
composer, where the user can edit it before sending.

## 6. Layout rules

- **Sans only.** `--font-mono` is pointed at the same family as `--font-sans`
  in `globals.css`, so a `font-mono` class cannot introduce a second face.
- **One empty state.** The greeting, the capability grid and the starter
  prompts are a single centred block; the composer sits at the bottom.
- **No fixed widths without a fluid base.** Cards are `w-full max-w-[…]`, so
  they shrink on a phone and stay readable on a desktop.
- **Centred overflow uses `m-auto`,** not `items-center`: a centred flex child
  taller than its container overflows past the top and cannot be scrolled
  back to.
