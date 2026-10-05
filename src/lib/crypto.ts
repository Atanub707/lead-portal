import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.SMTP_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("Missing SMTP_ENCRYPTION_KEY (64 hex chars)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${nonce.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid or tampered secret");
  }
  const [version, nonceB64, tagB64, ctB64] = parts;
  if (version !== "v1" || !nonceB64 || !tagB64 || !ctB64) {
    throw new Error("Invalid or tampered secret");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonceB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Invalid or tampered secret");
  }
}
