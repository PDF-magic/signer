import type { SignatureManifestV1 } from "./types";

export const SIGNING_FORMAT = "stellar-pdf-signature";
export const SIGNING_VERSION = 1 as const;
export const SIGNING_HEADER = "Stellar PDF Signature v1";

const HEX_64 = /^[0-9a-f]{64}$/;
const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

export function validateManifestShape(manifest: SignatureManifestV1): void {
  if (manifest.version !== SIGNING_VERSION) throw new Error("Unsupported signature manifest version.");
  if (!HEX_64.test(manifest.documentSha256)) throw new Error("Document SHA-256 must be 64 lowercase hex characters.");
  if (manifest.insigniaSha256 !== null && !HEX_64.test(manifest.insigniaSha256)) {
    throw new Error("Insignia SHA-256 must be null or 64 lowercase hex characters.");
  }
  if (!STELLAR_PUBLIC_KEY.test(manifest.signerPublicKey)) throw new Error("Signer public key must be a Stellar G-address.");
  if (!manifest.signerName || manifest.signerName.length > 120 || /[\r\n]/.test(manifest.signerName)) {
    throw new Error("Signer name must be 1-120 characters with no line breaks.");
  }
  const parsed = new Date(manifest.signedAt);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== manifest.signedAt) {
    throw new Error("signedAt must be a canonical UTC ISO timestamp.");
  }
}

export function canonicalizeManifest(manifest: SignatureManifestV1): string {
  validateManifestShape(manifest);
  return [
    SIGNING_HEADER,
    "document-sha256:" + manifest.documentSha256,
    "signed-at:" + manifest.signedAt,
    "signer-name:" + manifest.signerName,
    "signer-public-key:" + manifest.signerPublicKey,
    "insignia-sha256:" + (manifest.insigniaSha256 ?? "-"),
    "",
  ].join("\n");
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function shortKey(publicKey: string): string {
  return publicKey.length < 16 ? publicKey : publicKey.slice(0, 8) + "…" + publicKey.slice(-8);
}
