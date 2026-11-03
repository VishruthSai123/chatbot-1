import { generateText, Output, tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";

import { getGroundingModel } from "@/lib/ai/search/grounding";
import { guestRegex } from "@/lib/constants";
import { getDocumentById, saveDocument } from "@/lib/db/queries";
import { decodeSlidesRef, encodeSlidesRef } from "@/lib/slides/ref";
import {
  type Deck,
  deckSchema,
  MAX_SLIDES,
  MIN_SLIDES,
  normaliseDeck,
  slideSchema,
} from "@/lib/slides/schema";
import { themeIdFor } from "@/lib/slides/themes";

type SlidesToolsProps = {
  session: Session;
};

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
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
export const slidesCreate = ({ session }: SlidesToolsProps) =>
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
          output: Output.object({ schema: deckSchema }),
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

        const deck = normaliseDeck(output);

        if (deck.slides.length < MIN_SLIDES) {
          return {
            error:
              "The deck came back too short to be useful. Try a more specific topic.",
          };
        }

        const themeId = themeIdFor(theme ?? deck.theme);
        const documentId = crypto.randomUUID();

        await saveDocument({
          content: encodeSlidesRef({ deck, theme: themeId, title: deck.title }),
          id: documentId,
          kind: "slides",
          title: deck.title,
          userId: session.user.id,
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
export const slidesEdit = ({ session }: SlidesToolsProps) =>
  tool({
    description:
      "Rewrite one slide of a presentation. Use it when the user says a specific slide should be shorter, clearer, more formal, or say something else. Returns the updated deck.",
    execute: async ({ documentId, instruction, slideIndex }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to edit a presentation.",
          requiresAuth: true,
        };
      }

      try {
        const document = await getDocumentById({ id: documentId });

        if (!document || document.userId !== session.user.id) {
          return { error: "That presentation could not be found." };
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
          output: Output.object({ schema: slideSchema }),
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
        slides[slideIndex] = output;

        const deck = normaliseDeck({ ...ref.deck, slides });

        await saveDocument({
          content: encodeSlidesRef({
            ...ref,
            deck,
            title: deck.title,
          }),
          id: documentId,
          kind: "slides",
          title: deck.title,
          userId: session.user.id,
        });

        return {
          deck,
          documentId,
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
      documentId: z.string().uuid().describe("The presentation's document id."),
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
