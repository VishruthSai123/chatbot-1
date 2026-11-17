import { expect, test } from "@playwright/test";

import { parsePendingShare } from "../../lib/share/pending-share";

const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

test.describe("pending share persistence", () => {
  test("accepts a fresh share for the current path", () => {
    const pending = parsePendingShare(
      JSON.stringify({ createdAt: NOW - 1000, path: "/", token: "abc" }),
      "/",
      NOW
    );

    expect(pending).toEqual({
      createdAt: NOW - 1000,
      path: "/",
      token: "abc",
    });
  });

  test("rejects a share saved for a different chat", () => {
    expect(
      parsePendingShare(
        JSON.stringify({ createdAt: NOW, path: "/chat/a", token: "abc" }),
        "/chat/b",
        NOW
      )
    ).toBeNull();
  });

  test("rejects an expired share", () => {
    expect(
      parsePendingShare(
        JSON.stringify({ createdAt: NOW - DAY - 1, path: "/", token: "abc" }),
        "/",
        NOW
      )
    ).toBeNull();
  });

  test("rejects malformed or empty storage", () => {
    expect(parsePendingShare(null, "/", NOW)).toBeNull();
    expect(parsePendingShare("not json", "/", NOW)).toBeNull();
    expect(
      parsePendingShare(JSON.stringify({ createdAt: NOW, path: "/" }), "/", NOW)
    ).toBeNull();
    expect(
      parsePendingShare(
        JSON.stringify({ createdAt: NOW, path: "/", token: "  " }),
        "/",
        NOW
      )
    ).toBeNull();
  });
});
