import { z } from "zod";

export const quizQuestionSchema = z.object({
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().optional(),
  id: z.string().optional(),
  options: z.array(z.string().min(1)).length(4),
  question: z.string().min(5),
  sourceTitle: z.string().optional(),
});

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
