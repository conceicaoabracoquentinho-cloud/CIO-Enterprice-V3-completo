import { getAllConfig } from './supabase';
import { callEdgeFunction } from './edge';

// ─── Módulo 03 — Centro de Inteligência de Precificação ────────────────
// Regras vêm do Documento 11 (Business Rules Engine) e do Módulo 03:
//   - "Toda recomendação de preço deve ser explicável" — por isso toda
//     função aqui devolve não só o número, mas o breakdown usado.
//   - Este módulo NUNCA inventa dado: se o custo não está cadastrado no
//     Bling (precoCusto === null), a função sinaliza isso explicitamente
//     em vez de assumir 0.

export interface PricingConfig {
  mlCommissionPct: number; // ex.: 12 = 12%
  shopeeCommissionPct: number;
  targetMarginPct: number; // margem-alvo padrão sugerida pela Central de Administração
  fixedCostsMonthly: number; // rateio simples de despesas fixas (R$/mês), opcional
}

const DEFAULTS: PricingConfig = {
  mlCommissionPct: 12,
  shopeeCommissionPct: 14,
  targetMarginPct: 25,
  fixedCostsMonthly: 0,
};

function toNumber(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getPricingConfig(): Promise<PricingConfig> {
  const cfg = await getAllConfig();
  return {
    mlCommissionPct: toNumber(cfg.pricing_ml_commission_pct, DEFAULTS.mlCommissionPct),
    shopeeCommissionPct: toNumber(cfg.pricing_shopee_commission_pct, DEFAULTS.shopeeCommissionPct),
    targetMarginPct: toNumber(cfg.pricing_target_margin_pct, DEFAULTS.targetMarginPct),
    fixedCostsMonthly: toNumber(cfg.pricing_fixed_costs_monthly, DEFAULTS.fixedCostsMonthly),
  };
}

export async function savePricingConfig(config: PricingConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await callEdgeFunction('save-config', {
      config: {
        pricing_ml_commission_pct: String(config.mlCommissionPct),
        pricing_shopee_commission_pct: String(config.shopeeCommissionPct),
        pricing_target_margin_pct: String(config.targetMarginPct),
        pricing_fixed_costs_monthly: String(config.fixedCostsMonthly),
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao salvar parâmetros.' };
  }
}

// ─── Calculadora de Custos (Módulo 03, seção 1) ─────────────────────────
// "Essa tela nunca mostra lucro. Ela apenas responde: quanto custa vender
// uma unidade desse produto?"
export interface CostBreakdown {
  custoErp: number | null; // null = custo não cadastrado no Bling
  comissaoEstimada: number | null; // baseada no preço de venda atual e na comissão configurada
  custoTotalEstimado: number | null; // custoErp + comissão
  precoMinimo: number | null; // preço abaixo do qual o produto dá prejuízo
  explicacao: string[];
}

export function computeCostBreakdown(
  custoErp: number | null,
  precoVenda: number,
  commissionPct: number
): CostBreakdown {
  const explicacao: string[] = [];

  if (custoErp === null) {
    explicacao.push('Custo do produto não está cadastrado no Bling — cadastre o "Preço de Custo" para habilitar este cálculo.');
    return { custoErp: null, comissaoEstimada: null, custoTotalEstimado: null, precoMinimo: null, explicacao };
  }

  const comissaoEstimada = precoVenda * (commissionPct / 100);
  const custoTotalEstimado = custoErp + comissaoEstimada;
  const denom = 1 - commissionPct / 100;
  const precoMinimo = denom > 0 ? custoErp / denom : null;

  explicacao.push(`Custo de aquisição (Bling): R$ ${custoErp.toFixed(2)}`);
  explicacao.push(`Comissão do marketplace (${commissionPct}% sobre o preço atual de R$ ${precoVenda.toFixed(2)}): R$ ${comissaoEstimada.toFixed(2)}`);
  explicacao.push(`Custo total estimado por unidade: R$ ${custoTotalEstimado.toFixed(2)}`);
  if (precoMinimo !== null) {
    explicacao.push(`Preço mínimo para não ter prejuízo (cobrindo custo + comissão): R$ ${precoMinimo.toFixed(2)}`);
  }

  return { custoErp, comissaoEstimada, custoTotalEstimado, precoMinimo, explicacao };
}

// ─── Precificação Inteligente (Módulo 03, seção 2) ──────────────────────
// "Toda recomendação de preço deve ser explicável" (Documento 11, regra
// obrigatória) — por isso devolvemos o breakdown completo, nunca só o número.
export interface PriceRecommendation {
  precoRecomendado: number | null;
  explicacao: string[];
}

export function computeRecommendedPrice(
  custoErp: number | null,
  commissionPct: number,
  desiredMarginPct: number
): PriceRecommendation {
  const explicacao: string[] = [];

  if (custoErp === null) {
    explicacao.push('Custo do produto não está cadastrado no Bling — não é possível recomendar preço sem essa informação.');
    return { precoRecomendado: null, explicacao };
  }

  const denom = 1 - commissionPct / 100 - desiredMarginPct / 100;
  if (denom <= 0) {
    explicacao.push(`Comissão (${commissionPct}%) + margem desejada (${desiredMarginPct}%) somam ${(commissionPct + desiredMarginPct).toFixed(0)}% ou mais — não existe preço que atinja essa combinação.`);
    return { precoRecomendado: null, explicacao };
  }

  const precoRecomendado = custoErp / denom;
  explicacao.push(`Custo do produto: R$ ${custoErp.toFixed(2)}`);
  explicacao.push(`Comissão do marketplace: ${commissionPct}%`);
  explicacao.push(`Margem desejada: ${desiredMarginPct}%`);
  explicacao.push(`Preço recomendado = Custo ÷ (1 − comissão − margem) = R$ ${precoRecomendado.toFixed(2)}`);

  return { precoRecomendado, explicacao };
}

// ─── Rentabilidade (Módulo 03, seção 3) ──────────────────────────────────
// "Estou ganhando dinheiro com esse produto?"
// IMPORTANTE: "vendas" aqui usa soldQuantity da API do Mercado Livre, que é
// a quantidade vendida ACUMULADA HISTÓRICA do anúncio (não um período fixo
// como "últimos 30 dias") — a API não expõe esse recorte. Por isso o rótulo
// na tela deve deixar claro que é "vendas acumuladas do anúncio", nunca
// apresentar como se fosse receita mensal.
export interface ProfitabilityRow {
  sku: string;
  productName: string;
  precoVenda: number;
  custoErp: number | null;
  comissaoUnitaria: number | null;
  lucroUnitario: number | null;
  margemPct: number | null;
  vendasAcumuladas: number | null;
  receitaAcumulada: number | null;
  lucroAcumulado: number | null;
  saudavel: boolean | null; // margem >= 0
}

export function computeProfitability(
  sku: string,
  productName: string,
  precoVenda: number,
  custoErp: number | null,
  commissionPct: number,
  soldQuantity: number | null
): ProfitabilityRow {
  if (custoErp === null) {
    return {
      sku, productName, precoVenda, custoErp: null, comissaoUnitaria: null,
      lucroUnitario: null, margemPct: null, vendasAcumuladas: soldQuantity,
      receitaAcumulada: soldQuantity !== null ? soldQuantity * precoVenda : null,
      lucroAcumulado: null, saudavel: null,
    };
  }

  const comissaoUnitaria = precoVenda * (commissionPct / 100);
  const lucroUnitario = precoVenda - custoErp - comissaoUnitaria;
  const margemPct = precoVenda > 0 ? (lucroUnitario / precoVenda) * 100 : null;
  const receitaAcumulada = soldQuantity !== null ? soldQuantity * precoVenda : null;
  const lucroAcumulado = soldQuantity !== null ? soldQuantity * lucroUnitario : null;

  return {
    sku, productName, precoVenda, custoErp, comissaoUnitaria,
    lucroUnitario, margemPct, vendasAcumuladas: soldQuantity,
    receitaAcumulada, lucroAcumulado, saudavel: lucroUnitario >= 0,
  };
}
