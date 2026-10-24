"use client";

import {
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Copy,
  FileText,
  NotebookPen,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { QuizQuestion } from "@/lib/quiz/schema";
import { cn } from "@/lib/utils";

/**
 * The result card for the notebook tools.
 *
 * Four different things can happen here — a notebook is created, a question is
 * answered, a deliverable is generated, a quiz is marked — and the card has to
 * make each of them legible at a glance without becoming four separate
 * components.
 */

export type NotebookToolType =
  | "tool-notebookCreate"
  | "tool-notebookAsk"
  | "tool-notebookGenerate"
  | "tool-notebookQuiz"
  | "tool-notebookGrade"
  | "tool-notebookAddSource";

export interface NotebookCitation {
  index?: number;
  label?: string;
  title?: string;
}

export interface NotebookToolOutput {
  answer?: string;
  citation?: NotebookCitation;
  citations?: NotebookCitation[];
  content?: string;
  documentId?: string;
  error?: string;
  feedback?: string;
  kind?: string;
  matched?: boolean;
  mode?: string;
  question?: string;
  questions?: (QuizQuestion & { id: string })[];
  sources?: string[];
  title?: string;
  unmatched?: string[];
  verdict?: "correct" | "partial" | "incorrect";
}

interface NotebookToolCardProps {
  isReadonly?: boolean;
  output?: NotebookToolOutput;
  toolCallId: string;
  toolType: NotebookToolType;
}

const TOOL_CONFIG: Record<
  NotebookToolType,
  { icon: typeof BookOpen; label: string }
> = {
  "tool-notebookAddSource": { icon: FileText, label: "Add Source" },
  "tool-notebookAsk": { icon: BookOpen, label: "Notebook Answer" },
  "tool-notebookCreate": { icon: NotebookPen, label: "Notebook Created" },
  "tool-notebookGenerate": { icon: FileText, label: "Generated" },
  "tool-notebookGrade": { icon: Check, label: "Answer Marked" },
  "tool-notebookQuiz": { icon: NotebookPen, label: "Quiz" },
};

/** The source list under an answer or a deliverable. */
function CitationList({ citations }: { citations: NotebookCitation[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-2.5 border-t border-border/40 pt-2">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Sources
      </div>
      <div className="flex flex-col gap-0.5">
        {citations.slice(0, 10).map((citation, index) => (
          <div
            className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
            key={`${citation.index ?? index}-${citation.title ?? ""}`}
          >
            <span className="mt-px font-mono text-[9px] text-muted-foreground/60">
              [{citation.index ?? index + 1}]
            </span>
            <span className="min-w-0 flex-1 truncate">
              {citation.label ?? citation.title ?? "Source"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactive Quiz Card
// ---------------------------------------------------------------------------

type QuizQuestionData = QuizQuestion & {
  id: string;
};

function InteractiveQuizCard({ questions }: { questions: QuizQuestionData[] }) {
  // selectedIndex per question id
  const [selected, setSelected] = useState<Record<string, number>>({});
  // graded per question id → true once submitted
  const [graded, setGraded] = useState<Record<string, boolean>>({});

  const totalQuestions = questions.length;
  const totalGraded = Object.keys(graded).length;
  const totalCorrect = questions.filter(
    (q) => graded[q.id] && selected[q.id] === q.correctIndex
  ).length;

  const allDone = totalGraded === totalQuestions;

  return (
    <div className="flex flex-col gap-3">
      {questions.map((q, qIndex) => {
        const isGraded = !!graded[q.id];
        const selectedIdx = selected[q.id];
        const isCorrect = isGraded && selectedIdx === q.correctIndex;

        return (
          <div
            className={cn(
              "rounded-lg border p-3 transition-all",
              isGraded
                ? isCorrect
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-rose-500/40 bg-rose-500/5"
                : "border-border/50 bg-muted/20"
            )}
            key={q.id}
          >
            {/* Question text */}
            <p className="mb-2 text-[12px] font-medium leading-relaxed text-foreground/90">
              {qIndex + 1}. {q.question}
            </p>

            {/* Options */}
            <div className="flex flex-col gap-1">
              {q.options.map((option, optIdx) => {
                const letter = String.fromCharCode(65 + optIdx);
                const isSelected = selectedIdx === optIdx;
                const isCorrectOption = optIdx === q.correctIndex;

                let optionStyle =
                  "border-border/30 bg-background/50 hover:border-border/60 hover:bg-background/80";

                if (isGraded) {
                  if (isCorrectOption) {
                    optionStyle =
                      "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
                  } else if (isSelected && !isCorrectOption) {
                    optionStyle =
                      "border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-400 line-through";
                  } else {
                    optionStyle =
                      "border-border/20 bg-background/30 text-muted-foreground/60";
                  }
                } else if (isSelected) {
                  optionStyle =
                    "border-zinc-500 bg-zinc-500/10 ring-1 ring-zinc-500/30";
                }

                return (
                  <button
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-all",
                      optionStyle,
                      isGraded && "cursor-default"
                    )}
                    disabled={isGraded}
                    key={`${q.id}-${letter}`}
                    onClick={() =>
                      setSelected((prev) => ({ ...prev, [q.id]: optIdx }))
                    }
                    type="button"
                  >
                    {/* Radio indicator */}
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-all",
                        isGraded && isCorrectOption
                          ? "border-emerald-500 bg-emerald-500"
                          : isGraded && isSelected && !isCorrectOption
                            ? "border-rose-500 bg-rose-500"
                            : isSelected
                              ? "border-zinc-500 bg-zinc-500"
                              : "border-border/50"
                      )}
                    >
                      {isGraded && isCorrectOption ? (
                        <Check className="size-2.5 text-white" />
                      ) : isGraded && isSelected && !isCorrectOption ? (
                        <CircleX className="size-2.5 text-white" />
                      ) : isSelected ? (
                        <span className="size-1.5 rounded-full bg-white" />
                      ) : null}
                    </span>
                    <span className="font-mono text-[10px] opacity-60">
                      {letter}.
                    </span>
                    <span className="min-w-0 flex-1">{option}</span>
                  </button>
                );
              })}
            </div>

            {/* Submit / Result */}
            <div className="mt-2">
              {isGraded ? (
                <div className="flex flex-col gap-1">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 text-[11px] font-medium",
                      isCorrect
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {isCorrect ? (
                      <>
                        <CircleCheck className="size-3.5" />
                        Correct!
                      </>
                    ) : (
                      <>
                        <CircleX className="size-3.5" />
                        Incorrect — answer is{" "}
                        {String.fromCharCode(65 + q.correctIndex)}.{" "}
                        {q.options[q.correctIndex]}
                      </>
                    )}
                  </div>
                  {q.explanation ? (
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {q.explanation}
                    </p>
                  ) : null}
                </div>
              ) : (
                <button
                  className={cn(
                    "rounded-md px-3 py-1 text-[11px] font-medium transition-all",
                    selectedIdx === undefined
                      ? "cursor-not-allowed bg-muted text-muted-foreground"
                      : "cursor-pointer bg-foreground text-background hover:bg-foreground/90"
                  )}
                  disabled={selectedIdx === undefined}
                  onClick={() =>
                    setGraded((prev) => ({ ...prev, [q.id]: true }))
                  }
                  type="button"
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Score summary */}
      {allDone ? (
        <div
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg border p-3 text-[13px] font-semibold",
            totalCorrect === totalQuestions
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : totalCorrect >= totalQuestions / 2
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
          )}
        >
          Score: {totalCorrect}/{totalQuestions} (
          {Math.round((totalCorrect / totalQuestions) * 100)}%)
        </div>
      ) : totalGraded > 0 ? (
        <p className="text-center text-[10px] text-muted-foreground">
          {totalCorrect}/{totalGraded} correct so far —{" "}
          {totalQuestions - totalGraded} remaining
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Card
// ---------------------------------------------------------------------------

export function NotebookToolCard({
  toolType,
  toolCallId: _toolCallId,
  output,
}: NotebookToolCardProps) {
  const [hasCopied, setHasCopied] = useState(false);

  const config = TOOL_CONFIG[toolType] ?? TOOL_CONFIG["tool-notebookAsk"];
  const Icon = config.icon;

  const body = output?.answer ?? output?.content ?? "";
  const citations =
    output?.citations ?? (output?.citation ? [output.citation] : []);

  const handleCopy = useCallback(async () => {
    if (!body) {
      return;
    }

    try {
      await navigator.clipboard.writeText(body);
      setHasCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  }, [body]);

  return (
    <div className="flex w-full max-w-[480px] flex-col rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm transition-all hover:border-border hover:bg-card/90">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-zinc-500" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {config.label}
          </span>
          {output?.kind ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {output.kind.replace("_", " ")}
            </span>
          ) : null}
          {output?.mode === "searched" ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              retrieved
            </span>
          ) : null}
        </div>

        {body ? (
          <button
            aria-label="Copy"
            className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={handleCopy}
            type="button"
          >
            {hasCopied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>

      {/* Body */}
      <div className="mt-2">
        {toolType === "tool-notebookCreate" ||
        toolType === "tool-notebookAddSource" ? (
          <div className="flex flex-col gap-1">
            {output?.title ? (
              <p className="text-[12px] font-medium text-foreground/90">
                {output.title}
              </p>
            ) : null}
            {output?.sources && output.sources.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {output.sources.map((source) => (
                  <li
                    className="truncate text-[11px] text-muted-foreground"
                    key={source}
                  >
                    {source}
                  </li>
                ))}
              </ul>
            ) : null}
            {output?.unmatched && output.unmatched.length > 0 ? (
              <p className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                <CircleAlert className="mt-px size-3 shrink-0" />
                Could not match: {output.unmatched.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {toolType === "tool-notebookGrade" ? (
          <div className="flex flex-col gap-1.5">
            <div
              className={cn(
                "flex items-center gap-1.5 text-[12px] font-medium",
                output?.verdict === "correct" &&
                  "text-emerald-600 dark:text-emerald-400",
                output?.verdict === "partial" &&
                  "text-amber-600 dark:text-amber-400",
                output?.verdict === "incorrect" &&
                  "text-rose-600 dark:text-rose-400"
              )}
            >
              {output?.verdict === "correct" ? (
                <CircleCheck className="size-3.5" />
              ) : output?.verdict === "partial" ? (
                <CircleAlert className="size-3.5" />
              ) : (
                <CircleX className="size-3.5" />
              )}
              {output?.verdict === "correct"
                ? "Correct"
                : output?.verdict === "partial"
                  ? "Partly right"
                  : "Not quite"}
            </div>
            {output?.feedback ? (
              <p className="text-[12px] leading-relaxed text-foreground/90">
                {output.feedback}
              </p>
            ) : null}
          </div>
        ) : null}

        {toolType === "tool-notebookQuiz" && output?.questions ? (
          <InteractiveQuizCard
            questions={output.questions as QuizQuestionData[]}
          />
        ) : null}

        {body ? (
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
            {body}
          </p>
        ) : null}

        {output?.question && toolType === "tool-notebookAsk" ? (
          <p className="mb-1.5 mt-2 border-l-2 border-border/60 pl-2 text-[11px] italic text-muted-foreground">
            {output.question}
          </p>
        ) : null}

        <CitationList citations={citations} />
      </div>
    </div>
  );
}
