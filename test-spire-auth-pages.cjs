"use strict";
const { chromium } = require("@playwright/test");

const BASE = "https://chatbot-1-beige.vercel.app";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { height: 844, width: 390 } });

  await page.goto(
    `${BASE}/api/auth/guest?redirectUrl=%2Flogin%3Fembed%3Dandroid`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForURL("**/login?embed=android", { timeout: 30_000 });
  await page.waitForTimeout(1800);

  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a")].map((link) => ({
      href: link.getAttribute("href"),
      text: link.textContent?.trim(),
    }));
    return {
      links,
      title: document.body.innerText.includes("Welcome back"),
      url: location.href,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({
    path: `${process.env.TEMP}\\spire-login-embed.png`,
  });

  await page.getByRole("link", { name: "Sign up" }).click();
  await page.waitForURL("**/register?embed=android", { timeout: 15_000 });
  await page.waitForTimeout(800);
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        back: [...document.querySelectorAll("a")]
          .find((link) => link.textContent?.trim() === "Back")
          ?.getAttribute("href"),
        title: document.body.innerText.includes("Create account"),
        url: location.href,
      })),
      null,
      2
    )
  );

  await browser.close();
}

main();
