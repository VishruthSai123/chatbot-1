import { generateText, tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  getGroundingModel,
  googleSearchTool,
  googleUrlContextTool,
  toGroundingSources,
} from "@/lib/ai/search/grounding";
import { guestRegex } from "@/lib/constants";

type SearchToolsProps = {
  session: Session;
};

/**
 * A grounded answer is bounded so it cannot swamp the conversation's context.
 *
 * The full answer is still worth returning — it is the substance the model
 * reasons over — but a runaway search summary would crowd out the rest of the
 * conversation, so it is trimmed to a generous but finite length.
 */
const MAX_ANSWER_CHARS = 12_000;

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Trims an answer to a bounded length without cutting a word in half.
 */
function trim(text: string): string {
  if (text.length <= MAX_ANSWER_CHARS) {
    return text;
  }

  const cut = text.slice(0, MAX_ANSWER_CHARS);
  const lastBreak = cut.lastIndexOf(". ");

  return `${lastBreak > MAX_ANSWER_CHARS * 0.6 ? cut.slice(0, lastBreak + 1) : cut}…`;
}

/**
 * Searches the web.
 *
 * The search itself is Gemini's: the model is given the search tool and the
 * question, and returns an answer together with the pages it used. That is why
 * the result carries citations — they are not scraped afterwards, they are the
 * grounding the answer was written from.
 */
export const webSearch = ({ session }: SearchToolsProps) =>
  tool({
    description:
      "Search the web and answer with citations. Use it for anything that may have changed or that you are not certain about: current news, prices, releases, today's date, live data, documentation, or a fact you simply cannot vouch for. Returns a grounded answer plus the source pages.",
    execute: async ({ query }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to search the web.",
          requiresAuth: true,
        };
      }

      try {
        const { sources, text } = await generateText({
          model: getGroundingModel(),
          prompt: [
            "Answer the following using web search. Cite the pages you used.",
            "If the search does not find a reliable answer, say so plainly rather than guessing.",
            "",
            query,
          ].join("\n"),
          tools: { google_search: googleSearchTool() },
        });

        return {
          answer: trim(text),
          query,
          sources: toGroundingSources(sources),
        };
      } catch (error: any) {
        console.error("webSearch failed:", error);
        return {
          error:
            error?.message ??
            "The search could not be completed. Please try again.",
        };
      }
    },
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .max(2000)
        .describe("The question to research, as a complete question."),
    }),
  });

/**
 * Reads a web page.
 *
 * Gemini's URL context fetches and reads the page itself, which handles the
 * awkward parts of real pages — script-rendered content, redirects, PDFs served
 * from a link — that a hand-written fetcher would get wrong.
 */
export const readUrl = ({ session }: SearchToolsProps) =>
  tool({
    description:
      "Read a web page and report what it says, quoting the parts that matter. Use it when the user gives a URL and wants its content explained, summarised, compared, or extracted — or when you need the page itself rather than a search result.",
    execute: async ({ instruction, url }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to read web pages.",
          requiresAuth: true,
        };
      }

      try {
        const { sources, text } = await generateText({
          model: getGroundingModel(),
          prompt: [
            `Read the web page at ${url} and report its content.`,
            instruction
              ? `Focus on this: ${instruction}`
              : "Summarise it accurately and keep any concrete facts, figures and names.",
          ].join("\n"),
          tools: { url_context: googleUrlContextTool() },
        });

        return {
          content: trim(text),
          sources: toGroundingSources(sources),
          url,
        };
      } catch (error: any) {
        console.error("readUrl failed:", error);
        return {
          error:
            error?.message ?? "That page could not be read. Please try again.",
        };
      }
    },
    inputSchema: z.object({
      instruction: z
        .string()
        .max(500)
        .optional()
        .describe("What to focus on, e.g. 'the pricing table'."),
      url: z
        .string()
        .url()
        .describe("The full http(s) URL of the page to read."),
    }),
  });
