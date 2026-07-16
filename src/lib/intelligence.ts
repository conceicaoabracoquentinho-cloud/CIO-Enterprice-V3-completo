import { Priority, Divergence, ErpProduct, MarketplaceListing } from '../types';
import { ProfitabilityRow } from './pricing';
import { Page } from '../components/Sidebar';

// ─── Módulo 05 — Centro de Inteligência Operacional ─────────────────────
// Documento 11, Princípio 5: "Nenhuma IA poderá inventar informações. Toda
// inteligência deverá ser baseada em dados reais." Por isso este motor é
// 100% baseado em regras determinísticas sobre os dados que já auditamos
// (divergências, precificação, estoque) — não é um modelo de IA generativa.
// Quando um dado necessário não existe (ex.: concorrência, capital parado
// por falta de histórico de compras), o diagnóstico deixa isso explícito
// em vez de estimar.

export interface Diagnostic {
  id: string;
  categoria: 'Financeiro' | 'Operacional' | 'Marketplace' | 'Estoque' | 'Conciliação';
  problema: string;
  causa: string;
  impactoValor: number | null; // R$ — null quando não é quantificável com os dados atuais
  urgencia: Priority;
  recomendacao: string;
  modulo: Page;
  sku?: string;
}

const priorityWeight: Record<Priority, number> = { critical: 4, high: 3, medium: 2, informative: 1 };

export function buildDiagnostics(
  divergences: Divergence[],
  erpProducts: ErpProduct[],
  listings: MarketplaceListing[],
  profitability: ProfitabilityRow[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // 1) Divergências ERP × Marketplace (Módulo 06)
  for (const d of divergences) {
    let impactoValor: number | null = null;
    if (d.divergence_type === 'price' && d.erp_value && d.ml_value) {
      const a = parseFloat(d.erp_value.replace(',', '.'));
      const b = parseFloat(d.ml_value.replace(',', '.'));
      if (Number.isFinite(a) && Number.isFinite(b)) impactoValor = Math.abs(a - b);
    }
    diagnostics.push({
      id: `div-${d.id}`,
      categoria: 'Conciliação',
      problema: `${d.product_name} — divergência de ${divergenceLabel(d.divergence_type)}`,
      causa: d.erp_value !== null && d.ml_value !== null
        ? `ERP registra "${d.erp_value}", Mercado Livre registra "${d.ml_value}"`
        : 'Diferença identificada entre ERP e Mercado Livre',
      impactoValor,
      urgencia: d.priority,
      recomendacao: d.recommended_action,
      modulo: 'conciliacao',
      sku: d.sku,
    });
  }

  // 2) Produtos vendendo abaixo do preço mínimo (Módulo 03)
  for (const r of profitability) {
    if (r.saudavel === false && r.lucroUnitario !== null) {
      const impactoValor = r.vendasAcumuladas !== null ? Math.abs(r.lucroUnitario) * r.vendasAcumuladas : Math.abs(r.lucroUnitario);
      diagnostics.push({
        id: `preco-${r.sku}`,
        categoria: 'Financeiro',
        problema: `${r.productName} — vendendo com prejuízo de R$ ${Math.abs(r.lucroUnitario).toFixed(2)} por unidade`,
        causa: `Preço atual (R$ ${r.precoVenda.toFixed(2)}) não cobre custo + comissão do marketplace`,
        impactoValor,
        urgencia: 'high',
        recomendacao: 'Revisar preço em Precificação',
        modulo: 'precificacao',
        sku: r.sku,
      });
    }
  }

  // 3) Ruptura de estoque
  const listedSkus = new Set(listings.filter((l) => l.status === 'active').map((l) => l.sku));
  for (const p of erpProducts) {
    if (p.stock === 0) {
      const temAnuncioAtivo = listedSkus.has(p.sku);
      diagnostics.push({
        id: `estoque-${p.sku}`,
        categoria: 'Estoque',
        problema: `${p.name} — estoque zerado no ERP`,
        causa: temAnuncioAtivo
          ? 'Produto com anúncio ativo, mas sem estoque disponível para venda'
          : 'Produto sem estoque (sem anúncio ativo vinculado no momento)',
        impactoValor: null, // exige velocidade de venda por período, que a API não expõe hoje
        urgencia: temAnuncioAtivo ? 'high' : 'medium',
        recomendacao: 'Repor estoque no ERP (Bling)',
        modulo: 'monitor',
        sku: p.sku,
      });
    }
  }

  // 4) Produtos do ERP sem nenhum anúncio vinculado
  const anyListingSkus = new Set(listings.map((l) => l.sku));
  for (const p of erpProducts) {
    if (p.stock > 0 && !anyListingSkus.has(p.sku)) {
      diagnostics.push({
        id: `sem-anuncio-${p.sku}`,
        categoria: 'Marketplace',
        problema: `${p.name} — sem anúncio no Mercado Livre`,
        causa: 'Produto ativo e com estoque no ERP, mas não encontramos anúncio vinculado a este SKU',
        impactoValor: null,
        urgencia: 'medium',
        recomendacao: 'Verificar se falta criar o anúncio ou vincular o SKU em Monitorar',
        modulo: 'monitor',
        sku: p.sku,
      });
    }
  }

  return diagnostics.sort((a, b) => {
    const w = priorityWeight[b.urgencia] - priorityWeight[a.urgencia];
    if (w !== 0) return w;
    return (b.impactoValor ?? 0) - (a.impactoValor ?? 0);
  });
}

function divergenceLabel(type: Divergence['divergence_type']): string {
  const labels: Record<string, string> = {
    stock: 'estoque', title: 'título', status: 'status', photo: 'fotos',
    description: 'descrição', price: 'preço', orphan: 'anúncio órfão', unlinked_sku: 'SKU não vinculado',
  };
  return labels[type] ?? type;
}

// ─── Riscos (Módulo 05, seção 9) ─────────────────────────────────────────
export interface RiskGroup {
  categoria: string;
  quantidade: number;
  disponivel: boolean; // false = ainda não calculável com os dados atuais
  motivoIndisponivel?: string;
}

export function buildRisks(diagnostics: Diagnostic[], erpProducts: ErpProduct[]): RiskGroup[] {
  const count = (cat: Diagnostic['categoria']) => diagnostics.filter((d) => d.categoria === cat).length;
  return [
    { categoria: 'Produtos vendendo com prejuízo', quantidade: count('Financeiro'), disponivel: true },
    { categoria: 'Produtos sem estoque', quantidade: count('Estoque'), disponivel: true },
    { categoria: 'Divergências críticas/altas (ERP × Marketplace)', quantidade: diagnostics.filter((d) => d.categoria === 'Conciliação' && (d.urgencia === 'critical' || d.urgencia === 'high')).length, disponivel: true },
    { categoria: 'Produtos sem anúncio', quantidade: count('Marketplace'), disponivel: true },
    { categoria: 'Capital parado em estoque', quantidade: 0, disponivel: false, motivoIndisponivel: 'Exige histórico de compras/data de entrada, que o Centro de Dados (Módulo 10) ainda não armazena' },
    { categoria: 'Marketplace com queda de performance', quantidade: 0, disponivel: false, motivoIndisponivel: 'Exige série histórica de vendas por período, ainda não coletada' },
  ];
}

// ─── Oportunidades (Módulo 05, seção 8) ──────────────────────────────────
// Regra: alta margem + alta demanda entre os produtos já precificados.
// Concorrência NÃO entra no cálculo — nenhuma API atual traz esse dado.
export interface Opportunity {
  sku: string;
  productName: string;
  margemPct: number;
  vendasAcumuladas: number;
  recomendacao: string;
}

export function buildOpportunities(profitability: ProfitabilityRow[], marginThresholdPct = 30): Opportunity[] {
  const withSales = profitability.filter((r) => r.margemPct !== null && r.vendasAcumuladas !== null && r.vendasAcumuladas > 0);
  if (withSales.length === 0) return [];
  const salesSorted = [...withSales].sort((a, b) => (b.vendasAcumuladas ?? 0) - (a.vendasAcumuladas ?? 0));
  const medianSales = salesSorted[Math.floor(salesSorted.length / 2)]?.vendasAcumuladas ?? 0;

  return withSales
    .filter((r) => (r.margemPct ?? 0) >= marginThresholdPct && (r.vendasAcumuladas ?? 0) >= medianSales)
    .sort((a, b) => (b.vendasAcumuladas ?? 0) - (a.vendasAcumuladas ?? 0))
    .slice(0, 10)
    .map((r) => ({
      sku: r.sku,
      productName: r.productName,
      margemPct: r.margemPct as number,
      vendasAcumuladas: r.vendasAcumuladas as number,
      recomendacao: 'Margem acima do alvo e boa demanda histórica — considere garantir estoque e ampliar investimento neste produto.',
    }));
}
