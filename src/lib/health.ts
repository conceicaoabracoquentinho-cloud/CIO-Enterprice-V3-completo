// Índices de Saúde do CIO Enterprise — Documento 11 (Business Rules Engine),
// seções 9 e 10, e Módulo 01 (Dashboard), Área 2.
//
// Os pesos que combinam os três índices em um Índice CIO já vêm do Centro
// de Estratégias (Módulo 09) — ver lib/strategy.ts. Os pesos INTERNOS de
// cada índice individual (ex.: quanto o "health médio" pesa dentro da
// Saúde Comercial) ainda são fixos e documentados abaixo; esses entram
// numa fase futura de configuração mais fina.

export interface HealthResult {
  score: number; // 0-100
  label: 'Excelente' | 'Boa' | 'Regular' | 'Crítica';
  reasons: string[];
}

function labelFor(score: number): HealthResult['label'] {
  if (score >= 85) return 'Excelente';
  if (score >= 70) return 'Boa';
  if (score >= 50) return 'Regular';
  return 'Crítica';
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// ─── Saúde Operacional ────────────────────────────────────────────────
// Baseada em divergências ativas (ERP × Marketplace), ponderadas por
// prioridade. Fórmula: 100 - (críticas×8 + altas×4 + médias×1.5 + informativas×0.5),
// limitado a [0,100].
export function computeOperationalHealth(counts: { critical: number; high: number; medium: number; informative: number }): HealthResult {
  const penalty = counts.critical * 8 + counts.high * 4 + counts.medium * 1.5 + counts.informative * 0.5;
  const score = clamp(100 - penalty);
  const reasons: string[] = [];
  if (counts.critical > 0) reasons.push(`${counts.critical} divergência(s) crítica(s) ativa(s)`);
  if (counts.high > 0) reasons.push(`${counts.high} divergência(s) de alta prioridade`);
  if (counts.medium > 0) reasons.push(`${counts.medium} divergência(s) média(s)`);
  if (counts.informative > 0) reasons.push(`${counts.informative} ponto(s) informativo(s)`);
  if (reasons.length === 0) reasons.push('Nenhuma divergência ativa entre ERP e marketplaces');
  return { score, label: labelFor(score), reasons };
}

// ─── Saúde Comercial ──────────────────────────────────────────────────
// Baseada na qualidade dos anúncios ativos do Mercado Livre: health médio
// da API, % com foto suficiente (3+), % com vídeo. A Shopee ainda não entra
// aqui porque a API dela não devolve esses campos hoje (ver auditoria de
// dados) — será incluída quando os dados forem enriquecidos.
export function computeCommercialHealth(listings: { health: number | null; pictureCount: number; videoId: string | null; status: string }[]): HealthResult {
  const active = listings.filter((l) => l.status === 'active');
  if (active.length === 0) {
    return { score: 0, label: 'Crítica', reasons: ['Nenhum anúncio ativo no Mercado Livre'] };
  }
  const withHealth = active.filter((l) => l.health !== null);
  const avgHealth = withHealth.length > 0 ? withHealth.reduce((s, l) => s + (l.health ?? 0), 0) / withHealth.length : null;
  const pctGoodPhotos = (active.filter((l) => l.pictureCount >= 3).length / active.length) * 100;
  const pctVideo = (active.filter((l) => l.videoId !== null).length / active.length) * 100;

  const parts = [avgHealth ?? 60, pctGoodPhotos, pctVideo];
  const score = clamp(parts.reduce((a, b) => a + b, 0) / parts.length);

  const reasons: string[] = [];
  reasons.push(avgHealth !== null ? `Health médio dos anúncios: ${avgHealth.toFixed(0)}` : 'Health não disponível para os anúncios ativos');
  reasons.push(`${pctGoodPhotos.toFixed(0)}% dos anúncios com 3+ fotos`);
  reasons.push(`${pctVideo.toFixed(0)}% dos anúncios com vídeo`);

  return { score, label: labelFor(score), reasons };
}

// ─── Saúde Financeira ─────────────────────────────────────────────────
// Baseada em % de produtos com margem saudável (lucro unitário >= 0),
// considerando só produtos com custo cadastrado no Bling — produtos sem
// custo não entram no cálculo (não viram "problema" nem "saudável": ficam
// de fora, e isso é mostrado como limitação).
export function computeFinancialHealth(rows: { saudavel: boolean | null }[]): HealthResult {
  const priced = rows.filter((r) => r.saudavel !== null);
  if (priced.length === 0) {
    return { score: 0, label: 'Crítica', reasons: ['Nenhum produto com custo cadastrado no Bling — cadastre custos para habilitar este índice'] };
  }
  const healthy = priced.filter((r) => r.saudavel).length;
  const score = clamp((healthy / priced.length) * 100);
  const reasons = [
    `${healthy} de ${priced.length} produtos com custo cadastrado têm margem saudável`,
    `${priced.length < rows.length ? `${rows.length - priced.length} produto(s) sem custo cadastrado não entram neste cálculo` : 'Todos os produtos têm custo cadastrado'}`,
  ];
  return { score, label: labelFor(score), reasons };
}

// ─── Índice CIO ───────────────────────────────────────────────────────
// Combina os três índices acima. Os pesos vêm do Centro de Estratégias
// (Módulo 09) — se a pessoa ainda não escolheu uma estratégia, usamos
// pesos iguais (1/3 cada) como ponto de partida neutro.
export function computeCioIndex(
  operational: HealthResult,
  commercial: HealthResult,
  financial: HealthResult,
  weights: { operacional: number; comercial: number; financeira: number } = { operacional: 1 / 3, comercial: 1 / 3, financeira: 1 / 3 }
): HealthResult {
  const totalWeight = weights.operacional + weights.comercial + weights.financeira || 1;
  const score = clamp(
    (operational.score * weights.operacional + commercial.score * weights.comercial + financial.score * weights.financeira) / totalWeight
  );
  return {
    score,
    label: labelFor(score),
    reasons: [
      `Saúde Operacional: ${operational.score.toFixed(0)} (${operational.label}) — peso ${(weights.operacional * 100).toFixed(0)}%`,
      `Saúde Comercial: ${commercial.score.toFixed(0)} (${commercial.label}) — peso ${(weights.comercial * 100).toFixed(0)}%`,
      `Saúde Financeira: ${financial.score.toFixed(0)} (${financial.label}) — peso ${(weights.financeira * 100).toFixed(0)}%`,
      'Pesos definidos em Administrar → Centro de Estratégias.',
    ],
  };
}
