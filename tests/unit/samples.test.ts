import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { capabilities } from "../../lib/capabilities";
import { samples } from "../../lib/samples";

test.describe("the sample files", () => {
  test("every sample exists on disk", () => {
    for (const sample of samples) {
      const path = join(
        process.cwd(),
        "public",
        sample.href.replace(/^\//, "")
      );

      expect(existsSync(path), `${sample.filename} is missing`).toBe(true);
    }
  });

  test("every sample belongs to a real family", () => {
    const ids = new Set(capabilities.map((capability) => capability.id));

    for (const sample of samples) {
      expect(ids.has(sample.capability), sample.capability).toBe(true);
    }
  });

  test("every sample has a filename, a type and a prompt", () => {
    for (const sample of samples) {
      expect(sample.filename.length).toBeGreaterThan(3);
      expect(sample.mediaType).toContain("/");
      expect(sample.prompt.length).toBeGreaterThan(15);
    }
  });

  test("no family is offered twice", () => {
    const families = samples.map((sample) => sample.capability);

    expect(new Set(families).size).toBe(families.length);
  });

  test("the hrefs are unique", () => {
    const hrefs = samples.map((sample) => sample.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
