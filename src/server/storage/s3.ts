import { DeleteObjectCommand, GetObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.S3_REGION;
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

const s3 = region && accessKeyId && secretAccessKey
  ? new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

export async function createUploadUrl(key: string, contentType: string) {
  if (!s3 || !process.env.S3_BUCKET) throw new Error("Storage no configurado.");
  const command = new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: 60 * 10 });
}

export function isObjectStorageConfigured() {
  return Boolean(s3 && process.env.S3_BUCKET);
}

export async function putPrivateObject(key: string, contentType: string, body: Buffer) {
  if (!s3 || !process.env.S3_BUCKET) throw new Error("Storage no configurado.");
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType, Body: body }));
}

export async function readPrivateObject(key: string) {
  if (!s3 || !process.env.S3_BUCKET) throw new Error("Storage no configurado.");
  const result = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  if (!result.Body) throw new Error("El archivo almacenado está vacío.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deletePrivateObject(key: string) {
  if (!s3 || !process.env.S3_BUCKET) return;
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}
