"use client";

import { useEffect } from "react";

type SpireAndroidBridge = {
  onWebReady?: () => void;
  setTheme?: (dark: boolean, colorHex: string) => void;
};

const FALLBACK_BACKGROUND = {
  dark: "#09090b",
  light: "#ffffff",
} as const;

function hexChannel(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}`;
}

/** Converts a linear-light sRGB channel to the 0-255 display value. */
function linearToChannel(value: number): number {
  const encoded =
    value <= 0.003_130_8 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;

  const red = 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s;
  const green =
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s;
  const blue = -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s;

  return rgbToHex(
    linearToChannel(red),
    linearToChannel(green),
    linearToChannel(blue)
  );
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = l - chroma / 2;
  return rgbToHex(
    (red + offset) * 255,
    (green + offset) * 255,
    (blue + offset) * 255
  );
}

/**
 * CSS `lab()` uses the D50 white point; convert to D65 before sRGB.
 * Chromium serialises the sidebar token this way even when the source is
 * `oklch()`, so both formats need to resolve to the same hex.
 */
function labToHex(lightness: number, a: number, b: number): string {
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const epsilon = 216 / 24_389;
  const kappa = 24_389 / 27;
  const xr = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const yr = lightness > kappa * epsilon ? fy ** 3 : lightness / kappa;
  const zr = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;

  // D50 reference white and Bradford adaptation to D65.
  const x = xr * 0.964_22;
  const y = yr;
  const z = zr * 0.825_21;
  const x65 =
    0.955_473_421_488_075 * x -
    0.023_098_454_948_765 * y +
    0.063_259_243_200_571 * z;
  const y65 =
    -0.028_369_709_333_864 * x +
    1.009_995_398_081_304 * y +
    0.021_041_441_191_917 * z;
  const z65 =
    0.012_314_014_864_482 * x -
    0.020_507_649_298_899 * y +
    1.330_365_926_242_124 * z;

  const red =
    3.240_969_941_904_523 * x65 -
    1.537_383_177_570_094 * y65 -
    0.498_610_760_293_003 * z65;
  const green =
    -0.969_243_636_280_88 * x65 +
    1.875_967_501_507_72 * y65 +
    0.041_555_057_407_176 * z65;
  const blue =
    0.055_630_079_696_994 * x65 -
    0.203_976_958_888_977 * y65 +
    1.056_971_514_242_879 * z65;

  return rgbToHex(
    linearToChannel(red),
    linearToChannel(green),
    linearToChannel(blue)
  );
}

function parseCssColor(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return `#${hex[1].toLowerCase()}`;
  }

  const oklch = value.match(
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i
  );
  if (oklch) {
    const lightness = Number(oklch[1]) / (oklch[2] === "%" ? 100 : 1);
    const chroma = Number(oklch[3]) / (oklch[4] === "%" ? 100 : 1);
    return oklchToHex(lightness, chroma, Number(oklch[5]));
  }

  const lab = value.match(
    /^lab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*[\d.]+%?\s*)?\)$/i
  );
  if (lab) {
    return labToHex(Number(lab[1]), Number(lab[3]), Number(lab[4]));
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) {
    return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }

  const hsl = value.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i
  );
  if (hsl) {
    return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  }

  return null;
}

/**
 * The status-bar colour Android paints behind the transparent system bar.
 *
 * The bar sits directly above the web header, so it uses `--sidebar`, the same
 * token as that header. Chromium serialises computed `oklch()` colors as
 * `lab(...)`, so the raw custom property is parsed here instead.
 */
function readThemeBackground(isDark: boolean): string {
  const sidebar = getComputedStyle(document.documentElement)
    .getPropertyValue("--sidebar")
    .trim();
  const sidebarHex = parseCssColor(sidebar);
  if (sidebarHex) {
    return sidebarHex;
  }

  const metas = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  );
  const match =
    metas.find((meta) => meta.media && window.matchMedia(meta.media).matches) ??
    metas[0];
  return (
    parseCssColor(match?.content) ??
    FALLBACK_BACKGROUND[isDark ? "dark" : "light"]
  );
}

/**
 * Tells the Android WebView when React is hydrated, and keeps the native
 * system bars in sync with the web theme.
 *
 * The native shell keeps its skeleton over the WebView until readiness fires.
 * Without it, a tap on Send during hydration submits the plain HTML form and
 * reloads the whole page. The chat screen has no native header, so the page
 * also owns the status-bar colour while it is on screen.
 */
export function WebReadySignal() {
  useEffect(() => {
    document.documentElement.dataset.spireReady = "true";

    const bridge = (
      window as typeof window & { SpireAndroid?: SpireAndroidBridge }
    ).SpireAndroid;
    bridge?.onWebReady?.();

    return () => {
      delete document.documentElement.dataset.spireReady;
    };
  }, []);

  useEffect(() => {
    const bridge = (
      window as typeof window & { SpireAndroid?: SpireAndroidBridge }
    ).SpireAndroid;
    if (!bridge?.setTheme) {
      return;
    }

    const report = () => {
      const isDark = document.documentElement.classList.contains("dark");
      bridge.setTheme?.(isDark, readThemeBackground(isDark));
    };

    report();
    const observer = new MutationObserver(report);
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
