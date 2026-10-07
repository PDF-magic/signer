import { useEffect, useMemo, useState } from "react";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import {
  authorityLabel,
  canonicalizeManifest,
  sha256Hex,
  shortKey,
  STELLAR_PUBLIC_KEY,
} from "../shared/signature";
import type {
  PublicSignatureRecord,
  SignatureManifestV2,
  SignerAuthorityStatus,
} from "../shared/types";

let walletKitInitialized = false;

function ensureWalletKit(): void {
  if (walletKitInitialized) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    authModal: {
      showInstallLabel: true,
      hideUnsupportedWallets: false,
    },
  });
  walletKitInitialized = true;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Wallet request failed.";
}

async function copy(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function HomePage() {
  const [address, setAddress] = useState("");
  const [walletName, setWalletName] = useState("");
  const [representedAccount, setRepresentedAccount] = useState("");
  const [authority, setAuthority] = useState<SignerAuthorityStatus | null>(null);
  const [authorityError, setAuthorityError] = useState("");
  const [signerName, setSignerName] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState("");
  const [insignia, setInsignia] = useState<File | null>(null);
  const [documentHash, setDocumentHash] = useState("");
  const [insigniaHash, setInsigniaHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [anchorEnabled, setAnchorEnabled] = useState(false);
  const [anchorOnMainnet, setAnchorOnMainnet] = useState(false);

  useEffect(() => {
    ensureWalletKit();
    void fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load deployment configuration.");
        return response.json() as Promise<{ sorobanAnchorEnabled?: boolean }>;
      })
      .then((config) => setAnchorEnabled(Boolean(config.sorobanAnchorEnabled)))
      .catch(() => setAnchorEnabled(false));
  }, []);

  useEffect(() => {
    let active = true;
    if (!document) {
      setDocumentHash("");
      return;
    }
    void document.arrayBuffer().then(sha256Hex).then((hash) => {
      if (active) setDocumentHash(hash);
    });
    return () => {
      active = false;
    };
  }, [document]);

  useEffect(() => {
    if (!document) {
      setDocumentPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(document);
    setDocumentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [document]);

  useEffect(() => {
    let active = true;
    if (!insignia) {
      setInsigniaHash(null);
      return;
    }
    void insignia.arrayBuffer().then(sha256Hex).then((hash) => {
      if (active) setInsigniaHash(hash);
    });
    return () => {
      active = false;
    };
  }, [insignia]);

  useEffect(() => {
    const account = representedAccount.trim().toUpperCase();
    if (!address || !STELLAR_PUBLIC_KEY.test(account) || !STELLAR_PUBLIC_KEY.test(address)) {
      setAuthority(null);
      setAuthorityError("");
      return;
    }

    const controller = new AbortController();
    setAuthority(null);
    setAuthorityError("Checking signer authority with Stellar RPC…");

    void fetch(
      "/api/accounts/" + encodeURIComponent(account) + "/signers/" + encodeURIComponent(address),
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to verify signer authority.");
        return body as SignerAuthorityStatus;
      })
      .then((result) => {
        setAuthority(result);
        setAuthorityError("");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setAuthority(null);
        setAuthorityError(cause instanceof Error ? cause.message : "Unable to verify signer authority.");
      });

    return () => controller.abort();
  }, [address, representedAccount]);

  const previewMessage = useMemo(() => {
    if (!address || !documentHash || !signerName.trim() || !authority) return "";
    const placeholderTime = new Date(0).toISOString();
    const manifest: SignatureManifestV2 = {
      version: 2,
      documentSha256: documentHash,
      signedAt: placeholderTime,
      signerName: signerName.trim(),
      signerPublicKey: address,
      representedAccount: authority.representedAccount,
      authority: authority.authority,
      insigniaSha256: insigniaHash,
    };
    try {
      return canonicalizeManifest(manifest).replace(
        "signed-at:" + placeholderTime,
        "signed-at:<set when you click Sign>",
      );
    } catch {
      return "";
    }
  }, [address, authority, documentHash, insigniaHash, signerName]);

  async function chooseWallet() {
    setError("");
    setStatus("");
    try {
      ensureWalletKit();
      const previousAddress = address;
      const result = await StellarWalletsKit.authModal();
      const nextAddress = result.address;
      setAddress(nextAddress);
      setWalletName(StellarWalletsKit.selectedModule.productName);
      setRepresentedAccount((current) => {
        const normalized = current.trim().toUpperCase();
        return !normalized || normalized === previousAddress ? nextAddress : current;
      });
    } catch (cause) {
      const message = errorMessage(cause);
      if (!message.toLowerCase().includes("closed")) setError(message);
    }
  }

  async function submitSignature() {
    setError("");
    setStatus("");

    if (!address) {
      setError("Choose a wallet first.");
      return;
    }
    if (!authority) {
      setError("The wallet key must be verified as a signer for the represented Stellar account.");
      return;
    }
    if (!document || !documentHash) {
      setError("Choose a PDF and wait for its hash to finish.");
      return;
    }
    if (!signerName.trim()) {
      setError("Enter the name you want displayed with the signature.");
      return;
    }
    if (signerName.includes("\n") || signerName.includes("\r")) {
      setError("Signer name cannot contain line breaks.");
      return;
    }
    if (insignia && !["image/png", "image/jpeg", "image/webp"].includes(insignia.type)) {
      setError("Insignia must be PNG, JPEG, or WebP.");
      return;
    }

    setBusy(true);
    try {
      const fresh = await StellarWalletsKit.fetchAddress();
      if (fresh.address !== address) {
        const oldAddress = address;
        setAddress(fresh.address);
        if (representedAccount.trim().toUpperCase() === oldAddress) {
          setRepresentedAccount(fresh.address);
        }
        throw new Error("The wallet account changed. Its signer authority is being rechecked before you sign.");
      }

      const manifest: SignatureManifestV2 = {
        version: 2,
        documentSha256: documentHash,
        signedAt: new Date().toISOString(),
        signerName: signerName.trim(),
        signerPublicKey: address,
        representedAccount: authority.representedAccount,
        authority: authority.authority,
        insigniaSha256: insigniaHash,
      };
      const message = canonicalizeManifest(manifest);

      setStatus("Waiting for " + (walletName || "your wallet") + " to sign the SEP-53 message…");
      const result = await StellarWalletsKit.signMessage(message, { address });
      if (!result.signedMessage) throw new Error("The wallet did not return a message signature.");

      const actualSigner = result.signerAddress || fresh.address;
      if (actualSigner !== address) {
        throw new Error(
          "The wallet signed with " +
            shortKey(actualSigner) +
            ", not the public key that was reviewed. Reconnect that signer and try again.",
        );
      }

      setStatus(
        anchorOnMainnet
          ? "Publishing the proof and anchoring its digest on Stellar mainnet…"
          : "Checking the returned public key and publishing the proof…",
      );
      const form = new FormData();
      form.set("manifest", JSON.stringify(manifest));
      form.set("signature", result.signedMessage);
      form.set("anchor", anchorOnMainnet ? "true" : "false");
      form.set("document", document);
      if (insignia) form.set("insignia", insignia);

      const response = await fetch("/api/signatures", { method: "POST", body: form });
      const body = (await response.json()) as PublicSignatureRecord | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Publishing failed.");
      }

      window.location.assign((body as PublicSignatureRecord).shareUrl);
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus("");
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Stellar PDF Signer</a>
        <span className="pill">SEP-53 · off-chain</span>
      </header>

      <section className="hero compact-hero">
        <div>
          <p className="eyebrow">Signing request</p>
          <h1>Review the document. Choose the key that signs it.</h1>
          <p className="lede">
            The app verifies the wallet's actual public key against the represented Stellar
            account before it accepts the signature.
          </p>
        </div>
      </section>

      <section className="panel wallet-stage">
        <div className="step">
          <span className="step-number">1</span>
          <div>
            <h2>Choose your wallet</h2>
            <p>Pick any supported Stellar wallet that can sign an arbitrary message.</p>
          </div>
        </div>

        <div className="wallet-row">
          <button className="wallet-button wallet-picker" type="button" onClick={chooseWallet}>
            {address ? "Switch wallet" : "Choose wallet"}
          </button>
          <div className="wallet-summary">
            {address ? (
              <>
                <strong>{walletName || "Connected wallet"}</strong>
                <span>{shortKey(address)}</span>
              </>
            ) : (
              <>
                <strong>No wallet selected</strong>
                <span>Your secret key never enters this site.</span>
              </>
            )}
          </div>
        </div>

        {address && (
          <div className="account-check">
            <label>
              Stellar account this signature represents
              <input
                value={representedAccount}
                onChange={(event) => setRepresentedAccount(event.target.value.toUpperCase())}
                maxLength={56}
                spellCheck={false}
                placeholder="G…"
              />
            </label>

            {authority && (
              <div className={"authority-badge " + authority.authorityLevel}>
                <span className="authority-dot" />
                <strong>{authorityLabel(authority.representedAccount, authority.authority)}</strong>
                <small>
                  key weight {authority.authority.signerWeight} · account state ledger{" "}
                  {authority.authority.lastModifiedLedger.toLocaleString()}
                </small>
              </div>
            )}
            {authorityError && <div className={authority ? "notice" : "notice warning"}>{authorityError}</div>}
          </div>
        )}
      </section>

      <section className="panel signer-grid">
        <div className="form-column">
          <div className="step">
            <span className="step-number">2</span>
            <div>
              <h2>Signing identity</h2>
              <p>This name and optional visual insignia are bound into the signed statement.</p>
            </div>
          </div>

          <label>
            Display name
            <input
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              maxLength={120}
              placeholder="Example Signer"
              autoComplete="name"
            />
          </label>

          <label className="file-field">
            Visual insignia <span className="muted">(optional)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setInsignia(event.target.files?.[0] ?? null)}
            />
          </label>

          <div className="step spaced">
            <span className="step-number">3</span>
            <div>
              <h2>Document</h2>
              <p>The exact PDF bytes are SHA-256 hashed locally before signing.</p>
            </div>
          </div>

          <label className="file-field">
            PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setDocument(event.target.files?.[0] ?? null)}
            />
          </label>
          {document && (
            <div className="file-chip">
              <span>{document.name}</span>
              <code>{documentHash || "hashing…"}</code>
            </div>
          )}
        </div>

        <div className="review-column">
          <div className="step">
            <span className="step-number">4</span>
            <div>
              <h2>Review & sign</h2>
              <p>Read the request here, then approve the exact canonical message in your wallet.</p>
            </div>
          </div>

          {documentPreviewUrl ? (
            <div className="request-preview">
              <iframe src={documentPreviewUrl} title={document?.name || "Signing request"} />
            </div>
          ) : (
            <div className="request-placeholder">Choose a PDF to preview the signing request.</div>
          )}

          <details className="message-details">
            <summary>Exact message your wallet will sign</summary>
            <pre className="message-preview compact">
              {previewMessage || "Complete the wallet, signer authority, identity, and document fields first."}
            </pre>
          </details>

          {error && <div className="notice error">{error}</div>}
          {status && <div className="notice">{status}</div>}

          {anchorEnabled && (
            <label className="file-field">
              <span>
                <input
                  type="checkbox"
                  checked={anchorOnMainnet}
                  disabled={busy}
                  onChange={(event) => setAnchorOnMainnet(event.target.checked)}
                />{" "}
                <strong>Anchor proof on Stellar mainnet</strong>
              </span>
              <span className="muted">
                Publishes only a SHA-256 proof digest through Soroban; the PDF and identity stay off-chain.
              </span>
            </label>
          )}

          <button
            className="primary-button"
            type="button"
            disabled={busy || !address || !authority || !documentHash || !signerName.trim()}
            onClick={submitSignature}
          >
            {busy ? "Signing…" : "Sign document"}
          </button>
          <p className="fineprint">
            Stellar RPC is used to read the represented account's signer weights and thresholds
            directly from its ledger entry. The signature itself remains entirely off-chain.
          </p>
        </div>
      </section>
    </main>
  );
}

function SharePage({ id }: { id: string }) {
  const [record, setRecord] = useState<PublicSignatureRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/signatures/" + id)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Signature record not found.");
        return body as PublicSignatureRecord;
      })
      .then(setRecord)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load proof."));
  }, [id]);

  if (error) {
    return (
      <main className="shell narrow">
        <header className="topbar"><a className="brand" href="/">Stellar PDF Signer</a></header>
        <section className="panel empty-state">
          <h1>Proof unavailable</h1>
          <p>{error}</p>
          <a href="/">Create a signature</a>
        </section>
      </main>
    );
  }

  if (!record) {
    return <main className="shell narrow"><div className="loading">Verifying proof…</div></main>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Stellar PDF Signer</a>
        <span className={record.verified ? "pill verified" : "pill invalid"}>
          {record.verified ? "✓ Verified" : "✕ Verification failed"}
        </span>
      </header>

      <section className="proof-hero">
        <div className="identity">
          {record.insigniaUrl && <img className="insignia" src={record.insigniaUrl} alt="" />}
          <div>
            <p className="eyebrow">Signed by</p>
            <h1>{record.signerName}</h1>
            <div className={"authority-badge public " + record.authorityLevel}>
              <span className="authority-dot" />
              <strong>{authorityLabel(record.representedAccount, record.authority)}</strong>
            </div>
          </div>
        </div>
        <div className="actions">
          <button onClick={() => void copy(window.location.href)}>Copy share URL</button>
          <a href={record.proofUrl}>Download proof</a>
          <a href={record.documentUrl} target="_blank" rel="noreferrer">Open PDF</a>
        </div>
      </section>

      {!record.verified && (
        <div className="notice error">
          Do not rely on this proof. At least one stored byte sequence no longer matches the signed record.
        </div>
      )}

      {record.anchor && (
        <section className="panel">
          <p className="eyebrow">Soroban mainnet anchor</p>
          <h2>Anchored at ledger {record.anchor.ledger.toLocaleString()}</h2>
          <p>
            Proof SHA-256 <code>{record.anchor.proofSha256}</code>
          </p>
          <a
            href={"https://stellar.expert/explorer/public/tx/" + record.anchor.transactionHash}
            target="_blank"
            rel="noreferrer"
          >
            View mainnet transaction
          </a>
        </section>
      )}

      <section className="proof-layout">
        <div className="pdf-card">
          <iframe src={record.documentUrl} title={record.documentFilename} />
        </div>

        <aside className="panel details-card">
          <h2>Verification</h2>
          <div className="check-row"><span>SEP-53 signature</span><strong>{record.checks.signature ? "valid" : "failed"}</strong></div>
          <div className="check-row"><span>PDF hash</span><strong>{record.checks.documentHash ? "matches" : "failed"}</strong></div>
          <div className="check-row"><span>Insignia hash</span><strong>{record.checks.insigniaHash ? "matches" : "failed"}</strong></div>

          <hr />

          <dl>
            <dt>Represented Stellar account</dt>
            <dd><code>{record.representedAccount}</code></dd>
            <dt>Actual signing public key</dt>
            <dd>
              <button className="raw-key" onClick={() => void copy(record.signerPublicKey)}>
                <code>{record.signerPublicKey}</code>
              </button>
            </dd>
            <dt>Signer weight</dt>
            <dd>{record.authority.signerWeight}</dd>
            <dt>Account thresholds</dt>
            <dd>
              low {record.authority.lowThreshold} · medium {record.authority.mediumThreshold} · high{" "}
              {record.authority.highThreshold}
            </dd>
            <dt>Stellar RPC account-state ledger</dt>
            <dd>{record.authority.lastModifiedLedger.toLocaleString()}</dd>
            <dt>Claimed signed at</dt>
            <dd>{new Date(record.signedAt).toLocaleString()}</dd>
            <dt>Server received at</dt>
            <dd>{new Date(record.serverReceivedAt).toLocaleString()}</dd>
            <dt>Document</dt>
            <dd>{record.documentFilename}</dd>
            <dt>SHA-256</dt>
            <dd><code>{record.documentSha256}</code></dd>
            <dt>Signature</dt>
            <dd><code>{record.signature}</code></dd>
          </dl>

          <details>
            <summary>Canonical signed message</summary>
            <pre className="message-preview compact">{record.canonicalMessage}</pre>
          </details>

          <p className="fineprint">
            The large signer label comes from the signer weight and account thresholds read through Stellar RPC
            and captured in the signed statement. The raw key stays available here for independent verification.
          </p>
        </aside>
      </section>
    </main>
  );
}

export default function App() {
  const shareMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]{16})$/);
  return shareMatch ? <SharePage id={shareMatch[1]} /> : <HomePage />;
}
