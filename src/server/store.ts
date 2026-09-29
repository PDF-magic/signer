import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SignatureManifestV1 } from "../shared/types";

export interface StoredSignatureRecord {
  id: string;
  manifest: SignatureManifestV1;
  signature: string;
  canonicalMessage: string;
  serverReceivedAt: string;
  documentFilename: string;
  documentMimeType: string;
  documentFile: string;
  insigniaMimeType: string | null;
  insigniaFile: string | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

function dataRoot(): string {
  return path.resolve(process.env.DATA_DIR || "data");
}

function recordsRoot(): string {
  return path.join(dataRoot(), "records");
}

export async function initStore(): Promise<void> {
  await mkdir(recordsRoot(), { recursive: true });
}

export function createId(): string {
  return randomBytes(12).toString("base64url");
}

export function assertValidId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid signature id.");
}

function recordDirectory(id: string): string {
  assertValidId(id);
  return path.join(recordsRoot(), id);
}

export async function saveRecordAtomic(
  record: StoredSignatureRecord,
  document: Buffer,
  insignia: Buffer | null,
): Promise<void> {
  assertValidId(record.id);
  const finalDir = recordDirectory(record.id);
  const tempDir = path.join(recordsRoot(), "." + record.id + "." + randomBytes(5).toString("hex") + ".tmp");

  await mkdir(tempDir, { recursive: false });
  try {
    await writeFile(path.join(tempDir, record.documentFile), document, { flag: "wx" });
    if (insignia && record.insigniaFile) {
      await writeFile(path.join(tempDir, record.insigniaFile), insignia, { flag: "wx" });
    }
    await writeFile(
      path.join(tempDir, "record.json"),
      JSON.stringify(record, null, 2) + "\n",
      { flag: "wx" },
    );
    await rename(tempDir, finalDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function getRecord(id: string): Promise<StoredSignatureRecord | null> {
  try {
    const raw = await readFile(path.join(recordDirectory(id), "record.json"), "utf8");
    return JSON.parse(raw) as StoredSignatureRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function assetPath(id: string, filename: string): string {
  assertValidId(id);
  if (path.basename(filename) !== filename) throw new Error("Invalid stored filename.");
  return path.join(recordDirectory(id), filename);
}
