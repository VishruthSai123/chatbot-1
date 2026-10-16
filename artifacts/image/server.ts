import { createDocumentHandler } from "@/lib/artifacts/server";

export const imageDocumentHandler = createDocumentHandler<"image">({
  kind: "image",
  onCreateDocument: ({ title: _title, dataStream }) => {
    // Images are generated via AI tools or uploaded directly
    dataStream.write({
      data: "",
      transient: true,
      type: "data-imageDelta",
    });
    return Promise.resolve("");
  },
  onUpdateDocument: ({ document, description: _description, dataStream }) => {
    // Retain existing image content
    dataStream.write({
      data: document.content ?? "",
      transient: true,
      type: "data-imageDelta",
    });
    return Promise.resolve(document.content ?? "");
  },
});
