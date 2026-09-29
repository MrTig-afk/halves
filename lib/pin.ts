// PIN hashing with Node's built-in scrypt (no dependency). Stored as
// "scrypt$N$r$p$salt$hash", so the cost can be raised later without breaking old hashes.
// Plain TypeScript with relative imports only, so scripts/seed.ts can use it directly.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pin: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pin, salt, len, o, (e, key) => (e ? reject(e) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;

export const isValidPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4}$/.test(pin);

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error("PIN must be exactly 4 digits");
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, LEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !isValidPin(pin)) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pin, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}
