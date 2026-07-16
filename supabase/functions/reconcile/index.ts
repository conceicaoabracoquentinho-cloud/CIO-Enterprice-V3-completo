import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { serviceClient, insertAuditRecord } from '../_shared/db.ts';
import * as Bling from '../_shared/bling.ts';
import * as ML from '../_shared/ml.ts';
import * as Shopee from '../_shared/shopee.ts';
import { buildDivergenceRows, canAutoFix, DivergenceRow } from '../_shared/divergence-engine.ts';
import { ReconcileActionSchema } from '../_shared/schemas.ts';

// ─── Passo 1: buscar dados reais (nunca mock) e delegar o cálculo à função pura ───
async function computeDivergences(): Promise<{ rows: DivergenceRow[]; notConfigured: string[] }> {
  const notConfigured: string[] = [];

  const blingRes = await Bling.getProducts();
  if (!blingRes.ok) {
    // Sem o ERP não há como comparar nada (ele é a fonte da verdade). Aborta
    // com uma mensagem clara em vez de mostrar divergências parciais/erradas.
    throw new Error(`Bling: ${blingRes.error}`);
  }

  const mlRes = await ML.getListings();
  const mlListings = mlRes.ok ? mlRes.data : (notConfigured.push('mercadolivre'), []);

  const shopeeRes = await Shopee.getListings();
  const shopeeListings = shopeeRes.ok ? shopeeRes.data : (notConfigured.push('shopee'), []);

  const rows = buildDivergenceRows(blingRes.data, mlListings, shopeeListings);
  return { rows, notConfigured };
}

// ─── Passo 2: aplicar uma correção real via API oficial ─────────────────────
async function applyFix(div: { divergence_type: string; marketplace: string; erp_value: string | null; ml_item_id: string | null; shopee_item_id: string | null }): Promise<{ ok: boolean; error?: string }> {
  // Defesa em profundidade: mesmo que algo chame applyFix diretamente para um
  // tipo "somente manual" (photo/description/unlinked_sku), recusa agir.
  if (!canAutoFix(div.divergence_type)) {
    return { ok: false, error: 'Este tipo de divergência exige revisão manual — nenhuma ação automática é permitida.' };
  }
  if (div.marketplace === 'mercadolivre' || div.marketplace === 'both') {
    if (div.divergence_type === 'stock' && div.ml_item_id) {
      const r = await ML.updateStock(div.ml_item_id, Number(div.erp_value ?? 0));
      if (!r.ok) return r;
    } else if (div.divergence_type === 'orphan' && div.ml_item_id) {
      const r = await ML.closeListing(div.ml_item_id);
      if (!r.ok) return r;
    }
  }
  if (div.marketplace === 'shopee' || div.marketplace === 'both') {
    if (div.divergence_type === 'stock' && div.shopee_item_id) {
      const r = await Shopee.updateStock(Number(div.shopee_item_id), Number(div.erp_value ?? 0));
      if (!r.ok) return r;
    } else if (div.divergence_type === 'orphan' && div.shopee_item_id) {
      const r = await Shopee.unlistItem(Number(div.shopee_item_id));
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}

// BLOCO 4 (correção de auditoria — item 11, fila/reprocessamento): toda
// falha de aplicação de correção vai para retry_queue em vez de só falhar
// silenciosamente. process-retry-queue (function separada) reprocessa depois.
async function enqueueRetry(source: string, operation: string, payload: Record<string, unknown>, error: string) {
  const db = serviceClient();
  await db.from('retry_queue').insert({
    source, operation, payload, last_error: error, status: 'pending', attempts: 1, next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
  });
}

Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo da requisição inválido' }, 400);
  }

  const parsed = ReconcileActionSchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  const { action, params = {} } = parsed.data;

  const db = serviceClient();

  if (action === 'refresh_divergences') {
    try {
      const { rows, notConfigured } = await computeDivergences();
      const now = new Date().toISOString();
      const { error: delError } = await db.from('divergences').delete().eq('resolved', false).eq('ignored', false);
      if (delError) throw new Error(`Falha ao limpar divergências: ${delError.message}`);
      if (rows.length > 0) {
        const { error: insError } = await db.from('divergences').insert(rows.map((r) => ({ ...r, resolved: false, resolved_at: null, ignored: false, created_at: now, updated_at: now })));
        if (insError) throw new Error(`Falha ao inserir divergências: ${insError.message}`);
      }
      const { data, error: selError } = await db.from('divergences').select('*').eq('resolved', false).eq('ignored', false).order('priority', { ascending: true });
      if (selError) throw new Error(`Falha ao ler divergências: ${selError.message}`);
      return jsonResponse({ ok: true, data: data ?? [], notConfigured });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      await insertAuditRecord({ module: 'conciliacao', description: 'Falha ao calcular divergências', result: 'error', details: { error: message } });
      return jsonResponse({ ok: false, error: message });
    }
  }

  if (action === 'fix_one') {
    const { divergenceId } = params as { divergenceId: string };
    const { data: div } = await db.from('divergences').select('*').eq('id', divergenceId).maybeSingle();
    if (!div) return jsonResponse({ ok: false, error: 'Divergência não encontrada' });
    const result = await applyFix(div);
    if (result.ok) {
      await db.from('divergences').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', divergenceId);
    } else {
      await enqueueRetry(div.marketplace, 'fix_divergence', { divergenceId }, result.error ?? 'erro desconhecido');
    }
    return jsonResponse(result);
  }

  // Ignorar não altera nada no ERP nem no marketplace — só tira o item da
  // fila de pendências do CIO (Módulo 06, "fila de correções": cancelar).
  if (action === 'ignore_one') {
    const { divergenceId } = params as { divergenceId: string };
    const { error: updError } = await db.from('divergences').update({ ignored: true }).eq('id', divergenceId);
    if (updError) return jsonResponse({ ok: false, error: updError.message });
    return jsonResponse({ ok: true });
  }

  if (action === 'conciliar_todos') {
    const { data: divergences } = await db.from('divergences').select('*').eq('resolved', false).eq('ignored', false);
    const t0 = Date.now();
    let updated = 0, errors = 0, manualReview = 0;
    const details: Array<{ sku: string; status: string; message: string }> = [];

    for (const div of divergences ?? []) {
      if (!canAutoFix(div.divergence_type)) {
        manualReview++;
        details.push({ sku: div.sku, status: 'manual_review', message: 'Requer ação manual (ver recommended_action)' });
        continue;
      }
      const result = await applyFix(div);
      if (result.ok) {
        await db.from('divergences').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', div.id);
        updated++;
        details.push({ sku: div.sku, status: 'success', message: div.recommended_action });
      } else {
        errors++;
        details.push({ sku: div.sku, status: 'error', message: result.error ?? 'Erro desconhecido' });
        await enqueueRetry(div.marketplace, 'fix_divergence', { divergenceId: div.id }, result.error ?? 'erro desconhecido');
      }
    }

    const durationMs = Date.now() - t0;
    await insertAuditRecord({
      module: 'conciliacao',
      description: `Conciliação em massa: ${updated} atualizados, ${manualReview} p/ revisão manual, ${errors} erros`,
      result: errors === 0 ? 'success' : updated > 0 ? 'partial' : 'error',
      details: { updated, manualReview, errors, durationMs },
    });

    return jsonResponse({ ok: true, updated, manualReview, errors, durationMs, details });
  }

  if (action === 'update_integrations') {
    const t0 = Date.now();
    const [blingRes, mlRes, shopeeRes] = await Promise.all([Bling.testConnection(), ML.testConnection(), Shopee.testConnection()]);
    await insertAuditRecord({
      module: 'integrar',
      description: 'Atualização de integrações executada',
      result: blingRes.ok && mlRes.ok && shopeeRes.ok ? 'success' : 'partial',
      details: { bling: blingRes, mercadolivre: mlRes, shopee: shopeeRes },
    });
    return jsonResponse({
      bling: { success: blingRes.ok, durationMs: blingRes.ms, error: blingRes.error },
      mercadolivre: { success: mlRes.ok, durationMs: mlRes.ms, error: mlRes.error },
      shopee: { success: shopeeRes.ok, durationMs: shopeeRes.ms, error: shopeeRes.error },
      totalDurationMs: Date.now() - t0,
    });
  }

  return jsonResponse({ ok: false, error: `Ação desconhecida: ${action}` }, 400);
});
