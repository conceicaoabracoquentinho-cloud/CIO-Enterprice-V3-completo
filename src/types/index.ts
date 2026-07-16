export type Priority = 'critical' | 'high' | 'medium' | 'informative';
export type DivergenceType = 'stock' | 'title' | 'status' | 'photo' | 'description' | 'price' | 'orphan' | 'unlinked_sku';
export type Marketplace = 'mercadolivre' | 'shopee' | 'both';
export type SyncStatus = 'success' | 'error' | 'partial';
export type AuditResult = 'success' | 'error' | 'partial' | 'info';
export type IntegrationSource = 'bling' | 'mercadolivre' | 'shopee' | 'system';

export interface SyncLog {
  id: string;
  created_at: string;
  source: IntegrationSource;
  operation: string;
  status: SyncStatus;
  duration_ms: number | null;
  details: Record<string, unknown>;
}

export interface Divergence {
  id: string;
  created_at: string;
  updated_at: string;
  product_name: string;
  sku: string;
  divergence_type: DivergenceType;
  priority: Priority;
  erp_value: string | null;
  ml_value: string | null;
  shopee_value: string | null;
  recommended_action: string;
  marketplace: Marketplace;
  ml_item_id: string | null;
  shopee_item_id: string | null;
  resolved: boolean;
  resolved_at: string | null;
  ignored: boolean;
}

export interface AuditRecord {
  id: string;
  created_at: string;
  module: string;
  description: string;
  result: AuditResult;
  details: Record<string, unknown>;
}

export interface IntegrationStatus {
  source: IntegrationSource;
  label: string;
  connected: boolean;
  lastSync: string | null;
  responseMs: number | null;
  errorCount: number;
  tokenConfigured: boolean;
}

export interface MLAttribute {
  id: string;
  name: string;
  valueName: string | null;
}

export type ListingStatus = 'active' | 'paused' | 'closed' | 'not_listed';

export interface ErpProduct {
  sku: string;
  name: string;
  stock: number;
  price: number;
  precoCusto: number | null;
  categoria: string | null;
  marca: string | null;
  gtin: string | null;
  peso: number | null;
  situacao: string | null;
  ncm: string | null;
  tipo: string | null;
  unidade: string | null;
  photoCount: number;
  hasPhoto: boolean;
  descriptionText: string | null;
  hasDescription: boolean;
}

export type MarketplaceSource = 'mercadolivre' | 'shopee';

export interface MarketplaceListing {
  itemId: string;
  sku: string | null;
  source: MarketplaceSource;
  title: string;
  stock: number;
  status: ListingStatus;
  price: number | null;
  soldQuantity: number | null;
  health: number | null;
  permalink: string | null;
  thumbnail: string | null;
  pictureCount: number;
  videoId: string | null;
  listingType: string | null;
  condition: string | null;
  categoryId: string | null;
  freeShipping: boolean | null;
  localPickUp: boolean | null;
  warranty: string | null;
  acceptsMercadoPago: boolean | null;
  catalogListing: boolean | null;
  attributes: MLAttribute[];
  tags: string[];
  dateCreated: string | null;
  lastUpdated: string | null;
  erpSku: string | null;
  erpName: string | null;
  erpStock: number | null;
}

export interface OrderMonitor {
  id: string;
  marketplace: 'mercadolivre' | 'shopee' | 'bling';
  status: 'new' | 'paid' | 'awaiting_nf' | 'separating' | 'shipped' | 'delivered' | 'stopped';
  buyerName: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  daysStopped?: number;
}

export interface ConciliationResult {
  updated: number;
  // Renomeado de "ignored" para "manualReview" (correção de auditoria,
  // AUDIT_REPORT.md seção 7): esta contagem é sobre divergências que exigem
  // revisão manual nesta rodada (photo/description/unlinked_sku), um
  // conceito diferente da coluna `divergences.ignored` do banco (que
  // significa "usuário marcou para nunca mais mostrar").
  manualReview: number;
  errors: number;
  durationMs: number;
  details: Array<{ sku: string; status: 'success' | 'error' | 'manual_review'; message: string }>;
}

export interface UpdateIntegrationsResult {
  bling: { success: boolean; durationMs: number; error?: string };
  mercadolivre: { success: boolean; durationMs: number; error?: string };
  shopee: { success: boolean; durationMs: number; error?: string };
  totalDurationMs: number;
}
