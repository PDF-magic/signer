import { createHash } from "node:crypto";
import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type { SorobanAnchorReceipt } from "../shared/types";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_MAINNET_RPC = "https://mainnet.sorobanrpc.com";

export function sorobanAnchorConfigured(): boolean {
  return Boolean(
    process.env.SOROBAN_ANCHOR_CONTRACT_ID?.trim() &&
      process.env.SOROBAN_ANCHOR_SECRET?.trim(),
  );
}

export function proofAnchorDigest(canonicalMessage: string, signature: string): string {
  return createHash("sha256")
    .update("Stellar PDF Soroban Anchor v1\n", "utf8")
    .update(canonicalMessage, "utf8")
    .update("sep53-signature:", "utf8")
    .update(signature, "utf8")
    .update("\n", "utf8")
    .digest("hex");
}

export async function anchorProofOnMainnet(
  proofSha256: string,
): Promise<SorobanAnchorReceipt> {
  if (!HASH_PATTERN.test(proofSha256)) {
    throw new Error("Soroban proof digest must be 64 lowercase hex characters.");
  }

  const contractId = process.env.SOROBAN_ANCHOR_CONTRACT_ID?.trim();
  const secret = process.env.SOROBAN_ANCHOR_SECRET?.trim();
  if (!contractId || !secret) {
    throw new Error("Soroban mainnet anchoring is not configured.");
  }

  const relayer = Keypair.fromSecret(secret);
  const server = new rpc.Server(process.env.SOROBAN_RPC_URL?.trim() || DEFAULT_MAINNET_RPC);
  const account = await server.getAccount(relayer.publicKey());
  const contract = new Contract(contractId);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      contract.call("anchor", xdr.ScVal.scvBytes(Buffer.from(proofSha256, "hex"))),
    )
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  const prepared = rpc.assembleTransaction(transaction, simulation).build();
  prepared.sign(relayer);

  const submitted = await server.sendTransaction(prepared);
  if (submitted.status === "ERROR") {
    throw new Error("Stellar RPC rejected the Soroban anchor transaction.");
  }

  const confirmed = await server.pollTransaction(submitted.hash);
  const ledger = "ledger" in confirmed && typeof confirmed.ledger === "number" ? confirmed.ledger : 0;
  if (ledger <= 0) {
    throw new Error("Stellar RPC confirmed the anchor without a ledger sequence.");
  }

  return {
    network: "mainnet",
    contractId,
    transactionHash: submitted.hash,
    ledger,
    proofSha256,
    serverConfirmedAt: new Date().toISOString(),
  };
}
