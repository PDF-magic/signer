# Stellar PDF Signer

A full-stack document signer built around [Stellar SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md).

The app is deliberately off-chain: there is no Stellar transaction and the server never receives a secret key. Users choose a wallet through Stellar Wallets Kit, review the PDF, and sign one canonical message. The server then checks the actual wallet public key, verifies the SEP-53 signature, and confirms the key's signer authority for the represented account through SDF Horizon before publishing a share URL.

## Signing flow

1. **Choose a wallet.** Stellar Wallets Kit presents the supported-wallet picker instead of assuming Freighter.
2. **Choose the represented account.** This can be the wallet's own account or another G-account for which the wallet key is an added signer.
3. **Verify authority.** The server loads the represented account from Horizon and checks that the wallet public key appears in its signer list with non-zero weight.
4. **Review the document.** The exact PDF is shown in the signing view and SHA-256 hashed locally.
5. **Review the identity.** A display name and optional PNG/JPEG/WebP visual insignia can be attached.
6. **Sign.** Immediately before signing, the app fetches the wallet address again. After SEP-53 signing, it checks any signer address returned by the wallet against the key that was reviewed.
7. **Recheck on the server.** The server verifies the signature and file hashes, reloads the Horizon account, and rejects the request if signer weights, thresholds, or the account-state ledger changed after review.
8. **Share the proof.** The public page shows the PDF and a signer-authority badge such as **“Medium-weight signer for GAAAA…BBBB”**. The raw signing key remains in the verification details instead of being the primary identity label.

## Signed format

Version 2 binds the signer relationship itself into the SEP-53 message:

~~~text
Stellar PDF Signature v2
document-sha256:<64 lowercase hex characters>
signed-at:2026-09-29T00:00:00.000Z
signer-name:Windsor Flight
signer-public-key:G...
represented-account:G...
signer-weight:10
low-threshold:1
medium-threshold:5
high-threshold:20
account-last-modified-ledger:123456
insignia-sha256:<64 lowercase hex characters or ->
~~~

The authority label is derived from the strongest **non-zero** account threshold that the individual signer weight satisfies. Default zero thresholds therefore do not incorrectly turn every signer into a “high-weight” signer.

SEP-53 prefixes the UTF-8 message with `Stellar Signed Message:\n`, hashes that byte sequence with SHA-256, and verifies the Ed25519 signature against the recorded wallet key.

## Why Horizon

Classic Stellar account signer weights and low/medium/high thresholds are account state, so Horizon is the straightforward source for this app. The default endpoint is SDF Horizon:

~~~text
https://horizon.stellar.org
~~~

Override it with `HORIZON_URL` if the deployment uses another Horizon service.

## Run locally

Requires Node 22 or newer.

~~~sh
npm install
npm run dev
~~~

Open `http://localhost:3000`.

Useful checks:

~~~sh
npm run typecheck
npm test
npm run build
npm start
~~~

## Persistence

Records live under `./data/records/<id>/` by default. Each directory contains the original PDF, optional visual insignia, and the JSON proof record. Writes are staged and renamed into place atomically.

Set `DATA_DIR` to move persistent storage elsewhere. Public records are addressed by random 96-bit share IDs.

## Docker

~~~sh
docker compose up --build
~~~

For a public deployment, put the service behind HTTPS and set:

~~~text
PUBLIC_BASE_URL=https://sign.example.org
HORIZON_URL=https://horizon.stellar.org
~~~

## HTTP API

- `GET /api/accounts/:account/signers/:signer` — resolve one wallet key's signer weight and threshold level through Horizon
- `POST /api/signatures` — verify and publish a signed PDF
- `GET /api/signatures/:id` — verified public metadata
- `GET /api/signatures/:id/document` — original PDF
- `GET /api/signatures/:id/insignia` — optional visual insignia
- `GET /api/signatures/:id/proof` — downloadable JSON proof
- `GET /api/health` — health check

## Authority and timestamp semantics

“Medium-weight signer,” “high-weight signer,” and similar labels describe the signer weight relative to the represented account's threshold configuration at the Horizon account-state ledger captured in the signed message. The signer configuration can change later; the proof preserves what was checked when the signature was created.

Likewise, `signedAt` is cryptographically protected but is still a timestamp claim made by the signer. `serverReceivedAt` records when this server accepted the valid proof. Neither is a trusted timestamp authority.

See [SECURITY.md](./SECURITY.md) for the full trust model.
