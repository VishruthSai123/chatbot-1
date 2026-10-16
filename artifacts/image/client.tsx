import { Artifact } from "@/components/chat/create-artifact";
import { ImageWorkbench } from "@/components/chat/image/image-workbench";

export const imageArtifact = new Artifact({
  actions: [],
  content: ({
    title,
    content,
    isInline,
    onSaveContent,
    currentVersionIndex,
    handleVersionChange,
    totalVersions,
  }) => (
    <ImageWorkbench
      content={content}
      currentVersionIndex={currentVersionIndex}
      handleVersionChange={handleVersionChange}
      isInline={isInline}
      onSaveContent={onSaveContent}
      title={title}
      totalVersions={totalVersions}
    />
  ),
  description:
    "Native Image Workbench with dedicated contextual inspectors and neural background removal",
  kind: "image",
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === "data-imageDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: true,
        status: "idle",
      }));
    }
    if ((streamPart as any).type === "data-imageToolMode") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        toolMode: (streamPart as any).data,
      }));
    }
  },
  toolbar: [],
});
