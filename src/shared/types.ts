export type SignerAuthorityLevel = "high" | "medium" | "low" | "signer";

export interface SignerAuthoritySnapshot {
  signerWeight: number;
  lowThreshold: number;
  mediumThreshold: number;
  highThreshold: number;
  lastModifiedLedger: number;
}

export interface SignerAuthorityStatus {
  representedAccount: string;
  signerPublicKey: string;
  authority: SignerAuthoritySnapshot;
  authorityLevel: SignerAuthorityLevel;
}

export interface SignatureManifestV2 {
  version: 2;
  documentSha256: string;
  signedAt: string;
  signerName: string;
  signerPublicKey: string;
  representedAccount: string;
  authority: SignerAuthoritySnapshot;
  insigniaSha256: string | null;
}

export interface VerificationChecks {
  signature: boolean;
  documentHash: boolean;
  insigniaHash: boolean;
}

export interface PublicSignatureRecord {
  id: string;
  signerName: string;
  signerPublicKey: string;
  representedAccount: string;
  authority: SignerAuthoritySnapshot;
  authorityLevel: SignerAuthorityLevel;
  signedAt: string;
  serverReceivedAt: string;
  documentSha256: string;
  documentFilename: string;
  documentMimeType: string;
  insigniaSha256: string | null;
  insigniaMimeType: string | null;
  signature: string;
  canonicalMessage: string;
  verified: boolean;
  checks: VerificationChecks;
  documentUrl: string;
  insigniaUrl: string | null;
  proofUrl: string;
  shareUrl: string;
}
