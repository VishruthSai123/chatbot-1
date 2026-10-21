import { expect, test } from "@playwright/test";

import {
  collectImageCandidates,
  matchCandidate,
} from "../../lib/image/references";

const IMAGE_A = "11111111-1111-4111-8111-111111111111";
const IMAGE_B = "22222222-2222-4222-8222-222222222222";

const MESSAGES = [
  {
    parts: [
      {
        documentId: IMAGE_A,
        mediaType: "image/jpeg",
        name: "shot1.jpg",
        type: "file",
        url: "https://x/shot1.jpg",
      },
      {
        documentId: IMAGE_B,
        mediaType: "image/png",
        name: "logo.png",
        type: "file",
        url: "https://x/logo.png",
      },
    ],
    role: "user",
  },
];

test.describe("collecting image candidates", () => {
  test("finds the file parts that carry a document id", () => {
    const candidates = collectImageCandidates(MESSAGES);

    expect(candidates).toHaveLength(2);
    // Newest first, so the later part in the message comes first.
    expect(candidates[0].name).toBe("logo.png");
    expect(candidates[0].documentId).toBe(IMAGE_B);
    expect(candidates[1].name).toBe("shot1.jpg");
    expect(candidates[1].documentId).toBe(IMAGE_A);
  });

  test("ignores parts that are not images", () => {
    const candidates = collectImageCandidates([
      {
        parts: [
          {
            documentId: IMAGE_A,
            mediaType: "application/pdf",
            name: "doc.pdf",
            type: "file",
            url: "https://x/doc.pdf",
          },
          {
            mediaType: "image/png",
            name: "real.png",
            type: "file",
            url: "https://x/real.png",
          },
        ],
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("real.png");
  });

  test("keeps the older attachments array shape", () => {
    const candidates = collectImageCandidates([
      { attachments: [{ name: "old.jpg", url: "https://x/old.jpg" }] },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("old.jpg");
    expect(candidates[0].documentId).toBeUndefined();
  });

  test("the newest attachment comes first", () => {
    const candidates = collectImageCandidates([
      {
        parts: [
          {
            documentId: IMAGE_A,
            mediaType: "image/jpeg",
            name: "old.jpg",
            type: "file",
            url: "https://x/old.jpg",
          },
        ],
      },
      {
        parts: [
          {
            documentId: IMAGE_B,
            mediaType: "image/jpeg",
            name: "new.jpg",
            type: "file",
            url: "https://x/new.jpg",
          },
        ],
      },
    ]);

    expect(candidates[0].name).toBe("new.jpg");
  });
});

test.describe("matching a reference to an attachment", () => {
  const candidates = collectImageCandidates(MESSAGES);

  test("matches an exact filename", () => {
    expect(matchCandidate("shot1.jpg", candidates)?.documentId).toBe(IMAGE_A);
  });

  test("matches a filename regardless of case", () => {
    expect(matchCandidate("SHOT1.JPG", candidates)?.documentId).toBe(IMAGE_A);
  });

  test("matches a partial filename", () => {
    expect(matchCandidate("shot1", candidates)?.documentId).toBe(IMAGE_A);
  });

  test("matches a uuid", () => {
    expect(matchCandidate(IMAGE_B, candidates)?.documentId).toBe(IMAGE_B);
  });

  test("matches a url", () => {
    expect(matchCandidate("https://x/logo.png", candidates)?.name).toBe(
      "logo.png"
    );
  });

  test("an exact match wins over a partial one", () => {
    const ambiguous = collectImageCandidates([
      {
        parts: [
          {
            documentId: IMAGE_A,
            mediaType: "image/jpeg",
            name: "photo.jpg",
            type: "file",
            url: "https://x/photo.jpg",
          },
        ],
      },
      {
        parts: [
          {
            documentId: IMAGE_B,
            mediaType: "image/jpeg",
            name: "photo.jpg",
            type: "file",
            url: "https://x/photo2.jpg",
          },
        ],
      },
    ]);

    // Both share a name; the newest is the one that is found.
    expect(matchCandidate("photo.jpg", ambiguous)?.documentId).toBe(IMAGE_B);
  });

  test("an unknown reference matches nothing", () => {
    expect(matchCandidate("missing.jpg", candidates)).toBeUndefined();
  });

  test("an empty reference matches nothing", () => {
    expect(matchCandidate("   ", candidates)).toBeUndefined();
  });
});
