import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, RefreshCw, CheckCircle, XCircle, Info,
  Package, ArrowRight, ShoppingBag, Calculator, GitCompareArrows,
  Plug, Sparkles, Box, Video, Image as ImageIcon, Brain,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  getIntegrationStatuses, updateAllIntegrations,
  getErpProducts, getMarketplaceListings,
} from '../lib/integrations';
import { getPricingConfig, computeProfitability, ProfitabilityRow } from '../lib/pricing';
import { getStrategyConfig, StrategyConfig } from '../lib/strategy';
import {
  computeOperationalHealth, computeCommercialHealth, computeFinancialHealth, computeCioIndex, HealthResult,
} from '../lib/health';
import { buildDiagnostics } from '../lib/intelligence';
import { AuditRecord, IntegrationStatus, UpdateIntegrationsResult, Divergence, ErpProduct, MarketplaceListing } from '../types';
import { ConfirmModal } from '../components/ConfirmModal';
import { ProgressModal, ProgressStep } from '../components/ProgressModal';
import { PriorityBadge } from '../components/PriorityBadge';
import { Page } from '../components/Sidebar';

interface Props {
  onNavigate: (page: Page) => void;
}

function money(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Agora mesmo';
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

// ─── Área 2: cartão de índice de saúde ───────────────────────────────
function HealthCard({ label, result, onOpen }: { label: string; result: HealthResult; onOpen: () => void }) {
  const ring =
    result.label === 'Excelente' ? 'ring-green-200 bg-green-50' :
    result.label === 'Boa' ? 'ring-blue-200 bg-blue-50' :
    result.label === 'Regular' ? 'ring-amber-200 bg-amber-50' : 'ring-red-200 bg-red-50';
  const text =
    result.label === 'Excelente' ? 'text-green-700' :
    result.label === 'Boa' ? 'text-blue-700' :
    result.label === 'Regular' ? 'text-amber-700' : 'text-red-700';
  return (
    <button onClick={onOpen} className={`text-left p-4 rounded-xl ring-1 ${ring} hover:shadow-md transition-all`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${text}`}>{result.score.toFixed(0)}</p>
      <p className={`text-xs font-medium mt-0.5 ${text}`}>{result.label}</p>
    </button>
  );
}

export function Dashboard({ onNavigate }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [profitability, setProfitability] = useState<ProfitabilityRow[]>([]);
  const [strategy, setStrategy] = useState<StrategyConfig | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [progressSummary, setProgressSummary] = useState('');
  const [progressDone, setProgressDone] = useState(false);
  const [detailCard, setDetailCard] = useState<'cio' | 'financeira' | 'operacional' | 'comercial' | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [divRes, auditRes, intStatus] = await Promise.all([
      supabase.from('divergences').select('*').eq('ignored', false).order('created_at', { ascending: false }),
      supabase.from('audit_records').select('*').order('created_at', { ascending: false }).limit(8),
      getIntegrationStatuses(),
    ]);
    setDivergences(((divRes.data ?? []) as Divergence[]).filter((d) => !d.resolved));
    setAudits((auditRes.data ?? []) as AuditRecord[]);
    setIntegrations(intStatus);
    try { setStrategy(await getStrategyConfig()); } catch { setStrategy(null); }

    try {
      const erp = await getErpProducts();
      const ml = await getMarketplaceListings(erp);
      const cfg = await getPricingConfig();
      setErpProducts(erp);
      setListings(ml);

      const mlBySku = new Map<string, MarketplaceListing>();
      for (const l of ml) {
        if (l.source === 'mercadolivre' && l.sku && !mlBySku.has(l.sku)) mlBySku.set(l.sku, l);
      }
      const rows = erp.map((p) => {
        const listing = mlBySku.get(p.sku);
        const precoVenda = listing?.price ?? p.price;
        return computeProfitability(p.sku, p.name, precoVenda, p.precoCusto, cfg.mlCommissionPct, listing?.soldQuantity ?? null);
      });
      setProfitability(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setErpProducts([]);
      setListings([]);
      setProfitability([]);
    }

    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function handleUpdateIntegrations() {
    setConfirmOpen(false);
    setProgressSteps([
      { id: 'bling', label: 'Bling (ERP)', status: 'running' },
      { id: 'ml', label: 'Mercado Livre', status: 'pending' },
      { id: 'shopee', label: 'Shopee', status: 'pending' },
    ]);
    setProgressSummary('');
    setProgressDone(false);
    setProgressOpen(true);

    const result: UpdateIntegrationsResult = await updateAllIntegrations();

    setProgressSteps([
      { id: 'bling', label: 'Bling (ERP)', status: result.bling.success ? 'success' : 'error', detail: result.bling.error },
      { id: 'ml', label: 'Mercado Livre', status: result.mercadolivre.success ? 'success' : 'error', detail: result.mercadolivre.error },
      { id: 'shopee', label: 'Shopee', status: result.shopee.success ? 'success' : 'error', detail: result.shopee.error },
    ]);
    const secs = (result.totalDurationMs / 1000).toFixed(1);
    setProgressSummary([
      `Atualização concluída. Tempo total: ${secs}s\n`,
      `Bling ${result.bling.success ? '✔' : `✘ (${result.bling.error ?? 'erro'})`}`,
      `Mercado Livre ${result.mercadolivre.success ? '✔' : `✘ (${result.mercadolivre.error ?? 'erro'})`}`,
      `Shopee ${result.shopee.success ? '✔' : `✘ (${result.shopee.error ?? 'erro'})`}`,
    ].join('\n'));
    setProgressDone(true);
    loadData();
  }

  // ─── Área 2: Saúde Geral ─────────────────────────────────────────────
  const divCounts = useMemo(() => ({
    critical: divergences.filter((d) => d.priority === 'critical').length,
    high: divergences.filter((d) => d.priority === 'high').length,
    medium: divergences.filter((d) => d.priority === 'medium').length,
    informative: divergences.filter((d) => d.priority === 'informative').length,
  }), [divergences]);

  const mlListings = useMemo(() => listings.filter((l) => l.source === 'mercadolivre'), [listings]);
  const shopeeListings = useMemo(() => listings.filter((l) => l.source === 'shopee'), [listings]);

  const operationalHealth = useMemo(() => computeOperationalHealth(divCounts), [divCounts]);
  const commercialHealth = useMemo(() => computeCommercialHealth(mlListings), [mlListings]);
  const financialHealth = useMemo(() => computeFinancialHealth(profitability), [profitability]);
  const cioIndex = useMemo(
    () => computeCioIndex(
      operationalHealth, commercialHealth, financialHealth,
      strategy ? { operacional: strategy.weights.operacional, comercial: strategy.weights.comercial, financeira: strategy.weights.financeira } : undefined
    ),
    [operationalHealth, commercialHealth, financialHealth, strategy]
  );

  // ─── Área 3: Financeiro (resumo) ─────────────────────────────────────
  const pricedRows = profitability.filter((r) => r.saudavel !== null);
  const receitaAcumulada = pricedRows.reduce((s, r) => s + (r.receitaAcumulada ?? 0), 0);
  const lucroAcumulado = pricedRows.reduce((s, r) => s + (r.lucroAcumulado ?? 0), 0);
  const semCusto = erpProducts.filter((p) => p.precoCusto === null).length;

  // ─── Área 4: Operação ─────────────────────────────────────────────────
  const semEstoque = erpProducts.filter((p) => p.stock === 0).length;
  const semAnuncio = erpProducts.filter((p) => !listings.some((l) => l.sku === p.sku)).length;
  const abaixoDoMinimo = pricedRows.filter((r) => !r.saudavel).length;

  // ─── Área 6 e 7: ordenadas por prioridade, nunca por data (regra do
  // Documento 11, seção 12) ──────────────────────────────────────────
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, informative: 3 };
  const sortedDivergences = [...divergences].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const priorityTasks = sortedDivergences.slice(0, 10);

  const diagnostics = useMemo(
    () => buildDiagnostics(divergences, erpProducts, listings, profitability),
    [divergences, erpProducts, listings, profitability]
  );
  const topDiagnostics = diagnostics.slice(0, 3);

  // ─── Área 1: Resumo Executivo (gerado a partir de dados reais) ──────
  const resumoLinhas: string[] = [];
  if (!loading) {
    resumoLinhas.push(
      divCounts.critical > 0
        ? `${divCounts.critical} problema(s) crítico(s) precisam de atenção imediata.`
        : 'Nenhum problema crítico ativo no momento.'
    );
    if (pricedRows.length > 0) {
      resumoLinhas.push(`${pricedRows.length - abaixoDoMinimo} de ${pricedRows.length} produtos com custo cadastrado estão com margem saudável.`);
    } else {
      resumoLinhas.push('Nenhum produto tem custo cadastrado no Bling ainda — cadastre para habilitar a leitura financeira.');
    }
    if (semAnuncio > 0) resumoLinhas.push(`${semAnuncio} produto(s) do ERP ainda não têm anúncio no Mercado Livre.`);
    if (semEstoque > 0) resumoLinhas.push(`${semEstoque} produto(s) estão com estoque zerado no ERP.`);
  }

  const noneConfigured = !loading && integrations.length > 0 && integrations.every((i) => !i.tokenConfigured);

  return (
    <div className="space-y-8">
      {/* Primeiros Passos — só aparece antes de qualquer integração ser configurada */}
      {noneConfigured && (
        <div className="bg-blue-600 rounded-2xl p-6 text-white flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-blue-100 text-xs uppercase tracking-wide font-medium">Primeiros passos</p>
            <h2 className="text-lg font-bold mt-1">Conecte o Bling e o Mercado Livre para começar</h2>
            <p className="text-sm text-blue-100 mt-1 max-w-xl">
              Nenhuma integração está configurada ainda — por isso as telas abaixo mostram tudo zerado. Cadastre as credenciais em Administrar, clique em "Conectar" e depois "Testar Conexão".
            </p>
          </div>
          <button
            onClick={() => onNavigate('administrar')}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium"
          >
            Ir para Administrar <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Área 1 — Resumo Executivo */}
      <div className="bg-slate-900 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-slate-400 text-xs uppercase tracking-wide font-medium">Centro de Comando</p>
            <h2 className="text-xl font-bold mt-1">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
          </div>
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-900 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium"
          >
            <RefreshCw className="h-4 w-4" /> Sincronizar Dados
          </button>
        </div>
        {loading ? (
          <div className="mt-4 space-y-2">
            <div className="h-3.5 bg-slate-700 rounded w-3/4 animate-pulse" />
            <div className="h-3.5 bg-slate-700 rounded w-1/2 animate-pulse" />
          </div>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {resumoLinhas.map((line, i) => (
              <li key={i} className="text-sm text-slate-200 flex gap-2">
                <span className="text-slate-500">•</span>{line}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><span>⚠ {error}</span></div>
      )}

      {/* Área 2 — Saúde Geral */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Saúde Geral</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <HealthCard label="Índice CIO" result={cioIndex} onOpen={() => setDetailCard('cio')} />
          <HealthCard label="Saúde Financeira" result={financialHealth} onOpen={() => setDetailCard('financeira')} />
          <HealthCard label="Saúde Operacional" result={operationalHealth} onOpen={() => setDetailCard('operacional')} />
          <HealthCard label="Saúde Comercial" result={commercialHealth} onOpen={() => setDetailCard('comercial')} />
        </div>
        {detailCard && (
          <div className="mt-3 p-4 bg-white border border-gray-200 rounded-xl">
            <ul className="space-y-1">
              {(detailCard === 'cio' ? cioIndex : detailCard === 'financeira' ? financialHealth : detailCard === 'operacional' ? operationalHealth : commercialHealth)
                .reasons.map((r, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-gray-300">•</span>{r}</li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {/* Área 3 — Financeiro */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Financeiro (estimado)</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-bold text-gray-900">{loading ? '—' : money(receitaAcumulada)}</p>
            <p className="text-xs text-gray-500 mt-1">Receita acumulada (anúncios ML)</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold ${lucroAcumulado < 0 ? 'text-red-600' : 'text-gray-900'}`}>{loading ? '—' : money(lucroAcumulado)}</p>
            <p className="text-xs text-gray-500 mt-1">Lucro acumulado estimado</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-bold text-red-600">{loading ? '—' : abaixoDoMinimo}</p>
            <p className="text-xs text-gray-500 mt-1">Produtos vendendo com prejuízo</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-bold text-gray-400">{loading ? '—' : semCusto}</p>
            <p className="text-xs text-gray-500 mt-1">Produtos sem custo cadastrado</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          "Acumulado" = vendas históricas totais do anúncio no Mercado Livre (a API não expõe um recorte de período). Não é um valor mensal. Detalhe completo em Precificação.
        </p>
      </div>

      {/* Área 4 — Operação + Área 5 — Marketplace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Operação</h3>
          </div>
          <div className="divide-y divide-gray-50">
            <button onClick={() => onNavigate('monitor')} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
              <span className="text-sm text-gray-700 flex items-center gap-2"><Box className="h-4 w-4 text-gray-400" /> Produtos sem estoque</span>
              <span className="text-sm font-semibold text-gray-900">{loading ? '—' : semEstoque}</span>
            </button>
            <button onClick={() => onNavigate('monitor')} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
              <span className="text-sm text-gray-700 flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-gray-400" /> Produtos sem anúncio</span>
              <span className="text-sm font-semibold text-gray-900">{loading ? '—' : semAnuncio}</span>
            </button>
            <button onClick={() => onNavigate('conciliacao')} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
              <span className="text-sm text-gray-700 flex items-center gap-2"><GitCompareArrows className="h-4 w-4 text-gray-400" /> Divergências ativas</span>
              <span className="text-sm font-semibold text-gray-900">{loading ? '—' : divergences.length}</span>
            </button>
            <button onClick={() => onNavigate('precificacao')} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
              <span className="text-sm text-gray-700 flex items-center gap-2"><Calculator className="h-4 w-4 text-gray-400" /> Vendendo abaixo do preço mínimo</span>
              <span className="text-sm font-semibold text-gray-900">{loading ? '—' : abaixoDoMinimo}</span>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Marketplace</h3>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Mercado Livre</p>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-lg font-bold text-gray-900">{loading ? '—' : mlListings.filter((l) => l.status === 'active').length}</p><p className="text-[11px] text-gray-500">Ativos</p></div>
                <div><p className="text-lg font-bold text-gray-900 flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5 text-gray-400" />{loading ? '—' : mlListings.filter((l) => l.pictureCount < 3).length}</p><p className="text-[11px] text-gray-500">Poucas fotos</p></div>
                <div><p className="text-lg font-bold text-gray-900 flex items-center gap-1"><Video className="h-3.5 w-3.5 text-gray-400" />{loading ? '—' : mlListings.filter((l) => l.videoId === null).length}</p><p className="text-[11px] text-gray-500">Sem vídeo</p></div>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Shopee</p>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-lg font-bold text-gray-900">{loading ? '—' : shopeeListings.filter((l) => l.status === 'active').length}</p><p className="text-[11px] text-gray-500">Ativos</p></div>
                <div><p className="text-lg font-bold text-gray-400">{loading ? '—' : shopeeListings.length}</p><p className="text-[11px] text-gray-500">Total (dados limitados)</p></div>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">A captura de dados da Shopee ainda está limitada a estoque/status — será enriquecida quando entrar no foco do projeto.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Área 6 — Alertas + Área 7 — Tarefas Prioritárias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Alertas</h3>
            <button onClick={() => onNavigate('conciliacao')} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              Ver todos <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="px-5 py-3.5 animate-pulse"><div className="h-4 w-full bg-gray-100 rounded" /></div>)
            ) : divergences.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <CheckCircle className="h-8 w-8 text-green-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhum alerta ativo</p>
              </div>
            ) : (
              sortedDivergences.slice(0, 8).map((d) => (
                <div key={d.id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">{d.product_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{d.recommended_action}</p>
                  </div>
                  <PriorityBadge priority={d.priority} size="sm" />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Tarefas Prioritárias</h3>
            <span className="text-xs text-gray-400">até 10 mais urgentes</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="px-5 py-3.5 animate-pulse"><div className="h-4 w-full bg-gray-100 rounded" /></div>)
            ) : priorityTasks.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Sparkles className="h-8 w-8 text-blue-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhuma tarefa pendente</p>
              </div>
            ) : (
              priorityTasks.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onNavigate('conciliacao')}
                  className="w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">{d.product_name}</p>
                    <p className="text-xs text-gray-400 truncate">{d.recommended_action}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Área 8 — Resumo Inteligente (Módulo 05) */}
      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Brain className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-blue-900">Resumo Inteligente</p>
              {loading ? (
                <p className="text-xs text-blue-700 mt-1">Analisando…</p>
              ) : topDiagnostics.length === 0 ? (
                <p className="text-xs text-blue-700 mt-1">Nenhum ponto de atenção prioritário identificado agora.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {topDiagnostics.map((d) => (
                    <li key={d.id} className="text-xs text-blue-800">• {d.problema} — {d.recomendacao}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button onClick={() => onNavigate('inteligencia')} className="shrink-0 text-xs font-medium text-blue-700 hover:text-blue-900 flex items-center gap-1">
            Ver tudo <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Área 9 — Ações Rápidas */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ações Rápidas</h3>
        <div className="flex flex-wrap gap-3">
          <button onClick={loadData} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            <RefreshCw className="h-4 w-4" /> Atualizar Dashboard
          </button>
          <button onClick={() => setConfirmOpen(true)} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Plug className="h-4 w-4" /> Sincronizar Dados
          </button>
          <button onClick={() => onNavigate('conciliacao')} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            <GitCompareArrows className="h-4 w-4" /> Abrir Conciliação
          </button>
          <button onClick={() => onNavigate('precificacao')} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Calculator className="h-4 w-4" /> Abrir Precificação
          </button>
          <button onClick={() => onNavigate('relatorios')} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Package className="h-4 w-4" /> Exportar Relatório
          </button>
        </div>
      </div>

      {/* Integrações + Auditorias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Status das Integrações</h3>
            <button onClick={() => onNavigate('integrar')} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Ver detalhes</button>
          </div>
          <div className="divide-y divide-gray-50">
            {loading
              ? [1, 2, 3].map((i) => (
                  <div key={i} className="px-5 py-3.5 flex items-center gap-3 animate-pulse">
                    <div className="h-3 w-3 rounded-full bg-gray-200" />
                    <div className="h-4 w-28 bg-gray-200 rounded" />
                  </div>
                ))
              : integrations.map((int) => (
                  <div key={int.source} className="px-5 py-3.5 flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${!int.tokenConfigured ? 'bg-gray-300' : int.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-gray-800">{int.label}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {!int.tokenConfigured ? (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Não configurado</span>
                      ) : int.connected ? (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Conectado</span>
                      ) : (
                        <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1"><XCircle className="h-3 w-3" /> Erro</span>
                      )}
                    </div>
                  </div>
                ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Auditorias Recentes</h3>
            <button onClick={() => onNavigate('integrar')} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Ver logs</button>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse"><div className="flex-1 h-4 bg-gray-200 rounded" /></div>)
            ) : audits.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Package className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhuma auditoria registrada</p>
              </div>
            ) : (
              audits.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3">
                  {a.result === 'success' && <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />}
                  {a.result === 'error' && <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />}
                  {a.result === 'partial' && <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />}
                  {a.result === 'info' && <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 font-medium leading-snug truncate">{a.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5 capitalize">{a.module}</p>
                  </div>
                  <p className="text-xs text-gray-400 flex-shrink-0">{formatRelative(a.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Sincronizar Dados"
        message={`Deseja atualizar todas as integrações agora?\n\nSerão consultadas todas as APIs configuradas.\n\nBling\nMercado Livre\nShopee`}
        confirmLabel="Atualizar"
        cancelLabel="Cancelar"
        onConfirm={handleUpdateIntegrations}
        onCancel={() => setConfirmOpen(false)}
        variant="info"
      />

      <ProgressModal
        open={progressOpen}
        title="Atualizando Integrações..."
        steps={progressSteps}
        summary={progressSummary}
        finished={progressDone}
        onClose={() => setProgressOpen(false)}
      />
    </div>
  );
}
