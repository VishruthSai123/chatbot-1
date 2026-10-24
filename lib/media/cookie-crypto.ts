import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/*
 * Keeping the user's session cookie safe.
 *
 * A cookies.txt is a credential: whoever holds it can act as the user on that
 * site. It is therefore never stored in the clear — it is encrypted with a key
 * the deployment holds, so a reader of the database learns nothing, and it is
 * never written to a log.
 *
 * The cipher is AES-256-GCM, which authenticates as well as encrypts: a
 * tampered ciphertext fails to open rather than yielding a plausible-looking
 * garbage cookie file.
 */

/** How much random material the initialisation vector takes. */
const IV_BYTES = 12;
/** How much room the authentication tag takes. */
const TAG_BYTES = 16;

/**
 * Derives the encryption key from the deployment's secret.
 *
 * The secret is already high-entropy — it is the same kind of value as the
 * authentication secret — so a single hash is enough to turn it into exactly
 * the key length the cipher wants.
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypts a secret string.
 *
 * The result carries everything needed to open it: the initialisation vector,
 * the authentication tag and the ciphertext, base64-encoded together.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64"
  );
}

/**
 * Decrypts a secret string.
 *
 * Throws when the ciphertext has been altered or was encrypted with a
 * different secret. That is deliberate: a session that cannot be opened is a
 * session that has to be re-entered, and quietly using a wrong value would be
 * worse.
 */
export function decryptSecret(payload: string, secret: string): string {
  const raw = Buffer.from(payload, "base64");

  // A payload of exactly the header size is an empty value, which is
  // legitimate; anything shorter cannot hold the header at all.
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error("The stored session could not be read.");
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);

  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * The secret the session cookies are encrypted with.
 *
 * A dedicated variable is preferred, but the authentication secret is an
 * acceptable fallback: it is already a high-entropy value that the deployment
 * keeps, and reusing it avoids a second secret to forget to set.
 */
export function cookieSecret(): string {
  const secret = process.env.MEDIA_COOKIE_SECRET || process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error(
      "Media sessions cannot be stored because no encryption secret is configured. Set MEDIA_COOKIE_SECRET."
    );
  }

  return secret;
}
