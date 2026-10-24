import { expect, test } from "@playwright/test";

import { decryptSecret, encryptSecret } from "../../lib/media/cookie-crypto";

const SECRET = "a-test-secret-that-is-long-enough";

test.describe("encrypting a media session", () => {
  test("round-trips the value", () => {
    const cookies = ".instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc";

    expect(decryptSecret(encryptSecret(cookies, SECRET), SECRET)).toBe(cookies);
  });

  test("does not leave the value in the ciphertext", () => {
    const encrypted = encryptSecret("sessionid=supersecret", SECRET);

    expect(encrypted).not.toContain("supersecret");
    expect(encrypted).not.toContain("sessionid");
  });

  test("produces a different ciphertext each time", () => {
    // A random initialisation vector, so the same cookies do not produce the
    // same stored bytes twice.
    expect(encryptSecret("same", SECRET)).not.toBe(
      encryptSecret("same", SECRET)
    );
  });

  test("refuses a value encrypted with another secret", () => {
    const encrypted = encryptSecret("cookies", SECRET);

    expect(() => decryptSecret(encrypted, "a-different-secret")).toThrow();
  });

  test("refuses a ciphertext that has been tampered with", () => {
    const encrypted = encryptSecret("cookies", SECRET);
    const bytes = Buffer.from(encrypted, "base64");
    // Flip a byte in the ciphertext.
    bytes[bytes.length - 1] ^= 0xff;

    expect(() => decryptSecret(bytes.toString("base64"), SECRET)).toThrow();
  });

  test("refuses something that is not a ciphertext at all", () => {
    expect(() => decryptSecret("not-base64-ciphertext", SECRET)).toThrow();
    expect(() => decryptSecret("", SECRET)).toThrow();
  });

  test("handles an empty value", () => {
    expect(decryptSecret(encryptSecret("", SECRET), SECRET)).toBe("");
  });
});
