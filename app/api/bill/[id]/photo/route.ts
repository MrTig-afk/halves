// GET /api/bill/<id>/photo - the kept receipt photo, only for the bill's payer or partner.
// Anything else - no such bill, someone else's bill, no photo - is the same 404.
import { query } from "@/lib/db";
import { currentPerson } from "@/lib/session";
import { idParam } from "@/lib/tab";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentPerson();
  const id = idParam((await ctx.params).id);
  const notFound = () => new Response("Not found", { status: 404 });
  if (!me || id === null) return notFound();
  const [p] = await query<{ jpeg: Buffer }>(
    `select p.jpeg from receipt_photo p join bill b on b.id = p.bill_id
     where b.id = $1 and (b.payer_id = $2 or b.partner_id = $2)`,
    [id, me.id],
  );
  if (!p) return notFound();
  return new Response(new Uint8Array(p.jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, no-store", // a signed-out device must not keep serving it
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
