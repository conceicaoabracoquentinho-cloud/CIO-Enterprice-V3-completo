// ─── Módulo 08 — Explorador de API / Matriz de Utilização ───────────────
// Este catálogo é gerado a partir de uma auditoria manual do código real
// (supabase/functions/_shared/bling.ts, ml.ts, shopee.ts) — não é uma
// introspecção automática da API (isso exigiria consultar a documentação
// de cada provedor em tempo real, o que está fora do escopo desta fase).
// Sempre que um campo novo for capturado ou um módulo passar a usar um
// campo já existente, este arquivo deve ser atualizado manualmente.

export interface ApiField {
  field: string;
  capturedAs: string; // nome interno usado no código
  usedIn: string[]; // páginas/módulos que já usam este campo hoje
  status: 'em_uso' | 'capturado_nao_usado';
}

export interface ApiCatalogEntry {
  source: 'bling' | 'mercadolivre' | 'shopee';
  label: string;
  fields: ApiField[];
}

export const API_CATALOG: ApiCatalogEntry[] = [
  {
    source: 'bling', label: 'Bling (ERP)',
    fields: [
      { field: 'codigo', capturedAs: 'sku', usedIn: ['Monitorar', 'Precificação', 'Financeiro', 'Inteligência', 'Relatórios', 'Conciliação'], status: 'em_uso' },
      { field: 'descricao', capturedAs: 'name', usedIn: ['Monitorar', 'Precificação', 'Financeiro', 'Relatórios'], status: 'em_uso' },
      { field: 'preco', capturedAs: 'price', usedIn: ['Precificação', 'Financeiro', 'Relatórios'], status: 'em_uso' },
      { field: 'precoCusto', capturedAs: 'precoCusto', usedIn: ['Precificação', 'Financeiro', 'Inteligência'], status: 'em_uso' },
      { field: 'estoque.saldoVirtualTotal', capturedAs: 'stock', usedIn: ['Monitorar', 'Financeiro', 'Dashboard', 'Conciliação'], status: 'em_uso' },
      { field: 'categoria.descricao', capturedAs: 'categoria', usedIn: ['Monitorar', 'Relatórios'], status: 'em_uso' },
      { field: 'marca', capturedAs: 'marca', usedIn: ['Monitorar', 'Relatórios'], status: 'em_uso' },
      { field: 'gtin', capturedAs: 'gtin', usedIn: ['Monitorar', 'Relatórios'], status: 'em_uso' },
      { field: 'ncm', capturedAs: 'ncm', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'pesoLiq', capturedAs: 'peso', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'situacao', capturedAs: 'situacao', usedIn: ['Monitorar', 'Relatórios'], status: 'em_uso' },
      { field: 'unidade', capturedAs: 'unidade', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'pedidos (getOrders)', capturedAs: 'raw (não tipado)', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'fornecedor', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'depósitos (por armazém)', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
    ],
  },
  {
    source: 'mercadolivre', label: 'Mercado Livre',
    fields: [
      { field: 'id', capturedAs: 'itemId', usedIn: ['Monitorar', 'Precificação', 'Financeiro', 'Conciliação'], status: 'em_uso' },
      { field: 'title', capturedAs: 'title', usedIn: ['Monitorar', 'Relatórios'], status: 'em_uso' },
      { field: 'price', capturedAs: 'price', usedIn: ['Precificação', 'Financeiro', 'Dashboard', 'Inteligência'], status: 'em_uso' },
      { field: 'available_quantity', capturedAs: 'stock', usedIn: ['Monitorar', 'Conciliação'], status: 'em_uso' },
      { field: 'status', capturedAs: 'status', usedIn: ['Monitorar', 'Dashboard'], status: 'em_uso' },
      { field: 'health', capturedAs: 'health', usedIn: ['Monitorar', 'Dashboard'], status: 'em_uso' },
      { field: 'sold_quantity', capturedAs: 'soldQuantity', usedIn: ['Precificação', 'Financeiro', 'Inteligência', 'Relatórios'], status: 'em_uso' },
      { field: 'pictures (length)', capturedAs: 'pictureCount', usedIn: ['Monitorar', 'Dashboard'], status: 'em_uso' },
      { field: 'video_id', capturedAs: 'videoId', usedIn: ['Monitorar', 'Dashboard'], status: 'em_uso' },
      { field: 'date_created', capturedAs: 'dateCreated', usedIn: ['Financeiro (Estoque Inteligente)'], status: 'em_uso' },
      { field: 'permalink', capturedAs: 'permalink', usedIn: ['Monitorar', 'Relatórios'], status: 'em_uso' },
      { field: 'listing_type_id', capturedAs: 'listingType', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'category_id', capturedAs: 'categoryId', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'warranty', capturedAs: 'warranty', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'condition', capturedAs: 'condition', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'attributes', capturedAs: 'attributes', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'tags', capturedAs: 'tags', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'descrição completa (texto)', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'visitas (visits API)', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'perguntas (questions API)', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'publicidade / campanhas', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
    ],
  },
  {
    source: 'shopee', label: 'Shopee',
    fields: [
      { field: 'item_id', capturedAs: 'itemId', usedIn: ['Monitorar', 'Conciliação'], status: 'em_uso' },
      { field: 'item_sku', capturedAs: 'sku', usedIn: ['Monitorar', 'Conciliação'], status: 'em_uso' },
      { field: 'item_name', capturedAs: 'name', usedIn: ['Monitorar'], status: 'em_uso' },
      { field: 'stock', capturedAs: 'stock', usedIn: ['Monitorar', 'Dashboard'], status: 'em_uso' },
      { field: 'item_status', capturedAs: 'status', usedIn: ['Monitorar', 'Dashboard'], status: 'em_uso' },
      { field: 'preço', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'fotos / vídeo', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'descrição', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'qualidade do anúncio (equivalente a health)', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'vendas', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
      { field: 'categoria', capturedAs: '—', usedIn: [], status: 'capturado_nao_usado' },
    ],
  },
];
