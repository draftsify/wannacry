/**
 * Rolls the epoch against a running dev server.
 *   npm run dev            (in one terminal)
 *   npm run epoch:open     (in another)
 */
const base = process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set in .env");
  process.exit(1);
}

const res = await fetch(`${base}/api/cron/epoch`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.json();
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);
