// Motor de cálculo de divergências — função pura, sem I/O, para permitir
// testes unitários reais sem precisar mockar rede (ver
// divergence-engine.test.ts). reconcile/index.ts busca os dados reais do
// Bling/ML/Shopee e repassa para buildDivergenceRows().

export type Priority = 'critical' | 'high' | 'medium' | 'informative';

export interface DivergenceRow {
  product_name: string;
  sku: string;
  divergence_type: string; // 'stock' | 'status' | 'orphan' | 'unlinked_sku' | 'photo' | 'description'
  priority: Priority;
  erp_value: string | null;
  ml_value: string | null;
  shopee_value: string | null;
  recommended_action: string;
  marketplace: 'mercadolivre' | 'shopee' | 'both';
  ml_item_id: string | null;
  shopee_item_id: string | null;
}

export interface ErpProductInput {
  sku: string;
  name: string;
  stock: number;
  hasPhoto: boolean;
  hasDescription: boolean;
}

export interface MlListingInput {
  itemId: string;
  sku: string | null;
  title: string;
  stock: number;
  status: 'active' | 'paused' | 'closed';
}

export interface ShopeeListingInput {
  itemId: number;
  sku: string | null;
  name: string;
  stock: number;
  status: 'NORMAL' | 'BANNED' | 'DELETED' | 'UNLIST';
}

export function priorityForStock(erp: number, mp: number): Priority {
  if (mp > erp) return 'critical';
  if (erp > 0 && mp === 0) return 'high';
  if (Math.abs(erp - mp) <= 2) return 'medium';
  return 'high';
}

// BLOCO 2 (correção de auditoria — item 3.2, "falso positivo de produto
// órfão"): quando o marketplace não tem SKU vinculado (sku === null), NÃO
// tratamos mais como "orphan" (que oferece ação automática de encerrar
// anúncio). Vira uma categoria própria "unlinked_sku", informativa, sem
// nenhuma ação automática associada — precisa de vínculo manual.
export function buildDivergenceRows(
  products: ErpProductInput[],
  mlListings: MlListingInput[],
  shopeeListings: ShopeeListingInput[]
): DivergenceRow[] {
  const erpMap = new Map(products.map((p) => [p.sku, p]));
  const rows: DivergenceRow[] = [];

  for (const ml of mlListings) {
    if (ml.sku === null) {
      rows.push({
        product_name: ml.title, sku: ml.itemId, divergence_type: 'unlinked_sku', priority: 'informative',
        erp_value: null, ml_value: String(ml.stock), shopee_value: null,
        recommended_action: 'Vincular SKU manualmente no anúncio do Mercado Livre (campo SELLER_SKU) antes de conciliar',
        marketplace: 'mercadolivre', ml_item_id: ml.itemId, shopee_item_id: null,
      });
      continue;
    }
    const erp = erpMap.get(ml.sku);
    if (!erp) {
      rows.push({
        product_name: ml.title, sku: ml.sku, divergence_type: 'orphan', priority: 'critical',
        erp_value: null, ml_value: String(ml.stock), shopee_value: null,
        recommended_action: 'Encerrar anúncio no Mercado Livre', marketplace: 'mercadolivre',
        ml_item_id: ml.itemId, shopee_item_id: null,
      });
      continue;
    }
    if (erp.stock !== ml.stock) {
      rows.push({
        product_name: erp.name, sku: erp.sku, divergence_type: 'stock',
        priority: priorityForStock(erp.stock, ml.stock),
        erp_value: String(erp.stock), ml_value: String(ml.stock), shopee_value: null,
        recommended_action: erp.stock === 0 ? 'Zerar estoque no Mercado Livre' : 'Atualizar estoque no Mercado Livre',
        marketplace: 'mercadolivre', ml_item_id: ml.itemId, shopee_item_id: null,
      });
    }
    if (ml.status === 'paused' && erp.stock > 0) {
      rows.push({
        product_name: erp.name, sku: erp.sku, divergence_type: 'status', priority: 'high',
        erp_value: String(erp.stock), ml_value: ml.status, shopee_value: null,
        recommended_action: 'Reativar anúncio no Mercado Livre', marketplace: 'mercadolivre',
        ml_item_id: ml.itemId, shopee_item_id: null,
      });
    }
  }

  for (const sh of shopeeListings) {
    if (sh.sku === null) {
      rows.push({
        product_name: sh.name, sku: String(sh.itemId), divergence_type: 'unlinked_sku', priority: 'informative',
        erp_value: null, ml_value: null, shopee_value: String(sh.stock),
        recommended_action: 'Vincular SKU manualmente no anúncio da Shopee antes de conciliar',
        marketplace: 'shopee', ml_item_id: null, shopee_item_id: String(sh.itemId),
      });
      continue;
    }
    const erp = erpMap.get(sh.sku);
    if (!erp) {
      rows.push({
        product_name: sh.name, sku: sh.sku, divergence_type: 'orphan', priority: 'critical',
        erp_value: null, ml_value: null, shopee_value: String(sh.stock),
        recommended_action: 'Encerrar anúncio na Shopee', marketplace: 'shopee',
        ml_item_id: null, shopee_item_id: String(sh.itemId),
      });
      continue;
    }
    if (erp.stock !== sh.stock) {
      rows.push({
        product_name: erp.name, sku: erp.sku, divergence_type: 'stock',
        priority: priorityForStock(erp.stock, sh.stock),
        erp_value: String(erp.stock), ml_value: null, shopee_value: String(sh.stock),
        recommended_action: erp.stock === 0 ? 'Zerar estoque na Shopee' : 'Atualizar estoque na Shopee',
        marketplace: 'shopee', ml_item_id: null, shopee_item_id: String(sh.itemId),
      });
    }
  }

  for (const erp of products) {
    if (!erp.hasPhoto) {
      rows.push({
        product_name: erp.name, sku: erp.sku, divergence_type: 'photo', priority: 'informative',
        erp_value: 'sem foto', ml_value: null, shopee_value: null,
        recommended_action: 'Adicionar foto ao produto no ERP', marketplace: 'both',
        ml_item_id: null, shopee_item_id: null,
      });
    }
    if (!erp.hasDescription) {
      rows.push({
        product_name: erp.name, sku: erp.sku, divergence_type: 'description', priority: 'informative',
        erp_value: 'sem descrição', ml_value: null, shopee_value: null,
        recommended_action: 'Adicionar descrição ao produto no ERP', marketplace: 'both',
        ml_item_id: null, shopee_item_id: null,
      });
    }
  }

  return rows;
}

// Tipos de divergência que NUNCA podem ter uma ação automática aplicada
// (nem individualmente, nem em "Conciliar Todos") — exigem revisão humana.
// applyFix() só sabe corrigir 'stock' e 'orphan' de fato (via API do ML/Shopee).
// Qualquer outro tipo aqui precisa ficar em MANUAL_ONLY_TYPES — do contrário
// o botão "Resolver" marcaria a divergência como resolvida sem ter corrigido
// nada, porque applyFix cairia no caminho padrão sem fazer nenhuma chamada.
export const MANUAL_ONLY_TYPES = new Set(['photo', 'description', 'unlinked_sku', 'price', 'title', 'status']);

export function canAutoFix(divergenceType: string): boolean {
  return !MANUAL_ONLY_TYPES.has(divergenceType);
}
