import { expect, test } from "@playwright/test";

import {
  detectPlatform,
  downloadFileName,
  isAllowedMediaUrl,
  isPublicAddress,
} from "../../lib/media/url";

test.describe("the address boundary", () => {
  test("public addresses are allowed", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  test("private and loopback addresses are refused", () => {
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.0.0.5")).toBe(false);
    expect(isPublicAddress("172.16.0.1")).toBe(false);
    expect(isPublicAddress("172.31.255.254")).toBe(false);
    expect(isPublicAddress("192.168.1.1")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("0.0.0.0")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fd00::1")).toBe(false);
  });

  test("the cloud metadata address is refused", () => {
    // 169.254.169.254 is how a cloud instance is asked for its own credentials.
    expect(isPublicAddress("169.254.169.254")).toBe(false);
  });

  test("an IPv4-mapped IPv6 address is judged as the address it carries", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  test("a hostname that is not an address is not one", () => {
    expect(isPublicAddress("example.com")).toBe(false);
  });
});

test.describe("which links may be fetched", () => {
  test("ordinary web links are allowed", () => {
    expect(
      isAllowedMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ).toBe(true);
    expect(isAllowedMediaUrl("http://example.com/video.mp4")).toBe(true);
  });

  test("other schemes are refused", () => {
    expect(isAllowedMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedMediaUrl("ftp://example.com/x.mp4")).toBe(false);
    expect(isAllowedMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedMediaUrl("data:video/mp4;base64,AAAA")).toBe(false);
  });

  test("loopback and local names are refused", () => {
    expect(isAllowedMediaUrl("http://localhost:3000/x")).toBe(false);
    expect(isAllowedMediaUrl("http://127.0.0.1/x")).toBe(false);
    expect(isAllowedMediaUrl("http://[::1]/x")).toBe(false);
  });

  test("a private address written directly in the link is refused", () => {
    expect(isAllowedMediaUrl("http://10.0.0.1/admin")).toBe(false);
    expect(isAllowedMediaUrl("http://192.168.0.1/admin")).toBe(false);
  });

  test("nonsense is refused rather than crashing", () => {
    expect(isAllowedMediaUrl("not a url")).toBe(false);
    expect(isAllowedMediaUrl("")).toBe(false);
  });
});

test.describe("recognising a platform", () => {
  test("finds the known ones", () => {
    expect(detectPlatform("https://www.youtube.com/watch?v=abc")).toBe(
      "youtube"
    );
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
    expect(detectPlatform("https://vimeo.com/123")).toBe("vimeo");
    expect(detectPlatform("https://soundcloud.com/artist/track")).toBe(
      "soundcloud"
    );
  });

  test("does not mistake a lookalike for the real thing", () => {
    expect(detectPlatform("https://youtube.com.evil.example/watch")).toBe(
      "unknown"
    );
    expect(detectPlatform("https://notyoutube.com/watch")).toBe("unknown");
  });

  test("an unparseable link is simply unknown", () => {
    expect(detectPlatform("nonsense")).toBe("unknown");
  });
});

test.describe("naming the file", () => {
  test("keeps a readable name and adds the extension", () => {
    expect(downloadFileName("A Song Title", "mp3")).toBe("A-Song-Title.mp3");
  });

  test("strips characters a file system would object to", () => {
    expect(downloadFileName('bad/name: "here"', "mp4")).toBe(
      "badname-here.mp4"
    );
  });

  test("falls back when there is nothing usable", () => {
    expect(downloadFileName("///", "mp4")).toBe("download.mp4");
  });
});
