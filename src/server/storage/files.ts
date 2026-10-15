import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { deletePrivateObject, isObjectStorageConfigured, putPrivateObject, readPrivateObject } from "@/server/storage/s3";

/**
 * Archivos privados de la empresa (PDF generados, documentos…). Con S3 configurado se guardan en el
 * bucket; si no, en `LOCAL_UPLOAD_DIR` (por defecto `.data/uploads`). La clave devuelta indica dónde:
 * `s3:<clave>` o `local:<clave>`.
 */

const uploadRoot = () => process.env.LOCAL_UPLOAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "uploads");

export function safeStorageSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "file";
}

function localPath(key: string) {
  const root = path.resolve(uploadRoot());
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Ruta de almacenamiento no válida.");
  return resolved;
}

export async function storePrivateFile(input: { tenantId: string; companyId: string; folder: string; fileName: string; contentType: string; body: Buffer }) {
  const key = [input.tenantId, input.companyId, input.folder, safeStorageSegment(input.fileName)].map(safeStorageSegment).join("/");
  if (isObjectStorageConfigured()) {
    await putPrivateObject(key, input.contentType, input.body);
    return `s3:${key}`;
  }
  const filePath = localPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.body);
  return `local:${key}`;
}

export async function readPrivateFile(storageKey: string) {
  if (storageKey.startsWith("s3:")) return readPrivateObject(storageKey.slice(3));
  if (storageKey.startsWith("local:")) return readFile(/* turbopackIgnore: true */ localPath(storageKey.slice(6)));
  throw new Error("Clave de almacenamiento desconocida.");
}

export async function deletePrivateFile(storageKey: string) {
  if (storageKey.startsWith("s3:")) return deletePrivateObject(storageKey.slice(3));
  if (storageKey.startsWith("local:")) await rm(localPath(storageKey.slice(6)), { force: true });
}
