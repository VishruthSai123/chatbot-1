import { expect, test } from "@playwright/test";

import { decodeBase64Image, sniffImageMime } from "../../lib/image/base64";

/** A 1x1 JPEG, so the base64 really starts with the "/9j/" that caused the bug. */
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

test.describe("decodeBase64Image", () => {
  test("recognises JPEG base64 even though it begins with a slash", () => {
    // The regression: "/9j/…" reads as a root-relative path, so any URL-shaped
    // check has to lose to this one or JPEG edits silently target the head.
    expect(JPEG_BASE64.startsWith("/")).toBe(true);

    const decoded = decodeBase64Image(JPEG_BASE64);

    expect(decoded?.mimeType).toBe("image/jpeg");
    expect(decoded?.buffer.subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff])
    );
  });

  test("recognises PNG base64", () => {
    expect(decodeBase64Image(PNG_BASE64)?.mimeType).toBe("image/png");
  });

  test("ignores whitespace inside the payload", () => {
    const wrapped = `${JPEG_BASE64.slice(0, 40)}\n  ${JPEG_BASE64.slice(40)}`;

    expect(decodeBase64Image(wrapped)?.mimeType).toBe("image/jpeg");
  });

  test("never claims a URL or path", () => {
    for (const url of [
      "https://dexzwnsukzxyguuqseax.supabase.co/storage/v1/object/sign/artifacts/u/general/1-a.jpg?token=abc",
      "/storage/v1/object/sign/artifacts/user/general/1-photo.png",
      "/api/files/upload",
      "http://localhost:3000/9j/4AAQSkZJRgABAQEAYABgAAD",
      "blob:https://example.com/1234-5678",
    ]) {
      expect(decodeBase64Image(url), url).toBeNull();
    }
  });

  test("ignores short, empty and non-image payloads", () => {
    expect(decodeBase64Image("")).toBeNull();
    expect(decodeBase64Image("abcd")).toBeNull();
    // base64 of `{"hello":"world","a":1,…}` — valid base64, not an image.
    expect(
      decodeBase64Image(
        Buffer.from('{"hello":"world","padding":"'.padEnd(80, "x")).toString(
          "base64"
        )
      )
    ).toBeNull();
  });
});

test.describe("sniffImageMime", () => {
  test("identifies common containers from their magic bytes", () => {
    expect(
      sniffImageMime(Buffer.from("GIF89a................", "latin1"))
    ).toBe("image/gif");
    expect(
      sniffImageMime(
        Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.from([0, 0, 0, 0]),
          Buffer.from("WEBPVP8 "),
        ])
      )
    ).toBe("image/webp");
    expect(
      sniffImageMime(
        Buffer.concat([
          Buffer.from([0, 0, 0, 0x20]),
          Buffer.from("ftypavif"),
          Buffer.from("avifmif1"),
        ])
      )
    ).toBe("image/avif");
    expect(
      sniffImageMime(
        Buffer.from('<?xml version="1.0"?><svg xmlns=...', "latin1")
      )
    ).toBe("image/svg+xml");
  });

  test("returns null rather than guessing", () => {
    expect(sniffImageMime(Buffer.from("not an image at all"))).toBeNull();
    expect(sniffImageMime(Buffer.from([0, 0, 0]))).toBeNull();
  });
});
