import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { testConnection, getProducts, getOrders } from '../_shared/bling.ts';
import { BlingActionSchema } from '../_shared/schemas.ts';

Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo da requisição inválido' }, 400);
  }

  const parsed = BlingActionSchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  const { action } = parsed.data;

  if (action === 'test_connection') return jsonResponse(await testConnection());
  if (action === 'get_products') return jsonResponse(await getProducts());
  if (action === 'get_orders') return jsonResponse(await getOrders());

  return jsonResponse({ ok: false, error: `Ação desconhecida: ${action}` }, 400);
});
