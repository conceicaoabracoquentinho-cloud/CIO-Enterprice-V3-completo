import { getCredentials, getTokens, saveTokens, acquireRefreshLock, releaseRefreshLock } from './db.ts';
import { httpRequest } from './http-client.ts';

const API_BASE = 'https://api.mercadolibre.com';

export interface MLListing {
  itemId: string;
  sku: string | null;
  title: string;
  stock: number;
  status: 'active' | 'paused' | 'closed';
  price: number;
  soldQuantity: number;
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
  attributes: Array<{ id: string; name: string; valueName: string | null }>;
  tags: string[];
  dateCreated: string | null;
  lastUpdated: string | null;
}

export type AuthResult = { token: string; sellerId: string } | { error: string };

export async function refreshIfNeeded(): Promise<AuthResult> {
  const tokens = await getTokens('mercadolivre');
  if (!tokens?.access_token) return { error: 'Integração não configurada.' };

  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return { token: tokens.access_token, sellerId: tokens.shop_id ?? '' };

  if (!tokens.refresh_token) return { error: 'Token do Mercado Livre expirado e sem refresh_token. Refaça a conexão OAuth.' };

  // BLOCO 4 (item 3.3): lock otimista — só quem conseguir o lock renova.
  const gotLock = await acquireRefreshLock('mercadolivre');
  if (!gotLock) {
    // Outra instância já está renovando; aguarda um instante e relê o token.
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await getTokens('mercadolivre');
    if (fresh?.access_token && fresh.expires_at && new Date(fresh.expires_at).getTime() - Date.now() > 0) {
      return { token: fresh.access_token, sellerId: fresh.shop_id ?? '' };
    }
    return { error: 'Renovação de token do Mercado Livre em andamento por outra chamada; tente novamente em alguns segundos.' };
  }

  try {
    const creds = await getCredentials('mercadolivre');
    if (!creds?.client_id || !creds?.client_secret) return { error: 'Credenciais do Mercado Livre não configuradas.' };

    const result = await httpRequest<{ access_token: string; refresh_token: string; expires_in: number; user_id: number }>(
      `${API_BASE}/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          refresh_token: tokens.refresh_token,
        }).toString(),
        source: 'mercadolivre',
        operation: 'oauth_refresh',
      }
    );

    if (!result.ok || !result.data?.access_token) {
      return { error: `Falha ao renovar token do Mercado Livre: ${result.error ?? 'resposta inválida'}` };
    }

    await saveTokens('mercadolivre', {
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_at: new Date(Date.now() + result.data.expires_in * 1000).toISOString(),
      shop_id: String(result.data.user_id),
    });

    return { token: result.data.access_token, sellerId: String(result.data.user_id) };
  } finally {
    await releaseRefreshLock('mercadolivre');
  }
}

export async function testConnection(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, ms: 0, error: auth.error };
  const result = await httpRequest(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${auth.token}` }, source: 'mercadolivre', operation: 'test_connection' });
  return { ok: result.ok, ms: result.ms, error: result.error };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// BLOCO 3 (correção de auditoria — item 3.1): paginação completa.
// - /items/search: pagina por offset/limit até `paging.total` (limite da API
//   baseada em offset é 1000 registros — catálogos maiores exigiriam
//   search_type=scan com scroll_id, que NÃO implementei aqui para não
//   inventar um fluxo que não pude validar nesta sessão sem internet; fica
//   documentado como limitação restante caso a conta tenha >1000 anúncios).
// - /items (multiget): a API aceita no máximo 20 ids por chamada — agora
//   fatiamos em lotes de 20 e buscamos todos, em vez de descartar o resto.
const SEARCH_PAGE_LIMIT = 100;
const MAX_OFFSET_DEPTH = 1000; // limite documentado da busca por offset
const MULTIGET_BATCH_SIZE = 20;

export async function getListings(): Promise<{ ok: true; data: MLListing[]; truncated?: boolean } | { ok: false; error: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };
  const headers = { Authorization: `Bearer ${auth.token}` };

  const allIds: string[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < MAX_OFFSET_DEPTH) {
    const searchRes = await httpRequest<{ results: string[]; paging: { total: number } }>(
      `${API_BASE}/users/${auth.sellerId}/items/search?limit=${SEARCH_PAGE_LIMIT}&offset=${offset}`,
      { headers, source: 'mercadolivre', operation: 'get_listings_search' }
    );
    if (!searchRes.ok) return { ok: false, error: searchRes.error ?? 'erro desconhecido' };
    const page = searchRes.data?.results ?? [];
    allIds.push(...page);
    total = searchRes.data?.paging?.total ?? page.length;
    offset += SEARCH_PAGE_LIMIT;
    if (page.length === 0) break;
  }
  const truncated = total > MAX_OFFSET_DEPTH;

  if (!allIds.length) return { ok: true, data: [], truncated };

  const listings: MLListing[] = [];
  for (const batch of chunk(allIds, MULTIGET_BATCH_SIZE)) {
    const detailRes = await httpRequest<Array<{ body: Record<string, unknown> }>>(
      `${API_BASE}/items?ids=${batch.join(',')}`,
      { headers, source: 'mercadolivre', operation: 'get_listings_detail' }
    );
    if (!detailRes.ok) return { ok: false, error: detailRes.error ?? 'erro desconhecido' };

    for (const { body: b } of detailRes.data ?? []) {
      const attrs = (b.attributes as Array<{ id: string; name: string; value_name: string | null }> | undefined) ?? [];
      const skuAttr = attrs.find((a) => a.id === 'SELLER_SKU');
      const skuValue = skuAttr?.value_name?.trim();
      const pictures = Array.isArray(b.pictures) ? (b.pictures as unknown[]) : [];
      const shipping = b.shipping as { free_shipping?: boolean; local_pick_up?: boolean } | undefined;
      const tags = Array.isArray(b.tags) ? (b.tags as string[]) : [];
      listings.push({
        itemId: String(b.id ?? ''),
        sku: skuValue ? skuValue : null,
        title: String(b.title ?? ''),
        stock: Number(b.available_quantity ?? 0),
        status: String(b.status ?? 'closed') as MLListing['status'],
        price: Number(b.price ?? 0),
        soldQuantity: Number(b.sold_quantity ?? 0),
        health: b.health != null ? Number(b.health) : null,
        permalink: typeof b.permalink === 'string' ? b.permalink : null,
        thumbnail: typeof b.thumbnail === 'string' ? b.thumbnail : null,
        pictureCount: pictures.length,
        videoId: typeof b.video_id === 'string' && b.video_id ? b.video_id : null,
        listingType: typeof b.listing_type_id === 'string' ? b.listing_type_id : null,
        condition: typeof b.condition === 'string' ? b.condition : null,
        categoryId: typeof b.category_id === 'string' ? b.category_id : null,
        freeShipping: shipping?.free_shipping ?? null,
        localPickUp: shipping?.local_pick_up ?? null,
        warranty: typeof b.warranty === 'string' && b.warranty ? b.warranty : null,
        acceptsMercadoPago: b.accept_mercadopago ?? null,
        catalogListing: b.catalog_listing ?? null,
        attributes: attrs.map((a) => ({ id: a.id, name: a.name ?? a.id, valueName: a.value_name ?? null })),
        tags,
        dateCreated: typeof b.date_created === 'string' ? b.date_created : null,
        lastUpdated: typeof b.last_updated === 'string' ? b.last_updated : null,
      });
    }
  }
  return { ok: true, data: listings, truncated };
}

export async function updateStock(itemId: string, quantity: number): Promise<{ ok: boolean; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };
  const result = await httpRequest(`${API_BASE}/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ available_quantity: quantity }),
    source: 'mercadolivre',
    operation: 'update_stock',
  });
  return { ok: result.ok, error: result.error };
}

export async function closeListing(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };
  const result = await httpRequest(`${API_BASE}/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'closed' }),
    source: 'mercadolivre',
    operation: 'close_listing',
  });
  return { ok: result.ok, error: result.error };
}
