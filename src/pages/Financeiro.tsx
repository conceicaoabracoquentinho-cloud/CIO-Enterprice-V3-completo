import { useEffect, useMemo, useState } from 'react';
import {
  Boxes, RefreshCw, Settings2, Save, Search, AlertTriangle,
  PackageX, TrendingDown, HelpCircle, Info,
} from 'lucide-react';
import { getErpProducts, getMarketplaceListings } from '../lib/integrations';
import { ErpProduct, MarketplaceListing } from '../types';
import {
  InventoryConfig, getInventoryConfig, saveInventoryConfig,
  computeStockIntelligence, summarizeInventory, StockRow, StockStatus,
} from '../lib/inventory';

function money(v: number | null): string {
  return v === null ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const statusMeta: Record<StockStatus, { label: string; classes: string }> = {
  ruptura_iminente: { label: 'Ruptura iminente', classes: 'text-red-700 bg-red-50' },
  saudavel: { label: 'Saudável', classes: 'text-green-700 bg-green-50' },
  possivel_excesso: { label: 'Possível excesso', classes: 'text-amber-700 bg-amber-50' },
  sem_dado_suficiente: { label: 'Sem dado suficiente', classes: 'text-gray-500 bg-gray-100' },
};

function ParamsPanel({ config, onSaved }: { config: InventoryConfig; onSaved: (c: InventoryConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(config); }, [config]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await saveInventoryConfig(draft);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'Falha ao salvar.'); return; }
    onSaved(draft);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors">
        <Settings2 className="h-4 w-4" /> Parâmetros
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parâmetros de Estoque</p>
            <label className="block text-xs text-gray-600">
              Prazo médio do fornecedor (dias)
              <input type="number" value={draft.supplierLeadTimeDays} onChange={(e) => setDraft({ ...draft, supplierLeadTimeDays: Number(e.target.value) })} className="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </label>
            <label className="block text-xs text-gray-600">
              Estoque de segurança (dias)
              <input type="number" value={draft.safetyStockDays} onChange={(e) => setDraft({ ...draft, safetyStockDays: Number(e.target.value) })} className="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </label>
            <label className="block text-xs text-gray-600">
              Cobertura mínima antes de alertar (dias)
              <input type="number" value={draft.lowCoverageThresholdDays} onChange={(e) => setDraft({ ...draft, lowCoverageThresholdDays: Number(e.target.value) })} className="mt-1 w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button onClick={handleSave} disabled={saving} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? 'Salvando…' : 'Salvar parâmetros'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Financeiro() {
  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [config, setConfig] = useState<InventoryConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StockStatus | 'all'>('all');

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [erp, cfg] = await Promise.all([getErpProducts(), getInventoryConfig()]);
      const ml = await getMarketplaceListings(erp);
      setErpProducts(erp);
      setListings(ml);
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setErpProducts([]);
      setListings([]);
      try { setConfig(await getInventoryConfig()); } catch { setConfig(null); }
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const rows: StockRow[] = useMemo(() => {
    if (!config) return [];
    return computeStockIntelligence(erpProducts, listings, config);
  }, [erpProducts, listings, config]);

  const summary = useMemo(() => summarizeInventory(rows), [rows]);

  const filtered = rows
    .filter((r) => r.productName.toLowerCase().includes(search.toLowerCase()) || r.sku.toLowerCase().includes(search.toLowerCase()))
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)
    .sort((a, b) => (b.capitalParado ?? 0) - (a.capitalParado ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Boxes className="h-6 w-6 text-blue-600" /> Financeiro — Estoque Inteligente</h2>
        <p className="text-gray-500 text-sm mt-1">
          Capital parado, cobertura de estoque e sugestão de compra, calculados a partir do custo do Bling e da velocidade de venda do Mercado Livre.
        </p>
      </div>

      <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-xs">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          A "venda média diária" é uma aproximação: vendas acumuladas do anúncio ÷ dias desde a criação do anúncio no Mercado Livre — não uma média móvel de período fixo, porque essa série histórica ainda não é armazenada (isso chega com o Centro de Dados, Módulo 10). Receita, Despesas e Fluxo Financeiro completos do Módulo 04 dependem de dados que ainda não integramos (categorias de despesa, contas a pagar) e ficam para uma próxima fase.
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou SKU…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StockStatus | 'all')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="all">Todos os status</option>
            <option value="ruptura_iminente">Ruptura iminente</option>
            <option value="saudavel">Saudável</option>
            <option value="possivel_excesso">Possível excesso</option>
            <option value="sem_dado_suficiente">Sem dado suficiente</option>
          </select>
          {config && <ParamsPanel config={config} onSaved={setConfig} />}
          <button onClick={loadAll} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><span>⚠ {error}</span></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-gray-900">{loading ? '—' : money(summary.capitalParadoTotal)}</p>
          <p className="text-xs text-gray-500 mt-1">Capital total parado em estoque</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-red-600">{loading ? '—' : summary.rupturaIminente}</p>
          <p className="text-xs text-gray-500 mt-1">Ruptura iminente</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-amber-600">{loading ? '—' : summary.possivelExcesso}</p>
          <p className="text-xs text-gray-500 mt-1">Possível excesso de estoque</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-gray-400">{loading ? '—' : summary.produtosSemCusto}</p>
          <p className="text-xs text-gray-500 mt-1">Sem custo cadastrado</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <th className="px-4 py-3 font-medium">Produto</th>
              <th className="px-4 py-3 font-medium text-right">Estoque</th>
              <th className="px-4 py-3 font-medium text-right">Capital parado</th>
              <th className="px-4 py-3 font-medium text-right">Venda média/dia (est.)</th>
              <th className="px-4 py-3 font-medium text-right">Cobertura (dias)</th>
              <th className="px-4 py-3 font-medium text-right">Compra sugerida</th>
              <th className="px-4 py-3 font-medium text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              [1, 2, 3, 4, 5].map((i) => <tr key={i} className="animate-pulse"><td colSpan={7} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded w-full" /></td></tr>)
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.sku} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-xs">{r.productName}</p>
                    <p className="text-xs text-gray-400 font-mono">{r.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-800 flex items-center justify-end gap-1.5">
                    {r.stock === 0 && <PackageX className="h-3.5 w-3.5 text-red-500" />}
                    {r.stock}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-800">{money(r.capitalParado)}</td>
                  <td className="px-4 py-3 text-right text-gray-800">{r.vendaMediaDiaEstimada !== null ? r.vendaMediaDiaEstimada.toFixed(2) : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-800">
                    {r.coberturaDias !== null ? (
                      <span className={r.coberturaDias <= (config?.lowCoverageThresholdDays ?? 10) ? 'text-red-600 font-medium flex items-center justify-end gap-1' : ''}>
                        {r.coberturaDias <= (config?.lowCoverageThresholdDays ?? 10) && <TrendingDown className="h-3.5 w-3.5" />}
                        {r.coberturaDias.toFixed(0)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-blue-700">{r.compraSugerida !== null ? `${r.compraSugerida} un.` : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${statusMeta[r.status].classes}`}>
                      {r.status === 'sem_dado_suficiente' && <HelpCircle className="h-3 w-3" />}
                      {r.status === 'ruptura_iminente' && <AlertTriangle className="h-3 w-3" />}
                      {statusMeta[r.status].label}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-50">
          "Sem dado suficiente" aparece quando o produto não tem anúncio ativo no Mercado Livre com vendas registradas — não é possível estimar velocidade de venda nesse caso.
        </p>
      </div>
    </div>
  );
}
