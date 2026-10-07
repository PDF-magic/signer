import { Keypair, StrKey, rpc as StellarRpc, xdr } from "@stellar/stellar-sdk";
import { authorityLevel, STELLAR_PUBLIC_KEY } from "../shared/signature";
import type { SignerAuthoritySnapshot, SignerAuthorityStatus } from "../shared/types";

const DEFAULT_STELLAR_RPC_URL = "https://mainnet.sorobanrpc.com";

export class StellarRpcLookupError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

function stellarRpcUrl(): string {
  return (process.env.STELLAR_RPC_URL || DEFAULT_STELLAR_RPC_URL).replace(/\/+$/, "");
}

function createRpcServer(): StellarRpc.Server {
  const url = stellarRpcUrl();
  return new StellarRpc.Server(url, { allowHttp: url.startsWith("http://") });
}

function accountLedgerKey(account: string) {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(account).xdrPublicKey(),
    }),
  );
}

export async function resolveSignerAuthority(
  representedAccount: string,
  signerPublicKey: string,
): Promise<SignerAuthorityStatus> {
  if (!STELLAR_PUBLIC_KEY.test(representedAccount) || !STELLAR_PUBLIC_KEY.test(signerPublicKey)) {
    throw new StellarRpcLookupError("A valid Stellar G-address is required.", 400);
  }

  const response = await (async () => {
    try {
      return await createRpcServer().getLedgerEntries(accountLedgerKey(representedAccount));
    } catch {
      throw new StellarRpcLookupError("Unable to reach the configured Stellar RPC server.", 502);
    }
  })();

  const ledgerEntry = response.entries[0];
  if (!ledgerEntry) {
    throw new StellarRpcLookupError(
      "The represented Stellar account does not exist on the configured network.",
      404,
    );
  }
  if (ledgerEntry.val.type !== "account") {
    throw new StellarRpcLookupError("Stellar RPC returned an unexpected ledger entry type.", 502);
  }
  if (ledgerEntry.lastModifiedLedgerSeq === undefined) {
    throw new StellarRpcLookupError("Stellar RPC omitted the account's last-modified ledger.", 502);
  }

  const account = ledgerEntry.val.value;
  const thresholds = account.thresholds.toXdrObject();

  let signerWeight = signerPublicKey === representedAccount ? thresholds[0] : 0;
  if (signerWeight === 0) {
    for (const signer of account.signers) {
      const signerKey = signer.key.toXdrObject();
      if (
        signerKey.type === 0 &&
        StrKey.encodeEd25519PublicKey(signerKey.ed25519) === signerPublicKey
      ) {
        signerWeight = signer.weight;
        break;
      }
    }
  }

  if (signerWeight === 0) {
    throw new StellarRpcLookupError(
      "The connected wallet key is not an active signer for the represented Stellar account.",
      404,
    );
  }

  const authority: SignerAuthoritySnapshot = {
    signerWeight,
    lowThreshold: thresholds[1],
    mediumThreshold: thresholds[2],
    highThreshold: thresholds[3],
    lastModifiedLedger: ledgerEntry.lastModifiedLedgerSeq,
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
