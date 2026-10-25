import {
  createCipheriv,
  randomBytes,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  pbkdf2,
} from "node:crypto";
import { promisify } from "node:util";
import { equal } from "../security/crypto.js";

const derive = promisify(pbkdf2);
const sha = (b: Buffer): Buffer => createHash("sha256").update(b).digest();
function hex(text: string): Buffer {
  if (!/^(?:[0-9a-f]{2})+$/i.test(text) || text.length > 16_000_000)
    throw new Error("Invalid Defuse encoding");
  return Buffer.from(text, "hex");
}
function checked(text: string, header: string): Buffer {
  const b = hex(text);
  if (
    b.length < 36 ||
    !equal(b.subarray(0, 4), Buffer.from(header, "hex")) ||
    !equal(sha(b.subarray(0, -32)), b.subarray(-32))
  )
    throw new Error("Invalid Defuse key");
  return b.subarray(4, -32);
}
async function decryptRaw(
  ciphertext: Buffer,
  material: Buffer,
  password: boolean,
): Promise<Buffer> {
  if (
    ciphertext.length < 84 ||
    ciphertext.subarray(0, 4).toString("hex") !== "def50200"
  )
    throw new Error("Unsupported Defuse ciphertext");
  const salt = ciphertext.subarray(4, 36);
  const raw = password
    ? await derive(sha(material), salt, 100000, 32, "sha256")
    : material;
  try {
    const auth = Buffer.from(
      hkdfSync("sha256", raw, salt, "DefusePHP|V2|KeyForAuthentication", 32),
    );
    const mac = createHmac("sha256", auth)
      .update(ciphertext.subarray(0, -32))
      .digest();
    auth.fill(0);
    if (!equal(mac, ciphertext.subarray(-32)))
      throw new Error("Wrong key or modified Defuse ciphertext");
    const key = Buffer.from(
      hkdfSync("sha256", raw, salt, "DefusePHP|V2|KeyForEncryption", 32),
    );
    try {
      const cipher = createDecipheriv(
        "aes-256-ctr",
        key,
        ciphertext.subarray(36, 52),
      );
      return Buffer.concat([
        cipher.update(ciphertext.subarray(52, -32)),
        cipher.final(),
      ]);
    } finally {
      key.fill(0);
    }
  } finally {
    if (password) raw.fill(0);
  }
}
export async function unlockDefuse(
  protectedKey: string,
  password: string,
): Promise<Buffer> {
  const inner = await decryptRaw(
    checked(protectedKey, "def10000"),
    sha(Buffer.from(password)),
    true,
  );
  try {
    const key = checked(inner.toString(), "def00000");
    if (key.length !== 32) throw new Error("Invalid Defuse key size");
    return Buffer.from(key);
  } finally {
    inner.fill(0);
  }
}
export async function decryptDefuse(
  ciphertext: string,
  protectedKey: string,
  password: string,
): Promise<Buffer> {
  const key = await unlockDefuse(protectedKey, password);
  try {
    return await decryptRaw(hex(ciphertext), key, false);
  } finally {
    key.fill(0);
  }
}

async function encryptRaw(
  data: Buffer,
  material: Buffer,
  password: boolean,
): Promise<Buffer> {
  const salt = randomBytes(32),
    iv = randomBytes(16),
    raw = password
      ? await derive(sha(material), salt, 100000, 32, "sha256")
      : material;
  try {
    const key = Buffer.from(
        hkdfSync("sha256", raw, salt, "DefusePHP|V2|KeyForEncryption", 32),
      ),
      auth = Buffer.from(
        hkdfSync("sha256", raw, salt, "DefusePHP|V2|KeyForAuthentication", 32),
      );
    try {
      const cipher = createCipheriv("aes-256-ctr", key, iv),
        value = Buffer.concat([
          Buffer.from("def50200", "hex"),
          salt,
          iv,
          cipher.update(data),
          cipher.final(),
        ]);
      return Buffer.concat([
        value,
        createHmac("sha256", auth).update(value).digest(),
      ]);
    } finally {
      key.fill(0);
      auth.fill(0);
    }
  } finally {
    if (password) raw.fill(0);
  }
}
function encodeChecked(data: Buffer, header: string): string {
  const value = Buffer.concat([Buffer.from(header, "hex"), data]);
  return Buffer.concat([value, sha(value)]).toString("hex");
}
/** Export compatibility only. Application storage always uses NP1 AES-GCM. */
export async function encryptDefuse(
  data: string,
  password: string,
): Promise<{ pass: string; key: string }> {
  const raw = randomBytes(32);
  try {
    const wrapped = await encryptRaw(
      Buffer.from(encodeChecked(raw, "def00000")),
      sha(Buffer.from(password)),
      true,
    );
    return {
      pass: (await encryptRaw(Buffer.from(data), raw, false)).toString("hex"),
      key: encodeChecked(wrapped, "def10000"),
    };
  } finally {
    raw.fill(0);
  }
}
