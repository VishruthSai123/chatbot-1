import { expect, test } from "@playwright/test";

import { PLANS } from "../../lib/plans";
import { classifyToolAction } from "../../lib/tools/quota-class";

test.describe("tool quota classes", () => {
  test("storage-only persists never count as hosted file operations", () => {
    expect(classifyToolAction("image", "persist")).toBe("storage");
    expect(classifyToolAction("pdf", "persist_split")).toBe("storage");
    expect(classifyToolAction("pdf", "persist-split")).toBe("storage");
    expect(classifyToolAction("pdf", "resolve")).toBe("storage");
  });

  test("basic edits are light", () => {
    expect(classifyToolAction("image", "compress")).toBe("light");
    expect(classifyToolAction("image", "resize")).toBe("light");
    expect(classifyToolAction("image", "crop")).toBe("light");
    expect(classifyToolAction("image", "rotate")).toBe("light");
    expect(classifyToolAction("image", "convert")).toBe("light");
    expect(classifyToolAction("pdf", "split")).toBe("light");
    expect(classifyToolAction("pdf", "arrange")).toBe("light");
  });

  test("expensive tools are heavy", () => {
    expect(classifyToolAction("image", "remove_bg")).toBe("heavy");
    expect(classifyToolAction("image", "removeBg")).toBe("heavy");
    expect(classifyToolAction("image", "ocr")).toBe("heavy");
    expect(classifyToolAction("image", "upscale")).toBe("heavy");
    expect(classifyToolAction("image", "upscale_enhance")).toBe("heavy");
    expect(classifyToolAction("pdf", "images-to-pdf")).toBe("heavy");
  });

  test("an unknown action stays light rather than blocking a new cheap tool", () => {
    expect(classifyToolAction("image", "future_edit")).toBe("light");
  });
});

test.describe("free plan boundary", () => {
  test("free is a real allowance, not unlimited", () => {
    expect(PLANS.free.tasksPerDay).toBe(3);
    expect(PLANS.free.searchesPerDay).toBe(1);
    expect(PLANS.free.researchPerMonth).toBe(0);
    expect(PLANS.free.downloadsPerMonth).toBe(0);
    expect(PLANS.free.liveMinutesPerMonth).toBe(3);
    expect(PLANS.free.storageGb).toBe(0.5);
  });

  test("free keeps a light on-device fallback allowance", () => {
    expect(PLANS.free.lightFileOpsPerDay).toBeGreaterThan(0);
  });

  test("free has no monthly hosted file-op pool", () => {
    expect(PLANS.free.fileOpsPerMonth).toBe(0);
  });
});
