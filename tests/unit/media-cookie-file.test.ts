import { expect, test } from "@playwright/test";

import {
  isCookieFile,
  parseCookieFile,
  primaryDomain,
  summariseCookieFile,
} from "../../lib/media/cookie-file";

/**
 * A cookie file as a browser extension exports it.
 */
const SAMPLE = [
  "# Netscape HTTP Cookie File",
  "# https://curl.se/docs/http-cookies.html",
  "",
  "#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1799999999\tsessionid\tabc123",
  ".instagram.com\tTRUE\t/\tTRUE\t1799999999\tcsrftoken\txyz789",
  ".facebook.com\tTRUE\t/\tTRUE\t1799999999\tc_user\t987",
].join("\n");

test.describe("reading a cookie file", () => {
  test("reads the cookies out of it", () => {
    const entries = parseCookieFile(SAMPLE);

    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("sessionid");
    expect(entries[0].value).toBe("abc123");
    expect(entries[0].domain).toBe("instagram.com");
    expect(entries[0].secure).toBe(true);
    expect(entries[0].expires).toBe(1_799_999_999);
  });

  test("skips the comments", () => {
    const names = parseCookieFile(SAMPLE).map((entry) => entry.name);

    expect(names).not.toContain("# Netscape HTTP Cookie File");
    expect(names).toEqual(["sessionid", "csrftoken", "c_user"]);
  });

  test("keeps an HttpOnly cookie, which is a cookie and not a comment", () => {
    const entries = parseCookieFile(SAMPLE);

    expect(entries.some((entry) => entry.name === "sessionid")).toBe(true);
  });

  test("skips a malformed line rather than losing the file", () => {
    const entries = parseCookieFile(
      ["broken", ".example.com\tTRUE\t/\tTRUE\t0\tname\tvalue"].join("\n")
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("name");
  });

  test("reads a value that contains a tab", () => {
    const entries = parseCookieFile(
      ".example.com\tTRUE\t/\tTRUE\t0\tk\tv1\tv2"
    );

    expect(entries[0].value).toBe("v1\tv2");
  });

  test("reads a session cookie, which has no expiry", () => {
    const entries = parseCookieFile(".example.com\tTRUE\t/\tTRUE\t0\tk\tv");

    expect(entries[0].expires).toBe(0);
  });
});

test.describe("summarising a cookie file", () => {
  test("counts the cookies and names the domains", () => {
    const summary = summariseCookieFile(SAMPLE);

    expect(summary.count).toBe(3);
    expect(summary.domains).toEqual(["facebook.com", "instagram.com"]);
  });

  test("finds the domain the file is mainly for", () => {
    expect(primaryDomain(SAMPLE)).toBe("instagram.com");
  });

  test("recognises a file that is not a cookie file", () => {
    expect(isCookieFile(SAMPLE)).toBe(true);
    expect(isCookieFile("just some text")).toBe(false);
    expect(isCookieFile("")).toBe(false);
  });
});
