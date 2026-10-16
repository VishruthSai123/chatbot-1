import "server-only";

export interface ImageSessionRecord {
  base64: string;
  chatId?: string;
  documentId?: string;
  mimeType?: string;
  sourceUrl?: string;
  storageKey?: string;
  timestamp: number;
  title: string;
  userId?: string;
}

const MAX_REGISTRY_SIZE = 50;

class ImageSessionRegistry {
  private readonly byDocumentId = new Map<string, ImageSessionRecord>();
  private readonly byChatId = new Map<string, ImageSessionRecord>();
  private readonly byUserId = new Map<string, ImageSessionRecord>();

  /**
   * Pins an active image in the server-side memory registry.
   */
  setActiveImage(
    data: Omit<ImageSessionRecord, "timestamp"> & { timestamp?: number }
  ): ImageSessionRecord {
    const record: ImageSessionRecord = {
      base64: data.base64,
      chatId: data.chatId,
      documentId: data.documentId,
      mimeType: data.mimeType || "image/png",
      sourceUrl: data.sourceUrl,
      storageKey: data.storageKey,
      timestamp: data.timestamp || Date.now(),
      title: data.title || "Photo",
      userId: data.userId,
    };

    if (data.documentId) {
      this.byDocumentId.set(data.documentId, record);
    }
    if (data.chatId) {
      this.byChatId.set(data.chatId, record);
    }
    if (data.userId) {
      this.byUserId.set(data.userId, record);
    }

    // Prune if exceeded
    if (this.byDocumentId.size > MAX_REGISTRY_SIZE) {
      const oldestKey = this.byDocumentId.keys().next().value;
      if (oldestKey) {
        this.byDocumentId.delete(oldestKey);
      }
    }
    if (this.byChatId.size > MAX_REGISTRY_SIZE) {
      const oldestKey = this.byChatId.keys().next().value;
      if (oldestKey) {
        this.byChatId.delete(oldestKey);
      }
    }

    return record;
  }

  /**
   * Retrieves an active image from the session registry using the best available key.
   */
  getActiveImage({
    documentId,
    chatId,
    userId,
  }: {
    documentId?: string;
    chatId?: string;
    userId?: string;
  }): ImageSessionRecord | null {
    if (documentId && this.byDocumentId.has(documentId)) {
      return this.byDocumentId.get(documentId) ?? null;
    }

    if (chatId && this.byChatId.has(chatId)) {
      return this.byChatId.get(chatId) ?? null;
    }

    if (userId && this.byUserId.has(userId)) {
      return this.byUserId.get(userId) ?? null;
    }

    return null;
  }

  /**
   * Clears a specific document or chat from the registry.
   */
  clear({ documentId, chatId }: { documentId?: string; chatId?: string }) {
    if (documentId) {
      this.byDocumentId.delete(documentId);
    }
    if (chatId) {
      this.byChatId.delete(chatId);
    }
  }
}

// Global singleton to persist across HMR during local development
const globalRegistry = globalThis as unknown as {
  _activeImageRegistry?: ImageSessionRegistry;
};

export const activeImageRegistry =
  globalRegistry._activeImageRegistry ?? new ImageSessionRegistry();

if (process.env.NODE_ENV !== "production") {
  globalRegistry._activeImageRegistry = activeImageRegistry;
}
