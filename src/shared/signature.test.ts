import { describe, expect, it } from "vitest";
import {
  authorityLabel,
  authorityLevel,
  canonicalizeManifest,
  sha256Hex,
} from "./signature";
import type { SignatureManifestV2, SignerAuthoritySnapshot } from "./types";
import { verifySep53 } from "../server/stellar";

const authority: SignerAuthoritySnapshot = {
  signerWeight: 10,
  lowThreshold: 1,
  mediumThreshold: 5,
  highThreshold: 20,
  lastModifiedLedger: 123456,
};

const manifest: SignatureManifestV2 = {
  version: 2,
  documentSha256: "a".repeat(64),
  signedAt: "2026-09-29T00:00:00.000Z",
  signerName: "Windsor Flight",
  signerPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  representedAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  authority,
  insigniaSha256: null,
};

describe("signer authority", () => {
  it("labels the strongest non-zero threshold one signer can meet", () => {
    expect(authorityLevel(authority)).toBe("medium");
    expect(authorityLabel(manifest.representedAccount, authority)).toBe(
      "Medium-weight signer for GAAAAAAA…AAAAAWHF",
    );
  });

  it("does not promote default zero thresholds into a high-weight label", () => {
    expect(
      authorityLevel({
        signerWeight: 1,
        lowThreshold: 0,
        mediumThreshold: 0,
        highThreshold: 0,
        lastModifiedLedger: 1,
      }),
    ).toBe("signer");
  });
});

describe("signature manifest", () => {
  it("canonicalizes signer authority and represented account into the signed message", () => {
    expect(canonicalizeManifest(manifest)).toBe(
      [
        "Stellar PDF Signature v2",
        "document-sha256:" + "a".repeat(64),
        "signed-at:2026-09-29T00:00:00.000Z",
        "signer-name:Windsor Flight",
        "signer-public-key:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "represented-account:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "signer-weight:10",
        "low-threshold:1",
        "medium-threshold:5",
        "high-threshold:20",
        "account-last-modified-ledger:123456",
        "insignia-sha256:-",
        "",
      ].join("\n"),
    );
  });

  it("hashes bytes with SHA-256", async () => {
    const value = new TextEncoder().encode("abc");
    await expect(sha256Hex(value)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("SEP-53 verification", () => {
  const publicKey = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
  const signature =
    "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==";

  it("accepts the official ASCII test vector", () => {
    expect(verifySep53(publicKey, "Hello, World!", signature)).toBe(true);
  });

  it("rejects a modified message", () => {
    expect(verifySep53(publicKey, "Hello, world!", signature)).toBe(false);
  });
});
