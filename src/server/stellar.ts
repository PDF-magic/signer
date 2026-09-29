import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const SEP53_PREFIX = Buffer.from("Stellar Signed Message:\n", "utf8");

export function normalizeSignature(raw: string): Buffer {
  const value = raw.trim();

  if (/^[0-9a-fA-F]{128}$/.test(value)) return Buffer.from(value, "hex");

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64) {
    throw new Error("Signature must be a 64-byte Ed25519 signature encoded as base64 or hex.");
  }
  return decoded;
}

export function signatureToBase64(raw: string): string {
  return normalizeSignature(raw).toString("base64");
}

export function sep53Digest(message: string): Buffer {
  return createHash("sha256")
    .update(SEP53_PREFIX)
    .update(Buffer.from(message, "utf8"))
    .digest();
}

export function verifySep53(publicKey: string, message: string, rawSignature: string): boolean {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    return keypair.verify(sep53Digest(message), normalizeSignature(rawSignature));
  } catch {
    return false;
  }
}
