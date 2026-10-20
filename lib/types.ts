import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind, ImageToolMode } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { getWeather } from "./ai/tools/get-weather";
import type {
  imageCompress,
  imageConvert,
  imageCrop,
  imageListPresets,
  imageOcr,
  imagePixelate,
  imageRemoveBg,
  imageResize,
  imageRotate,
  imageUpscaleEnhance,
} from "./ai/tools/image-tools";
import type {
  pdfArrange,
  pdfExtractText,
  pdfGetInfo,
  pdfMerge,
  pdfRotatePages,
  pdfSplit,
} from "./ai/tools/pdf-tools";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { updateDocument } from "./ai/tools/update-document";
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
type pdfGetInfoTool = InferUITool<ReturnType<typeof pdfGetInfo>>;
type pdfMergeTool = InferUITool<ReturnType<typeof pdfMerge>>;
type pdfSplitTool = InferUITool<ReturnType<typeof pdfSplit>>;
type pdfArrangeTool = InferUITool<ReturnType<typeof pdfArrange>>;
type pdfRotatePagesTool = InferUITool<ReturnType<typeof pdfRotatePages>>;
type pdfExtractTextTool = InferUITool<ReturnType<typeof pdfExtractText>>;

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
  pdfGetInfo: pdfGetInfoTool;
  pdfMerge: pdfMergeTool;
  pdfSplit: pdfSplitTool;
  pdfArrange: pdfArrangeTool;
  pdfRotatePages: pdfRotatePagesTool;
  pdfExtractText: pdfExtractTextTool;
};

export type WaitingStatusData = {
  phase: "waiting" | "still-waiting" | "health" | "thinking";
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
