import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/db.ts';
import * as ML from '../_shared/ml.ts';
import * as Shopee from '../_shared/shopee.ts';

// BLOCO 4 (correção de auditoria — item 11, fila/reprocessamento): quando
// `fix_one`/`conciliar_todos` (em reconcile/index.ts) falham ao aplicar uma
// correção, o item entra em `retry_queue`. Esta function reprocessa a fila —
// pode ser chamada manualmente (com o header de autenticação interna) ou
// agendada via `supabase functions schedule` / cron externo.
//
// Escopo desta correção: não criei nenhuma tela nova para isto (o Prompt PJ
// desta fase proíbe novas funcionalidades/telas) — é só a estrutura de
// backend que faltava. Acionar via cron é uma decisão operacional de vocês.
const MAX_ATTEMPTS = 5;

Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const db = serviceClient();
  const { data: pending } = await db
    .from('retry_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .limit(20);

  let processed = 0, succeeded = 0, failed = 0;

  for (const item of pending ?? []) {
    processed++;
    await db.from('retry_queue').update({ status: 'processing' }).eq('id', item.id);

    let result: { ok: boolean; error?: string } = { ok: false, error: 'operação desconhecida' };
    if (item.operation === 'fix_divergence') {
      const { divergenceId } = item.payload as { divergenceId: string };
      const { data: div } = await db.from('divergences').select('*').eq('id', divergenceId).maybeSingle();
      if (!div) {
        result = { ok: false, error: 'divergência não existe mais (provavelmente já resolvida ou removida)' };
      } else if (div.marketplace === 'mercadolivre' && div.ml_item_id && div.divergence_type === 'stock') {
        result = await ML.updateStock(div.ml_item_id, Number(div.erp_value ?? 0));
      } else if (div.marketplace === 'shopee' && div.shopee_item_id && div.divergence_type === 'stock') {
        result = await Shopee.updateStock(Number(div.shopee_item_id), Number(div.erp_value ?? 0));
      } else if (div.marketplace === 'mercadolivre' && div.ml_item_id && div.divergence_type === 'orphan') {
        result = await ML.closeListing(div.ml_item_id);
      } else if (div.marketplace === 'shopee' && div.shopee_item_id && div.divergence_type === 'orphan') {
        result = await Shopee.unlistItem(Number(div.shopee_item_id));
      } else {
        result = { ok: false, error: 'combinação de marketplace/tipo não suportada para retry' };
      }
      if (result.ok && div) {
        await db.from('divergences').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', div.id);
      }
    }

    if (result.ok) {
      succeeded++;
      await db.from('retry_queue').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', item.id);
    } else {
      failed++;
      const attempts = (item.attempts ?? 0) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.from('retry_queue').update({
        status: giveUp ? 'failed' : 'pending',
        attempts,
        last_error: result.error ?? 'erro desconhecido',
        next_attempt_at: new Date(Date.now() + Math.min(attempts, 5) * 60_000).toISOString(), // backoff linear até 5 min
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
    }
  }

  return jsonResponse({ ok: true, processed, succeeded, failed });
});
