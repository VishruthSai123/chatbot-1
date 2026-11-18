import { generateText, Output, tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { getGroundingModel } from "@/lib/ai/search/grounding";
import { guestRegex } from "@/lib/constants";
import {
  getDocumentById,
  getLatestDocumentByKind,
  saveDocument,
} from "@/lib/db/queries";
import { decodeSlidesRef, encodeSlidesRef } from "@/lib/slides/ref";
import {
  type Deck,
  deckSchema,
  generatedDeckSchema,
  generatedSlideSchema,
  MAX_SLIDES,
  MIN_SLIDES,
  normaliseDeck,
  type Slide,
} from "@/lib/slides/schema";
import { themeIdFor } from "@/lib/slides/themes";
import type { ChatMessage } from "@/lib/types";

type SlidesToolsProps = {
  dataStream?: UIMessageStreamWriter<ChatMessage>;
  session: Session;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/** Opens or refreshes the Slides Studio with the deck a tool just wrote. */
function emitSlidesArtifact(
  dataStream: UIMessageStreamWriter<ChatMessage> | undefined,
  payload: { content: string; documentId: string; title: string }
) {
  if (!dataStream) {
    return;
  }

  dataStream.write({ data: "slides", transient: true, type: "data-kind" });
  dataStream.write({
    data: payload.documentId,
    transient: true,
    type: "data-id",
  });
  dataStream.write({
    data: payload.title,
    transient: true,
    type: "data-title",
  });
  dataStream.write({
    data: payload.content,
    transient: true,
    type: "data-slidesDelta",
  });
  dataStream.write({ data: null, transient: true, type: "data-finish" });
}

/**
 * The rules that make generated copy usable on a slide.
 *
 * A model left to itself writes paragraphs, invents statistics to fill a
 * "stat" layout, and puts six bullets on a slide. These constraints are the
 * difference between a deck and a wall of text.
 */
const COPY_RULES = [
  "You are designing a presentation, not writing an essay.",
  "Fill the schema exactly. Every slide needs a layout and a title.",
  "Headlines are at most 8 words and have no full stop.",
  "Bullets: 3 to 5 per slide, at most 12 words each, no sub-bullets, no full sentences.",
  "Speaker notes: 1 to 3 sentences on what to say, not a repeat of the slide.",
  "Vary the layouts: start with a title slide, use section slides to break the deck, and use bullets for substance.",
  "Use a stat slide only when you have a real number from the material. Use a quote slide only for a real quotation with an attribution.",
  "Never invent a statistic, a quotation or a source. If you do not have one, use a bullets slide instead.",
  "Write in English, in plain language.",
].join("\n");

/**
 * Creates a presentation.
 *
 * The model returns a structured deck rather than prose, so the renderer can
 * guarantee every slide has the content its layout needs.
 */
export const slidesCreate = ({ dataStream, session }: SlidesToolsProps) =>
  tool({
    description:
      "Create a presentation (a deck of slides) about a topic. Use it when the user asks for slides, a deck, a PowerPoint, a presentation or a pitch. Returns a deck that opens in the Slides Studio and can be downloaded as a .pptx file.",
    execute: async ({ audience, slideCount, theme, tone, topic }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to create a presentation.",
          requiresAuth: true,
        };
      }

      const count = Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, slideCount ?? 8));

      try {
        const { output } = await generateText({
          model: getGroundingModel(),
          output: Output.object({ schema: generatedDeckSchema }),
          prompt: [
            COPY_RULES,
            "",
            `TOPIC: ${topic}`,
            audience ? `AUDIENCE: ${audience}` : "",
            tone ? `TONE: ${tone}` : "",
            `SLIDES: exactly ${count}`,
            theme ? `THEME: ${theme}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        });

        const deck = normaliseDeck(output as Deck);

        if (deck.slides.length < MIN_SLIDES) {
          return {
            error:
              "The deck came back too short to be useful. Try a more specific topic.",
          };
        }

        const themeId = themeIdFor(theme ?? deck.theme);
        const documentId = crypto.randomUUID();

        const content = encodeSlidesRef({
          deck,
          theme: themeId,
          title: deck.title,
        });

        await saveDocument({
          content,
          id: documentId,
          kind: "slides",
          title: deck.title,
          userId: session.user.id,
        });

        emitSlidesArtifact(dataStream, {
          content,
          documentId,
          title: deck.title,
        });

        return {
          documentId,
          slideCount: deck.slides.length,
          success: true,
          theme: themeId,
          title: deck.title,
        };
      } catch (error: any) {
        console.error("slidesCreate failed:", error);
        return {
          error:
            error?.message ??
            "The presentation could not be created. Please try again.",
        };
      }
    },
    inputSchema: z.object({
      audience: z
        .string()
        .max(120)
        .optional()
        .describe("Who the deck is for, e.g. 'the board' or 'new engineers'."),
      slideCount: z
        .number()
        .int()
        .min(MIN_SLIDES)
        .max(MAX_SLIDES)
        .optional()
        .describe(
          `How many slides, ${MIN_SLIDES} to ${MAX_SLIDES}. Defaults to 8.`
        ),
      theme: z
        .enum(["mono", "editorial", "bold", "minimal"])
        .optional()
        .describe("Visual theme. Defaults to mono."),
      tone: z
        .string()
        .max(80)
        .optional()
        .describe("e.g. 'concise', 'educational', 'pitch'."),
      topic: z
        .string()
        .min(3)
        .max(400)
        .describe("What the presentation is about."),
    }),
  });

/**
 * Rewrites one slide.
 *
 * Editing a slide rather than regenerating the deck is what makes a generated
 * presentation usable: the other nine slides stay as they were.
 */
export const slidesEdit = ({ dataStream, session }: SlidesToolsProps) =>
  tool({
    description:
      "Rewrite one slide of the latest presentation, or of a specific one by id. Use it when the user says a slide should be shorter, clearer, more formal, or say something else. Omit documentId to edit the deck most recently created or edited. Returns the updated deck.",
    execute: async ({ documentId, instruction, slideIndex }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to edit a presentation.",
          requiresAuth: true,
        };
      }

      try {
        const document = documentId
          ? await getDocumentById({ id: documentId })
          : await getLatestDocumentByKind({
              kind: "slides",
              userId: session.user.id,
            });

        if (!document || document.userId !== session.user.id) {
          return {
            error: documentId
              ? "That presentation could not be found."
              : "There is no presentation to edit yet. Create one first.",
          };
        }

        const ref = decodeSlidesRef(document.content);

        if (!ref) {
          return { error: "That document is not a presentation." };
        }

        const existing = ref.deck.slides[slideIndex];

        if (!existing) {
          return {
            error: `There is no slide ${slideIndex + 1}. The deck has ${ref.deck.slides.length}.`,
          };
        }

        const { output } = await generateText({
          model: getGroundingModel(),
          output: Output.object({ schema: generatedSlideSchema }),
          prompt: [
            COPY_RULES,
            "",
            `DECK: ${ref.deck.title}`,
            `SLIDE ${slideIndex + 1} OF ${ref.deck.slides.length}`,
            `CURRENT SLIDE (JSON): ${JSON.stringify(existing)}`,
            "",
            `WHAT TO CHANGE: ${instruction}`,
            "Return the whole slide, not just the changed part.",
          ].join("\n"),
        });

        const slides = [...ref.deck.slides];
        const rewritten = output as Slide;

        /*
         * A model asked to make a slide "shorter" sometimes drops the content
         * entirely and returns only a title. Keeping the previous body is
         * better than rendering an empty slide: the request was to shorten the
         * copy, not to delete it.
         */
        if (
          rewritten.layout === "bullets" &&
          !rewritten.bullets?.length &&
          existing.layout === "bullets"
        ) {
          rewritten.bullets = existing.bullets;
        }

        if (
          rewritten.layout === "two-column" &&
          (rewritten.columns?.length ?? 0) < 2 &&
          existing.layout === "two-column" &&
          existing.columns?.length === 2
        ) {
          rewritten.columns = existing.columns;
        }

        slides[slideIndex] = rewritten;

        const deck = normaliseDeck({ ...ref.deck, slides });

        const content = encodeSlidesRef({
          ...ref,
          deck,
          title: deck.title,
        });

        await saveDocument({
          content,
          id: document.id,
          kind: "slides",
          title: deck.title,
          userId: session.user.id,
        });

        emitSlidesArtifact(dataStream, {
          content,
          documentId: document.id,
          title: deck.title,
        });

        return {
          deck,
          documentId: document.id,
          slideCount: deck.slides.length,
          success: true,
          theme: ref.theme,
          title: deck.title,
        };
      } catch (error: any) {
        console.error("slidesEdit failed:", error);
        return {
          error:
            error?.message ??
            "That slide could not be rewritten. Please try again.",
        };
      }
    },
    inputSchema: z.object({
      documentId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "The presentation's document id. Omit to edit the most recent deck."
        ),
      instruction: z
        .string()
        .min(3)
        .max(400)
        .describe("What the slide should become."),
      slideIndex: z
        .number()
        .int()
        .min(0)
        .describe("Zero-based index of the slide to rewrite."),
    }),
  });

/** A deck from a tool output, when the card needs one. */
export function deckFromOutput(output: unknown): Deck | null {
  if (!output || typeof output !== "object") {
    return null;
  }

  const candidate = (output as { deck?: unknown }).deck;

  if (!candidate) {
    return null;
  }

  const parsed = deckSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}
