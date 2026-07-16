import { getAllConfig } from './supabase';
import { callEdgeFunction } from './edge';
import { ErpProduct, MarketplaceListing } from '../types';

// ─── Módulo 04 — Financeiro / Estoque Inteligente ────────────────────────
// LIMITAÇÃO HONESTA: não temos uma série histórica de vendas por data (o
// Centro de Dados / Módulo 10 ainda não guarda isso). O que existe é
// `soldQuantity` (vendas acumuladas desde a criação do anúncio) e
// `dateCreated` do anúncio no Mercado Livre. Por isso a "venda média diária"
// aqui é uma APROXIMAÇÃO: vendas acumuladas ÷ dias desde a criação do
// anúncio — não é uma média móvel de 90 dias como o documento idealiza.
// Isso é sinalizado na tela sempre que exibido, para não passar a
// impressão de ser um dado mais preciso do que realmente é.

export interface InventoryConfig {
  supplierLeadTimeDays: number;
  safetyStockDays: number;
  lowCoverageThresholdDays: number; // abaixo disso, alerta de ruptura
}

const DEFAULTS: InventoryConfig = {
  supplierLeadTimeDays: 15,
  safetyStockDays: 5,
  lowCoverageThresholdDays: 10,
};

function toNumber(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getInventoryConfig(): Promise<InventoryConfig> {
  const cfg = await getAllConfig();
  return {
    supplierLeadTimeDays: toNumber(cfg.inventory_supplier_lead_time_days, DEFAULTS.supplierLeadTimeDays),
    safetyStockDays: toNumber(cfg.inventory_safety_stock_days, DEFAULTS.safetyStockDays),
    lowCoverageThresholdDays: toNumber(cfg.inventory_low_coverage_threshold_days, DEFAULTS.lowCoverageThresholdDays),
  };
}

export async function saveInventoryConfig(config: InventoryConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await callEdgeFunction('save-config', {
      config: {
        inventory_supplier_lead_time_days: String(config.supplierLeadTimeDays),
        inventory_safety_stock_days: String(config.safetyStockDays),
        inventory_low_coverage_threshold_days: String(config.lowCoverageThresholdDays),
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao salvar parâmetros.' };
  }
}

export type StockStatus = 'ruptura_iminente' | 'saudavel' | 'possivel_excesso' | 'sem_dado_suficiente';

export interface StockRow {
  sku: string;
  productName: string;
  stock: number;
  custoUnitario: number | null;
  capitalParado: number | null; // stock * custoUnitario
  vendaMediaDiaEstimada: number | null; // aproximação — ver comentário acima
  coberturaDias: number | null;
  compraSugerida: number | null;
  status: StockStatus;
}

export function computeStockIntelligence(
  erpProducts: ErpProduct[],
  listings: MarketplaceListing[],
  config: InventoryConfig
): StockRow[] {
  const mlBySku = new Map<string, MarketplaceListing>();
  for (const l of listings) {
    if (l.source === 'mercadolivre' && l.sku && !mlBySku.has(l.sku)) mlBySku.set(l.sku, l);
  }

  return erpProducts.map((p) => {
    const capitalParado = p.precoCusto !== null ? p.stock * p.precoCusto : null;
    const listing = mlBySku.get(p.sku);

    let vendaMediaDiaEstimada: number | null = null;
    if (listing?.dateCreated && listing.soldQuantity !== null) {
      const dias = Math.max(1, Math.floor((Date.now() - new Date(listing.dateCreated).getTime()) / 86_400_000));
      vendaMediaDiaEstimada = listing.soldQuantity / dias;
    }

    let coberturaDias: number | null = null;
    let compraSugerida: number | null = null;
    let status: StockStatus = 'sem_dado_suficiente';

    if (vendaMediaDiaEstimada !== null && vendaMediaDiaEstimada > 0) {
      coberturaDias = p.stock / vendaMediaDiaEstimada;
      const necessidade = vendaMediaDiaEstimada * (config.supplierLeadTimeDays + config.safetyStockDays);
      compraSugerida = Math.max(0, Math.ceil(necessidade - p.stock));

      if (coberturaDias <= config.lowCoverageThresholdDays) status = 'ruptura_iminente';
      else if (coberturaDias > config.lowCoverageThresholdDays * 6) status = 'possivel_excesso';
      else status = 'saudavel';
    } else if (p.stock === 0) {
      status = 'ruptura_iminente';
    }

    return {
      sku: p.sku, productName: p.name, stock: p.stock,
      custoUnitario: p.precoCusto, capitalParado,
      vendaMediaDiaEstimada, coberturaDias, compraSugerida, status,
    };
  });
}

export interface InventorySummary {
  capitalParadoTotal: number;
  produtosSemCusto: number;
  rupturaIminente: number;
  possivelExcesso: number;
  semDadoSuficiente: number;
}

export function summarizeInventory(rows: StockRow[]): InventorySummary {
  return {
    capitalParadoTotal: rows.reduce((s, r) => s + (r.capitalParado ?? 0), 0),
    produtosSemCusto: rows.filter((r) => r.custoUnitario === null).length,
    rupturaIminente: rows.filter((r) => r.status === 'ruptura_iminente').length,
    possivelExcesso: rows.filter((r) => r.status === 'possivel_excesso').length,
    semDadoSuficiente: rows.filter((r) => r.status === 'sem_dado_suficiente').length,
  };
}
