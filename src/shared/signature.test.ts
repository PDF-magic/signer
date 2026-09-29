import { describe, expect, it } from "vitest";
import { canonicalizeManifest, sha256Hex } from "./signature";
import type { SignatureManifestV1 } from "./types";
import { verifySep53 } from "../server/stellar";

const manifest: SignatureManifestV1 = {
  version: 1,
  documentSha256: "a".repeat(64),
  signedAt: "2026-09-29T00:00:00.000Z",
  signerName: "Windsor Flight",
  signerPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  insigniaSha256: null,
};

describe("signature manifest", () => {
  it("canonicalizes fields in a stable human-readable order", () => {
    expect(canonicalizeManifest(manifest)).toBe(
      [
        "Stellar PDF Signature v1",
        "document-sha256:" + "a".repeat(64),
        "signed-at:2026-09-29T00:00:00.000Z",
        "signer-name:Windsor Flight",
        "signer-public-key:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
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
