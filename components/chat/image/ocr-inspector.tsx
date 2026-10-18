"use client";

import { Copy, FileText, Loader2, ScanText } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface OcrInspectorProps {
  /** Parameters the model applied on the last image tool call; pre-fills the panel. */
  appliedParams?: Record<string, unknown> | null;
  documentId?: string;
  isGuest?: boolean;
  isProcessing: boolean;
  ocrText?: string;
  onRequireAuth?: () => void;
  setIsProcessing: (val: boolean) => void;
  /** Which version of the document is on screen; the server resolves its bytes. */
  versionIndex?: number;
}

export const OcrInspector = memo(function InnerOcrInspector({
  documentId,
  ocrText,
  isProcessing,
  setIsProcessing,
  isGuest,
  onRequireAuth,
  versionIndex,
}: OcrInspectorProps) {
  const [text, setText] = useState<string>(ocrText ?? "");
  const [ranOnce, setRanOnce] = useState<boolean>(Boolean(ocrText));

  useEffect(() => {
    if (ocrText) {
      setText(ocrText);
      setRanOnce(true);
    }
  }, [ocrText]);

  const handleExtract = useCallback(async () => {
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    if (isProcessing) {
      return;
    }
    setIsProcessing(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/image`,
        {
          body: JSON.stringify({
            action: "ocr",
            documentId,
            params: { format: "markdown" },
            versionIndex,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );

      if (!response.ok) {
        if (response.status === 403) {
          onRequireAuth?.();
          return;
        }
        let errMessage = "OCR failed";
        try {
          const errData = await response.json();
          if (errData.requiresAuth) {
            onRequireAuth?.();
            return;
          }
          errMessage = errData.error || errMessage;
        } catch {
          // ignore
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (data.ocr?.text) {
        setText(data.ocr.text);
        setRanOnce(true);
        toast.success(`Extracted ${data.ocr.wordCount} words`);
      } else {
        setText("");
        setRanOnce(true);
        toast.success("No text detected in the image");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to extract text");
    } finally {
      setIsProcessing(false);
    }
  }, [
    isGuest,
    onRequireAuth,
    isProcessing,
    setIsProcessing,
    documentId,
    versionIndex,
  ]);

  const handleCopy = useCallback(async () => {
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Text copied to clipboard");
    } catch {
      toast.error("Failed to copy text");
    }
  }, [text]);

  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="flex h-full flex-col justify-between p-3.5 space-y-3.5 text-xs select-none">
      <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="size-3.5" />
            <span className="text-[11px]">
              {ranOnce ? `${wordCount} words detected` : "Ready to scan"}
            </span>
          </div>
          {text ? (
            <button
              className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
              onClick={handleCopy}
              type="button"
            >
              <Copy className="size-3" />
              Copy
            </button>
          ) : null}
        </div>

        <div className="flex-1 min-h-[140px] overflow-y-auto rounded-xl border border-border/40 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {text ? (
            text
          ) : (
            <span className="text-muted-foreground">
              {ranOnce
                ? "No legible text was found in this image."
                : "Run OCR to extract text, tables, and layout from the image."}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 pt-2.5 border-t border-border/50">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 cursor-pointer shadow-xs"
          disabled={isProcessing}
          onClick={handleExtract}
          type="button"
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Extracting text...</span>
            </>
          ) : (
            <>
              <ScanText className="size-3.5" />
              <span>{ranOnce ? "Re-run OCR" : "Extract Text"}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});
