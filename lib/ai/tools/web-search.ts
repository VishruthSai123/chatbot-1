import { generateText, tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getGroundingModelFor } from "@/lib/ai/search/grounding";
import { guestRegex } from "@/lib/constants";
import { getEntitlement } from "@/lib/entitlements";
import { fetchPageText } from "@/lib/net/page";
import { searchWeb } from "@/lib/search/web";
import { QuotaExceededError } from "@/lib/usage/ledger";
import {
  releaseSearchTask,
  reserveSearchTask,
  type SearchReservation,
  settleSearchTask,
} from "@/lib/usage/search";

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
 * Searches the web through Gemini's grounded search.
 *
 * The tool is provider-executed: Gemini runs the query itself and returns both
 * the answer and the pages it used, so the citations are real rather than
 * recalled. That is the whole point — a model asked to "search" without a
 * search tool answers from training data and invents the links.
 */
export const webSearch = ({ session }: SearchToolsProps) =>
  tool({
    description:
      "Search the web once and answer with citations. Use it for a single factual lookup: current news, prices, releases, today's date, live data, documentation, or a fact you cannot vouch for. Do not also call research for the same question. Returns a grounded answer plus the source pages.",
    execute: async ({ query }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to search the web.",
          requiresAuth: true,
        };
      }

      const plan = await getEntitlement(session.user.id);

      let reservation: SearchReservation;
      try {
        reservation = await reserveSearchTask({
          plan,
          userId: session.user.id,
        });
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return {
            code: "quota_exceeded",
            error:
              plan.searchesPerMonth > 0
                ? "You have used your web searches for this period. Local search and on-device tools are still free."
                : "Web search is not included in your plan.",
            kind: error.details.kind,
            limit: error.details.limit,
            period: error.details.period,
            resetAt: error.details.resetAt,
            used: error.details.used,
          };
        }
        throw error;
      }

      try {
        const result = await searchWeb(query, { model: plan.model });

        await settleSearchTask({
          model: plan.model,
          provider: result.via,
          reservation,
          usage: result.usage,
        }).catch((error) => {
          console.error("Search usage settlement failed:", error);
        });

        return {
          answer: trim(result.answer),
          query,
          sources: result.sources,
          via: result.via,
        };
      } catch (error: any) {
        await releaseSearchTask(reservation).catch(() => undefined);
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
 *
 * Gemini's URL context is tried first: it renders the page the way a browser
 * would, so a page built by JavaScript is readable. If that is unavailable, the
 * page is fetched directly — through the same address checks the downloader
 * uses, so a URL cannot point the server at its own network.
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

      const plan = await getEntitlement(session.user.id);

      let reservation: SearchReservation;
      try {
        reservation = await reserveSearchTask({
          plan,
          userId: session.user.id,
        });
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return {
            code: "quota_exceeded",
            error:
              "You have used your web allowance for this period. Local search and on-device tools are still free.",
            kind: error.details.kind,
            limit: error.details.limit,
            period: error.details.period,
            resetAt: error.details.resetAt,
            used: error.details.used,
          };
        }
        throw error;
      }

      try {
        // The page is fetched here, through the address checks, and the model
        // is given its text. No provider tool is involved.
        const page = await fetchPageText(url);
        const { text, usage } = await generateText({
          maxOutputTokens: 700,
          model: getGroundingModelFor(plan.model),
          prompt: [
            `Read the web page at ${page.url} and report its content.`,
            instruction
              ? `Focus on this: ${instruction}`
              : "Summarise it accurately and keep any concrete facts, figures and names.",
            "Do not invent anything that is not on the page.",
            "",
            "EXTRACTED PAGE TEXT:",
            page.text,
          ].join("\n"),
        });

        await settleSearchTask({
          model: plan.model,
          provider: "read",
          reservation,
          usage: {
            cachedTokens: (usage as { cachedInputTokens?: number | null })
              ?.cachedInputTokens,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
          },
        }).catch((error) => {
          console.error("Page-read usage settlement failed:", error);
        });

        return {
          content: trim(text.trim()),
          sources: [{ title: url, url }],
          url,
        };
      } catch (error: any) {
        await releaseSearchTask(reservation).catch(() => undefined);
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
        .describe(
          "What to look for on the page, when the user asked for something specific."
        ),
      url: z.string().min(4).describe("The full URL of the page to read."),
    }),
  });
