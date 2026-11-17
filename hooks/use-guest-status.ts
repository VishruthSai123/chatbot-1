"use client";

import useSWR from "swr";

export type GuestStatus = {
  exhausted: boolean;
  isGuest: boolean;
  limit: number;
  remaining: number;
  used: number;
};

const STATUS_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/guest/status`;

async function fetchGuestStatus(url: string): Promise<GuestStatus> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Could not load guest status");
  }

  return response.json() as Promise<GuestStatus>;
}

/**
 * The guest trial is account-wide, not per chat. The server is the source of
 * truth; this hook lets the composer lock immediately after the third message
 * and restore the lock on a later page load.
 */
export function useGuestStatus() {
  const { data, error, isLoading, mutate } = useSWR<GuestStatus>(
    STATUS_URL,
    fetchGuestStatus,
    {
      dedupingInterval: 0,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    }
  );

  return {
    error,
    isLoading,
    refresh: mutate,
    status: data,
  };
}
