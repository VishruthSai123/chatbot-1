import { parse, unparse } from "papaparse";
import { toast } from "sonner";
import { Artifact } from "@/components/chat/create-artifact";
import {
  CopyIcon,
  LineChartIcon,
  RedoIcon,
  SparklesIcon,
  UndoIcon,
} from "@/components/chat/icons";
import { DataStudioCanvas } from "@/components/chat/sheet/data-studio-canvas";
import { SpreadsheetEditor } from "@/components/chat/sheet-editor";
import { isSheetRef } from "@/lib/sheet/ref";

type Metadata = Record<string, never>;

export const sheetArtifact = new Artifact<"sheet", Metadata>({
  actions: [
    {
      description: "View Previous version",
      icon: <UndoIcon size={18} />,
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }

        return false;
      },
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
    },
    {
      description: "View Next version",
      icon: <RedoIcon size={18} />,
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }

        return false;
      },
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
    },
    {
      description: "Copy as .csv",
      icon: <CopyIcon />,
      onClick: ({ content }) => {
        // A stored file holds a reference, not the rows; copying it as text
        // means fetching the real thing first.
        if (isSheetRef(content)) {
          toast.info("Download the file to copy its contents.");
          return;
        }

        const parsed = parse<string[]>(content, { skipEmptyLines: true });

        const nonEmptyRows = parsed.data.filter((row) =>
          row.some((cell) => cell.trim() !== "")
        );

        const cleanedCsv = unparse(nonEmptyRows);

        navigator.clipboard.writeText(cleanedCsv);
        toast.success("Copied csv to clipboard!");
      },
    },
  ],
  content: ({
    content,
    currentVersionIndex,
    documentId,
    handleVersionChange,
    onSaveContent,
    status,
    title,
    totalVersions,
  }) =>
    // Two shapes of sheet, two canvases. A file uploaded by the user is a
    // reference to a stored document and gets the full Data Studio; a sheet the
    // model wrote is raw CSV in the document and keeps the inline editor, which
    // can write cell edits straight back into the text.
    isSheetRef(content) ? (
      <DataStudioCanvas
        content={content}
        currentVersionIndex={currentVersionIndex}
        documentId={documentId}
        handleVersionChange={handleVersionChange}
        title={title}
        totalVersions={totalVersions}
      />
    ) : (
      <SpreadsheetEditor
        content={content}
        currentVersionIndex={currentVersionIndex}
        isCurrentVersion={true}
        saveContent={onSaveContent}
        status={status}
      />
    ),
  description: "Useful for working with spreadsheets",
  initialize: () => null,
  kind: "sheet",
  onStreamPart: ({ setArtifact, streamPart }) => {
    if (streamPart.type === "data-sheetDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: true,
        status: "streaming",
      }));
    }
  },
  toolbar: [
    {
      description: "Format and clean data",
      icon: <SparklesIcon />,
      onClick: ({ sendMessage }) => {
        sendMessage({
          parts: [
            { text: "Can you please format and clean the data?", type: "text" },
          ],
          role: "user",
        });
      },
    },
    {
      description: "Analyze and visualize data",
      icon: <LineChartIcon />,
      onClick: ({ sendMessage }) => {
        sendMessage({
          parts: [
            {
              text: "Can you please analyze and visualize the data by creating a new code artifact in python?",
              type: "text",
            },
          ],
          role: "user",
        });
      },
    },
  ],
});
