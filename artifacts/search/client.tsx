import { Artifact } from "@/components/chat/create-artifact";
import { SearchStudio } from "@/components/chat/search/search-studio";

export const searchArtifact = new Artifact({
  actions: [],
  content: ({ content, title }) => (
    <SearchStudio content={content} title={title} />
  ),
  description:
    "Search Studio: the full answer or research report with every source",
  kind: "search",
  onStreamPart: () => {
    // Search results are opened from their card, not streamed as a document.
  },
  toolbar: [],
});
