# Security model

This application is intentionally non-custodial. It never asks for or stores a Stellar secret key. Wallet selection and message signing are delegated to Stellar Wallets Kit and the wallet chosen by the user.

## What a valid proof establishes

A valid proof establishes that the private key corresponding to the recorded Stellar G-address produced a SEP-53 signature over the exact canonical message shown on the proof page. That message binds:

- the SHA-256 hash of the PDF;
- the claimed signing time;
- the displayed signer name;
- the actual wallet public key reviewed before signing;
- the represented Stellar account;
- a Stellar RPC snapshot of that key's signer weight, account thresholds, and account-state ledger;
- the SHA-256 hash of the optional visual insignia.

Before accepting a signature, the server reads the represented account ledger entry through Stellar RPC and confirms that the wallet public key is an active signer with non-zero weight. The signed RPC snapshot must still match when the server receives the signature.

The server also recomputes the PDF and insignia hashes before accepting a record and whenever the public proof API is loaded.

## What it does not establish

- It does not prove the signer's civil or legal identity merely because a name is displayed.
- The authority label describes one signer's weight relative to one account's thresholds at the captured account-state ledger. It is not a claim that the key alone can authorize every possible action forever.
- The signed timestamp is a claim by the signer. The server receipt timestamp is a server observation, not a trusted timestamp authority.
- Public share URLs are not an access-control system. Anyone with the URL can view the uploaded PDF.
- A signer can later be removed or its weight/thresholds can change. The proof preserves the signer configuration that was checked and signed at creation time.

Run the service behind HTTPS in production. Treat uploaded documents as public-by-link and apply your own authentication, retention, malware scanning, rate limiting, Stellar RPC availability controls, and backup policies when the deployment requires them.
