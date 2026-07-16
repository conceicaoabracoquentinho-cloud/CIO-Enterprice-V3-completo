import { useEffect, useMemo, useState } from 'react';
import {
  Brain, AlertOctagon, ShieldAlert, Sparkles, SlidersHorizontal,
  RefreshCw, ArrowRight, Info, CheckCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getErpProducts, getMarketplaceListings } from '../lib/integrations';
import { getPricingConfig, computeProfitability, PricingConfig } from '../lib/pricing';
import { buildDiagnostics, buildRisks, buildOpportunities, Diagnostic } from '../lib/intelligence';
import { Divergence, ErpProduct, MarketplaceListing } from '../types';
import { PriorityBadge } from '../components/PriorityBadge';
import { Page } from '../components/Sidebar';

type Tab = 'diagnosticos' | 'riscos' | 'oportunidades' | 'simulador';

interface Props {
  onNavigate: (page: Page) => void;
}

function money(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const categoriaIcon: Record<Diagnostic['categoria'], string> = {
  Financeiro: 'bg-red-50 text-red-700',
  Operacional: 'bg-orange-50 text-orange-700',
  Marketplace: 'bg-blue-50 text-blue-700',
  Estoque: 'bg-amber-50 text-amber-700',
  Conciliação: 'bg-purple-50 text-purple-700',
};

export function Inteligencia({ onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>('diagnosticos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [config, setConfig] = useState<PricingConfig | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const divRes = await supabase.from('divergences').select('*').eq('ignored', false).eq('resolved', false);
    setDivergences((divRes.data ?? []) as Divergence[]);
    try {
      const erp = await getErpProducts();
      const ml = await getMarketplaceListings(erp);
      const cfg = await getPricingConfig();
      setErpProducts(erp);
      setListings(ml);
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setErpProducts([]);
      setListings([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const profitability = useMemo(() => {
    if (!config) return [];
    const mlBySku = new Map<string, MarketplaceListing>();
    for (const l of listings) if (l.source === 'mercadolivre' && l.sku && !mlBySku.has(l.sku)) mlBySku.set(l.sku, l);
    return erpProducts.map((p) => {
      const listing = mlBySku.get(p.sku);
      const precoVenda = listing?.price ?? p.price;
      return computeProfitability(p.sku, p.name, precoVenda, p.precoCusto, config.mlCommissionPct, listing?.soldQuantity ?? null);
    });
  }, [erpProducts, listings, config]);

  const diagnostics = useMemo(() => buildDiagnostics(divergences, erpProducts, listings, profitability), [divergences, erpProducts, listings, profitability]);
  const risks = useMemo(() => buildRisks(diagnostics, erpProducts), [diagnostics, erpProducts]);
  const opportunities = useMemo(() => buildOpportunities(profitability), [profitability]);

  const impactoTotal = diagnostics.reduce((s, d) => s + (d.impactoValor ?? 0), 0);
  const criticos = diagnostics.filter((d) => d.urgencia === 'critical').length;

  // ─── Simulador (Módulo 05, seção 11) ────────────────────────────────
  const [simSku, setSimSku] = useState<string>('');
  const [simPriceDeltaPct, setSimPriceDeltaPct] = useState(0);
  const [simCommissionDeltaPct, setSimCommissionDeltaPct] = useState(0);

  const simProduct = erpProducts.find((p) => p.sku === simSku) ?? erpProducts[0] ?? null;
  const simListing = listings.find((l) => l.source === 'mercadolivre' && l.sku === simProduct?.sku);

  const simResult = useMemo(() => {
    if (!simProduct || !config) return null;
    const precoBase = simListing?.price ?? simProduct.price;
    const custo = simProduct.precoCusto;
    if (custo === null) return null;
    const novoPreco = precoBase * (1 + simPriceDeltaPct / 100);
    const novaComissaoPct = config.mlCommissionPct + simCommissionDeltaPct;
    const comissao = novoPreco * (novaComissaoPct / 100);
    const lucroUnit = novoPreco - custo - comissao;
    const margemPct = novoPreco > 0 ? (lucroUnit / novoPreco) * 100 : 0;

    const comissaoAtual = precoBase * (config.mlCommissionPct / 100);
    const lucroAtual = precoBase - custo - comissaoAtual;

    return { precoBase, novoPreco, lucroAtual, lucroUnit, margemPct, deltaLucro: lucroUnit - lucroAtual };
  }, [simProduct, simListing, config, simPriceDeltaPct, simCommissionDeltaPct]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Brain className="h-6 w-6 text-blue-600" /> Inteligência Operacional</h2>
        <p className="text-gray-500 text-sm mt-1">
          Diagnósticos, riscos, oportunidades e simulações — gerados por regras determinísticas sobre os dados reais do ERP e do Mercado Livre.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
          {([
            ['diagnosticos', 'Diagnósticos', AlertOctagon],
            ['riscos', 'Riscos', ShieldAlert],
            ['oportunidades', 'Oportunidades', Sparkles],
            ['simulador', 'Simulador', SlidersHorizontal],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <button onClick={loadAll} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><span>⚠ {error}</span></div>
      )}

      {tab === 'diagnosticos' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-2xl font-bold text-gray-900">{loading ? '—' : diagnostics.length}</p>
              <p className="text-xs text-gray-500 mt-1">Pontos de atenção identificados</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-2xl font-bold text-red-600">{loading ? '—' : criticos}</p>
              <p className="text-xs text-gray-500 mt-1">Críticos</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-2xl font-bold text-gray-900">{loading ? '—' : money(impactoTotal)}</p>
              <p className="text-xs text-gray-500 mt-1">Impacto financeiro quantificado (soma dos itens mensuráveis)</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {loading ? (
              [1, 2, 3, 4].map((i) => <div key={i} className="p-5 animate-pulse"><div className="h-4 bg-gray-100 rounded w-2/3" /></div>)
            ) : diagnostics.length === 0 ? (
              <div className="p-10 text-center">
                <CheckCircle className="h-8 w-8 text-green-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhum diagnóstico no momento — operação sem pontos de atenção detectados.</p>
              </div>
            ) : (
              diagnostics.map((d) => (
                <div key={d.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${categoriaIcon[d.categoria]}`}>{d.categoria}</span>
                      <PriorityBadge priority={d.urgencia} size="sm" />
                      {d.impactoValor !== null && (
                        <span className="text-[11px] font-medium text-gray-500">Impacto estimado: {money(d.impactoValor)}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900">{d.problema}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{d.causa}</p>
                    <p className="text-xs text-blue-700 mt-1.5 font-medium">→ {d.recomendacao}</p>
                  </div>
                  <button
                    onClick={() => onNavigate(d.modulo)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-700"
                  >
                    Resolver <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {tab === 'riscos' && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
          {risks.map((r) => (
            <div key={r.categoria} className="p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{r.categoria}</p>
                {!r.disponivel && <p className="text-xs text-gray-400 mt-0.5">{r.motivoIndisponivel}</p>}
              </div>
              {r.disponivel ? (
                <span className={`text-lg font-bold ${r.quantidade > 0 ? 'text-red-600' : 'text-green-600'}`}>{loading ? '—' : r.quantidade}</span>
              ) : (
                <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">Aguardando dados</span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'oportunidades' && (
        <>
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-xs">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Critério: margem ≥ 30% e vendas acumuladas acima da mediana dos produtos precificados. Concorrência não entra no cálculo — nenhuma API conectada hoje traz esse dado.</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="p-5 animate-pulse"><div className="h-4 bg-gray-100 rounded w-2/3" /></div>)
            ) : opportunities.length === 0 ? (
              <div className="p-10 text-center"><p className="text-sm text-gray-400">Nenhuma oportunidade identificada com os critérios atuais.</p></div>
            ) : (
              opportunities.map((o) => (
                <div key={o.sku} className="p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{o.productName}</p>
                    <p className="text-xs text-gray-400 font-mono">{o.sku}</p>
                    <p className="text-xs text-blue-700 mt-1">{o.recomendacao}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-green-700">{o.margemPct.toFixed(1)}% margem</p>
                    <p className="text-xs text-gray-500">{o.vendasAcumuladas} vendas acum.</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {tab === 'simulador' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Produto</label>
            <select
              value={simProduct?.sku ?? ''}
              onChange={(e) => setSimSku(e.target.value)}
              className="w-full max-w-md px-3 py-2 text-sm border border-gray-200 rounded-lg"
            >
              {erpProducts.map((p) => <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>)}
            </select>
          </div>

          {!simProduct ? (
            <p className="text-sm text-gray-400">Nenhum produto carregado ainda.</p>
          ) : simProduct.precoCusto === null ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Este produto não tem custo cadastrado no Bling — o simulador precisa dessa informação.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    E se eu mudar o preço em <span className="font-semibold text-gray-900">{simPriceDeltaPct > 0 ? '+' : ''}{simPriceDeltaPct}%</span>
                  </label>
                  <input type="range" min={-30} max={30} step={1} value={simPriceDeltaPct} onChange={(e) => setSimPriceDeltaPct(Number(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    E se a comissão do marketplace mudar em <span className="font-semibold text-gray-900">{simCommissionDeltaPct > 0 ? '+' : ''}{simCommissionDeltaPct} p.p.</span>
                  </label>
                  <input type="range" min={-5} max={10} step={0.5} value={simCommissionDeltaPct} onChange={(e) => setSimCommissionDeltaPct(Number(e.target.value))} className="w-full" />
                </div>
              </div>

              {simResult && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="p-3 rounded-lg bg-gray-50"><p className="text-xs text-gray-500">Preço atual</p><p className="text-base font-semibold text-gray-900">{money(simResult.precoBase)}</p></div>
                  <div className="p-3 rounded-lg bg-gray-50"><p className="text-xs text-gray-500">Novo preço</p><p className="text-base font-semibold text-gray-900">{money(simResult.novoPreco)}</p></div>
                  <div className="p-3 rounded-lg bg-gray-50"><p className="text-xs text-gray-500">Novo lucro / un.</p><p className={`text-base font-semibold ${simResult.lucroUnit < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(simResult.lucroUnit)}</p></div>
                  <div className="p-3 rounded-lg bg-gray-50"><p className="text-xs text-gray-500">Variação de lucro / un.</p><p className={`text-base font-semibold ${simResult.deltaLucro < 0 ? 'text-red-600' : 'text-green-700'}`}>{simResult.deltaLucro >= 0 ? '+' : ''}{money(simResult.deltaLucro)}</p></div>
                </div>
              )}
              <p className="text-xs text-gray-400">Simulação por unidade vendida — não projeta volume futuro (o Módulo 04/Financeiro cuidará de projeções com sazonalidade e histórico).</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
