import {
  generateObject,
  generateText,
  tool,
  type UIMessageStreamWriter,
} from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  type GroundingSource,
  getGroundingModel,
  googleSearchTool,
  googleUrlContextTool,
  toGroundingSources,
} from "@/lib/ai/search/grounding";
import { guestRegex } from "@/lib/constants";
import type { ResearchRun } from "@/lib/research/ref";
import { findResearchRun, saveResearchRun } from "@/lib/research/store";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";

type ResearchToolsProps = {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
};

type ResearchDepth = "quick" | "standard" | "thorough";

/**
 * How much work each depth buys.
 *
 * The counts are deliberately modest. Each search and each page read is a real
 * model call with a real latency, and a report built from six pages is not
 * meaningfully better than one built from four — but a "thorough" run that takes
 * two minutes is a run the user will not wait for.
 */
const DEPTH_BUDGET: Record<
  ResearchDepth,
  { pagesToRead: number; queries: number }
> = {
  quick: { pagesToRead: 0, queries: 1 },
  standard: { pagesToRead: 3, queries: 3 },
  thorough: { pagesToRead: 5, queries: 5 },
};

/** How much of one page is kept for the synthesis step. */
const SNIPPET_CHARS = 3000;

function checkIsGuest(session: Session): boolean {
  return (
    session.user?.type === "guest" || guestRegex.test(session.user?.email ?? "")
  );
}

/**
 * Reports what the research is doing right now.
 *
 * A deep-research run takes long enough that a silent spinner reads as a
 * hang. Saying "searching…" then "reading 3 sources…" then "writing the
 * report" is the difference between waiting and wondering.
 */
function writeStatus(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  phase: WaitingStatusData["phase"],
  message: string
) {
  dataStream.write({
    data: {
      message,
      modelId: "research",
      modelName: "Deep Research",
      phase,
    },
    transient: true,
    type: "data-waiting-status",
  });
}

/**
 * Deep research.
 *
 * A single search answers a single question. This runs the loop a researcher
 * would: plan several angles, search each, read the most promising pages in
 * full, and then write a report that cites what it actually read.
 *
 * The searches and the reads are the same grounded Gemini calls the `webSearch`
 * and `readUrl` tools use, so a research report and a plain search answer are
 * grounded identically — the difference is the number of rounds and the reading
 * in between.
 */
export const research = ({ dataStream, session }: ResearchToolsProps) =>
  tool({
    description:
      "Research a topic deeply: plan several search angles, search the web, read the most useful pages in full, and write a cited report. Use it for open-ended questions that need more than one search — comparisons, 'best of', 'how does X work', market or product questions, or anything where a single answer would be thin. Prefer webSearch for a single factual lookup.",
    execute: async ({ depth = "standard", topic }) => {
      if (checkIsGuest(session)) {
        return {
          error: "Sign in or create a free account to run research.",
          requiresAuth: true,
        };
      }

      const budget = DEPTH_BUDGET[depth] ?? DEPTH_BUDGET.standard;

      try {
        // ── 0. Pick up an earlier run, if there is one ──────────────────
        //
        // A run that was cut short keeps what it found. Asking again about the
        // same topic continues from those findings instead of starting over,
        // and the questions already asked are not asked again.
        const existing = await findResearchRun({
          topic,
          userId: session.user.id,
        });
        const run: ResearchRun = existing?.run ?? {
          findings: [],
          queriesAsked: [],
          sources: [],
          topic,
          updatedAt: new Date().toISOString(),
        };
        const runDocumentId = existing?.documentId;

        const alreadyAsked = new Set(
          run.queriesAsked.map((q) => q.toLowerCase())
        );

        // ── 1. Plan the angles ────────────────────────────────────────────
        writeStatus(
          dataStream,
          "thinking",
          existing
            ? "Planning what is still missing…"
            : "Planning the research…"
        );

        const { object: plan } = await generateObject({
          model: getGroundingModel(),
          prompt: [
            `Break this research topic into ${budget.queries} specific web search queries.`,
            "Each query should attack a different angle of the topic, and each should be a phrase a person would actually type into a search engine.",
            run.queriesAsked.length > 0
              ? `These questions have already been asked, so do not repeat them: ${run.queriesAsked.join("; ")}.`
              : "",
            "Return nothing but the queries.",
            "",
            topic,
          ]
            .filter(Boolean)
            .join("\n"),
          schema: z.object({
            queries: z.array(z.string().min(3)).max(8),
          }),
        });

        const queries = plan.queries
          .filter((query) => !alreadyAsked.has(query.toLowerCase()))
          .slice(0, budget.queries);

        if (queries.length === 0) {
          // Everything planned has been asked. Report what the run has, rather
          // than searching again for the same ground.
          return {
            continued: Boolean(existing),
            documentId: runDocumentId,
            findings: run.findings,
            report: run.report ?? run.findings.join("\n\n"),
            sources: run.sources,
            topic,
          };
        }

        // ── 2. Search each angle ──────────────────────────────────────────
        writeStatus(
          dataStream,
          "searching",
          `Searching the web (${queries.length} ${queries.length === 1 ? "query" : "queries"})…`
        );

        const searchResults = await Promise.all(
          queries.map(async (query) => {
            try {
              const { sources, text } = await generateText({
                model: getGroundingModel(),
                prompt: `Search the web and report what you find about: ${query}`,
                tools: { google_search: googleSearchTool() },
              });

              return {
                query,
                snippet: text.slice(0, SNIPPET_CHARS),
                sources: toGroundingSources(sources),
              };
            } catch (error) {
              console.warn("Research search failed:", error);
              return { query, snippet: "", sources: [] };
            }
          })
        );

        run.queriesAsked = [...run.queriesAsked, ...queries];
        await saveResearchRun({
          documentId: runDocumentId,
          run,
          userId: session.user.id,
        });

        // ── 3. Collect the pages worth reading ───────────────────────────
        const seenUrls = new Set<string>(run.sources.map((s) => s.url));
        const sources: GroundingSource[] = [];

        for (const result of searchResults) {
          for (const source of result.sources) {
            if (seenUrls.has(source.url)) {
              continue;
            }

            seenUrls.add(source.url);
            sources.push(source);
          }
        }

        if (sources.length === 0 && run.findings.length === 0) {
          return {
            error:
              "The searches found no readable sources. Try a broader or differently worded topic.",
          };
        }

        const pagesToRead = sources.slice(0, budget.pagesToRead);

        // ── 4. Read them ─────────────────────────────────────────────────
        let readings: { source: GroundingSource; text: string }[] = [];

        if (pagesToRead.length > 0) {
          writeStatus(
            dataStream,
            "reading",
            `Reading ${pagesToRead.length} ${pagesToRead.length === 1 ? "source" : "sources"}…`
          );

          readings = await Promise.all(
            pagesToRead.map(async (source) => {
              try {
                const { text } = await generateText({
                  model: getGroundingModel(),
                  prompt: [
                    `Read the page at ${source.url}.`,
                    "Extract the facts it states that are relevant to the research, with the specifics: figures, dates, names and conditions.",
                    "Do not summarise the layout — report the substance.",
                  ].join("\n"),
                  tools: { url_context: googleUrlContextTool() },
                });

                return { source, text: text.slice(0, SNIPPET_CHARS) };
              } catch (error) {
                console.warn("Research page read failed:", error);
                return { source, text: "" };
              }
            })
          );

          // The findings are written down as they arrive, so a run that is cut
          // short keeps what it read rather than losing all of it.
          for (const reading of readings) {
            if (!reading.text) {
              continue;
            }

            run.findings.push(reading.text);
            run.sources.push({
              note: reading.text.slice(0, 400),
              title: reading.source.title,
              url: reading.source.url,
            });
          }

          run.updatedAt = new Date().toISOString();
          await saveResearchRun({
            documentId: runDocumentId,
            run,
            userId: session.user.id,
          });
        }

        // ── 5. Write the report ──────────────────────────────────────────
        writeStatus(dataStream, "thinking", "Writing the report…");

        const cited = readings.filter((reading) => reading.text);

        // A continuation writes the whole picture, not just this round's slice.
        const earlierFindings = run.findings
          .filter(
            (finding) => !cited.some((reading) => reading.text === finding)
          )
          .slice(0, 12);

        const allSources = [...run.sources, ...sources];

        const material = [
          earlierFindings.length > 0
            ? "What earlier rounds of this research already established:"
            : "",
          ...earlierFindings.map((finding) => `FINDING: ${finding}\n`),
          "Here is what this round's web searches found, per query:",
          ...searchResults
            .filter((result) => result.snippet)
            .map((result) => `QUERY: ${result.query}\n${result.snippet}\n`),
          cited.length > 0
            ? "Here is what was read in full from the most relevant pages:"
            : "",
          ...cited.map(
            (reading) => `SOURCE: ${reading.source.url}\n${reading.text}\n`
          ),
        ]
          .filter(Boolean)
          .join("\n");

        const { text: report } = await generateText({
          model: getGroundingModel(),
          prompt: [
            `Write a research report on: ${topic}`,
            "",
            "Use the material below. Cite with [n] markers matching the numbered source list.",
            "If the material does not support a claim, leave it out. If it is thin, say what is uncertain rather than padding.",
            "Structure it with short sections and a few clear headings. Lead with the answer.",
            "",
            "NUMBERED SOURCE LIST:",
            ...allSources.map(
              (source, index) => `[${index + 1}] ${source.url}`
            ),
            "",
            "MATERIAL:",
            material,
          ].join("\n"),
        });

        // The report is kept, so a later continuation can build on it.
        run.report = report;
        run.updatedAt = new Date().toISOString();

        const savedRunId = await saveResearchRun({
          documentId: runDocumentId,
          run,
          userId: session.user.id,
        });

        return {
          continued: Boolean(existing),
          depth,
          documentId: savedRunId,
          report,
          sources: allSources,
          topic,
        };
      } catch (error: any) {
        console.error("research failed:", error);
        return {
          error: error?.message ?? "The research could not be completed.",
        };
      }
    },
    inputSchema: z.object({
      depth: z
        .enum(["quick", "standard", "thorough"])
        .optional()
        .default("standard")
        .describe(
          "How much effort to spend. 'quick' is a single search, 'standard' searches several angles and reads the best pages, 'thorough' searches more and reads more."
        ),
      topic: z
        .string()
        .min(3)
        .max(1000)
        .describe("The topic to research, as a complete question or subject."),
    }),
  });
