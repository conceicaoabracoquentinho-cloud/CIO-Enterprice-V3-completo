import { callEdgeFunction, getEdgeFunction } from '../edge';
import {
  Divergence,
  IntegrationStatus,
  ErpProduct,
  MarketplaceListing,
  ListingStatus,
  OrderMonitor,
  UpdateIntegrationsResult,
  IntegrationSource,
} from '../../types';

const SOURCE_LABELS: Record<IntegrationSource, string> = {
  bling: 'Bling',
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  system: 'Sistema',
};

// ─── Conciliação ─────────────────────────────────────────────────────────────
// Todo o cálculo de divergências agora acontece na Edge Function `reconcile`,
// que busca dados reais no Bling/ML/Shopee (nunca mock) e usa o ERP como
// fonte da verdade, conforme o princípio 01 do documento estratégico.
export async function computeDivergences(): Promise<Divergence[]> {
  const res = await callEdgeFunction<{ ok: boolean; data?: Divergence[]; notConfigured?: string[]; error?: string }>(
    'reconcile',
    { action: 'refresh_divergences' }
  );
  if (!res.ok) {
    throw new Error(res.error ?? 'Falha ao calcular divergências');
  }
  return res.data ?? [];
}

export async function fixDivergence(divergence: Divergence): Promise<{ ok: boolean; error?: string }> {
  return callEdgeFunction('reconcile', { action: 'fix_one', params: { divergenceId: divergence.id } });
}

export async function ignoreDivergence(divergence: Divergence): Promise<{ ok: boolean; error?: string }> {
  return callEdgeFunction('reconcile', { action: 'ignore_one', params: { divergenceId: divergence.id } });
}

export async function reconcileAll(): Promise<{ ok: boolean; updated: number; manualReview: number; errors: number; durationMs: number; details: { sku: string; status: string; message: string }[] }> {
  return callEdgeFunction('reconcile', { action: 'conciliar_todos' });
}

// canAutoFix espelha a regra do backend (_shared/divergence-engine.ts):
// só estoque e anúncio órfão podem ser corrigidos automaticamente via API.
// Foto/descrição/status/título/SKU não vinculado exigem revisão manual —
// o botão "Resolver" fica desabilitado para esses tipos na tela.
export function canAutoFixType(type: Divergence['divergence_type']): boolean {
  return type === 'stock' || type === 'orphan';
}


// ─── Status das integrações (Admin / Dashboard / Integrar) ──────────────────
interface StatusRow {
  source: IntegrationSource;
  configured: boolean;
  connected: boolean;
  tokenValid: boolean;
  lastSync: string | null;
  responseMs: number | null;
  errorCount: number;
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const res = await getEdgeFunction<{ ok: boolean; data: StatusRow[] }>('integrations-status');
  if (!res.ok) return [];
  return res.data.map((row) => ({
    source: row.source,
    label: SOURCE_LABELS[row.source],
    connected: row.tokenValid,
    lastSync: row.lastSync,
    responseMs: row.responseMs,
    errorCount: row.errorCount,
    tokenConfigured: row.configured,
  }));
}

export async function updateAllIntegrations(): Promise<UpdateIntegrationsResult> {
  return callEdgeFunction<UpdateIntegrationsResult>('reconcile', { action: 'update_integrations' });
}

// ─── Monitor (produtos e pedidos) ────────────────────────────────────────────
interface BlingProductDTO {
  id: string; sku: string; name: string; stock: number; price: number;
  hasPhoto: boolean; hasDescription: boolean;
  photoCount: number; descriptionText: string | null;
  categoria: string | null; marca: string | null; gtin: string | null;
  peso: number | null; situacao: string | null; ncm: string | null;
  precoCusto: number | null; tipo: string | null; unidade: string | null;
}
interface MLListingDTO {
  itemId: string; sku: string | null; title: string; stock: number; status: string;
  price: number; soldQuantity: number; health: number | null;
  permalink: string | null; thumbnail: string | null; pictureCount: number;
  videoId: string | null; listingType: string | null; condition: string | null;
  categoryId: string | null; freeShipping: boolean | null; localPickUp: boolean | null;
  warranty: string | null; acceptsMercadoPago: boolean | null;
  catalogListing: boolean | null;
  attributes: Array<{ id: string; name: string; valueName: string | null }>;
  tags: string[]; dateCreated: string | null; lastUpdated: string | null;
}
interface ShopeeListingDTO { itemId: number; sku: string | null; name: string; stock: number; status: string }

export function mapMlStatus(status: string): ListingStatus {
  if (status === 'active' || status === 'paused' || status === 'closed') return status;
  return 'not_listed';
}
export function mapShopeeStatus(status: string): ListingStatus {
  if (status === 'NORMAL') return 'active';
  if (status === 'UNLIST') return 'paused';
  if (status === 'BANNED' || status === 'DELETED') return 'closed';
  return 'not_listed';
}

export async function getErpProducts(): Promise<ErpProduct[]> {
  const blingRes = await callEdgeFunction<{ ok: boolean; data?: BlingProductDTO[]; error?: string }>(
    'bling-api', { action: 'get_products' }
  );
  if (!blingRes.ok) throw new Error(blingRes.error ?? 'Integração não configurada.');
  return (blingRes.data ?? []).map((p) => ({
    sku: p.sku,
    name: p.name,
    stock: p.stock,
    price: p.price,
    precoCusto: p.precoCusto,
    categoria: p.categoria,
    marca: p.marca,
    gtin: p.gtin,
    peso: p.peso,
    situacao: p.situacao,
    ncm: p.ncm,
    tipo: p.tipo,
    unidade: p.unidade,
    photoCount: p.photoCount,
    hasPhoto: p.hasPhoto,
    descriptionText: p.descriptionText,
    hasDescription: p.hasDescription,
  }));
}

export async function getMarketplaceListings(erpProducts?: ErpProduct[]): Promise<MarketplaceListing[]> {
  const [mlRes, shopeeRes] = await Promise.all([
    callEdgeFunction<{ ok: boolean; data?: MLListingDTO[]; error?: string }>('ml-api', { action: 'get_listings' }),
    callEdgeFunction<{ ok: boolean; data?: ShopeeListingDTO[]; error?: string }>('shopee-api', { action: 'get_listings' }),
  ]);

  const erpMap = new Map((erpProducts ?? []).map((p) => [p.sku, p]));

  const mlListings: MarketplaceListing[] = (mlRes.ok ? mlRes.data ?? [] : []).map((l) => {
    const erp = l.sku ? erpMap.get(l.sku) : undefined;
    return {
      itemId: l.itemId,
      sku: l.sku,
      source: 'mercadolivre' as const,
      title: l.title,
      stock: l.stock,
      status: mapMlStatus(l.status),
      price: l.price,
      soldQuantity: l.soldQuantity,
      health: l.health,
      permalink: l.permalink,
      thumbnail: l.thumbnail,
      pictureCount: l.pictureCount,
      videoId: l.videoId,
      listingType: l.listingType,
      condition: l.condition,
      categoryId: l.categoryId,
      freeShipping: l.freeShipping,
      localPickUp: l.localPickUp,
      warranty: l.warranty,
      acceptsMercadoPago: l.acceptsMercadoPago,
      catalogListing: l.catalogListing,
      attributes: l.attributes,
      tags: l.tags,
      dateCreated: l.dateCreated,
      lastUpdated: l.lastUpdated,
      erpSku: erp?.sku ?? null,
      erpName: erp?.name ?? null,
      erpStock: erp?.stock ?? null,
    };
  });

  const shopeeListings: MarketplaceListing[] = (shopeeRes.ok ? shopeeRes.data ?? [] : []).map((l) => {
    const erp = l.sku ? erpMap.get(l.sku) : undefined;
    return {
      itemId: String(l.itemId),
      sku: l.sku,
      source: 'shopee' as const,
      title: l.name,
      stock: l.stock,
      status: mapShopeeStatus(l.status),
      price: null,
      soldQuantity: null,
      health: null,
      permalink: null,
      thumbnail: null,
      pictureCount: 0,
      videoId: null,
      listingType: null,
      condition: null,
      categoryId: null,
      freeShipping: null,
      localPickUp: null,
      warranty: null,
      acceptsMercadoPago: null,
      catalogListing: null,
      attributes: [],
      tags: [],
      dateCreated: null,
      lastUpdated: null,
      erpSku: erp?.sku ?? null,
      erpName: erp?.name ?? null,
      erpStock: erp?.stock ?? null,
    };
  });

  return [...mlListings, ...shopeeListings];
}

// NOTA: existia aqui uma implementação local (`computeLocalDivergences`)
// que recalculava divergências no navegador com regras próprias — isso
// fazia a tela de Conciliação mostrar números diferentes do Dashboard e
// da Inteligência Operacional, que sempre leram a tabela `divergences`
// (populada pela Edge Function `reconcile`). Removida: agora só existe
// UM cálculo de divergências, feito no backend (ver computeDivergences()
// acima, que chama a action 'refresh_divergences').

interface BlingOrderDTO {
  id?: string | number;
  numero?: string | number;
  contato?: { nome?: string };
  total?: number;
  data?: string;
  situacao?: { id?: number; valor?: number };
}

// Backward-compatible flat view for Analyze.tsx — derives the old ProductMonitor
// shape from the split ErpProduct + MarketplaceListing data. Analyze only needs
// a few fields (hasPhoto, hasDescription, mlStatus, mlStock, name, sku).
export async function getProductMonitorData(): Promise<{
  sku: string; name: string; hasPhoto: boolean; hasDescription: boolean;
  mlStatus: ListingStatus; mlStock: number | null; erpStock: number;
}[]> {
  const erp = await getErpProducts();
  const listings = await getMarketplaceListings(erp);
  return erp.map((p) => {
    const ml = listings.find((l) => l.source === 'mercadolivre' && l.sku === p.sku);
    return {
      sku: p.sku,
      name: p.name,
      hasPhoto: p.hasPhoto,
      hasDescription: p.hasDescription,
      mlStatus: ml?.status ?? 'not_listed',
      mlStock: ml?.stock ?? null,
      erpStock: p.stock,
    };
  });
}

export async function getOrderMonitorData(): Promise<OrderMonitor[]> {
  const res = await callEdgeFunction<{ ok: boolean; data?: BlingOrderDTO[]; error?: string }>('bling-api', { action: 'get_orders' });
  if (!res.ok) throw new Error(res.error ?? 'Integração não configurada.');

  // ATENÇÃO: o Bling representa a situação do pedido por um código numérico
  // (situacao.id) próprio de cada conta/fluxo cadastrado. Não temos acesso a
  // uma conta real para confirmar quais códigos correspondem a "Novo",
  // "Pago", "Aguardando NF", etc. Em vez de inventar esse mapeamento,
  // devolvemos o pedido com status "new" e os dados brutos preservados —
  // ajuste esta função assim que os códigos da conta real forem
  // confirmados (ver AUDITORIA.md).
  return (res.data ?? []).map((o) => ({
    id: String(o.numero ?? o.id ?? ''),
    marketplace: 'bling' as const,
    status: 'new' as const,
    buyerName: o.contato?.nome ?? '—',
    total: Number(o.total ?? 0),
    createdAt: o.data ?? new Date().toISOString(),
    updatedAt: o.data ?? new Date().toISOString(),
  }));
}
