import { expect, test } from "@playwright/test";
import {
  decodeImageCollection,
  decodeImageRef,
  encodeImageCollection,
  encodeImageRef,
  IMAGE_COLLECTION_MARKER,
  IMAGE_REF_MARKER,
  isImageCollection,
  isImageRef,
} from "../../lib/image/ref";

test.describe("ImageRef envelopes", () => {
  test("encodes and decodes an ImageRef", () => {
    const ref = {
      filename: "photo.jpg",
      format: "jpg",
      height: 1080,
      sizeBytes: 250_000,
      storageKey: "user-1/chat-1/photo.jpg",
      thumbKey: "user-1/chat-1/thumb-photo.webp",
      thumbUrl: "https://example.com/thumb.webp",
      url: "https://example.com/photo.jpg",
      width: 1920,
    };

    const encoded = encodeImageRef(ref);
    expect(encoded.startsWith(IMAGE_REF_MARKER)).toBe(true);
    expect(isImageRef(encoded)).toBe(true);

    const decoded = decodeImageRef(encoded);
    expect(decoded).toEqual(ref);
  });

  test("returns null for non-ref or invalid strings", () => {
    expect(decodeImageRef("")).toBeNull();
    expect(decodeImageRef("bare-base64-data==")).toBeNull();
    expect(decodeImageRef("image-ref:not-json")).toBeNull();
    expect(decodeImageRef("image-ref:{}")).toBeNull(); // missing storageKey
    expect(isImageRef("bare-base64-data==")).toBe(false);
  });
});

test.describe("ImageCollectionRef envelopes", () => {
  test("encodes and decodes an ImageCollectionRef", () => {
    const collection = {
      activeId: "doc-1",
      items: [
        {
          documentId: "doc-1",
          filename: "img1.png",
          format: "png",
          height: 800,
          sizeBytes: 120_000,
          storageKey: "user-1/chat-1/img1.png",
          width: 800,
        },
        {
          documentId: "doc-2",
          filename: "img2.jpg",
          format: "jpg",
          height: 600,
          sizeBytes: 90_000,
          storageKey: "user-1/chat-1/img2.jpg",
          width: 900,
        },
      ],
      title: "Holiday Album",
    };

    const encoded = encodeImageCollection(collection);
    expect(encoded.startsWith(IMAGE_COLLECTION_MARKER)).toBe(true);
    expect(isImageCollection(encoded)).toBe(true);

    const decoded = decodeImageCollection(encoded);
    expect(decoded).toEqual(collection);
  });

  test("returns null for non-collection strings", () => {
    expect(decodeImageCollection("")).toBeNull();
    expect(decodeImageCollection("image-ref:{}")).toBeNull();
    expect(decodeImageCollection("image-collection:not-json")).toBeNull();
    expect(isImageCollection("hello")).toBe(false);
  });
});
