import { useEffect, useMemo, useState } from 'react';
import {
  Calculator, TrendingUp, Search, RefreshCw, Settings2, X,
  AlertTriangle, CheckCircle, Info, Save,
} from 'lucide-react';
import { getErpProducts, getMarketplaceListings } from '../lib/integrations';
import { ErpProduct, MarketplaceListing } from '../types';
import {
  PricingConfig, getPricingConfig, savePricingConfig,
  computeCostBreakdown, computeRecommendedPrice, computeProfitability,
  CostBreakdown, PriceRecommendation, ProfitabilityRow,
} from '../lib/pricing';

type Tab = 'custos' | 'rentabilidade';

function money(v: number | null): string {
  return v === null ? '—' : `R$ ${v.toFixed(2)}`;
}
function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

// ─── Painel de Parâmetros (Documento 09 — Custos e Parâmetros) ──────────
// Guardado em system_config via save-config (não é credencial nem toca
// nas integrações homologadas — são só números de negócio configuráveis).
function ParamsPanel({ config, onSaved }: { config: PricingConfig; onSaved: (c: PricingConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(config); }, [config]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await savePricingConfig(draft);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'Falha ao salvar.'); return; }
    onSaved(draft);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Settings2 className="h-4 w-4" /> Parâmetros
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parâmetros de Precificação</p>
            <label className="block text-xs text-gray-600">
              Comissão Mercado Livre (%)
              <input
                type="number" step="0.1" value={draft.mlCommissionPct}
                onChange={(e) => setDraft({ ...draft, mlCommissionPct: Number(e.target.value) })}
                className="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg"
              />
            </label>
            <label className="block text-xs text-gray-600">
              Comissão Shopee (%) <span className="text-gray-400">— usada quando a Shopee entrar em produção</span>
              <input
                type="number" step="0.1" value={draft.shopeeCommissionPct}
                onChange={(e) => setDraft({ ...draft, shopeeCommissionPct: Number(e.target.value) })}
                className="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg"
              />
            </label>
            <label className="block text-xs text-gray-600">
              Margem-alvo padrão (%)
              <input
                type="number" step="0.1" value={draft.targetMarginPct}
                onChange={(e) => setDraft({ ...draft, targetMarginPct: Number(e.target.value) })}
                className="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg"
              />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              onClick={handleSave} disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? 'Salvando…' : 'Salvar parâmetros'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Drawer de explicação (regra obrigatória: toda recomendação de preço
// deve ser explicável — Documento 11) ────────────────────────────────────
function ExplainDrawer({
  title, sku, cost, rec, onClose,
}: { title: string; sku: string; cost: CostBreakdown; rec: PriceRecommendation; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">Por que esse preço?</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="px-6 py-4 space-y-6">
          <div>
            <p className="text-base font-semibold text-gray-900 leading-snug">{title}</p>
            <p className="text-xs text-gray-400 font-mono mt-1">SKU: {sku}</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Calculator className="h-4 w-4" /> Custo total (como calculamos)
            </h3>
            <ul className="space-y-1.5">
              {cost.explicacao.map((line, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-gray-300">•</span>{line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" /> Preço recomendado (como calculamos)
            </h3>
            <ul className="space-y-1.5">
              {rec.explicacao.map((line, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-gray-300">•</span>{line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

export function Precificacao() {
  const [tab, setTab] = useState<Tab>('custos');
  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [explainSku, setExplainSku] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [erp, cfg] = await Promise.all([getErpProducts(), getPricingConfig()]);
      const ml = await getMarketplaceListings(erp);
      setErpProducts(erp);
      setListings(ml);
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setErpProducts([]);
      setListings([]);
      try {
        setConfig(await getPricingConfig());
      } catch {
        setConfig(null);
      }
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const filtered = erpProducts.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );

  // Foco no Mercado Livre agora (Shopee entra depois, reaproveitando a
  // mesma lógica — computeCostBreakdown/computeProfitability já recebem
  // a comissão como parâmetro, então funcionam para qualquer marketplace).
  const mlBySku = useMemo(() => {
    const map = new Map<string, MarketplaceListing>();
    for (const l of listings) {
      if (l.source === 'mercadolivre' && l.sku && !map.has(l.sku)) map.set(l.sku, l);
    }
    return map;
  }, [listings]);

  const costRows = useMemo(() => {
    if (!config) return [];
    return filtered.map((p) => {
      const cost = computeCostBreakdown(p.precoCusto, p.price, config.mlCommissionPct);
      const rec = computeRecommendedPrice(p.precoCusto, config.mlCommissionPct, config.targetMarginPct);
      return { product: p, cost, rec };
    });
  }, [filtered, config]);

  const profitabilityRows: ProfitabilityRow[] = useMemo(() => {
    if (!config) return [];
    return filtered
      .map((p) => {
        const ml = mlBySku.get(p.sku);
        const precoVenda = ml?.price ?? p.price;
        return computeProfitability(p.sku, p.name, precoVenda, p.precoCusto, config.mlCommissionPct, ml?.soldQuantity ?? null);
      })
      .sort((a, b) => (b.lucroAcumulado ?? -Infinity) - (a.lucroAcumulado ?? -Infinity));
  }, [filtered, mlBySku, config]);

  const semCusto = erpProducts.filter((p) => p.precoCusto === null).length;
  const abaixoDoMinimo = costRows.filter((r) => r.cost.precoMinimo !== null && r.product.price < r.cost.precoMinimo).length;

  const explainTarget = explainSku ? costRows.find((r) => r.product.sku === explainSku) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Precificação</h2>
        <p className="text-gray-500 text-sm mt-1">
          Custos, preço recomendado e rentabilidade — calculado a partir do custo cadastrado no Bling e do preço/vendas do Mercado Livre.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setTab('custos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'custos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Calculator className="h-4 w-4" /> Custos &amp; Preço Recomendado
          </button>
          <button onClick={() => setTab('rentabilidade')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'rentabilidade' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <TrendingUp className="h-4 w-4" /> Rentabilidade
          </button>
        </div>
        <div className="flex items-center gap-2">
          {config && <ParamsPanel config={config} onSaved={setConfig} />}
          <button onClick={loadAll} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><span>⚠ {error}</span></div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-700"><Calculator className="h-[18px] w-[18px]" /></div>
            <div><p className="text-lg font-bold text-gray-900 leading-none">{erpProducts.length}</p><p className="text-[10px] text-gray-500 mt-0.5">Produtos no ERP</p></div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-amber-50 text-amber-700"><Info className="h-[18px] w-[18px]" /></div>
            <div><p className="text-lg font-bold text-gray-900 leading-none">{semCusto}</p><p className="text-[10px] text-gray-500 mt-0.5">Sem custo cadastrado</p></div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-red-50 text-red-700"><AlertTriangle className="h-[18px] w-[18px]" /></div>
            <div><p className="text-lg font-bold text-gray-900 leading-none">{abaixoDoMinimo}</p><p className="text-[10px] text-gray-500 mt-0.5">Vendendo abaixo do mínimo</p></div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-green-50 text-green-700"><CheckCircle className="h-[18px] w-[18px]" /></div>
            <div><p className="text-lg font-bold text-gray-900 leading-none">{profitabilityRows.filter((r) => r.saudavel).length}</p><p className="text-[10px] text-gray-500 mt-0.5">Produtos com margem saudável</p></div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou SKU…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
        </div>

        {tab === 'custos' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium text-right">Preço atual</th>
                  <th className="px-4 py-3 font-medium text-right">Custo (Bling)</th>
                  <th className="px-4 py-3 font-medium text-right">Comissão est.</th>
                  <th className="px-4 py-3 font-medium text-right">Custo total</th>
                  <th className="px-4 py-3 font-medium text-right">Preço mínimo</th>
                  <th className="px-4 py-3 font-medium text-right">Preço recomendado</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  [1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="animate-pulse"><td colSpan={8} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded w-full" /></td></tr>
                  ))
                ) : costRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
                ) : (
                  costRows.map(({ product, cost, rec }) => {
                    const abaixo = cost.precoMinimo !== null && product.price < cost.precoMinimo;
                    return (
                      <tr key={product.sku} onClick={() => setExplainSku(product.sku)} className="hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 truncate max-w-xs">{product.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-800">{money(product.price)}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{money(cost.custoErp)}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{money(cost.comissaoEstimada)}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{money(cost.custoTotalEstimado)}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{money(cost.precoMinimo)}</td>
                        <td className="px-4 py-3 text-right font-medium text-blue-700">{money(rec.precoRecomendado)}</td>
                        <td className="px-4 py-3 text-center">
                          {cost.custoErp === null ? (
                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Sem custo</span>
                          ) : abaixo ? (
                            <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Abaixo do mínimo</span>
                          ) : (
                            <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'rentabilidade' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 font-medium text-right">Preço venda</th>
                  <th className="px-4 py-3 font-medium text-right">Lucro / un.</th>
                  <th className="px-4 py-3 font-medium text-right">Margem</th>
                  <th className="px-4 py-3 font-medium text-right">Vendas acum. (ML)</th>
                  <th className="px-4 py-3 font-medium text-right">Lucro acumulado est.</th>
                  <th className="px-4 py-3 font-medium text-center">Saúde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  [1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="animate-pulse"><td colSpan={7} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded w-full" /></td></tr>
                  ))
                ) : profitabilityRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
                ) : (
                  profitabilityRows.map((r) => (
                    <tr key={r.sku} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-xs">{r.productName}</p>
                        <p className="text-xs text-gray-400 font-mono">{r.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">{money(r.precoVenda)}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{money(r.lucroUnitario)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${r.margemPct !== null && r.margemPct < 0 ? 'text-red-600' : 'text-gray-800'}`}>{pct(r.margemPct)}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{r.vendasAcumuladas ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{money(r.lucroAcumulado)}</td>
                      <td className="px-4 py-3 text-center">
                        {r.saudavel === null ? (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Sem custo</span>
                        ) : r.saudavel ? (
                          <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Saudável</span>
                        ) : (
                          <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Prejuízo</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-50">
              "Vendas acum. (ML)" é a quantidade vendida histórica acumulada do anúncio, conforme devolvida pela API do Mercado Livre — não é um valor mensal. A Shopee ainda não está incluída nesta tela (ver Central de Integrações).
            </p>
          </div>
        )}
      </div>

      {explainTarget && (
        <ExplainDrawer
          title={explainTarget.product.name}
          sku={explainTarget.product.sku}
          cost={explainTarget.cost}
          rec={explainTarget.rec}
          onClose={() => setExplainSku(null)}
        />
      )}
    </div>
  );
}
