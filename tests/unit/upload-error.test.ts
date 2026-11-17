import { expect, test } from "@playwright/test";

import { parseUploadErrorBody } from "../../lib/upload/client";

test.describe("upload error handling", () => {
  test("a guest upload response asks for an account", () => {
    const parsed = parseUploadErrorBody(
      JSON.stringify({
        error: "Create a free account to upload files to Spire AI.",
        requiresAuth: true,
      }),
      403,
      "Upload failed"
    );

    expect(parsed.requiresAuth).toBe(true);
    expect(parsed.message).toContain("free account");
  });

  test("an expired session is treated as needing sign-in", () => {
    const parsed = parseUploadErrorBody(
      JSON.stringify({ error: "Unauthorized" }),
      401,
      "Upload failed"
    );

    expect(parsed.requiresAuth).toBe(true);
    expect(parsed.message).toBe("Unauthorized");
  });

  test("ordinary failures keep their message and stay non-auth", () => {
    const parsed = parseUploadErrorBody(
      JSON.stringify({ error: "Storage rejected the upload" }),
      500,
      "Upload failed"
    );

    expect(parsed.requiresAuth).toBe(false);
    expect(parsed.message).toBe("Storage rejected the upload");
  });

  test("a plain body still gets a readable message", () => {
    const parsed = parseUploadErrorBody("Bad gateway", 502, "Upload failed");

    expect(parsed.requiresAuth).toBe(false);
    expect(parsed.message).toBe("Bad gateway");
  });

  test("a 413 uses the size explanation", () => {
    const parsed = parseUploadErrorBody("", 413, "Upload failed");

    expect(parsed.requiresAuth).toBe(false);
    expect(parsed.message).toContain("larger than the server accepts");
  });
});
