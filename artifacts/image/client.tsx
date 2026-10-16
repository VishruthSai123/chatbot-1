import { toast } from "sonner";
import { Artifact } from "@/components/chat/create-artifact";
import { CopyIcon, RedoIcon, UndoIcon } from "@/components/chat/icons";
import { ImageStudioCanvas } from "@/components/chat/image-studio-canvas";

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
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      ),
      onClick: ({ content }) => {
        if (!content) return;
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
        if (!content) return;
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
    <ImageStudioCanvas
      title={title}
      content={content}
      isInline={isInline}
      onSaveContent={onSaveContent}
    />
  ),
  description: "Native Image Studio with hardware-accelerated processing and neural background removal",
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
          role: "user",
          parts: [
            {
              type: "text",
              text: "Resize this image to Indian Passport standard (35x45 mm at 300 DPI)",
            },
          ],
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
          role: "user",
          parts: [
            {
              type: "text",
              text: "Resize this image to US Visa specification (2x2 inches at 300 DPI)",
            },
          ],
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
          role: "user",
          parts: [
            {
              type: "text",
              text: "Remove the background of this image and make it transparent",
            },
          ],
        });
      },
    },
  ],
});
