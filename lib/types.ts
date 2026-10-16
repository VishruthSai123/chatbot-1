import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind, ImageToolMode } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { getWeather } from "./ai/tools/get-weather";
import type {
  imageCompress,
  imageConvert,
  imageCrop,
  imageOcr,
  imagePixelate,
  imageRemoveBg,
  imageResizePhysical,
  imageUpscaleEnhance,
} from "./ai/tools/image-tools";
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
type imageResizePhysicalTool = InferUITool<
  ReturnType<typeof imageResizePhysical>
>;
type imageRemoveBgTool = InferUITool<ReturnType<typeof imageRemoveBg>>;
type imageCropTool = InferUITool<ReturnType<typeof imageCrop>>;
type imageCompressTool = InferUITool<ReturnType<typeof imageCompress>>;
type imageConvertTool = InferUITool<ReturnType<typeof imageConvert>>;
type imageUpscaleEnhanceTool = InferUITool<
  ReturnType<typeof imageUpscaleEnhance>
>;
type imagePixelateTool = InferUITool<ReturnType<typeof imagePixelate>>;
type imageOcrTool = InferUITool<ReturnType<typeof imageOcr>>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  imageResizePhysical: imageResizePhysicalTool;
  imageRemoveBg: imageRemoveBgTool;
  imageCrop: imageCropTool;
  imageCompress: imageCompressTool;
  imageConvert: imageConvertTool;
  imageUpscaleEnhance: imageUpscaleEnhanceTool;
  imagePixelate: imagePixelateTool;
  imageOcr: imageOcrTool;
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
  imageOcrText: string;
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
