export type StorageProvider = "r2" | "supabase";

export function storageProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === "r2" ? "r2" : "supabase";
}
