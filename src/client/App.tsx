import { useEffect, useMemo, useState } from "react";
import { requestAccess, signMessage } from "@stellar/freighter-api";
import { canonicalizeManifest, sha256Hex, shortKey } from "../shared/signature";
import type { PublicSignatureRecord, SignatureManifestV1 } from "../shared/types";

function apiError(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value && (value as { error?: unknown }).error) {
    const error = (value as { error: { message?: string } }).error;
    return error.message || "Wallet request failed.";
  }
  return null;
}

async function copy(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function HomePage() {
  const [address, setAddress] = useState("");
  const [signerName, setSignerName] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [insignia, setInsignia] = useState<File | null>(null);
  const [documentHash, setDocumentHash] = useState("");
  const [insigniaHash, setInsigniaHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

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

  const previewMessage = useMemo(() => {
    if (!address || !documentHash || !signerName.trim()) return "";
    const placeholderTime = new Date(0).toISOString();
    const manifest: SignatureManifestV1 = {
      version: 1,
      documentSha256: documentHash,
      signedAt: placeholderTime,
      signerName: signerName.trim(),
      signerPublicKey: address,
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
  }, [address, documentHash, insigniaHash, signerName]);

  async function connectWallet() {
    setError("");
    try {
      const result = await requestAccess();
      const walletError = apiError(result);
      if (walletError) throw new Error(walletError);
      const nextAddress = (result as { address?: string }).address;
      if (!nextAddress) throw new Error("Freighter did not return an address.");
      setAddress(nextAddress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect to Freighter.");
    }
  }

  async function submitSignature() {
    setError("");
    setStatus("");

    if (!address) {
      setError("Connect Freighter first.");
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
      const manifest: SignatureManifestV1 = {
        version: 1,
        documentSha256: documentHash,
        signedAt: new Date().toISOString(),
        signerName: signerName.trim(),
        signerPublicKey: address,
        insigniaSha256: insigniaHash,
      };
      const message = canonicalizeManifest(manifest);

      setStatus("Waiting for your SEP-53 signature in Freighter…");
      const result = await signMessage(message, { address });
      const walletError = apiError(result);
      if (walletError) throw new Error(walletError);

      const signedMessage = (result as { signedMessage?: string }).signedMessage;
      const signerAddress = (result as { signerAddress?: string }).signerAddress;
      if (!signedMessage) throw new Error("Freighter did not return a signature.");
      if (signerAddress && signerAddress !== address) {
        throw new Error("Freighter signed with a different address than the connected account.");
      }

      setStatus("Verifying and publishing the proof…");
      const form = new FormData();
      form.set("manifest", JSON.stringify(manifest));
      form.set("signature", signedMessage);
      form.set("document", document);
      if (insignia) form.set("insignia", insignia);

      const response = await fetch("/api/signatures", { method: "POST", body: form });
      const body = (await response.json()) as PublicSignatureRecord | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Publishing failed.");
      }

      window.location.assign((body as PublicSignatureRecord).shareUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Signing failed.");
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

      <section className="hero">
        <div>
          <p className="eyebrow">Cryptographic document signatures</p>
          <h1>Sign the document hash. Share the proof.</h1>
          <p className="lede">
            Your private key never leaves your wallet. The public page binds the PDF,
            your displayed name, optional insignia, claimed signing time, and Stellar
            public key into one independently verifiable SEP-53 signature.
          </p>
        </div>
        <div className="protocol-card">
          <div className="protocol-row"><span>Network transaction</span><strong>None</strong></div>
          <div className="protocol-row"><span>Signature</span><strong>Ed25519</strong></div>
          <div className="protocol-row"><span>Hash</span><strong>SHA-256</strong></div>
          <div className="protocol-row"><span>Standard</span><strong>SEP-53</strong></div>
        </div>
      </section>

      <section className="panel signer-grid">
        <div className="form-column">
          <div className="step">
            <span className="step-number">1</span>
            <div>
              <h2>Signer</h2>
              <p>Connect Freighter and choose the public name shown on the proof.</p>
            </div>
          </div>

          <button className="wallet-button" type="button" onClick={connectWallet}>
            {address ? "Connected · " + shortKey(address) : "Connect Freighter"}
          </button>

          <label>
            Display name
            <input
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              maxLength={120}
              placeholder="Windsor Flight"
              autoComplete="name"
            />
          </label>

          <div className="step spaced">
            <span className="step-number">2</span>
            <div>
              <h2>Document</h2>
              <p>The PDF is hashed locally before the wallet is asked to sign.</p>
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

          <label className="file-field">
            Insignia <span className="muted">(optional)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setInsignia(event.target.files?.[0] ?? null)}
            />
          </label>
          {insignia && (
            <div className="file-chip">
              <span>{insignia.name}</span>
              <code>{insigniaHash || "hashing…"}</code>
            </div>
          )}
        </div>

        <div className="review-column">
          <div className="step">
            <span className="step-number">3</span>
            <div>
              <h2>Review & sign</h2>
              <p>Freighter will show the canonical message. The real timestamp is inserted at signing.</p>
            </div>
          </div>

          <pre className="message-preview">
            {previewMessage || "Complete the signer and document fields to preview the message."}
          </pre>

          {error && <div className="notice error">{error}</div>}
          {status && <div className="notice">{status}</div>}

          <button
            className="primary-button"
            type="button"
            disabled={busy || !address || !documentHash || !signerName.trim()}
            onClick={submitSignature}
          >
            {busy ? "Signing…" : "Sign & publish"}
          </button>
          <p className="fineprint">
            The signing time is a signed claim. The server also records when it received
            the proof, but neither is a trusted timestamp authority.
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
            <button className="key-button" onClick={() => void copy(record.signerPublicKey)}>
              {shortKey(record.signerPublicKey)} · copy key
            </button>
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
            Verification proves control of the private key corresponding to the displayed
            Stellar G-address. It does not by itself prove legal identity or full control
            of a multisignature Stellar account.
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
