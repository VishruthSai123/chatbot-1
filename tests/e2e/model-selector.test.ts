import { expect, test } from "@playwright/test";

test.describe("Fixed model", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the single model as a label", async ({ page }) => {
    const modelLabel = page.getByTestId("model-label");

    await expect(modelLabel).toBeVisible();
    await expect(modelLabel).toContainText("Gemini 3.5 Flash-Lite");
  });

  test("does not expose a model picker", async ({ page }) => {
    await expect(page.getByTestId("model-selector")).toHaveCount(0);
    await expect(page.getByPlaceholder("Search models...")).toHaveCount(0);
  });
});
