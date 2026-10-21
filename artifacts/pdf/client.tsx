import { Artifact } from "@/components/chat/create-artifact";
import { PdfStudioCanvas } from "@/components/chat/pdf/pdf-studio-canvas";

export const pdfArtifact = new Artifact({
  actions: [],
  content: ({
    title,
    content,
    currentVersionIndex,
    documentId,
    handleVersionChange,
    onSaveContent,
    totalVersions,
  }) => (
    <PdfStudioCanvas
      content={content}
      currentVersionIndex={currentVersionIndex}
      documentId={documentId}
      handleVersionChange={handleVersionChange}
      onSaveContent={onSaveContent}
      title={title}
      totalVersions={totalVersions}
    />
  ),
  description:
    "Native PDF Studio with page thumbnails, reordering, rotation, page extraction and text extraction",
  kind: "pdf",
  onStreamPart: ({ streamPart, setArtifact }) => {
    // A PDF version is a storage reference, never bytes: the panel resolves it to a
    // signed URL itself. The stream only has to reveal the panel and point it at
    // the document the server just wrote.
    if ((streamPart as any).type === "data-pdfDelta") {
      const deltaData = (streamPart as any).data;
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: deltaData || draftArtifact.content,
        isVisible: true,
        status: "idle",
      }));
    }
  },

  toolbar: [],
});
