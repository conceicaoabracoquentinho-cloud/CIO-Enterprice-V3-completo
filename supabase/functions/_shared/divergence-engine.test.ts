import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildDivergenceRows, priorityForStock, canAutoFix } from './divergence-engine.ts';

const erpBase = { sku: 'ABC', name: 'Produto ABC', stock: 10, hasPhoto: true, hasDescription: true };

Deno.test('produto com estoque igual em todos os canais não gera divergência de estoque', () => {
  const rows = buildDivergenceRows(
    [erpBase],
    [{ itemId: 'MLB1', sku: 'ABC', title: 'Produto ABC', stock: 10, status: 'active' }],
    []
  );
  assertEquals(rows.filter((r) => r.divergence_type === 'stock').length, 0);
});

Deno.test('divergência de estoque real (SKU correspondente, quantidades diferentes)', () => {
  const rows = buildDivergenceRows(
    [erpBase],
    [{ itemId: 'MLB1', sku: 'ABC', title: 'Produto ABC', stock: 5, status: 'active' }],
    []
  );
  const stockRow = rows.find((r) => r.divergence_type === 'stock');
  assertEquals(stockRow?.erp_value, '10');
  assertEquals(stockRow?.ml_value, '5');
});

// ─── Regressão do BLOCO 2 (item 3.2 do AUDIT_REPORT): falso positivo de órfão ───
Deno.test('REGRESSÃO item 3.2: anúncio ML sem SKU vinculado (sku=null) NUNCA vira "orphan"', () => {
  const rows = buildDivergenceRows(
    [erpBase],
    [{ itemId: 'MLB2', sku: null, title: 'Anúncio sem SKU', stock: 3, status: 'active' }],
    []
  );
  const orphanRows = rows.filter((r) => r.divergence_type === 'orphan');
  const unlinkedRows = rows.filter((r) => r.divergence_type === 'unlinked_sku');
  assertEquals(orphanRows.length, 0, 'não deve haver nenhuma linha "orphan" para item sem SKU');
  assertEquals(unlinkedRows.length, 1, 'deve haver exatamente 1 linha "unlinked_sku"');
  assertEquals(canAutoFix('unlinked_sku'), false, 'unlinked_sku nunca pode ter correção automática');
});

Deno.test('REGRESSÃO item 3.2: anúncio Shopee com item_sku="" (string vazia) NUNCA vira "orphan"', () => {
  const rows = buildDivergenceRows(
    [erpBase],
    [],
    [{ itemId: 999, sku: null, name: 'Anúncio Shopee sem SKU', stock: 4, status: 'NORMAL' }]
  );
  assertEquals(rows.filter((r) => r.divergence_type === 'orphan').length, 0);
  assertEquals(rows.filter((r) => r.divergence_type === 'unlinked_sku').length, 1);
});

Deno.test('produto realmente órfão (SKU presente mas não existe no ERP) ainda é detectado como orphan', () => {
  const rows = buildDivergenceRows(
    [erpBase],
    [{ itemId: 'MLB3', sku: 'SKU-QUE-NAO-EXISTE', title: 'Produto fantasma', stock: 2, status: 'active' }],
    []
  );
  const orphanRows = rows.filter((r) => r.divergence_type === 'orphan');
  assertEquals(orphanRows.length, 1);
  assertEquals(canAutoFix('orphan'), true);
});

Deno.test('produto sem foto e sem descrição gera divergências informativas, nunca autocorrigíveis', () => {
  const rows = buildDivergenceRows(
    [{ ...erpBase, hasPhoto: false, hasDescription: false }],
    [],
    []
  );
  const photo = rows.find((r) => r.divergence_type === 'photo');
  const desc = rows.find((r) => r.divergence_type === 'description');
  assertEquals(photo?.priority, 'informative');
  assertEquals(desc?.priority, 'informative');
  assertEquals(canAutoFix('photo'), false);
  assertEquals(canAutoFix('description'), false);
});

Deno.test('priorityForStock: marketplace com mais estoque que o ERP é sempre crítico', () => {
  assertEquals(priorityForStock(5, 10), 'critical');
});

Deno.test('priorityForStock: ERP com estoque e marketplace zerado é alto', () => {
  assertEquals(priorityForStock(10, 0), 'high');
});

Deno.test('priorityForStock: diferença pequena (<=2) é média', () => {
  assertEquals(priorityForStock(10, 8), 'medium');
});

Deno.test('ERP sempre vence: recommended_action nunca sugere alterar o ERP a partir do marketplace', () => {
  const rows = buildDivergenceRows(
    [erpBase],
    [{ itemId: 'MLB1', sku: 'ABC', title: 'Produto ABC', stock: 5, status: 'active' }],
    []
  );
  for (const r of rows) {
    assertEquals(/\bBling\b|\bERP\b/i.test(r.recommended_action), false);
  }
});
