import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import type { SecretKey } from "../shared/rpc";
import { AppDb } from "./db";

const KEY_ENV = "SMITHERS_SECRET_KEY";
const KEY_FILE = join(os.homedir(), ".smithers", "secret.key");
const KEY_BYTES = 32;

type EncryptedPayload = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

let cachedKey: Buffer | null = null;

function normalizeKey(input: string): Buffer {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length >= KEY_BYTES) {
      return buf.subarray(0, KEY_BYTES);
    }
  } catch {
    // fall through to scrypt
  }
  return scryptSync(trimmed, "smithers-desktop", KEY_BYTES);
}

async function loadKeyFromFile(): Promise<Buffer | null> {
  try {
    const raw = await fs.readFile(KEY_FILE, "utf8");
    const buf = Buffer.from(raw.trim(), "base64");
    if (buf.length >= KEY_BYTES) {
      return buf.subarray(0, KEY_BYTES);
    }
  } catch {
    return null;
  }
  return null;
}

async function persistKey(key: Buffer): Promise<void> {
  await fs.mkdir(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  await fs.writeFile(KEY_FILE, key.toString("base64"), { mode: 0o600 });
  try {
    await fs.chmod(KEY_FILE, 0o600);
  } catch {
    // best effort on non-posix platforms
  }
}

async function getSecretKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const envKey = process.env[KEY_ENV];
  if (envKey && envKey.trim().length > 0) {
    cachedKey = normalizeKey(envKey);
    return cachedKey;
  }
  const existing = await loadKeyFromFile();
  if (existing) {
    cachedKey = existing;
    return cachedKey;
  }
  const fresh = randomBytes(KEY_BYTES);
  await persistKey(fresh);
  cachedKey = fresh;
  return cachedKey;
}

async function encryptSecret(plainText: string): Promise<string> {
  const key = await getSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
  return JSON.stringify(payload);
}

async function decryptSecret(payload: string): Promise<string> {
  const key = await getSecretKey();
  const parsed = JSON.parse(payload) as EncryptedPayload;
  if (!parsed || parsed.v !== 1) {
    throw new Error("Invalid secret payload");
  }
  const iv = Buffer.from(parsed.iv, "base64");
  const tag = Buffer.from(parsed.tag, "base64");
  const data = Buffer.from(parsed.data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}

export class SecretStore {
  private db: AppDb;

  constructor(db: AppDb) {
    this.db = db;
  }

  async get(key: SecretKey): Promise<string | null> {
    const row = this.db.getSecret(key);
    if (!row) return null;
    try {
      return await decryptSecret(row.value);
    } catch {
      return null;
    }
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const payload = await encryptSecret(value);
    this.db.setSecret(key, payload);
  }

  clear(key: SecretKey): void {
    this.db.deleteSecret(key);
  }

  has(key: SecretKey): boolean {
    return Boolean(this.db.getSecret(key));
  }
}

