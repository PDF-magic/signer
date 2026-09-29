# Security model

This application is intentionally non-custodial. It never asks for or stores a Stellar secret key. Signing is delegated to a SEP-53-capable wallet such as Freighter.

## What a valid proof establishes

A valid proof establishes that the private key corresponding to the displayed Stellar G-address produced a SEP-53 signature over the exact canonical message shown on the proof page. That message binds:

- the SHA-256 hash of the PDF;
- the claimed signing time;
- the displayed signer name;
- the Stellar public key;
- the SHA-256 hash of the optional insignia.

The server recomputes the PDF and insignia hashes before accepting a record and recomputes them again whenever the public proof API is loaded.

## What it does not establish

- It does not prove the signer's civil or legal identity merely because a name is displayed.
- It does not prove that one Stellar key has full control over an account with multiple signers or custom thresholds.
- The signed timestamp is a claim by the signer. The server receipt timestamp is a server observation, not a trusted timestamp authority.
- Public share URLs are not an access-control system. Anyone with the URL can view the uploaded PDF.

Run the service behind HTTPS in production. Treat uploaded documents as public-by-link and apply your own authentication, retention, malware scanning, rate limiting, and backup policies when the deployment requires them.
