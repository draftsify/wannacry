import { cookies } from "next/headers";
import { ed25519 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { envStr } from "@/lib/env";
import { isValidPubkey } from "@/lib/solana";
import { SIGN_IN_DOMAIN } from "@/lib/config";

/**
 * Sign-In With Solana.
 *
 * Connecting a wallet proves nothing — the browser can name any address. A
 * signature over a server-issued single-use nonce is what actually establishes
 * that this session controls the wallet whose allocation it is about to spend.
 */

const COOKIE = "pz_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const NONCE_TTL_SECONDS = 5 * 60;

// Re-exported so callers keep importing sign-in concerns from one place.
export { SIGN_IN_DOMAIN };

export function signInMessage(wallet: string, nonce: string): string {
  return [
    `${SIGN_IN_DOMAIN} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Signing proves you control this wallet. It authorizes nothing else, moves no funds, and costs no fees.",
    "",
    `Nonce: ${nonce}`,
  ].join("\n");
}

export async function issueNonce(wallet: string): Promise<string> {
  if (!isValidPubkey(wallet)) throw new Error("Invalid wallet address.");
  const nonce = bytesToHex(randomBytes(16));
  await prisma.authNonce.create({
    data: {
      nonce,
      wallet,
      expiresAt: new Date(Date.now() + NONCE_TTL_SECONDS * 1000),
    },
  });
  return nonce;
}

/** Verifies the signature and burns the nonce. Returns the wallet on success. */
export async function verifySignIn(
  wallet: string,
  nonce: string,
  signatureB58: string,
): Promise<string> {
  const row = await prisma.authNonce.findUnique({ where: { nonce } });
  if (!row) throw new Error("Unknown nonce.");
  if (row.usedAt) throw new Error("Nonce already used.");
  if (row.expiresAt < new Date()) throw new Error("Nonce expired.");
  if (row.wallet !== wallet) throw new Error("Nonce was issued for a different wallet.");

  const ok = ed25519.verify(
    bs58.decode(signatureB58),
    utf8ToBytes(signInMessage(wallet, nonce)),
    bs58.decode(wallet),
  );
  if (!ok) throw new Error("Signature does not verify.");

  // Burn before issuing the session so a replayed request cannot mint a second.
  const burned = await prisma.authNonce.updateMany({
    where: { nonce, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count !== 1) throw new Error("Nonce already used.");

  return wallet;
}

function sessionSecret(): Uint8Array {
  return utf8ToBytes(envStr("SESSION_SECRET"));
}

export function mintSessionToken(wallet: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${wallet}.${exp}`;
  const mac = bytesToHex(hmac(sha256, sessionSecret(), utf8ToBytes(payload)));
  return `${payload}.${mac}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [wallet, expRaw, mac] = parts;

  const expected = bytesToHex(hmac(sha256, sessionSecret(), utf8ToBytes(`${wallet}.${expRaw}`)));
  if (!timingSafeEqualHex(mac, expected)) return null;
  if (Number(expRaw) * 1000 < Date.now()) return null;
  if (!isValidPubkey(wallet)) return null;
  return wallet;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function setSessionCookie(wallet: string): void {
  cookies().set(COOKIE, mintSessionToken(wallet), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(): void {
  cookies().delete(COOKIE);
}

/** The authenticated wallet for this request, or null. */
export function sessionWallet(): string | null {
  return readSessionToken(cookies().get(COOKIE)?.value);
}

/** Same, but throws — for routes where anonymous access is a bug. */
export function requireWallet(): string {
  const wallet = sessionWallet();
  if (!wallet) throw new Error("Not authenticated.");
  return wallet;
}
