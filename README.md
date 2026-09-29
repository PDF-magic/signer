# Stellar PDF Signer

A small full-stack document signer built around [Stellar SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md).

The app does **not** submit a transaction or store private keys. A browser wallet signs one human-readable message that binds the PDF hash, claimed signing time, display name, Stellar public key, and optional insignia hash. The server independently verifies the signature and file hashes before issuing a permanent share URL.

## Signing flow

1. Connect Freighter.
2. Pick a PDF and optionally a PNG/JPEG/WebP insignia.
3. The browser computes SHA-256 locally.
4. The app constructs a versioned canonical message.
5. Freighter signs that message using SEP-53.
6. The server recomputes both hashes, reconstructs the message, verifies the Ed25519 signature, and only then stores the proof.
7. The share page rechecks the stored files and signature whenever the proof metadata is loaded.

A canonical message looks like:

~~~text
Stellar PDF Signature v1
document-sha256:<64 lowercase hex characters>
signed-at:2026-09-29T00:00:00.000Z
signer-name:Windsor Flight
signer-public-key:G...
insignia-sha256:<64 lowercase hex characters or ->
~~~

SEP-53 itself prefixes that UTF-8 message with "Stellar Signed Message:\n", hashes the result once with SHA-256, and signs the digest with Ed25519.

## Run locally

Requires Node 22 or newer and the Freighter browser extension.

~~~sh
npm install
npm run dev
~~~

Open http://localhost:3000.

Useful checks:

~~~sh
npm run typecheck
npm test
npm run build
npm start
~~~

The test suite includes the official SEP-53 ASCII test vector and a tampering test.

## Persistence

By default records live under ./data/records/<id>/. Each record directory contains the original PDF, optional insignia, and a JSON proof record. Writes are staged in a temporary directory and renamed into place only after the files and metadata are complete.

Set DATA_DIR to move persistent storage elsewhere. The application does not require a database because public records are addressed directly by their random 96-bit share id.

## Docker

~~~sh
docker compose up --build
~~~

The Compose file mounts a named volume at /app/data.

For a public deployment, put the container behind HTTPS and set:

~~~text
PUBLIC_BASE_URL=https://sign.example.org
~~~

This makes generated share and proof URLs use the canonical public origin.

## HTTP API

- POST /api/signatures — multipart form with document, optional insignia, manifest, and signature
- GET /api/signatures/:id — verified public metadata
- GET /api/signatures/:id/document — original PDF
- GET /api/signatures/:id/insignia — optional insignia
- GET /api/signatures/:id/proof — downloadable JSON proof
- GET /api/health — health check

## Timestamp semantics

The signedAt timestamp is inside the signed message, so it cannot be altered without invalidating the signature. It is still only a claim made by the signer. serverReceivedAt records when this server accepted the already-valid proof, but the server is not a trusted timestamp authority.

If cryptographically independent proof-of-existence time is ever needed, that can be added separately without changing the core SEP-53 document signature model.

## Security

See [SECURITY.md](./SECURITY.md). The important boundary is simple: **the private key stays in the wallet**. The server receives only the public key, signature, canonical message metadata, PDF, and optional insignia.
