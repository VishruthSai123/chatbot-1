import {
  type AttachmentCandidate,
  collectAttachmentCandidates,
} from "@/lib/attachments/references";

export { matchCandidate } from "@/lib/attachments/references";

/**
 * Image-specific attachment matching.
 *
 * The rules themselves live in `lib/attachments/references`, shared with the
 * notebook family: matching a filename to an attachment must behave the same way
 * everywhere, or the same user request would resolve to different files in
 * different tools. This module only adds the image filter.
 */

/**
 * Collects the image attachments in a conversation, newest first.
 */
export function collectImageCandidates(
  messages: unknown[]
): AttachmentCandidate[] {
  return collectAttachmentCandidates(messages, {
    accept: (mediaType, name) => {
      if (mediaType) {
        return mediaType.startsWith("image/");
      }

      // No media type: fall back to the extension, which is what the browser
      // gives us for a file whose type it could not determine.
      return /\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)$/i.test(name);
    },
  });
}
