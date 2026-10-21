# Next-phase plan: Documents, Media, Notebooks, Research

## Capability audit (verified in this repo, not assumed)

| Capability | Status | Consequence |
|---|---|---|
| `googleSearch` tool | ✅ native in `@ai-sdk/google` v4, **Gemini 2+ only** | Web search is ~free — no Brave/Tavily/Exa, no extra key, no scraping infra. **But it only works on Gemini 2 models** (default `gemini-2.5-flash`); a user on DeepSeek gets no grounding, so the feature must be model-aware. |
| `urlContext` tool | ✅ native, Gemini 2+ | "Read this URL" needs no fetcher, no headless browser, no proxy. |
| PDF as model input | ✅ `application/pdf` is a supported media type | The model can read a PDF *directly*. Server-side parsing is only needed for the *studio* (thumbnails, page ops), not for Q&A. |
| Audio as model input | ✅ incl. `audioTimestamp` | Transcription with timestamps is native. No Whisper, no AssemblyAI. |
| Function budget | 9 of 12 used | 3 free. A dedicated downloader function fits. |
| Storage | Supabase, private, signed URLs | Every new family follows the `*-ref:` envelope pattern (`image-ref:`, `pdf-ref:`, `sheet-ref:`). |

**The big consequence:** most of what looks expensive is actually free, because Gemini already does the hard part. The parts that are *not* free are the ones that need native binaries (MP3 encoding, video downloading).

---

## Track 1 — Family 04: Document & Text Studio

**Goal:** open a `.docx`/`.md`/`.txt` in a studio; read, diff, summarise, outline it.

**Native stack:** `mammoth` (DOCX → semantic HTML/Markdown), `diff-match-patch` (already installed) for side-by-side diff, `shiki` for code-block highlighting, Gemini for summarisation.

**Deliverables**
- `lib/doc/` engine: `parseDocx` (mammoth → sanitised HTML + plain text), `parseMarkdown`, `extractOutline` (heading tree), `diffDocuments` (word- and line-level), `readingStats` (words, sentences, read time, speak time)
- `doc-ref:` storage envelope; new artifact kind `doc`
- Tools: `docRead`, `docSummarize`, `docDiff` (two documents), `docOutline`, `docStats`, `docConvert` (docx ⇄ md)
- Studio: outline sidebar, side-by-side diff with change highlighting, reading stats, rendered markdown

**Risks:** `mammoth` is read-only — writing `.docx` back out needs the separate `docx` package, so `docConvert` to DOCX is a v2 item. `shiki` is large-ish; a lazy dynamic import keeps it out of the initial bundle.

---

## Track 2 — Family 05: Audio & Media Studio

**Goal:** open an audio/video file; see a waveform, seek, and get a timestamped transcript.

**Native stack:** `music-metadata` (pure-JS container parser: duration, codec, bitrate, channels, sample rate), Web Audio `decodeAudioData` in the browser for waveform peaks, Gemini `audioTimestamp` for transcription.

**Deliverables**
- `lib/audio/` engine: `readAudioInfo` (music-metadata), `buildPeaks` (client-side), `transcribe` (Gemini, timestamped)
- `audio-ref:` envelope; new artifact kind `audio`
- Tools: `audioInfo`, `audioTranscribe`, `audioClip` (client-side, exports a WAV slice)
- Studio: waveform canvas with click-to-seek, transport controls, transcript panel with click-to-jump timestamps, metadata readout

**Risks:** waveform peaks for a 90-minute file means decoding the whole file in the browser — needs downsampling and a size cap. Gemini's audio input has a per-request size ceiling; long files need chunking.

---

## Track 3 — Social media downloader (BlackHole-style)

**Goal:** paste a link → get MP4 or MP3. YouTube, Instagram, TikTok, Facebook.

**This is the highest-risk track, and the risk is real.** Being straight about it:

1. **There is no good pure-JS downloader.** The de-facto tool is `yt-dlp` — a **Python binary**. JS ports (`ytdl-core`) break on YouTube's signature cipher regularly. So this is a native-dependency problem, not a package-install problem.
2. **MP3 needs ffmpeg** (~70 MB static binary). `yt-dlp -x --audio-format mp3` shells out to it.
3. **Bundle size.** The tools function already carries sharp + ONNX. yt-dlp (~35 MB) + ffmpeg (~70 MB) will not fit alongside it in one 250 MB function. → the downloader needs **its own route = its own function = its own 250 MB budget**. 9 → 10 functions. Fine.
4. **Instagram/TikTok/Facebook are hostile.** Most content is cookie-gated, rate-limited, and their private APIs change without notice. YouTube is the reliable one; the others work "until they don't".
5. **ToS/legal.** Downloading from these platforms violates their terms; redistributing copyrighted material is unlawful. The feature is legitimate for the user's *own* uploads, public-domain and licensed footage. I'd build it that way and not add anything that circumvents DRM or paid-access walls.

**My recommended shape for v1**
- Dedicated `app/api/download` function (own bundle budget)
- `yt-dlp` **standalone binary bundled into that function** (deterministic, no runtime download, ~35 MB) — *or* `youtube-dl-exec` which fetches the binary at runtime (no bloat, slower first hit). I lean toward bundling: reproducible.
- **MP3 without ffmpeg:** download the best *audio-only* stream (m4a/webm/opus), then decode and re-encode **in the browser** — Web Audio `decodeAudioData` + `lamejs` → 128 kbps MP3. Zero extra server bytes, no ffmpeg, and it works.
- Offer: MP4 (1080p/720p/480p), audio-only native, MP3 (client-encoded), thumbnail, title/author/duration metadata
- Then extend the same binary to Instagram/TikTok/Facebook

---

## Track 4 — Notebooks, Research & Web Search (the NotebookLM-style layer)

**Goal:** a *Notebook* = a named set of sources (files, URLs, videos, web pages) + a grounded chat over them + generated artefacts (summary, study guide, FAQ, quiz, timeline) + **"quiz me"** interactive mode.

**Why this is cheap here:** grounding, web search and URL reading are all native Gemini tools (table above). The only real work is *chunking + retrieval + citation plumbing*.

**The retrieval design I recommend — progressive, no new infrastructure**
- **Tier 1 (fits):** if the notebook's total text fits in the model context (Gemini 2.5 Flash = **1M tokens**), put it all in context and cite by source. For a handful of sources this is *better* than retrieval, and it costs nothing extra.
- **Tier 2 (doesn't fit):** chunk (heading-aware for md/docx, page-aware for PDF), rank with a local **BM25** index — hand-rolled, zero infra, zero per-token cost, instant — retrieve top-k, answer with citations.
- **Tier 3 (optional v2):** hybrid with `pgvector` + Gemini embeddings for semantic recall. Needs the Supabase extension enabled and costs embeddings per chunk. Only worth it once Tier 2 shows real recall failures.

**Deep research:** a multi-step agent loop — search → read → note → search again → synthesise. The repo already has `WaitingStatusData` phases; I'd add `researching` / `reading sources` so the UI shows *what it's doing*, not a spinner. `isStepCount(5)` becomes a real step budget.

**Quiz me (the feature you named):** generate MCQ + short-answer from the notebook → ask Q1 → grade the user's answer with Gemini (with the source passage) → Q2 → … → final score + a "weakest topics" breakdown. This is a genuinely delightful feature and it reuses the whole notebook stack.

**Deliverables**
- `lib/notebook/` engine: sources model, chunker, BM25 index, citation assembly
- New artifact kind `notebook` + studio: source list (add/remove, reorder), a sources panel with citations, a deliverables tab
- Tools: `webSearch` (googleSearch), `readUrl` (urlContext), `notebookCreate`, `notebookAsk`, `notebookGenerate` (summary/guide/faq/timeline/briefing), `notebookQuiz`, `research` (multi-step)
- Composer: a notebook picker + a "Deep Research" toggle

**Risk:** grounding metadata plumbing (Google returns `groundingMetadata` with source URLs — needs mapping to UI chips) and citation accuracy for in-context answers.

---

## Sequencing (my recommendation)

```
1. Web search + deep research      (free, high impact, unblocks notebooks)
2. Notebooks + quiz me             (the "wow" — NotebookLM layer)
3. Family 04 document studio       (smallest, reuses diff + mammoth)
4. Family 05 audio studio          (native audio + waveform)
5. Media downloader                (highest risk — do last, with a spike first)
```

The reason for this order: 1 and 2 are the features you described as making the chat "more interesting", they're the cheapest (native tools), and Notebooks then becomes the container for the Document and Audio families' output rather than a separate silo.

---

## What I need from you

Before I start, five decisions that genuinely change the architecture. Everything else I can decide myself and report back.
