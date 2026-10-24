import { expect, test } from "@playwright/test";

import { quizQuestionSchema } from "../../lib/quiz/schema";

test.describe("quiz schema", () => {
  test("validates a standard 4-option multiple choice question", () => {
    const valid = {
      correctIndex: 1,
      explanation: "Water consists of two hydrogen atoms and one oxygen atom.",
      id: "q1",
      options: ["H2O2", "H2O", "CO2", "NaCl"],
      question: "What is the chemical formula for water?",
      sourceTitle: "Chemistry 101",
    };

    const parsed = quizQuestionSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  test("fails when there are fewer or more than 4 options", () => {
    const threeOptions = {
      correctIndex: 0,
      options: ["Option A", "Option B", "Option C"],
      question: "Which option is correct?",
    };

    const fiveOptions = {
      correctIndex: 0,
      options: ["A", "B", "C", "D", "E"],
      question: "Which option is correct?",
    };

    expect(quizQuestionSchema.safeParse(threeOptions).success).toBe(false);
    expect(quizQuestionSchema.safeParse(fiveOptions).success).toBe(false);
  });

  test("fails when correctIndex is out of bounds", () => {
    const outOfBounds = {
      correctIndex: 4,
      options: ["A", "B", "C", "D"],
      question: "Which option is correct?",
    };

    expect(quizQuestionSchema.safeParse(outOfBounds).success).toBe(false);
  });
});
