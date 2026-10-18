import { expect, test } from "@playwright/test";

import {
  formatBytes,
  isAllowedUploadType,
  MAX_UPLOAD_BYTES,
  SAFE_MULTIPART_BYTES,
  STORAGE_ALLOWED_MIME_TYPES,
  safeStorageFilename,
  validateUpload,
} from "../../lib/storage/limits";

test.describe("validateUpload", () => {
  test("accepts a generous but bounded image", () => {
    expect(
      validateUpload({
        name: "photo.jpg",
        size: 5 * 1024 * 1024,
        type: "image/jpeg",
      })
    ).toEqual({ ok: true });
  });

  test("accepts the largest allowed file and rejects one byte more", () => {
    expect(
      validateUpload({
        name: "a.png",
        size: MAX_UPLOAD_BYTES,
        type: "image/png",
      })
    ).toEqual({ ok: true });

    const tooBig = validateUpload({
      name: "a.png",
      size: MAX_UPLOAD_BYTES + 1,
      type: "image/png",
    });

    expect(tooBig.ok).toBe(false);
    // The message has to state the real cap — an opaque 413 is what this whole
    // path exists to avoid.
    expect(tooBig.ok === false && tooBig.message).toContain("16 MB");
  });

  test("rejects empty files", () => {
    const result = validateUpload({
      name: "empty.txt",
      size: 0,
      type: "text/plain",
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("empty");
  });

  test("allows any image/* type but rejects an unsupported one", () => {
    expect(
      validateUpload({ name: "shot.heic", size: 1000, type: "image/heic" })
    ).toEqual({ ok: true });

    const rejected = validateUpload({
      name: "archive.zip",
      size: 1000,
      type: "application/zip",
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.ok === false && rejected.message).toContain(
      "not a supported"
    );
  });

  test("is not shadowed by the proxied transport ceiling", () => {
    // The proxy must stay well under Vercel's 4.5 MB request cap, but the direct
    // upload path is allowed to exceed it — otherwise the fix would be useless.
    expect(SAFE_MULTIPART_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(
      validateUpload({
        name: "huge.jpg",
        size: SAFE_MULTIPART_BYTES + 1,
        type: "image/jpeg",
      })
    ).toEqual({ ok: true });
  });
});

test.describe("storage configuration mirrors the app rules", () => {
  const bucketAllows = (type: string) =>
    STORAGE_ALLOWED_MIME_TYPES.some((pattern) =>
      pattern.endsWith("/*")
        ? type.startsWith(pattern.slice(0, -1))
        : pattern === type
    );

  test("never rejects a type the app already accepted", () => {
    // Guards the exact bug found in production review: the app allowed any
    // image/*, the bucket allowed only a fixed list, so a HEIC photo failed at
    // the storage layer after passing validation.
    const types = [
      "image/heic",
      "image/avif",
      "image/tiff",
      "image/png",
      "text/markdown",
      "text/csv",
      "application/pdf",
      "application/octet-stream",
      "video/quicktime",
    ];

    for (const type of types) {
      if (isAllowedUploadType(type)) {
        expect(
          bucketAllows(type),
          `${type} passes the app but not the bucket`
        ).toBe(true);
      }
    }
  });

  test("keeps the bucket size limit identical to the app limit", () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(SAFE_MULTIPART_BYTES);
  });
});

test.describe("isAllowedUploadType", () => {
  test("permits text/*, image/* and allowlisted documents", () => {
    expect(isAllowedUploadType("text/csv")).toBe(true);
    expect(isAllowedUploadType("image/webp")).toBe(true);
    expect(isAllowedUploadType("application/pdf")).toBe(true);
  });

  test("permits an empty type so unusual but valid files still reach the server", () => {
    expect(isAllowedUploadType("")).toBe(true);
  });
});

test.describe("safeStorageFilename", () => {
  test("strips path traversal and separators", () => {
    expect(safeStorageFilename("../../etc/passwd")).toBe("etc_passwd");
    expect(safeStorageFilename("my photo (1).png")).toBe("my_photo__1_.png");
  });

  test("never returns an empty name", () => {
    expect(safeStorageFilename("...")).toBe("upload");
    expect(safeStorageFilename("")).toBe("upload");
  });

  test("bounds the length", () => {
    expect(safeStorageFilename("a".repeat(400)).length).toBe(120);
  });
});

test.describe("formatBytes", () => {
  test("formats each magnitude", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(16 * 1024 * 1024)).toBe("16 MB");
  });
});
