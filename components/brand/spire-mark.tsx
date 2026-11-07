import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The Spire mark: one continuous ribbon with round ends, drawn as a stroked
 * path so it stays crisp from a 16 px sidebar icon to a 1024 px app icon.
 */
const MARK_PATH =
  "M494.00,215.00C517.67,214.83 604.50,213.17 636.00,214.00C667.50,214.83 673.00,218.00 683.00,220.00C693.00,222.00 692.67,223.67 696.00,226.00C699.33,228.33 700.00,225.67 703.00,234.00C706.00,242.33 712.83,263.50 714.00,276.00C715.17,288.50 713.33,295.67 710.00,309.00C706.67,322.33 704.00,331.17 694.00,356.00C684.00,380.83 663.00,430.83 650.00,458.00C637.00,485.17 624.83,505.33 616.00,519.00C607.17,532.67 602.67,535.00 597.00,540.00C591.33,545.00 589.00,546.50 582.00,549.00C575.00,551.50 565.33,555.00 555.00,555.00C544.67,555.00 528.17,551.33 520.00,549.00C511.83,546.67 510.83,545.00 506.00,541.00C501.17,537.00 498.00,535.50 491.00,525.00C484.00,514.50 476.67,505.00 464.00,478.00C451.33,451.00 437.17,418.17 415.00,363.00C392.83,307.83 350.50,193.50 331.00,147.00C311.50,100.50 306.83,98.17 298.00,84.00C289.17,69.83 283.17,66.83 278.00,62.00C272.83,57.17 275.50,57.67 267.00,55.00C258.50,52.33 240.67,46.00 227.00,46.00C213.33,46.00 195.67,51.00 185.00,55.00C174.33,59.00 170.00,63.67 163.00,70.00C156.00,76.33 150.00,83.33 143.00,93.00C136.00,102.67 131.00,109.17 121.00,128.00C111.00,146.83 93.00,184.17 83.00,206.00C73.00,227.83 66.67,244.00 61.00,259.00C55.33,274.00 51.67,285.00 49.00,296.00C46.33,307.00 44.67,313.83 45.00,325.00C45.33,336.17 49.33,355.33 51.00,363.00C52.67,370.67 52.50,368.00 55.00,371.00C57.50,374.00 59.33,378.00 66.00,381.00C72.67,384.00 85.33,387.17 95.00,389.00C104.67,390.83 93.50,391.50 124.00,392.00C154.50,392.50 252.33,392.00 278.00,392.00";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function SpireMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0", className)}
      fill="none"
      viewBox="0 0 760 602"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d={MARK_PATH}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={73}
      />
    </svg>
  );
}

/**
 * The supplied Spire wordmark, used as a mask so it can inherit any text
 * colour. Set a height with `className`; the aspect ratio supplies the width.
 */
export function SpireWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="Spire"
      className={cn("inline-block shrink-0 bg-current align-middle", className)}
      role="img"
      style={{
        aspectRatio: "935 / 218",
        maskImage: `url("${basePath}/brand/spire-wordmark.png")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${basePath}/brand/spire-wordmark.png")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
