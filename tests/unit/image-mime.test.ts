import { expect, test } from "@playwright/test";

import {
  FLATTEN_BACKGROUND,
  formatSupportsAlpha,
  resolveAlphaFormat,
} from "../../lib/image/formats";
import {
  imageDownloadName,
  imageExtension,
  imageSrcMime,
  imageSrcToDataUrl,
  sniffBase64ImageMime,
} from "../../lib/image/mime";
import { sniffImageBytes } from "../../lib/image/signatures";

/** A 1x1 JPEG, so the base64 really starts with the "/9j/" that caused the bug. */
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

test.describe("sniffImageBytes", () => {
  test("identifies an edited cutout's PNG bytes", () => {
    expect(sniffImageBytes(Buffer.from(PNG_BASE64, "base64"))).toBe(
      "image/png"
    );
  });

  test("recognises TIFF in both byte orders", () => {
    const pad = Buffer.alloc(8);

    expect(
      sniffImageBytes(
        Buffer.concat([Buffer.from("II"), Buffer.from([42, 0]), pad])
      )
    ).toBe("image/tiff");
    expect(
      sniffImageBytes(
        Buffer.concat([Buffer.from("MM"), Buffer.from([0, 42]), pad])
      )
    ).toBe("image/tiff");
  });

  test("reads the ftyp brand, so HEIC is not mislabelled AVIF", () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.from("mif1heic"),
    ]);

    expect(sniffImageBytes(heic)).toBe("image/heic");
  });

  test("never guesses an unknown container", () => {
    expect(
      sniffImageBytes(Buffer.from("this is not an image, just text"))
    ).toBeNull();
    expect(
      sniffImageBytes(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
    ).toBeNull();
  });
});

test.describe("sniffBase64ImageMime", () => {
  test("recovers the real format of bare base64", () => {
    expect(sniffBase64ImageMime(JPEG_BASE64)).toBe("image/jpeg");
    expect(sniffBase64ImageMime(PNG_BASE64)).toBe("image/png");
  });

  test("ignores whitespace in the payload", () => {
    const wrapped = `${PNG_BASE64.slice(0, 40)}\n  ${PNG_BASE64.slice(40)}`;

    expect(sniffBase64ImageMime(wrapped)).toBe("image/png");
  });

  test("returns null for non-base64 and short inputs", () => {
    expect(sniffBase64ImageMime("")).toBeNull();
    expect(sniffBase64ImageMime("iVBOR")).toBeNull();
    expect(
      sniffBase64ImageMime(
        "https://example.com/storage/object/sign/artifacts/u/1-a.jpg?token=abc"
      )
    ).toBeNull();
  });
});

test.describe("imageSrcMime", () => {
  test("keeps the type a data URL declares", () => {
    expect(imageSrcMime("data:image/webp;base64,UklGRg==")).toBe("image/webp");
  });

  test("sniffs bare base64 rather than assuming PNG", () => {
    expect(imageSrcMime(JPEG_BASE64)).toBe("image/jpeg");
  });

  test("falls back to the extension for remote URLs", () => {
    expect(imageSrcMime("https://cdn.example.com/a/photo.JPEG?x=1")).toBe(
      "image/jpeg"
    );
    expect(imageSrcMime("https://cdn.example.com/a/pic.avif")).toBe(
      "image/avif"
    );
    expect(imageSrcMime("https://cdn.example.com/a/pic.gif")).toBe("image/gif");
  });
});

test.describe("imageSrcToDataUrl", () => {
  test("promotes bare base64 with the sniffed mime", () => {
    expect(imageSrcToDataUrl(PNG_BASE64)).toBe(
      `data:image/png;base64,${PNG_BASE64}`
    );
    expect(imageSrcToDataUrl(JPEG_BASE64)).toBe(
      `data:image/jpeg;base64,${JPEG_BASE64}`
    );
  });

  test("passes through anything the DOM can already load", () => {
    for (const src of [
      "data:image/png;base64,AAAA",
      "blob:https://example.com/1234",
      "https://cdn.example.com/a.png",
    ]) {
      expect(imageSrcToDataUrl(src)).toBe(src);
    }
  });

  test("is empty for an empty source", () => {
    expect(imageSrcToDataUrl("")).toBe("");
  });
});

test.describe("imageExtension", () => {
  test("maps every supported container to its extension", () => {
    expect(imageExtension(PNG_BASE64)).toBe("png");
    expect(imageExtension(JPEG_BASE64)).toBe("jpg");
    expect(imageExtension("https://cdn.example.com/a/pic.webp")).toBe("webp");
  });

  test("defaults to png when the source carries no recognisable format", () => {
    expect(imageExtension("https://cdn.example.com/a/pic")).toBe("png");
    expect(imageExtension("")).toBe("png");
  });
});

test.describe("imageDownloadName", () => {
  test("names a saved cutout after its real bytes, not the selected mode", () => {
    const name = imageDownloadName("bg-transparent", PNG_BASE64);

    expect(name.startsWith("bg-transparent-")).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
  });

  test("gives a JPEG download a .jpg extension", () => {
    expect(imageDownloadName("cropped", JPEG_BASE64).endsWith(".jpg")).toBe(
      true
    );
  });
});

test.describe("formatSupportsAlpha", () => {
  test("rejects only the encoders without an alpha channel", () => {
    expect(formatSupportsAlpha("jpeg")).toBe(false);
    expect(formatSupportsAlpha("jpg")).toBe(false);
    expect(formatSupportsAlpha("png")).toBe(true);
    expect(formatSupportsAlpha("webp")).toBe(true);
    expect(formatSupportsAlpha("avif")).toBe(true);
  });
});

test.describe("resolveAlphaFormat", () => {
  test("leaves an opaque photo on the requested encoder", () => {
    expect(resolveAlphaFormat({ hasAlpha: false, requested: "jpeg" })).toEqual({
      format: "jpeg",
    });
  });

  test("leaves an alpha-capable request alone", () => {
    expect(resolveAlphaFormat({ hasAlpha: true, requested: "webp" })).toEqual({
      format: "webp",
    });
  });

  test("switches a cutout off JPEG, so the background cannot come back", () => {
    // Re-encoding a cutout to JPEG does not merely drop alpha: the colour
    // channels still hold the removed pixels, so asking for JPEG would paint
    // the background back in. Transparency wins over the request.
    expect(resolveAlphaFormat({ hasAlpha: true, requested: "jpeg" })).toEqual({
      format: "png",
    });
  });

  test("flattens onto white instead when the user confirmed the loss", () => {
    expect(
      resolveAlphaFormat({
        flattenAlpha: true,
        hasAlpha: true,
        requested: "jpeg",
      })
    ).toEqual({ flattenBackground: FLATTEN_BACKGROUND, format: "jpeg" });
    expect(FLATTEN_BACKGROUND).toBe("#ffffff");
  });
});
