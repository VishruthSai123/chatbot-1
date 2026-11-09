import { memo, useCallback } from "react";
import { useArtifact } from "@/hooks/use-artifact";
import { CrossIcon } from "./icons";

function PureArtifactCloseButton() {
  const { setArtifact } = useArtifact();
  const handleClick = useCallback(() => {
    // Hiding, not resetting, is what lets the header toggle (or a card's Open
    // panel button) bring the same document back after the user closes it.
    setArtifact((currentArtifact) => ({
      ...currentArtifact,
      isVisible: false,
    }));
  }, [setArtifact]);

  return (
    <button
      aria-label="Close panel"
      className="group flex size-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-all duration-150 hover:border-border hover:bg-muted hover:text-foreground active:scale-95"
      data-testid="artifact-close-button"
      onClick={handleClick}
      type="button"
    >
      <CrossIcon size={16} />
    </button>
  );
}

export const ArtifactCloseButton = memo(PureArtifactCloseButton, () => true);
