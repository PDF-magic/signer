import type {
  SignatureManifestV2,
  SignerAuthorityLevel,
  SignerAuthoritySnapshot,
} from "./types";

export const SIGNING_FORMAT = "stellar-pdf-signature";
export const SIGNING_VERSION = 2 as const;
export const SIGNING_HEADER = "Stellar PDF Signature v2";

const HEX_64 = /^[0-9a-f]{64}$/;
export const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

function isByteWeight(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export function authorityLevel(authority: SignerAuthoritySnapshot): SignerAuthorityLevel {
  if (authority.highThreshold > 0 && authority.signerWeight >= authority.highThreshold) return "high";
  if (authority.mediumThreshold > 0 && authority.signerWeight >= authority.mediumThreshold) return "medium";
  if (authority.lowThreshold > 0 && authority.signerWeight >= authority.lowThreshold) return "low";
  return "signer";
}

export function authorityLabel(
  representedAccount: string,
  authority: SignerAuthoritySnapshot,
): string {
  const level = authorityLevel(authority);
  const prefix =
    level === "high"
      ? "High-weight signer"
      : level === "medium"
        ? "Medium-weight signer"
        : level === "low"
          ? "Low-weight signer"
          : "Signer";
  return prefix + " for " + shortKey(representedAccount);
}

export function validateManifestShape(manifest: SignatureManifestV2): void {
  if (manifest.version !== SIGNING_VERSION) throw new Error("Unsupported signature manifest version.");
  if (!HEX_64.test(manifest.documentSha256)) {
    throw new Error("Document SHA-256 must be 64 lowercase hex characters.");
  }
  if (manifest.insigniaSha256 !== null && !HEX_64.test(manifest.insigniaSha256)) {
    throw new Error("Insignia SHA-256 must be null or 64 lowercase hex characters.");
  }
  if (!STELLAR_PUBLIC_KEY.test(manifest.signerPublicKey)) {
    throw new Error("Signer public key must be a Stellar G-address.");
  }
  if (!STELLAR_PUBLIC_KEY.test(manifest.representedAccount)) {
    throw new Error("Represented account must be a Stellar G-address.");
  }
  if (!manifest.signerName || manifest.signerName.length > 120 || /[\r\n]/.test(manifest.signerName)) {
    throw new Error("Signer name must be 1-120 characters with no line breaks.");
  }
  const parsed = new Date(manifest.signedAt);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== manifest.signedAt) {
    throw new Error("signedAt must be a canonical UTC ISO timestamp.");
  }
  const authority = manifest.authority;
  if (
    !isByteWeight(authority.signerWeight) ||
    authority.signerWeight === 0 ||
    !isByteWeight(authority.lowThreshold) ||
    !isByteWeight(authority.mediumThreshold) ||
    !isByteWeight(authority.highThreshold) ||
    !Number.isInteger(authority.lastModifiedLedger) ||
    authority.lastModifiedLedger < 0
  ) {
    throw new Error("Invalid Stellar signer authority snapshot.");
  }
}

export function canonicalizeManifest(manifest: SignatureManifestV2): string {
  validateManifestShape(manifest);
  return [
    SIGNING_HEADER,
    "document-sha256:" + manifest.documentSha256,
    "signed-at:" + manifest.signedAt,
    "signer-name:" + manifest.signerName,
    "signer-public-key:" + manifest.signerPublicKey,
    "represented-account:" + manifest.representedAccount,
    "signer-weight:" + manifest.authority.signerWeight,
    "low-threshold:" + manifest.authority.lowThreshold,
    "medium-threshold:" + manifest.authority.mediumThreshold,
    "high-threshold:" + manifest.authority.highThreshold,
    "account-last-modified-ledger:" + manifest.authority.lastModifiedLedger,
    "insignia-sha256:" + (manifest.insigniaSha256 ?? "-"),
    "",
  ].join("\n");
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function shortKey(publicKey: string): string {
  return publicKey.length < 16 ? publicKey : publicKey.slice(0, 8) + "…" + publicKey.slice(-8);
}
