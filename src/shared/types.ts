export interface SignatureManifestV1 {
  version: 1;
  documentSha256: string;
  signedAt: string;
  signerName: string;
  signerPublicKey: string;
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
