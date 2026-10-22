import { AudioStudio } from "@/components/chat/audio/audio-studio";
import { Artifact } from "@/components/chat/create-artifact";

export const audioArtifact = new Artifact({
  actions: [],
  content: ({
    title,
    content,
    currentVersionIndex,
    documentId,
    handleVersionChange,
    totalVersions,
  }) => (
    <AudioStudio
      content={content}
      currentVersionIndex={currentVersionIndex}
      documentId={documentId}
      handleVersionChange={handleVersionChange}
      title={title}
      totalVersions={totalVersions}
    />
  ),
  description:
    "Audio Studio: a waveform, a transport, and a timestamped transcript",
  kind: "audio",
  onStreamPart: ({ streamPart, setArtifact }) => {
    // An audio document's content is a descriptor, never the media itself.
    if ((streamPart as any).type === "data-audioDelta") {
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
