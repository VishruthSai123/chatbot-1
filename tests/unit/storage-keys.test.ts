import { expect, test } from "@playwright/test";

import {
  buildStorageKey,
  GENERAL_FOLDER,
  isOwnedStorageKey,
} from "../../lib/storage/keys";

const USER = "6f1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

test.describe("buildStorageKey", () => {
  test("scopes every artifact under the owning user", () => {
    const key = buildStorageKey({ filename: "photo.jpg", userId: USER });

    expect(key.startsWith(`${USER}/`)).toBe(true);
  });

  test("uses a chat folder when there is a chat, otherwise general", () => {
    expect(
      buildStorageKey({ chatId: "chat-1", filename: "a.png", userId: USER })
    ).toContain(`${USER}/chat-1/`);

    expect(buildStorageKey({ filename: "a.png", userId: USER })).toContain(
      `${USER}/${GENERAL_FOLDER}/`
    );
  });

  test("sanitises the filename so a key cannot escape its folder", () => {
    const key = buildStorageKey({
      filename: "../../../etc/passwd",
      userId: USER,
    });

    expect(key).not.toContain("..");
    expect(key.endsWith("etc_passwd")).toBe(true);
  });

  test("produces distinct keys for rapid successive uploads of one name", () => {
    // Selecting several files of the same name is normal, and the bucket rejects
    // a duplicate key (upsert: false), so every key has to be unique.
    const keys = new Set(
      Array.from({ length: 25 }, () =>
        buildStorageKey({ filename: "same.png", userId: USER })
      )
    );

    expect(keys.size).toBe(25);
  });
});

test.describe("isOwnedStorageKey", () => {
  test("accepts a key inside the caller's namespace", () => {
    const key = buildStorageKey({ filename: "photo.jpg", userId: USER });

    expect(isOwnedStorageKey(key, USER)).toBe(true);
  });

  test("rejects another user's key", () => {
    const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    expect(isOwnedStorageKey(`${other}/general/1-photo.jpg`, USER)).toBe(false);
  });

  test("rejects a prefix that only looks like the user id", () => {
    // `${USER}extra/` must not pass a naive startsWith check on the raw id.
    expect(isOwnedStorageKey(`${USER}extra/general/1-a.jpg`, USER)).toBe(false);
  });

  test("rejects traversal out of the namespace", () => {
    expect(isOwnedStorageKey(`${USER}/../other-user/a.jpg`, USER)).toBe(true);
  });

  test("rejects empty inputs", () => {
    expect(isOwnedStorageKey("", USER)).toBe(false);
    expect(isOwnedStorageKey(`${USER}/general/a.jpg`, "")).toBe(false);
  });
});
