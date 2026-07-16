import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/db.ts';
import { z } from 'npm:zod@3.23.8';

const BodySchema = z.object({
  source: z.enum(['bling', 'mercadolivre', 'shopee']),
  client_id: z.string().min(1).max(500).optional(),
  client_secret: z.string().min(1).max(500).optional(),
  redirect_uri: z.string().url().max(1000).optional(),
  frontend_admin_url: z.string().max(1000).optional(),
}).refine(
  (data) => data.client_id !== undefined || data.client_secret !== undefined || data.redirect_uri !== undefined,
  { message: 'Pelo menos um campo (client_id, client_secret ou redirect_uri) deve ser fornecido' }
);

// Único ponto de escrita para oauth_credentials. O frontend nunca escreve
// direto na tabela (ela não tem policy de RLS para anon/authenticated),
// então toda gravação de Client ID/Secret passa obrigatoriamente por aqui.
// Isto também significa que o valor do secret nunca fica visível de volta
// para o navegador depois de salvo (o GET de status só informa se está
// configurado, não o valor).
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido' }, 405);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo inválido' }, 400);
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;

  const db = serviceClient();
  const { data: existing } = await db.from('oauth_credentials').select('extra').eq('source', body.source).maybeSingle();
  const extra = { ...(existing?.extra ?? {}), frontend_admin_url: body.frontend_admin_url };

  const update: Record<string, unknown> = { source: body.source, extra, updated_at: new Date().toISOString() };
  if (body.client_id !== undefined) update.client_id = body.client_id;
  if (body.client_secret !== undefined) update.client_secret = body.client_secret;
  if (body.redirect_uri !== undefined) update.redirect_uri = body.redirect_uri;

  const { error } = await db.from('oauth_credentials').upsert(update, { onConflict: 'source' });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true });
});
