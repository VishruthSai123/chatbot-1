import { toast } from "sonner";
import { Artifact } from "@/components/chat/create-artifact";
import { CopyIcon, RedoIcon, UndoIcon } from "@/components/chat/icons";
import { ImageWorkbench } from "@/components/chat/image/image-workbench";

export const imageArtifact = new Artifact({
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
      description: "Download Image",
      icon: (
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      ),
      onClick: ({ content }) => {
        if (!content) {
          return;
        }
        const link = document.createElement("a");
        link.href = content.startsWith("data:")
          ? content
          : `data:image/png;base64,${content}`;
        link.download = `superiorai-image-${Date.now()}.png`;
        link.click();
        toast.success("Download started!");
      },
    },
    {
      description: "Copy image to clipboard",
      icon: <CopyIcon size={18} />,
      onClick: ({ content }) => {
        if (!content) {
          return;
        }
        const img = new Image();
        img.src = content.startsWith("data:")
          ? content
          : `data:image/png;base64,${content}`;

        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              navigator.clipboard.write([
                new ClipboardItem({ "image/png": blob }),
              ]);
              toast.success("Copied image to clipboard!");
            }
          }, "image/png");
        };
      },
    },
  ],
  content: ({ title, content, isInline, onSaveContent }) => (
    <ImageWorkbench
      content={content}
      isInline={isInline}
      onSaveContent={onSaveContent}
      title={title}
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
  toolbar: [
    {
      description: "Indian Passport (35×45 mm)",
      icon: (
        <span className="font-mono text-[10px] font-semibold text-neutral-300">
          35×45mm
        </span>
      ),
      onClick: ({ sendMessage }) => {
        sendMessage({
          parts: [
            {
              text: "Resize this image to Indian Passport standard (35x45 mm at 300 DPI)",
              type: "text",
            },
          ],
          role: "user",
        });
      },
    },
    {
      description: "US Visa (2×2 in)",
      icon: (
        <span className="font-mono text-[10px] font-semibold text-neutral-300">
          2×2in
        </span>
      ),
      onClick: ({ sendMessage }) => {
        sendMessage({
          parts: [
            {
              text: "Resize this image to US Visa specification (2x2 inches at 300 DPI)",
              type: "text",
            },
          ],
          role: "user",
        });
      },
    },
    {
      description: "Remove Background",
      icon: (
        <span className="font-mono text-[10px] font-semibold text-emerald-400">
          Remove BG
        </span>
      ),
      onClick: ({ sendMessage }) => {
        sendMessage({
          parts: [
            {
              text: "Remove the background of this image and make it transparent",
              type: "text",
            },
          ],
          role: "user",
        });
      },
    },
  ],
});
