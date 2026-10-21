import { Artifact } from "@/components/chat/create-artifact";
import { NotebookStudio } from "@/components/chat/notebook/notebook-studio";

export const notebookArtifact = new Artifact({
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
    <NotebookStudio
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
    "A grounded notebook: a set of sources with a cited conversation over them",
  kind: "notebook",
  onStreamPart: ({ streamPart, setArtifact }) => {
    // A notebook's content is a source list, never bytes, so the stream only has
    // to reveal the panel.
    if ((streamPart as any).type === "data-notebookDelta") {
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
