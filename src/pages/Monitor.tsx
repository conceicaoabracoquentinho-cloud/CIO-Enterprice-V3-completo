import { useEffect, useState } from 'react';
import {
  Package, ShoppingBag, Plug, Search, RefreshCw,
  CheckCircle, XCircle, MinusCircle, AlertCircle,
  ExternalLink, ChevronRight, X, Tag, ShieldCheck, Box, Link2,
  GitCompareArrows,
} from 'lucide-react';
import { getErpProducts, getMarketplaceListings, getOrderMonitorData, getIntegrationStatuses } from '../lib/integrations';
import { ErpProduct, MarketplaceListing, OrderMonitor, IntegrationStatus, MLAttribute } from '../types';

type Tab = 'erp' | 'mercadolivre' | 'shopee' | 'pedidos' | 'apis';

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Novo', paid: 'Pago', awaiting_nf: 'Aguardando NF',
  separating: 'Em Separação', shipped: 'Enviado', delivered: 'Entregado', stopped: 'Parado',
};
const ORDER_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  paid: 'bg-green-50 text-green-700 border-green-200',
  awaiting_nf: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  separating: 'bg-purple-50 text-purple-700 border-purple-200',
  shipped: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  delivered: 'bg-gray-50 text-gray-700 border-gray-200',
  stopped: 'bg-red-50 text-red-700 border-red-200',
};

// ─── Health Score ─────────────────────────────────────────────────────
function healthColor(h: number | null): { dot: string; text: string; bg: string; label: string } {
  if (h === null) return { dot: 'bg-gray-300', text: 'text-gray-400', bg: 'bg-gray-50', label: 'N/D' };
  if (h >= 85) return { dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', label: 'Excelente' };
  if (h >= 70) return { dot: 'bg-yellow-500', text: 'text-yellow-700', bg: 'bg-yellow-50', label: 'Boa' };
  if (h >= 50) return { dot: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', label: 'Regular' };
  return { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', label: 'Crítica' };
}

function mlGtinFromAttrs(attrs: MLAttribute[]): string | null {
  const g = attrs.find((a) => a.id === 'GTIN' || a.id === 'EAN');
  return g?.valueName ?? null;
}

function computePendencias(l: MarketplaceListing): string[] {
  const list: string[] = [];
  if (l.videoId === null) list.push('Sem vídeo');
  if (l.pictureCount < 3) list.push('Poucas fotos');
  if (l.attributes.length < 5) list.push('Poucos atributos');
  if (l.categoryId === null) list.push('Categoria incompleta');
  if (l.title.length < 30) list.push('Título fraco');
  if (mlGtinFromAttrs(l.attributes) === null) list.push('Sem GTIN');
  if (l.warranty === null) list.push('Sem garantia');
  return list;
}

const listingTypeLabel: Record<string, string> = {
  gold_pro: 'Gold Pro', gold_special: 'Gold Special', gold: 'Gold',
  silver: 'Silver', bronze: 'Bronze', free: 'Grátis',
};
const conditionLabel: Record<string, string> = {
  new: 'Novo', used: 'Usado', not_specified: 'Não especificado',
};

// ─── Indicators ────────────────────────────────────────────────────────
function computeDivergenceCount(erp: ErpProduct[], ml: MarketplaceListing[]): number {
  let count = 0;
  for (const p of erp) {
    const linked = ml.filter((l) => l.sku === p.sku);
    if (linked.length === 0) { count++; continue; }
    for (const l of linked) {
      if (l.stock !== p.stock) count++;
      if (l.price !== null && Math.abs(l.price - p.price) > 0.01) count++;
    }
  }
  const orphanMl = ml.filter((l) => l.sku && !erp.some((p) => p.sku === l.sku));
  count += orphanMl.length;
  return count;
}

function IndicatorCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2.5">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-[10px] text-gray-500 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  );
}

// ─── Shared UI cells ──────────────────────────────────────────────────
function PhotoCell({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-red-500 font-medium flex items-center gap-1 justify-center"><XCircle className="h-3.5 w-3.5" /> Nenhuma</span>;
  if (count < 3) return <span className="text-xs text-amber-600 font-medium flex items-center gap-1 justify-center"><AlertCircle className="h-3.5 w-3.5" /> {count} foto(s)</span>;
  return <span className="text-xs text-green-600 font-medium flex items-center gap-1 justify-center"><CheckCircle className="h-3.5 w-3.5" /> {count} fotos</span>;
}

function VideoCell({ has }: { has: boolean }) {
  return has
    ? <span className="text-xs text-green-600 font-medium">Possui</span>
    : <span className="text-xs text-red-400 font-medium">Não possui</span>;
}


function MLStatusBadge({ status }: { status: MarketplaceListing['status'] }) {
  if (status === 'not_listed') return <span className="text-xs text-gray-400">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: 'Ativo', cls: 'text-green-700 bg-green-50' },
    paused: { label: 'Pausado', cls: 'text-yellow-700 bg-yellow-50' },
    closed: { label: 'Encerrado', cls: 'text-gray-700 bg-gray-100' },
  };
  const c = map[status];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.cls}`}>{c.label}</span>;
}

function PendenciasCell({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-green-600 font-medium flex items-center gap-1 justify-center"><CheckCircle className="h-3.5 w-3.5" /> OK</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-center max-w-[180px]">
      {items.slice(0, 3).map((item, i) => (
        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{item}</span>
      ))}
      {items.length > 3 && <span className="text-[10px] text-amber-600 font-medium">+{items.length - 3}</span>}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs font-medium text-gray-900 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ─── ERP Detail Drawer ────────────────────────────────────────────────
function ErpDetailDrawer({ product, listings, onClose, onCompare }: { product: ErpProduct; listings: MarketplaceListing[]; onClose: () => void; onCompare: (product: ErpProduct) => void }) {
  const linked = listings.filter((l) => l.sku === product.sku);
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">Detalhes do Produto (ERP)</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="px-6 py-4 space-y-6">
          <div>
            <p className="text-base font-semibold text-gray-900 leading-snug">{product.name}</p>
            <p className="text-xs text-gray-400 font-mono mt-1">SKU: {product.sku}</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5"><Box className="h-4 w-4" /> ERP (Bling)</h3>
            <div className="space-y-2">
              <DetailRow label="Estoque" value={String(product.stock)} />
              <DetailRow label="Preço" value={`R$ ${product.price.toFixed(2)}`} />
              {product.precoCusto !== null && <DetailRow label="Custo" value={`R$ ${product.precoCusto.toFixed(2)}`} />}
              {product.categoria && <DetailRow label="Categoria" value={product.categoria} />}
              {product.marca && <DetailRow label="Marca" value={product.marca} />}
              {product.gtin && <DetailRow label="GTIN" value={product.gtin} />}
              {product.peso !== null && <DetailRow label="Peso (kg)" value={String(product.peso)} />}
              {product.situacao && <DetailRow label="Situação" value={product.situacao} />}
              {product.ncm && <DetailRow label="NCM" value={product.ncm} />}
              {product.tipo && <DetailRow label="Tipo" value={product.tipo} />}
              {product.unidade && <DetailRow label="Unidade" value={product.unidade} />}
            </div>
          </div>
          {linked.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Link2 className="h-4 w-4" /> Anúncios vinculados ({linked.length})</h3>
                {linked.length > 1 && (
                  <button
                    onClick={() => onCompare(product)}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <GitCompareArrows className="h-3.5 w-3.5" /> Comparar
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {linked.map((l) => (
                  <div key={l.itemId} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{l.title}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{l.source === 'mercadolivre' ? 'ML' : 'Shopee'} · {l.itemId}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <MLStatusBadge status={l.status} />
                      <span className="text-xs text-gray-600">Est: {l.stock}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {linked.length === 0 && (
            <p className="text-sm text-gray-400 italic">Nenhum anúncio vinculado a este SKU</p>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Comparador de Anúncios ───────────────────────────────────────────
// Mesmo SKU pode ter N anúncios (ML e/ou Shopee). O gestor precisa ver
// lado a lado qual anúncio merece mais investimento — ver Módulo 02
// (atualização "Comparador de anúncios").
function ComparatorDrawer({ product, listings, onClose }: { product: ErpProduct; listings: MarketplaceListing[]; onClose: () => void }) {
  const linked = listings.filter((l) => l.sku === product.sku);

  const rows: { label: string; render: (l: MarketplaceListing) => React.ReactNode }[] = [
    { label: 'Marketplace', render: (l) => (l.source === 'mercadolivre' ? 'Mercado Livre' : 'Shopee') },
    { label: 'Título', render: (l) => <span className="line-clamp-2">{l.title}</span> },
    { label: 'Status', render: (l) => <MLStatusBadge status={l.status} /> },
    { label: 'Preço', render: (l) => (l.price !== null ? `R$ ${l.price.toFixed(2)}` : '—') },
    { label: 'Estoque', render: (l) => String(l.stock) },
    { label: 'Vendas', render: (l) => (l.soldQuantity !== null ? String(l.soldQuantity) : '—') },
    { label: 'Health', render: (l) => (l.health !== null ? `${l.health}` : '—') },
    { label: 'Fotos', render: (l) => <PhotoCell count={l.pictureCount} /> },
    { label: 'Vídeo', render: (l) => <VideoCell has={l.videoId !== null} /> },
    { label: 'Tipo do anúncio', render: (l) => (l.listingType ? listingTypeLabel[l.listingType] ?? l.listingType : '—') },
    { label: 'Pendências', render: (l) => <PendenciasCell items={computePendencias(l)} /> },
    {
      label: 'Link',
      render: (l) =>
        l.permalink ? (
          <a href={l.permalink} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
            Abrir <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:right-0 sm:top-0 sm:inset-x-auto h-[85vh] sm:h-full w-full sm:max-w-3xl bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4" /> Comparador de Anúncios
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{product.name} · SKU {product.sku}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="p-6 overflow-x-auto">
          {linked.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Nenhum anúncio vinculado a este SKU.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap align-top w-32">
                      {row.label}
                    </td>
                    {linked.map((l) => (
                      <td key={l.itemId} className="py-2.5 px-3 align-top text-gray-800 min-w-[180px]">
                        {row.render(l)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

// ─── ML Detail Drawer ─────────────────────────────────────────────────
function MlDetailDrawer({ listing, onClose }: { listing: MarketplaceListing; onClose: () => void }) {
  const gtin = mlGtinFromAttrs(listing.attributes);
  const pendencias = computePendencias(listing);
  const hc = healthColor(listing.health);
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">Detalhes do Anúncio</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="px-6 py-4 space-y-6">
          {/* Thumbnail + title */}
          <div className="flex gap-3">
            {listing.thumbnail ? (
              <img src={listing.thumbnail} alt={listing.title} className="w-20 h-20 rounded-lg object-cover border border-gray-200 shrink-0" />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0"><ShoppingBag className="h-8 w-8 text-gray-300" /></div>
            )}
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900 leading-snug">{listing.title}</p>
              <p className="text-xs text-gray-400 font-mono mt-1">Item ID: {listing.itemId}</p>
              {listing.erpSku && <p className="text-xs text-blue-600 font-mono mt-0.5">SKU ERP: {listing.erpSku}</p>}
            </div>
          </div>

          {/* Health Score + reasons */}
          <div className={`rounded-xl p-4 ${hc.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Saúde do Anúncio</span>
              {listing.permalink && <a href={listing.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">Ver anúncio <ExternalLink className="h-3 w-3" /></a>}
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className={`text-3xl font-bold ${hc.text}`}>{listing.health !== null ? `${listing.health}%` : 'N/D'}</div>
              <div>
                <span className={`text-sm font-medium ${hc.text}`}>{hc.label}</span>
                {listing.soldQuantity !== null && <p className="text-xs text-gray-500 mt-0.5">{listing.soldQuantity} vendidos</p>}
              </div>
            </div>
            {pendencias.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Motivos:</p>
                <div className="flex flex-wrap gap-1.5">
                  {pendencias.map((p, i) => <span key={i} className="text-xs px-2 py-1 rounded-lg bg-white/70 text-gray-700 border border-gray-200">{p}</span>)}
                </div>
              </div>
            )}
          </div>

          {/* ERP link */}
          {listing.erpSku && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5"><Box className="h-4 w-4" /> ERP vinculado</h3>
              <div className="space-y-2">
                {listing.erpName && <DetailRow label="Nome ERP" value={listing.erpName} />}
                <DetailRow label="SKU ERP" value={listing.erpSku} mono />
                <DetailRow label="Estoque ERP" value={String(listing.erpStock ?? '—')} />
              </div>
            </div>
          )}

          {/* Marketplace fields */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5"><ShoppingBag className="h-4 w-4" /> Marketplace ({listing.source === 'mercadolivre' ? 'Mercado Livre' : 'Shopee'})</h3>
            <div className="space-y-2">
              <DetailRow label="Item ID" value={listing.itemId} mono />
              <DetailRow label="Status" value={listing.status === 'active' ? 'Ativo' : listing.status === 'paused' ? 'Pausado' : listing.status === 'closed' ? 'Encerrado' : '—'} />
              <DetailRow label="Estoque" value={String(listing.stock)} />
              {listing.price !== null && <DetailRow label="Preço publicado" value={`R$ ${listing.price.toFixed(2)}`} />}
              {listing.soldQuantity !== null && <DetailRow label="Qtd. vendida" value={String(listing.soldQuantity)} />}
              {listing.listingType && <DetailRow label="Tipo do anúncio" value={listingTypeLabel[listing.listingType] ?? listing.listingType} />}
              {listing.condition && <DetailRow label="Condição" value={conditionLabel[listing.condition] ?? listing.condition} />}
              {listing.categoryId && <DetailRow label="Categoria (ML)" value={listing.categoryId} />}
              <DetailRow label="Fotos" value={String(listing.pictureCount)} />
              <DetailRow label="Vídeo" value={listing.videoId ? 'Possui' : 'Não possui'} />
              {listing.freeShipping !== null && <DetailRow label="Frete grátis" value={listing.freeShipping ? 'Sim' : 'Não'} />}
              {listing.localPickUp !== null && <DetailRow label="Retirada local" value={listing.localPickUp ? 'Sim' : 'Não'} />}
              {listing.warranty && <DetailRow label="Garantia" value={listing.warranty} />}
              {listing.acceptsMercadoPago !== null && <DetailRow label="Mercado Pago" value={listing.acceptsMercadoPago ? 'Sim' : 'Não'} />}
              {listing.catalogListing !== null && <DetailRow label="Catálogo" value={listing.catalogListing ? 'Sim' : 'Não'} />}
              {gtin && <DetailRow label="GTIN (ML)" value={gtin} />}
              {listing.permalink && <DetailRow label="Permalink" value={listing.permalink} />}
              {listing.thumbnail && <DetailRow label="Thumbnail" value={listing.thumbnail} />}
              {listing.dateCreated && <DetailRow label="Criado em" value={new Date(listing.dateCreated).toLocaleDateString('pt-BR')} />}
              {listing.lastUpdated && <DetailRow label="Atualizado em" value={new Date(listing.lastUpdated).toLocaleDateString('pt-BR')} />}
              {listing.tags.length > 0 && <DetailRow label="Tags" value={listing.tags.join(', ')} />}
            </div>
            {listing.attributes.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Atributos ({listing.attributes.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {listing.attributes.map((a: MLAttribute, i: number) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-lg bg-gray-50 text-gray-600 border border-gray-200">{a.name}: {a.valueName ?? '—'}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────
export function Monitor() {
  const [tab, setTab] = useState<Tab>('erp');
  const [erpProducts, setErpProducts] = useState<ErpProduct[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [orders, setOrders] = useState<OrderMonitor[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [erpSearch, setErpSearch] = useState('');
  const [mlSearch, setMlSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('all');
  const [selectedErp, setSelectedErp] = useState<ErpProduct | null>(null);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [compareProduct, setCompareProduct] = useState<ErpProduct | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const erp = await getErpProducts();
      const ml = await getMarketplaceListings(erp);
      const [ords, ints] = await Promise.all([getOrderMonitorData(), getIntegrationStatuses()]);
      setErpProducts(erp);
      setListings(ml);
      setOrders(ords);
      setIntegrations(ints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integração não configurada.');
      setErpProducts([]);
      setListings([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const mlListings = listings.filter((l) => l.source === 'mercadolivre');

  const filteredErp = erpProducts.filter(
    (p) => p.name.toLowerCase().includes(erpSearch.toLowerCase()) || p.sku.toLowerCase().includes(erpSearch.toLowerCase())
  );
  const filteredMl = mlListings.filter(
    (l) => l.title.toLowerCase().includes(mlSearch.toLowerCase()) || (l.sku ?? '').toLowerCase().includes(mlSearch.toLowerCase()) || l.itemId.toLowerCase().includes(mlSearch.toLowerCase())
  );
  const filteredOrders = orderFilter === 'all' ? orders : orders.filter((o) => o.status === orderFilter);

  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'erp', label: 'ERP (Bling)', icon: Box, count: erpProducts.length },
    { id: 'mercadolivre', label: 'Mercado Livre', icon: ShoppingBag, count: mlListings.length },
    { id: 'shopee', label: 'Shopee', icon: ShoppingBag, count: listings.filter((l) => l.source === 'shopee').length },
    { id: 'pedidos', label: 'Pedidos', icon: Package },
    { id: 'apis', label: 'APIs', icon: Plug },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <Icon className="h-4 w-4" />
                {t.label}
                {t.count !== undefined && <span className="text-xs text-gray-400 ml-0.5">({t.count})</span>}
              </button>
            );
          })}
        </div>
        <button onClick={loadAll} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><span>⚠ {error}</span></div>
      )}

      {/* Indicators panel */}
      {!loading && !error && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <IndicatorCard label="Produtos ERP" value={erpProducts.length} icon={Box} color="text-blue-700 bg-blue-50" />
          <IndicatorCard label="Anúncios ML" value={mlListings.length} icon={ShoppingBag} color="text-yellow-700 bg-yellow-50" />
          <IndicatorCard label="Sem anúncio" value={erpProducts.filter((p) => !listings.some((l) => l.sku === p.sku)).length} icon={AlertCircle} color="text-orange-700 bg-orange-50" />
          <IndicatorCard label="Health baixo" value={mlListings.filter((l) => l.health !== null && l.health < 70).length} icon={ShieldCheck} color="text-red-700 bg-red-50" />
          <IndicatorCard label="Sem vídeo" value={mlListings.filter((l) => l.videoId === null).length} icon={AlertCircle} color="text-amber-700 bg-amber-50" />
          <IndicatorCard label="Sem GTIN" value={mlListings.filter((l) => mlGtinFromAttrs(l.attributes) === null).length} icon={Tag} color="text-purple-700 bg-purple-50" />
          <IndicatorCard label="Divergências" value={computeDivergenceCount(erpProducts, mlListings)} icon={GitCompareArrows} color="text-pink-700 bg-pink-50" />
        </div>
      )}

      {/* ERP Tab */}
      {tab === 'erp' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={erpSearch} onChange={(e) => setErpSearch(e.target.value)} placeholder="Buscar produto ou SKU..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <span className="text-xs text-gray-400">{filteredErp.length} produto(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Produto / SKU</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Estoque</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Preço</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Categoria</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Marca</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">GTIN</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Situação</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Anúncios</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded w-48" /></td>
                      {Array.from({ length: 8 }).map((__, j) => <td key={j} className="px-3 py-3 text-center"><div className="h-4 bg-gray-200 rounded w-8 mx-auto" /></td>)}
                    </tr>
                  ))
                ) : filteredErp.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">Nenhum produto encontrado</td></tr>
                ) : (
                  filteredErp.map((p) => {
                    const linkedCount = listings.filter((l) => l.sku === p.sku).length;
                    return (
                      <tr key={p.sku} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedErp(p)}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900 leading-snug">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{p.sku}</p>
                        </td>
                        <td className="px-3 py-3 text-center"><span className="text-sm font-semibold text-gray-900">{p.stock}</span></td>
                        <td className="px-3 py-3 text-center"><span className="text-xs font-medium text-gray-700">R$ {p.price.toFixed(2)}</span></td>
                        <td className="px-3 py-3 text-center"><span className="text-xs text-gray-600">{p.categoria ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center"><span className="text-xs text-gray-600">{p.marca ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center"><span className="text-xs text-gray-600 font-mono">{p.gtin ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center"><span className="text-xs text-gray-600">{p.situacao ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center">
                          {linkedCount > 0 ? <span className="text-xs font-medium text-blue-600">{linkedCount} anúncio(s)</span> : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-2 py-3 text-center"><ChevronRight className="h-4 w-4 text-gray-300" /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mercado Livre Tab */}
      {tab === 'mercadolivre' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={mlSearch} onChange={(e) => setMlSearch(e.target.value)} placeholder="Buscar anúncio, SKU ou Item ID..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <span className="text-xs text-gray-400">{filteredMl.length} anúncio(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Anúncio / Item ID</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">SKU ERP</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Status</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Estoque ML</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Est. ERP</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Preço</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Saúde</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Vendidos</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Fotos</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Vídeo</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Pendências</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded w-48" /></td>
                      {Array.from({ length: 11 }).map((__, j) => <td key={j} className="px-3 py-3 text-center"><div className="h-4 bg-gray-200 rounded w-8 mx-auto" /></td>)}
                    </tr>
                  ))
                ) : filteredMl.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-sm text-gray-400">Nenhum anúncio encontrado</td></tr>
                ) : (
                  filteredMl.map((l) => {
                    const hc = healthColor(l.health);
                    const pendencias = computePendencias(l);
                    return (
                      <tr key={l.itemId} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedListing(l)}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900 leading-snug">{l.title}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{l.itemId}</p>
                        </td>
                        <td className="px-3 py-3">
                          {l.sku ? <span className="text-xs font-mono text-blue-600">{l.sku}</span> : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center"><MLStatusBadge status={l.status} /></td>
                        <td className="px-3 py-3 text-center"><span className="text-sm font-semibold text-gray-900">{l.stock}</span></td>
                        <td className="px-3 py-3 text-center">
                          {l.erpStock !== null ? <span className="text-xs text-gray-600">{l.erpStock}</span> : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {l.price !== null ? <span className="text-xs font-medium text-gray-700">R$ {l.price.toFixed(2)}</span> : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {l.health !== null ? (
                            <div className="flex items-center gap-1.5 justify-center">
                              <span className={`h-2 w-2 rounded-full ${hc.dot}`} />
                              <span className={`text-xs font-semibold ${hc.text}`}>{l.health}%</span>
                            </div>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center"><span className="text-xs text-gray-600">{l.soldQuantity ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center"><PhotoCell count={l.pictureCount} /></td>
                        <td className="px-3 py-3 text-center"><VideoCell has={l.videoId !== null} /></td>
                        <td className="px-3 py-3 text-center"><PendenciasCell items={pendencias} /></td>
                        <td className="px-2 py-3 text-center"><ChevronRight className="h-4 w-4 text-gray-300" /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Shopee Tab — same layout as ML, placeholder until integration is configured */}
      {tab === 'shopee' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input disabled placeholder="Buscar anúncio, SKU ou Item ID..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 cursor-not-allowed" />
            </div>
            <span className="text-xs text-gray-400">0 anúncio(s)</span>
          </div>
          <div className="px-4 py-16 text-center">
            <ShoppingBag className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-sm font-medium text-gray-600">Integração com Shopee ainda não configurada</p>
            <p className="text-xs text-gray-400 mt-1.5 max-w-sm mx-auto">
              A estrutura desta aba segue o mesmo layout do Mercado Livre. Assim que a integração com Shopee for conectada,
              os anúncios aparecerão aqui automaticamente com Item ID, título, status, preço, estoque, fotos, vídeo e demais campos.
            </p>
          </div>
        </div>
      )}

      {/* Pedidos Tab */}
      {tab === 'pedidos' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Filtrar:</span>
            {['all', 'new', 'paid', 'awaiting_nf', 'separating', 'shipped', 'delivered', 'stopped'].map((f) => (
              <button key={f} onClick={() => setOrderFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${orderFilter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                {f === 'all' ? 'Todos' : ORDER_STATUS_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Pedido</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">Canal</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-3 py-3">Comprador</th>
                  <th className="text-right text-xs font-semibold text-gray-500 px-3 py-3">Total</th>
                  <th className="text-center text-xs font-semibold text-gray-500 px-3 py-3">Status</th>
                  <th className="text-right text-xs font-semibold text-gray-500 px-4 py-3">Criado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredOrders.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">Nenhum pedido encontrado</td></tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id} className={`hover:bg-gray-50 transition-colors ${o.status === 'stopped' ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-mono font-medium text-gray-900">{o.id}</p>
                        {o.status === 'stopped' && o.daysStopped != null && <p className="text-xs text-red-600 flex items-center gap-1 mt-0.5"><AlertCircle className="h-3 w-3" /> Parado há {o.daysStopped} dia(s)</p>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${o.marketplace === 'mercadolivre' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : o.marketplace === 'shopee' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                          {o.marketplace === 'mercadolivre' ? 'Mercado Livre' : o.marketplace === 'shopee' ? 'Shopee' : 'Bling'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">{o.buyerName}</td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900">{o.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      <td className="px-3 py-3 text-center"><span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${ORDER_STATUS_COLORS[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span></td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">{new Date(o.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* APIs Tab */}
      {tab === 'apis' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {loading ? [1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-5 w-28 bg-gray-200 rounded mb-4" />
              <div className="space-y-2">{[1, 2, 3, 4].map((j) => <div key={j} className="h-4 bg-gray-100 rounded" />)}</div>
            </div>
          )) : integrations.map((int) => (
            <div key={int.source} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">{int.label}</h3>
                <span className={`h-3 w-3 rounded-full ${!int.tokenConfigured ? 'bg-gray-300' : int.connected ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>
              <div className="space-y-3">
                <Row label="Token" value={int.tokenConfigured ? 'Configurado' : 'Não configurado'} ok={int.tokenConfigured} />
                <Row label="Status" value={int.connected ? 'Conectado' : int.tokenConfigured ? 'Erro' : 'Sem token'} ok={int.connected} />
                <Row label="Última sync" value={int.lastSync ? new Date(int.lastSync).toLocaleString('pt-BR') : 'Nunca'} ok={Boolean(int.lastSync)} />
                <Row label="Tempo médio" value={int.responseMs != null ? `${int.responseMs}ms` : '—'} ok={int.responseMs != null && int.responseMs < 1000} />
                <Row label="Erros recentes" value={String(int.errorCount)} ok={int.errorCount === 0} />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedErp && (
        <ErpDetailDrawer
          product={selectedErp}
          listings={listings}
          onClose={() => setSelectedErp(null)}
          onCompare={(p) => { setCompareProduct(p); setSelectedErp(null); }}
        />
      )}
      {selectedListing && <MlDetailDrawer listing={selectedListing} onClose={() => setSelectedListing(null)} />}
      {compareProduct && <ComparatorDrawer product={compareProduct} listings={listings} onClose={() => setCompareProduct(null)} />}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {ok ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <MinusCircle className="h-3.5 w-3.5 text-gray-300" />}
        <span className="text-xs font-medium text-gray-700">{value}</span>
      </div>
    </div>
  );
}
