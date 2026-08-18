import { issueNonce, signInMessage } from "@/lib/auth";
import { errorMessage, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { wallet } = (await req.json()) as { wallet?: string };
    if (!wallet) return fail("wallet is required.");
    const nonce = await issueNonce(wallet);
    return json({ nonce, message: signInMessage(wallet, nonce) });
  } catch (err) {
    return fail(errorMessage(err));
  }
}
