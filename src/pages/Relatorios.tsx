import { useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet, RefreshCw, Download, Info, Table2, Sliders,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getErpProducts, getMarketplaceListings } from '../lib/integrations';
import { getPricingConfig, computeProfitability, ProfitabilityRow } from '../lib/pricing';
import { getInventoryConfig, computeStockIntelligence, StockRow } from '../lib/inventory';
import { buildCsv, downloadTextFile, ColumnDef, DatasetId } from '../lib/reports';
import { Divergence, ErpProduct, MarketplaceListing } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyColumn = ColumnDef<any>;

interface DatasetRuntime {
  id: DatasetId;
  label: string;
  description: string;
  columns: AnyColumn[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
}

export function Relatorios() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [profitability, setProfitability] = useState<ReturnType<typeof computeProfitability>[]>([]);
  const [stockRows, setStockRows] = useState<ReturnType<typeof computeStockIntelligence>>([]);

  const [datasetId, setDatasetId] = useState<DatasetId>('produtos_erp');
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());

  async function loadAll() {
    setLoading(true);
    setError(null);
    const divRes = await supabase.from('divergences').select('*').eq('ignored', false);
    setDivergences((divRes.data ?? []) as Divergence[]);
    try {
      const erp = await getErpProducts();
      const ml = await getMarketplaceListings(erp);
      const pricingCfg = await getPricingConfig();
      const inventoryCfg = await getInventoryConfig();
      setErpProducts(erp);
      setListings(ml);

      const mlBySku = new Map<string, MarketplaceListing>();
      for (const l of ml) if (l.source === 'mercadolivre' && l.sku && !mlBySku.has(l.sku)) mlBySku.set(l.sku, l);
      setProfitability(erp.map((p) => {
        const listing = mlBySku.get(p.sku);
        const precoVenda = listing?.price ?? p.price;
        return computeProfitability(p.sku, p.name, precoVenda, p.precoCusto, pricingCfg.mlCommissionPct, listing?.soldQuantity ?? null);
      }));
      setStockRows(computeStockIntelligence(erp, ml, inventoryCfg));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setErpProducts([]); setListings([]); setProfitability([]); setStockRows([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const datasets: DatasetRuntime[] = useMemo(() => [
    {
      id: 'produtos_erp', label: 'Produtos (ERP)', description: 'Catálogo do Bling — dados oficiais de cadastro.',
      rows: erpProducts,
      columns: [
        { key: 'sku', label: 'SKU', get: (r: ErpProduct) => r.sku },
        { key: 'name', label: 'Nome', get: (r: ErpProduct) => r.name },
        { key: 'categoria', label: 'Categoria', get: (r: ErpProduct) => r.categoria },
        { key: 'marca', label: 'Marca', get: (r: ErpProduct) => r.marca },
        { key: 'stock', label: 'Estoque', get: (r: ErpProduct) => r.stock },
        { key: 'price', label: 'Preço', get: (r: ErpProduct) => r.price },
        { key: 'precoCusto', label: 'Custo', get: (r: ErpProduct) => r.precoCusto },
        { key: 'gtin', label: 'GTIN', get: (r: ErpProduct) => r.gtin },
        { key: 'situacao', label: 'Situação', get: (r: ErpProduct) => r.situacao },
      ] as AnyColumn[],
    },
    {
      id: 'anuncios_ml', label: 'Anúncios (Mercado Livre)', description: 'Anúncios ativos e pausados do Mercado Livre.',
      rows: listings.filter((l) => l.source === 'mercadolivre'),
      columns: [
        { key: 'sku', label: 'SKU', get: (r: MarketplaceListing) => r.sku },
        { key: 'title', label: 'Título', get: (r: MarketplaceListing) => r.title },
        { key: 'status', label: 'Status', get: (r: MarketplaceListing) => r.status },
        { key: 'price', label: 'Preço', get: (r: MarketplaceListing) => r.price },
        { key: 'stock', label: 'Estoque', get: (r: MarketplaceListing) => r.stock },
        { key: 'soldQuantity', label: 'Vendas acumuladas', get: (r: MarketplaceListing) => r.soldQuantity },
        { key: 'health', label: 'Health', get: (r: MarketplaceListing) => r.health },
        { key: 'pictureCount', label: 'Fotos', get: (r: MarketplaceListing) => r.pictureCount },
        { key: 'permalink', label: 'Link', get: (r: MarketplaceListing) => r.permalink },
      ] as AnyColumn[],
    },
    {
      id: 'divergencias', label: 'Divergências (Conciliação)', description: 'Divergências ativas entre ERP e Mercado Livre.',
      rows: divergences,
      columns: [
        { key: 'sku', label: 'SKU', get: (r: Divergence) => r.sku },
        { key: 'product_name', label: 'Produto', get: (r: Divergence) => r.product_name },
        { key: 'divergence_type', label: 'Tipo', get: (r: Divergence) => r.divergence_type },
        { key: 'priority', label: 'Prioridade', get: (r: Divergence) => r.priority },
        { key: 'erp_value', label: 'Valor ERP', get: (r: Divergence) => r.erp_value },
        { key: 'ml_value', label: 'Valor Mercado Livre', get: (r: Divergence) => r.ml_value },
        { key: 'recommended_action', label: 'Ação recomendada', get: (r: Divergence) => r.recommended_action },
        { key: 'resolved', label: 'Resolvida', get: (r: Divergence) => (r.resolved ? 'Sim' : 'Não') },
      ] as AnyColumn[],
    },
    {
      id: 'precificacao', label: 'Precificação e Rentabilidade', description: 'Custo, margem e lucro estimado por produto.',
      rows: profitability,
      columns: [
        { key: 'sku', label: 'SKU', get: (r: ProfitabilityRow) => r.sku },
        { key: 'productName', label: 'Produto', get: (r: ProfitabilityRow) => r.productName },
        { key: 'precoVenda', label: 'Preço venda', get: (r: ProfitabilityRow) => r.precoVenda },
        { key: 'custoErp', label: 'Custo', get: (r: ProfitabilityRow) => r.custoErp },
        { key: 'lucroUnitario', label: 'Lucro/un.', get: (r: ProfitabilityRow) => r.lucroUnitario },
        { key: 'margemPct', label: 'Margem %', get: (r: ProfitabilityRow) => r.margemPct },
        { key: 'vendasAcumuladas', label: 'Vendas acumuladas', get: (r: ProfitabilityRow) => r.vendasAcumuladas },
        { key: 'lucroAcumulado', label: 'Lucro acumulado est.', get: (r: ProfitabilityRow) => r.lucroAcumulado },
      ] as AnyColumn[],
    },
    {
      id: 'estoque', label: 'Estoque Inteligente', description: 'Capital parado, cobertura e sugestão de compra.',
      rows: stockRows,
      columns: [
        { key: 'sku', label: 'SKU', get: (r: StockRow) => r.sku },
        { key: 'productName', label: 'Produto', get: (r: StockRow) => r.productName },
        { key: 'stock', label: 'Estoque', get: (r: StockRow) => r.stock },
        { key: 'capitalParado', label: 'Capital parado', get: (r: StockRow) => r.capitalParado },
        { key: 'coberturaDias', label: 'Cobertura (dias)', get: (r: StockRow) => r.coberturaDias },
        { key: 'compraSugerida', label: 'Compra sugerida', get: (r: StockRow) => r.compraSugerida },
        { key: 'status', label: 'Status', get: (r: StockRow) => r.status },
      ] as AnyColumn[],
    },
  ], [erpProducts, listings, divergences, profitability, stockRows]);

  const dataset = datasets.find((d) => d.id === datasetId) ?? datasets[0];

  useEffect(() => {
    setSelectedCols(new Set(dataset.columns.map((c) => c.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  const activeColumns = dataset.columns.filter((c) => selectedCols.has(c.key));

  function toggleCol(key: string) {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleExportCsv() {
    const headers = activeColumns.map((c) => c.label);
    const rows = dataset.rows.map((row) => activeColumns.map((c) => c.get(row)));
    const csv = buildCsv(headers, rows);
    downloadTextFile(`${dataset.id}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  function handleExportJson() {
    const data = dataset.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const c of activeColumns) obj[c.key] = c.get(row);
      return obj;
    });
    downloadTextFile(`${dataset.id}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileSpreadsheet className="h-6 w-6 text-blue-600" /> Relatórios</h2>
        <p className="text-gray-500 text-sm mt-1">
          Construtor Inteligente: escolha o quê analisar e quais colunas mostrar — sem precisar navegar por dezenas de relatórios fixos.
        </p>
      </div>

      <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-xs">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Exportação disponível em CSV (abre direto no Excel) e JSON. PDF, agendamento de envio e .xlsx binário ainda não foram implementados.</span>
      </div>

      {error && <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><span>⚠ {error}</span></div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Table2 className="h-3.5 w-3.5" /> Analisar</h3>
          {datasets.map((d) => (
            <button
              key={d.id}
              onClick={() => setDatasetId(d.id)}
              className={`w-full text-left px-3.5 py-2.5 rounded-lg border transition-colors ${d.id === datasetId ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
            >
              <p className="text-sm font-medium">{d.label}</p>
              <p className={`text-xs mt-0.5 ${d.id === datasetId ? 'text-slate-300' : 'text-gray-400'}`}>{d.description}</p>
              <p className={`text-[11px] mt-1 ${d.id === datasetId ? 'text-slate-400' : 'text-gray-400'}`}>{loading ? '…' : `${d.rows.length} registros`}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5"><Sliders className="h-3.5 w-3.5" /> Colunas a mostrar</h3>
            <div className="flex flex-wrap gap-2">
              {dataset.columns.map((c) => (
                <button
                  key={c.key}
                  onClick={() => toggleCol(c.key)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${selectedCols.has(c.key) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button onClick={handleExportCsv} disabled={loading || activeColumns.length === 0} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-50">
                <Download className="h-4 w-4" /> Exportar CSV
              </button>
              <button onClick={handleExportJson} disabled={loading || activeColumns.length === 0} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                <Download className="h-4 w-4" /> Exportar JSON
              </button>
              <button onClick={loadAll} disabled={loading} className="ml-auto flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  {activeColumns.map((c) => <th key={c.key} className="px-4 py-3 font-medium whitespace-nowrap">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  [1, 2, 3].map((i) => <tr key={i}><td colSpan={activeColumns.length || 1} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded w-full animate-pulse" /></td></tr>)
                ) : dataset.rows.length === 0 ? (
                  <tr><td colSpan={activeColumns.length || 1} className="px-4 py-10 text-center text-gray-400">Nenhum registro.</td></tr>
                ) : (
                  dataset.rows.slice(0, 50).map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {activeColumns.map((c) => (
                        <td key={c.key} className="px-4 py-2.5 text-gray-700 whitespace-nowrap max-w-xs truncate">{String(c.get(row) ?? '—')}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {dataset.rows.length > 50 && (
              <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-50">Mostrando 50 de {dataset.rows.length} registros — a exportação inclui todos.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
