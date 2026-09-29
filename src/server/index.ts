import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { z } from "zod";
import { canonicalizeManifest } from "../shared/signature";
import type { PublicSignatureRecord, SignatureManifestV1, VerificationChecks } from "../shared/types";
import {
  assetPath,
  createId,
  getRecord,
  initStore,
  saveRecordAtomic,
  type StoredSignatureRecord,
} from "./store";
import { signatureToBase64, verifySep53 } from "./stellar";

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 25));
const maxUploadBytes = maxUploadMb * 1024 * 1024;

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 2, fields: 4 },
});

const hashPattern = /^[0-9a-f]{64}$/;
const publicKeyPattern = /^G[A-Z2-7]{55}$/;

const manifestSchema = z.object({
  version: z.literal(1),
  documentSha256: z.string().regex(hashPattern),
  signedAt: z.string().refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
  }, "signedAt must be a canonical UTC ISO timestamp"),
  signerName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !/[\r\n]/.test(value), "signerName cannot contain line breaks"),
  signerPublicKey: z.string().regex(publicKeyPattern),
  insigniaSha256: z.string().regex(hashPattern).nullable(),
});

const acceptedInsigniaTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeFilename(input: string): string {
  const base = path.basename(input || "document.pdf");
  const safe = base.replace(/[^A-Za-z0-9._() -]+/g, "_").slice(0, 180);
  return safe || "document.pdf";
}

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function baseUrl(req: express.Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  return req.protocol + "://" + req.get("host");
}

async function verifyStoredRecord(record: StoredSignatureRecord): Promise<VerificationChecks> {
  const document = await readFile(assetPath(record.id, record.documentFile));
  const documentHash = sha256(document) === record.manifest.documentSha256;

  let insigniaHash = true;
  if (record.manifest.insigniaSha256 !== null) {
    if (!record.insigniaFile) {
      insigniaHash = false;
    } else {
      const insignia = await readFile(assetPath(record.id, record.insigniaFile));
      insigniaHash = sha256(insignia) === record.manifest.insigniaSha256;
    }
  } else if (record.insigniaFile) {
    insigniaHash = false;
  }

  const canonical = canonicalizeManifest(record.manifest);
  const signature =
    canonical === record.canonicalMessage &&
    verifySep53(record.manifest.signerPublicKey, canonical, record.signature);

  return { signature, documentHash, insigniaHash };
}

function toPublicRecord(
  req: express.Request,
  record: StoredSignatureRecord,
  checks: VerificationChecks,
): PublicSignatureRecord {
  const root = baseUrl(req);
  return {
    id: record.id,
    signerName: record.manifest.signerName,
    signerPublicKey: record.manifest.signerPublicKey,
    signedAt: record.manifest.signedAt,
    serverReceivedAt: record.serverReceivedAt,
    documentSha256: record.manifest.documentSha256,
    documentFilename: record.documentFilename,
    documentMimeType: record.documentMimeType,
    insigniaSha256: record.manifest.insigniaSha256,
    insigniaMimeType: record.insigniaMimeType,
    signature: record.signature,
    canonicalMessage: record.canonicalMessage,
    verified: checks.signature && checks.documentHash && checks.insigniaHash,
    checks,
    documentUrl: root + "/api/signatures/" + record.id + "/document",
    insigniaUrl: record.insigniaFile ? root + "/api/signatures/" + record.id + "/insignia" : null,
    proofUrl: root + "/api/signatures/" + record.id + "/proof",
    shareUrl: root + "/s/" + record.id,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "stellar-pdf-signer" });
});

app.post(
  "/api/signatures",
  upload.fields([
    { name: "document", maxCount: 1 },
    { name: "insignia", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const document = files?.document?.[0];
      const insignia = files?.insignia?.[0];

      if (!document) {
        res.status(400).json({ error: "A PDF document is required." });
        return;
      }
      if (document.mimetype !== "application/pdf" || !isPdf(document.buffer)) {
        res.status(400).json({ error: "The document must be a valid PDF." });
        return;
      }
      if (typeof req.body.manifest !== "string" || typeof req.body.signature !== "string") {
        res.status(400).json({ error: "manifest and signature fields are required." });
        return;
      }

      let parsedManifest: unknown;
      try {
        parsedManifest = JSON.parse(req.body.manifest);
      } catch {
        res.status(400).json({ error: "manifest must be valid JSON." });
        return;
      }

      const manifest = manifestSchema.parse(parsedManifest) as SignatureManifestV1;
      const actualDocumentHash = sha256(document.buffer);
      if (actualDocumentHash !== manifest.documentSha256) {
        res.status(400).json({ error: "Document hash does not match the signed manifest." });
        return;
      }

      if (insignia) {
        if (!acceptedInsigniaTypes.has(insignia.mimetype)) {
          res.status(400).json({ error: "Insignia must be PNG, JPEG, or WebP." });
          return;
        }
        if (manifest.insigniaSha256 !== sha256(insignia.buffer)) {
          res.status(400).json({ error: "Insignia hash does not match the signed manifest." });
          return;
        }
      } else if (manifest.insigniaSha256 !== null) {
        res.status(400).json({ error: "The signed manifest expects an insignia image." });
        return;
      }

      const canonicalMessage = canonicalizeManifest(manifest);
      if (!verifySep53(manifest.signerPublicKey, canonicalMessage, req.body.signature)) {
        res.status(400).json({ error: "SEP-53 signature verification failed." });
        return;
      }

      const signature = signatureToBase64(req.body.signature);
      const id = createId();
      const insigniaExtension = insignia ? acceptedInsigniaTypes.get(insignia.mimetype)! : null;
      const record: StoredSignatureRecord = {
        id,
        manifest,
        signature,
        canonicalMessage,
        serverReceivedAt: new Date().toISOString(),
        documentFilename: safeFilename(document.originalname),
        documentMimeType: "application/pdf",
        documentFile: "document.pdf",
        insigniaMimeType: insignia?.mimetype ?? null,
        insigniaFile: insigniaExtension ? "insignia" + insigniaExtension : null,
      };

      await saveRecordAtomic(record, document.buffer, insignia?.buffer ?? null);
      const checks = await verifyStoredRecord(record);
      res.status(201).json(toPublicRecord(req, record, checks));
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/signatures/:id", async (req, res, next) => {
  try {
    const record = await getRecord(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Signature record not found." });
      return;
    }
    const checks = await verifyStoredRecord(record);
    res.json(toPublicRecord(req, record, checks));
  } catch (error) {
    next(error);
  }
});

app.get("/api/signatures/:id/proof", async (req, res, next) => {
  try {
    const record = await getRecord(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Signature record not found." });
      return;
    }
    const checks = await verifyStoredRecord(record);
    const publicRecord = toPublicRecord(req, record, checks);
    res.setHeader("Content-Disposition", 'attachment; filename="stellar-signature-' + record.id + '.json"');
    res.json({ format: "stellar-pdf-signature", version: 1, sep: 53, ...publicRecord });
  } catch (error) {
    next(error);
  }
});

app.get("/api/signatures/:id/document", async (req, res, next) => {
  try {
    const record = await getRecord(req.params.id);
    if (!record) {
      res.sendStatus(404);
      return;
    }
    res.type("application/pdf");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", 'inline; filename="' + record.documentFilename.replace(/"/g, "_") + '"');
    res.sendFile(assetPath(record.id, record.documentFile));
  } catch (error) {
    next(error);
  }
});

app.get("/api/signatures/:id/insignia", async (req, res, next) => {
  try {
    const record = await getRecord(req.params.id);
    if (!record?.insigniaFile || !record.insigniaMimeType) {
      res.sendStatus(404);
      return;
    }
    res.type(record.insigniaMimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(assetPath(record.id, record.insigniaFile));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Upload exceeds the " + maxUploadMb + " MB limit."
      : error.message;
    res.status(400).json({ error: message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: "Invalid signed manifest.",
      details: error.issues.map((issue) => issue.message),
    });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

await initStore();

if (process.env.NODE_ENV === "production") {
  const clientDir = path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDir));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      res.sendFile(path.join(clientDir, "index.html"));
      return;
    }
    next();
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log("Stellar PDF Signer listening on http://localhost:" + port);
});
