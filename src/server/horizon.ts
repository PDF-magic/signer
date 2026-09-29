import { authorityLevel, STELLAR_PUBLIC_KEY } from "../shared/signature";
import type { SignerAuthoritySnapshot, SignerAuthorityStatus } from "../shared/types";

interface HorizonSigner {
  key: string;
  type: string;
  weight: number;
}

interface HorizonAccount {
  account_id: string;
  last_modified_ledger: number;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: HorizonSigner[];
}

export class HorizonLookupError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

function horizonBaseUrl(): string {
  return (process.env.HORIZON_URL || "https://horizon.stellar.org").replace(/\/+$/, "");
}

export async function resolveSignerAuthority(
  representedAccount: string,
  signerPublicKey: string,
): Promise<SignerAuthorityStatus> {
  if (!STELLAR_PUBLIC_KEY.test(representedAccount) || !STELLAR_PUBLIC_KEY.test(signerPublicKey)) {
    throw new HorizonLookupError("A valid Stellar G-address is required.", 400);
  }

  let response: Response;
  try {
    response = await fetch(
      horizonBaseUrl() + "/accounts/" + encodeURIComponent(representedAccount),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      },
    );
  } catch {
    throw new HorizonLookupError("Unable to reach Stellar Horizon.", 502);
  }

  if (response.status === 404) {
    throw new HorizonLookupError("The represented Stellar account does not exist on the public network.", 404);
  }
  if (!response.ok) {
    throw new HorizonLookupError("Stellar Horizon returned HTTP " + response.status + ".", 502);
  }

  const account = (await response.json()) as HorizonAccount;
  const signer = account.signers.find((candidate) => candidate.key === signerPublicKey && candidate.weight > 0);

  if (!signer) {
    throw new HorizonLookupError(
      "The connected wallet key is not an active signer for the represented Stellar account.",
      404,
    );
  }

  const authority: SignerAuthoritySnapshot = {
    signerWeight: signer.weight,
    lowThreshold: account.thresholds.low_threshold,
    mediumThreshold: account.thresholds.med_threshold,
    highThreshold: account.thresholds.high_threshold,
    lastModifiedLedger: account.last_modified_ledger,
  };

  return {
    representedAccount,
    signerPublicKey,
    authority,
    authorityLevel: authorityLevel(authority),
  };
}

export function authoritySnapshotsEqual(
  left: SignerAuthoritySnapshot,
  right: SignerAuthoritySnapshot,
): boolean {
  return (
    left.signerWeight === right.signerWeight &&
    left.lowThreshold === right.lowThreshold &&
    left.mediumThreshold === right.mediumThreshold &&
    left.highThreshold === right.highThreshold &&
    left.lastModifiedLedger === right.lastModifiedLedger
  );
}
