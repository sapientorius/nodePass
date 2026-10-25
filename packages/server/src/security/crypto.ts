import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const digest = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
export const token = (): string => randomBytes(32).toString("base64url");
export function equal(a: string | Buffer, b: string | Buffer): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** NP1 is binary: magic(4), nonce(12), tag(16), ciphertext. AAD is mandatory. */
export function seal(
  data: Buffer | string,
  key: Buffer,
  context: string,
): Buffer {
  if (key.length !== 32 || !context)
    throw new Error("Invalid encryption context");
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`nodePass/v1/${context}`));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([
    Buffer.from("NP1\0"),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export function open(data: Buffer, key: Buffer, context: string): Buffer {
  if (
    data.length < 32 ||
    data.subarray(0, 4).toString() !== "NP1\0" ||
    key.length !== 32 ||
    !context
  )
    throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from(`nodePass/v1/${context}`));
  decipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
}
export function encryptSecret(
  data: string,
  kek: Buffer,
  context: string,
): { pass: Buffer; key: Buffer } {
  const dek = randomBytes(32);
  try {
    return {
      pass: seal(data, dek, context),
      key: seal(dek, kek, `${context}/key`),
    };
  } finally {
    dek.fill(0);
  }
}
export function decryptSecret(
  data: { pass: Buffer; key: Buffer },
  kek: Buffer,
  context: string,
): string {
  const dek = open(data.key, kek, `${context}/key`);
  try {
    return open(data.pass, dek, context).toString("utf8");
  } finally {
    dek.fill(0);
  }
}
