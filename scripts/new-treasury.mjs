/**
 * Generates a treasury keypair and writes it straight into .env.
 *
 * The key is never printed to the terminal and never leaves this machine — a
 * secret that appears in scrollback is a secret in your shell history, your
 * terminal buffer, and anywhere that buffer gets pasted.
 */
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const envPath = path.resolve(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.resolve(process.cwd(), ".env.example"), envPath);
  console.log("Created .env from .env.example");
}

let env = fs.readFileSync(envPath, "utf8");

if (/^TREASURY_SECRET_KEY="..+"/m.test(env)) {
  console.error("TREASURY_SECRET_KEY is already set in .env. Refusing to overwrite it.");
  process.exit(1);
}

const kp = Keypair.generate();
const secret = bs58.encode(kp.secretKey);
const pubkey = kp.publicKey.toBase58();

const set = (key, value) =>
  new RegExp(`^${key}=.*$`, "m").test(env)
    ? (env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}="${value}"`))
    : (env += `\n${key}="${value}"`);

set("TREASURY_SECRET_KEY", secret);
set("NEXT_PUBLIC_TREASURY_PUBKEY", pubkey);

fs.writeFileSync(envPath, env, "utf8");
fs.chmodSync(envPath, 0o600);

console.log(`Treasury public key: ${pubkey}`);
console.log("Secret key written to .env. Fund this address, then run the epoch cron.");
