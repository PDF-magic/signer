# PDF Magic Signer

PDF Magic Signer creates independently verifiable signatures for PDF documents with Stellar wallets. The application uses SEP-53 signed messages for the cryptographic signature and Stellar RPC for signer-authority reads. It is non-custodial: wallet software performs the signature, and the server never receives a Stellar secret key.

The document signature itself is off-chain. Deployments can optionally anchor a SHA-256 digest of the finalized proof to Stellar mainnet through Soroban; the PDF and signer identity remain off-chain. Stellar is used as the signer-authorization source of truth: the server reads the represented account's ledger entry through Stellar RPC, checks the wallet key's current signer weight and account thresholds, and binds that snapshot into the signed message.

## What a proof contains

Each published proof binds the exact PDF and the signer-authority snapshot that was checked when the signature was created:

- SHA-256 of the PDF
- claimed signing timestamp
- display name
- wallet public key that produced the SEP-53 signature
- represented Stellar account
- signer weight
- low, medium, and high account thresholds
- account ledger sequence at which the account entry was last modified
- optional visual-insignia SHA-256

The public proof page exposes the raw canonical message and signature so the record can be independently verified.

## Signing flow

1. **Connect a Stellar wallet.** Stellar Wallets Kit provides the wallet picker.
2. **Choose the represented account.** This can be the wallet's own G-address or another G-address for which the wallet key is an active signer.
3. **Read account authority through Stellar RPC.** The server requests the account ledger entry with `getLedgerEntries`, then reads the master signer weight, additional Ed25519 signers, account thresholds, and `lastModifiedLedgerSeq`.
4. **Review the PDF.** The browser hashes the exact document with SHA-256.
5. **Add display metadata.** A display name and optional PNG, JPEG, or WebP visual insignia can be included.
6. **Sign the canonical message.** The wallet signs using SEP-53.
7. **Recheck authority on submission.** The server reads the account entry again and rejects the signature if the signed authority snapshot no longer matches.
8. **Optionally anchor the proof.** When configured, the signer can request a relayed Soroban mainnet transaction containing only a SHA-256 digest of the canonical SEP-53 message plus signature.
9. **Publish the proof.** The service stores the PDF, optional insignia, signed manifest, signature, and server receipt time under a random share ID. Anchored proofs also expose their mainnet transaction, ledger, contract, and digest.

## Canonical signed message

Version 2 uses this canonical structure:

~~~text
Stellar PDF Signature v2
document-sha256:<64 lowercase hex characters>
signed-at:2026-10-07T00:00:00.000Z
signer-name:Example Signer
signer-public-key:G...
represented-account:G...
signer-weight:10
low-threshold:1
medium-threshold:5
high-threshold:20
account-last-modified-ledger:123456
insignia-sha256:<64 lowercase hex characters or ->
~~~

SEP-53 prefixes the UTF-8 message with `Stellar Signed Message:\n`, hashes the result with SHA-256, and verifies the Ed25519 signature against the recorded wallet public key.

The authority label is derived from the strongest non-zero threshold satisfied by the individual signer weight. Zero-valued thresholds do not cause an ordinary signer to be labeled as a high-weight signer.

## Stellar RPC

The server no longer depends on Horizon for signer-authority lookup. It reads the classic Stellar account ledger entry through the JavaScript SDK's Stellar RPC client.

By default:

~~~text
STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
~~~

Set `STELLAR_RPC_URL` to another compatible endpoint when using another provider, another network, or a self-hosted RPC service. HTTP endpoints are allowed for local development; production deployments should use HTTPS.

SDF does not operate a public Mainnet RPC endpoint, so production operators should deliberately choose and monitor the RPC provider appropriate for their deployment.

## Optional Soroban mainnet anchor

A minimal event-only contract lives in `contracts/proof-anchor`. It accepts one `BytesN<32>` proof digest, emits it with the ledger sequence and ledger timestamp, and stores no PDF or identity data.

The digest is:

~~~text
SHA-256(
  "Stellar PDF Soroban Anchor v1\n"
  || canonical SEP-53 message
  || "sep53-signature:"
  || base64 SEP-53 signature
  || "\n"
)
~~~

Build and deploy it:

~~~sh
stellar contract build --package proof-anchor

stellar network add signer-mainnet \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015"

stellar contract deploy \
  --wasm target/wasm32v1-none/release/proof_anchor.wasm \
  --source-account <your-cli-identity> \
  --network signer-mainnet
~~~

Configure the deployment with a dedicated, conservatively funded relayer account:

~~~text
SOROBAN_RPC_URL=https://mainnet.sorobanrpc.com
SOROBAN_ANCHOR_CONTRACT_ID=C...
SOROBAN_ANCHOR_SECRET=S...
~~~

The relayer secret belongs to the deployment, never the document signer. Without both anchor variables the existing SEP-53 flow stays fully off-chain and the anchor option is hidden.

## Local development

Requirements:

- Node.js 22 or newer
- a reachable Stellar RPC endpoint

Install dependencies and start the development server:

~~~sh
npm install
npm run dev
~~~

Then open `http://localhost:3000`.

Useful checks:

~~~sh
npm run typecheck
npm test
npm run build
npm start
~~~

## Configuration

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port |
| `DATA_DIR` | `./data` | Persistent signature-record storage |
| `MAX_UPLOAD_MB` | `25` | Maximum uploaded file size |
| `STELLAR_RPC_URL` | `https://mainnet.sorobanrpc.com` | Stellar RPC endpoint used for account-ledger reads |
| `SOROBAN_RPC_URL` | `https://mainnet.sorobanrpc.com` | Stellar RPC endpoint used for optional proof anchoring |
| `SOROBAN_ANCHOR_CONTRACT_ID` | unset | Deployed proof-anchor contract ID; required to enable anchoring |
| `SOROBAN_ANCHOR_SECRET` | unset | Dedicated deployment relayer secret; required to enable anchoring |
| `PUBLIC_BASE_URL` | request origin | Canonical public origin used in generated proof URLs |

Copy `.env.example` or provide these values through your deployment environment.

## Docker

Build and run with Docker Compose:

~~~sh
docker compose up --build
~~~

The Compose configuration persists records in the `signer-data` volume and configures the default Mainnet RPC endpoint. Override `STELLAR_RPC_URL` for another provider or network.

For public deployment, terminate TLS in front of the service and set `PUBLIC_BASE_URL` to the external HTTPS origin.

## HTTP API

The application's own HTTP API remains small and independent of the upstream Stellar RPC protocol:

- `GET /api/accounts/:account/signers/:signer` — resolve one wallet key's signer weight and threshold level from the account ledger entry
- `POST /api/signatures` — verify and publish a signed PDF
- `GET /api/signatures/:id` — return verified public metadata
- `GET /api/signatures/:id/document` — return the original PDF
- `GET /api/signatures/:id/insignia` — return the optional visual insignia
- `GET /api/signatures/:id/proof` — download the JSON proof
- `GET /api/health` — service health check

## Persistence

Records are stored under `./data/records/<id>/` by default. Each record directory contains the original PDF, the optional insignia, and the JSON proof record. Writes are staged and atomically renamed into place.

Share IDs are random 96-bit identifiers. A share URL is public-by-link; possession of the URL is sufficient to retrieve the document.

## Trust model

A valid record proves that the private key corresponding to the recorded wallet public key produced the SEP-53 signature over the canonical message and that the server observed the signed authority snapshot through Stellar RPC when it accepted the record.

It does **not** prove a person's civil or legal identity merely because a display name is present. Signer weights and account thresholds can also change after signing. The stored ledger sequence and signed snapshot describe the authority state that was checked at creation time, not a guarantee of continuing authority.

Likewise, `signedAt` is a signer-controlled claim and `serverReceivedAt` is the accepting server's observation. Neither is a trusted timestamp authority. A Soroban anchor independently establishes that the proof digest was committed by the mainnet ledger containing its transaction, but it is not a conventional timestamp-authority certificate.

See [SECURITY.md](./SECURITY.md) for the complete security model.
