import { Artifact } from "@/components/chat/create-artifact";
import { SlidesStudio } from "@/components/chat/slides/slides-studio";

export const slidesArtifact = new Artifact({
  actions: [],
  content: ({ content, title }) => (
    <SlidesStudio content={content} title={title} />
  ),
  description: "Slides Studio: a deck you can preview, restyle and download",
  kind: "slides",
  onStreamPart: ({ streamPart, setArtifact }: any) => {
    // A deck's content is a descriptor, never a binary.
    if ((streamPart as any).type === "data-slidesDelta") {
      setArtifact((draftArtifact: any) => ({
        ...draftArtifact,
        content: (streamPart as any).data,
        isVisible: true,
        status: "idle",
      }));
    }
  },
  toolbar: [],
});
