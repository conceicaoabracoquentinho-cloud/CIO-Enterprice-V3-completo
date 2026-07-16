import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw, CheckCircle, AlertTriangle, XCircle,
  Search, ArrowRight, Package, Tag, ShieldCheck, EyeOff, ListChecks,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { computeDivergences, fixDivergence, ignoreDivergence, reconcileAll, canAutoFixType } from '../lib/integrations';
import { Divergence, DivergenceType, Priority } from '../types';
import { PriorityBadge } from '../components/PriorityBadge';
import { ConfirmModal } from '../components/ConfirmModal';

const TYPE_LABELS: Record<DivergenceType, string> = {
  stock: 'Estoque', title: 'Título', status: 'Status', photo: 'Fotos',
  description: 'Descrição', price: 'Preço', orphan: 'Anúncio órfão', unlinked_sku: 'SKU não vinculado',
};

const TYPE_ICON: Record<DivergenceType, React.ElementType> = {
  stock: Package, title: Tag, status: AlertTriangle, photo: AlertTriangle,
  description: AlertTriangle, price: Tag, orphan: XCircle, unlinked_sku: XCircle,
};

type ViewFilter = 'ativas' | 'resolvidas' | 'ignoradas';

export function Conciliation() {
  const [divergences, setDivergences] = useState<Divergence[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<DivergenceType | 'all'>('all');
  const [view, setView] = useState<ViewFilter>('ativas');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: dbError } = await supabase.from('divergences').select('*').order('priority', { ascending: true });
    if (dbError) setError(dbError.message);
    setDivergences((data ?? []) as Divergence[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadFromDb(); }, [loadFromDb]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await computeDivergences(); // recalcula no backend e regrava a tabela
      await loadFromDb();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao sincronizar. Verifique as integrações em Administrar.');
    }
    setSyncing(false);
  }

  async function handleResolve(d: Divergence) {
    if (!canAutoFixType(d.divergence_type)) return;
    if (!window.confirm(`Confirma aplicar a correção?\n\n${d.product_name}\n${d.recommended_action}`)) return;
    setBusyId(d.id);
    const res = await fixDivergence(d);
    setBusyId(null);
    if (!res.ok) { alert(res.error ?? 'Falha ao aplicar correção — item enviado para a fila de retentativa.'); }
    await loadFromDb();
  }

  async function handleIgnore(d: Divergence) {
    if (!window.confirm(`Ignorar esta divergência?\n\n${d.product_name}\n\nEla sai da fila de pendências, mas nada é alterado no ERP nem no marketplace.`)) return;
    setBusyId(d.id);
    const res = await ignoreDivergence(d);
    setBusyId(null);
    if (!res.ok) { alert(res.error ?? 'Falha ao ignorar.'); }
    await loadFromDb();
  }

  async function handleBulk() {
    setConfirmBulk(false);
    setBulkRunning(true);
    setBulkSummary(null);
    const res = await reconcileAll();
    setBulkRunning(false);
    setBulkSummary(`${res.updated} corrigido(s) automaticamente · ${res.manualReview} exige(m) revisão manual · ${res.errors} erro(s)`);
    await loadFromDb();
  }

  const filtered = useMemo(() => divergences
    .filter((d) => (view === 'ativas' ? !d.resolved && !d.ignored : view === 'resolvidas' ? d.resolved : d.ignored))
    .filter((d) => priorityFilter === 'all' || d.priority === priorityFilter)
    .filter((d) => typeFilter === 'all' || d.divergence_type === typeFilter)
    .filter((d) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return d.product_name.toLowerCase().includes(q) || d.sku.toLowerCase().includes(q);
    }), [divergences, view, priorityFilter, typeFilter, search]);

  const active = divergences.filter((d) => !d.resolved && !d.ignored);
  const countsByPriority = {
    critical: active.filter((d) => d.priority === 'critical').length,
    high: active.filter((d) => d.priority === 'high').length,
    medium: active.filter((d) => d.priority === 'medium').length,
    informative: active.filter((d) => d.priority === 'informative').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-blue-600" /> Conciliação</h2>
        <p className="text-gray-500 text-sm mt-1">ERP (Bling) é sempre a fonte oficial de estoque, custo e cadastro — o marketplace é fonte oficial de fotos, vídeo e descrição.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Críticos" value={countsByPriority.critical} color="text-red-700 bg-red-50" />
        <SummaryCard label="Altos" value={countsByPriority.high} color="text-orange-700 bg-orange-50" />
        <SummaryCard label="Médios" value={countsByPriority.medium} color="text-yellow-700 bg-yellow-50" />
        <SummaryCard label="Informativos" value={countsByPriority.informative} color="text-blue-700 bg-blue-50" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {([['ativas', 'Ativas'], ['resolvidas', 'Resolvidas'], ['ignoradas', 'Ignoradas']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${view === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setConfirmBulk(true)} disabled={bulkRunning || active.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-50">
            <ListChecks className={`h-4 w-4 ${bulkRunning ? 'animate-spin' : ''}`} /> Conciliar Tudo
          </button>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sincronizar
          </button>
        </div>
      </div>

      {bulkSummary && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-sm"><CheckCircle className="h-4 w-4 shrink-0" /> {bulkSummary}</div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto ou SKU..."
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56" />
        </div>
        {(['all', 'critical', 'high', 'medium', 'informative'] as const).map((p) => (
          <button key={p} onClick={() => setPriorityFilter(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${priorityFilter === p ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {p === 'all' ? 'Todas prioridades' : p}
          </button>
        ))}
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DivergenceType | 'all')}
          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">Todos os tipos</option>
          {(Object.keys(TYPE_LABELS) as DivergenceType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Produto / SKU</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">Tipo</th>
                <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">ERP</th>
                <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3"></th>
                <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Marketplace</th>
                <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Prioridade</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">Ação recomendada</th>
                {view === 'ativas' && <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse"><td colSpan={8} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded w-full" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-600">
                      {view === 'ativas' ? 'Nenhuma divergência ativa' : view === 'resolvidas' ? 'Nenhuma divergência resolvida ainda' : 'Nenhuma divergência ignorada'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const Icon = TYPE_ICON[d.divergence_type] ?? AlertTriangle;
                  const marketplaceValue = d.marketplace === 'shopee' ? d.shopee_value : d.ml_value;
                  return (
                    <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${d.priority === 'critical' && view === 'ativas' ? 'border-l-2 border-l-red-400' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 leading-snug">{d.product_name}</p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{d.sku}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                          <Icon className="h-3 w-3" /> {TYPE_LABELS[d.divergence_type]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center"><span className="text-sm font-semibold text-gray-900">{d.erp_value ?? '—'}</span></td>
                      <td className="px-3 py-3 text-center"><ArrowRight className="h-4 w-4 text-gray-300 mx-auto" /></td>
                      <td className="px-3 py-3 text-center"><span className="text-sm font-medium text-red-600">{marketplaceValue ?? '—'}</span></td>
                      <td className="px-3 py-3 text-center"><PriorityBadge priority={d.priority} size="sm" /></td>
                      <td className="px-3 py-3"><p className="text-xs text-gray-600 leading-snug max-w-48">{d.recommended_action}</p></td>
                      {view === 'ativas' && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleResolve(d)}
                              disabled={busyId === d.id || !canAutoFixType(d.divergence_type)}
                              title={canAutoFixType(d.divergence_type) ? 'Aplicar correção automática' : 'Este tipo exige revisão manual'}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <CheckCircle className="h-3.5 w-3.5" /> Resolver
                            </button>
                            <button
                              onClick={() => handleIgnore(d)}
                              disabled={busyId === d.id}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                            >
                              <EyeOff className="h-3.5 w-3.5" /> Ignorar
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <span className="text-xs text-gray-500">{filtered.length} divergência(s) exibida(s)</span>
            <span className="text-xs text-gray-400">ERP é sempre a fonte oficial</span>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmBulk}
        title="Conciliar Tudo"
        message="Isso vai aplicar correção automática em todas as divergências de estoque e anúncio órfão pendentes. Preço, título, status, foto e descrição continuam exigindo revisão manual. Deseja continuar?"
        confirmLabel="Conciliar"
        cancelLabel="Cancelar"
        onConfirm={handleBulk}
        onCancel={() => setConfirmBulk(false)}
        variant="warning"
      />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <span className="text-sm font-bold">{value}</span>
      </div>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
