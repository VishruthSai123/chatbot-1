import { expect, test } from "@playwright/test";

import { proxyArgsFromEnv, proxyFromEnv } from "../../lib/media/proxy";

test.describe("finding the proxy", () => {
  test("uses YTDLP_PROXY first", () => {
    const env = {
      HTTPS_PROXY: "http://general:8080",
      YTDLP_PROXY: "http://media:8080",
    };

    expect(proxyFromEnv(env)).toBe("http://media:8080");
  });

  test("falls back to the platform's HTTPS_PROXY", () => {
    expect(proxyFromEnv({ HTTPS_PROXY: "http://general:8080" })).toBe(
      "http://general:8080"
    );
    expect(proxyFromEnv({ https_proxy: "http://lower:8080" })).toBe(
      "http://lower:8080"
    );
  });

  test("ignores empty and whitespace values", () => {
    expect(proxyFromEnv({ YTDLP_PROXY: "   " })).toBeUndefined();
    expect(proxyFromEnv({})).toBeUndefined();
  });

  test("trims the value", () => {
    expect(proxyFromEnv({ YTDLP_PROXY: "  http://p:1  " })).toBe("http://p:1");
  });
});

test.describe("turning it into arguments", () => {
  test("passes it to yt-dlp", () => {
    expect(proxyArgsFromEnv({ YTDLP_PROXY: "http://p:8080" })).toEqual([
      "--proxy",
      "http://p:8080",
    ]);
  });

  test("is an empty list when there is none, so it can be spread", () => {
    expect(proxyArgsFromEnv({})).toEqual([]);
  });
});
