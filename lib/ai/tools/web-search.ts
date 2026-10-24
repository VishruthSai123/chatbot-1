import { generateText, tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  getGroundingModel,
  getSearchModel,
  toGroundingSources,
} from "@/lib/ai/search/grounding";
import { guestRegex } from "@/lib/constants";

type SearchToolsProps = {
  session: Session;
};

/**
 * A grounded answer is bounded so it cannot swamp the conversation's context.
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
 * Searches the web via OpenRouter.
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
          model: getSearchModel(),
          prompt: [
            "Search the web and answer the following question. Cite the sources and links you used.",
            "If the search does not find a reliable answer, say so plainly rather than guessing.",
            "",
            `QUERY: ${query}`,
          ].join("\n"),
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
 * Reads a web page and extracts its content.
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
        let pageContent = "";
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12_000);
          const res = await fetch(url, {
            headers: {
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const raw = await res.text();
            pageContent = raw
              .replace(
                /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
                ""
              )
              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 25_000);
          }
        } catch {
          // Ignore network errors and let the model know
        }

        const { text } = await generateText({
          model: getGroundingModel(),
          prompt: [
            `Read the web page at ${url} and report its content.`,
            instruction
              ? `Focus on this: ${instruction}`
              : "Summarise it accurately and keep any concrete facts, figures and names.",
            pageContent
              ? `\nEXTRACTED PAGE TEXT:\n${pageContent}`
              : "\n(Note: Direct HTML retrieval was unavailable; please summarize or explain based on known context.)",
          ].join("\n"),
        });

        return {
          content: trim(text),
          sources: [{ title: url, url }],
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
