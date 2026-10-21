import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind, ImageToolMode } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { getWeather } from "./ai/tools/get-weather";
import type {
  imageCollage,
  imageCompress,
  imageConvert,
  imageCrop,
  imageListPresets,
  imageOcr,
  imageOverlay,
  imagePixelate,
  imageRemoveBg,
  imageResize,
  imageRotate,
  imageStitch,
  imageUpscaleEnhance,
} from "./ai/tools/image-tools";
import type {
  imageToPdf,
  pdfArrange,
  pdfExtractText,
  pdfGetInfo,
  pdfMerge,
  pdfRotatePages,
  pdfSplit,
} from "./ai/tools/pdf-tools";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { research } from "./ai/tools/research";
import type {
  sheetConvertFormat,
  sheetFilterSort,
  sheetGetInfo,
  sheetRemoveDuplicates,
  sheetSummaryStats,
} from "./ai/tools/sheet-tools";
import type { updateDocument } from "./ai/tools/update-document";
import type { readUrl, webSearch } from "./ai/tools/web-search";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type imageResizeTool = InferUITool<ReturnType<typeof imageResize>>;
type imageRemoveBgTool = InferUITool<ReturnType<typeof imageRemoveBg>>;
type imageCropTool = InferUITool<ReturnType<typeof imageCrop>>;
type imageCompressTool = InferUITool<ReturnType<typeof imageCompress>>;
type imageConvertTool = InferUITool<ReturnType<typeof imageConvert>>;
type imageUpscaleEnhanceTool = InferUITool<
  ReturnType<typeof imageUpscaleEnhance>
>;
type imagePixelateTool = InferUITool<ReturnType<typeof imagePixelate>>;
type imageRotateTool = InferUITool<ReturnType<typeof imageRotate>>;
type imageOcrTool = InferUITool<ReturnType<typeof imageOcr>>;
type imageListPresetsTool = InferUITool<ReturnType<typeof imageListPresets>>;
type imageStitchTool = InferUITool<ReturnType<typeof imageStitch>>;
type imageOverlayTool = InferUITool<ReturnType<typeof imageOverlay>>;
type imageCollageTool = InferUITool<ReturnType<typeof imageCollage>>;
type sheetGetInfoTool = InferUITool<ReturnType<typeof sheetGetInfo>>;
type sheetFilterSortTool = InferUITool<ReturnType<typeof sheetFilterSort>>;
type sheetRemoveDuplicatesTool = InferUITool<
  ReturnType<typeof sheetRemoveDuplicates>
>;
type sheetSummaryStatsTool = InferUITool<ReturnType<typeof sheetSummaryStats>>;
type sheetConvertFormatTool = InferUITool<
  ReturnType<typeof sheetConvertFormat>
>;
type webSearchTool = InferUITool<ReturnType<typeof webSearch>>;
type readUrlTool = InferUITool<ReturnType<typeof readUrl>>;
type researchTool = InferUITool<ReturnType<typeof research>>;
type pdfGetInfoTool = InferUITool<ReturnType<typeof pdfGetInfo>>;
type pdfMergeTool = InferUITool<ReturnType<typeof pdfMerge>>;
type pdfSplitTool = InferUITool<ReturnType<typeof pdfSplit>>;
type pdfArrangeTool = InferUITool<ReturnType<typeof pdfArrange>>;
type pdfRotatePagesTool = InferUITool<ReturnType<typeof pdfRotatePages>>;
type pdfExtractTextTool = InferUITool<ReturnType<typeof pdfExtractText>>;
type imageToPdfTool = InferUITool<ReturnType<typeof imageToPdf>>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  imageResize: imageResizeTool;
  imageRemoveBg: imageRemoveBgTool;
  imageCrop: imageCropTool;
  imageCompress: imageCompressTool;
  imageConvert: imageConvertTool;
  imageUpscaleEnhance: imageUpscaleEnhanceTool;
  imagePixelate: imagePixelateTool;
  imageRotate: imageRotateTool;
  imageOcr: imageOcrTool;
  imageListPresets: imageListPresetsTool;
  imageStitch: imageStitchTool;
  imageOverlay: imageOverlayTool;
  imageCollage: imageCollageTool;
  pdfGetInfo: pdfGetInfoTool;
  pdfMerge: pdfMergeTool;
  pdfSplit: pdfSplitTool;
  pdfArrange: pdfArrangeTool;
  pdfRotatePages: pdfRotatePagesTool;
  pdfExtractText: pdfExtractTextTool;
  imageToPdf: imageToPdfTool;
  sheetGetInfo: sheetGetInfoTool;
  sheetFilterSort: sheetFilterSortTool;
  sheetRemoveDuplicates: sheetRemoveDuplicatesTool;
  sheetSummaryStats: sheetSummaryStatsTool;
  sheetConvertFormat: sheetConvertFormatTool;
  webSearch: webSearchTool;
  readUrl: readUrlTool;
  research: researchTool;
};

export type WaitingStatusData = {
  phase:
    | "waiting"
    | "still-waiting"
    | "health"
    | "thinking"
    | "searching"
    | "reading"
    | "researching";
  message: string;
  modelId: string;
  modelName: string;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
  "waiting-status": WaitingStatusData;
  imageToolMode?: ImageToolMode;
  imageToolParams: Record<string, unknown>;
  imageOcrText: string;
  pdfDelta: string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
  documentId?: string;
};
