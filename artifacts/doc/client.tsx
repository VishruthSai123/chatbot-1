import { Artifact } from "@/components/chat/create-artifact";
import { DocumentStudio } from "@/components/chat/doc/document-studio";

export const docArtifact = new Artifact({
  actions: [],
  content: ({
    title,
    content,
    currentVersionIndex,
    documentId,
    handleVersionChange,
    totalVersions,
  }) => (
    <DocumentStudio
      content={content}
      currentVersionIndex={currentVersionIndex}
      documentId={documentId}
      handleVersionChange={handleVersionChange}
      title={title}
      totalVersions={totalVersions}
    />
  ),
  description:
    "Document Studio: an outline, reading statistics and a rendered document, with side-by-side comparison",
  kind: "doc",
  onStreamPart: ({ streamPart, setArtifact }) => {
    // A document's content is a descriptor plus its text, never the file itself.
    if ((streamPart as any).type === "data-docDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: (streamPart as any).data,
        isVisible: true,
        status: "idle",
      }));
    }
  },
  toolbar: [],
});
