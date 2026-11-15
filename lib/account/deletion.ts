import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { deleteUserAccountData } from "@/lib/db/queries";
import { artifact } from "@/lib/db/schema";
import { deleteArtifact } from "@/lib/storage";

const DELETE_CONCURRENCY = 6;

async function deleteStorageBatch(
  storageKeys: string[],
  failedKeys: string[]
): Promise<void> {
  if (storageKeys.length === 0) {
    return;
  }

  const batch = storageKeys.slice(0, DELETE_CONCURRENCY);
  const remaining = storageKeys.slice(DELETE_CONCURRENCY);
  const results = await Promise.allSettled(
    batch.map((storageKey) => deleteArtifact(storageKey))
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failedKeys.push(batch[index]);
    }
  });

  await deleteStorageBatch(remaining, failedKeys);
}

/**
 * Deletes an account and all of its files.
 *
 * Stored objects are removed before the rows so a storage failure leaves the
 * account intact and retryable. Once every object is gone, the database
 * transaction removes the account's rows atomically.
 */
export async function deleteUserAccount(userId: string) {
  if (!userId) {
    throw new Error("A user id is required.");
  }

  const artifactRows = await db
    .select({ storageKey: artifact.storageKey })
    .from(artifact)
    .where(eq(artifact.userId, userId));

  const storageKeys = [
    ...new Set(
      artifactRows
        .map((row) => row.storageKey)
        .filter((key): key is string => Boolean(key))
    ),
  ];

  const failedKeys: string[] = [];
  await deleteStorageBatch(storageKeys, failedKeys);

  if (failedKeys.length > 0) {
    console.error(
      `Account deletion stopped: ${failedKeys.length} stored files could not be removed.`
    );
    throw new Error(
      "Some files could not be deleted. Nothing was removed from your account; please try again."
    );
  }

  return await deleteUserAccountData({ userId });
}
