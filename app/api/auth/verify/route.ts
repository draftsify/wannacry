import { setSessionCookie, verifySignIn } from "@/lib/auth";
import { errorMessage, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { wallet, nonce, signature } = (await req.json()) as {
      wallet?: string;
      nonce?: string;
      signature?: string;
    };
    if (!wallet || !nonce || !signature) return fail("wallet, nonce and signature are required.");

    const verified = await verifySignIn(wallet, nonce, signature);
    setSessionCookie(verified);
    return json({ wallet: verified });
  } catch (err) {
    return fail(errorMessage(err), 401);
  }
}
