import { getCredentials, getTokens, saveTokens, acquireRefreshLock, releaseRefreshLock } from './db.ts';
import { httpRequest } from './http-client.ts';
import { hmacSha256Hex } from './shopee-sign.ts';

const HOST = 'https://partner.shopeemobile.com';

export interface ShopeeListing {
  itemId: number;
  // BLOCO 2 (correção de auditoria — item 3.2): sku agora é `string | null`.
  // O item_sku vazio ("") da Shopee NÃO é mais tratado como "ausente ??
  // usa item_id" — isso causava falso "produto órfão".
  sku: string | null;
  name: string;
  stock: number;
  status: 'NORMAL' | 'BANNED' | 'DELETED' | 'UNLIST';
}

type Auth = { token: string; shopId: string; partnerId: string; partnerKey: string };
export type AuthResult = Auth | { error: string };

export async function refreshIfNeeded(): Promise<AuthResult> {
  const tokens = await getTokens('shopee');
  const creds = await getCredentials('shopee');
  if (!creds?.client_id || !creds?.client_secret) return { error: 'Credenciais da Shopee não configuradas.' };
  if (!tokens?.access_token || !tokens.shop_id) return { error: 'Integração não configurada.' };

  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) {
    return { token: tokens.access_token, shopId: tokens.shop_id, partnerId: creds.client_id, partnerKey: creds.client_secret };
  }
  if (!tokens.refresh_token) return { error: 'Token da Shopee expirado e sem refresh_token. Refaça a conexão OAuth.' };

  // BLOCO 4 (item 3.3): lock otimista de refresh.
  const gotLock = await acquireRefreshLock('shopee');
  if (!gotLock) {
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await getTokens('shopee');
    if (fresh?.access_token && fresh.expires_at && new Date(fresh.expires_at).getTime() - Date.now() > 0 && fresh.shop_id) {
      return { token: fresh.access_token, shopId: fresh.shop_id, partnerId: creds.client_id, partnerKey: creds.client_secret };
    }
    return { error: 'Renovação de token da Shopee em andamento por outra chamada; tente novamente em alguns segundos.' };
  }

  try {
    const path = '/api/v2/auth/access_token/get';
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = await hmacSha256Hex(creds.client_secret, `${creds.client_id}${path}${timestamp}`);

    const result = await httpRequest<{ access_token: string; refresh_token: string; expire_in: number }>(
      `${HOST}${path}?partner_id=${creds.client_id}&timestamp=${timestamp}&sign=${sign}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: tokens.refresh_token, shop_id: Number(tokens.shop_id), partner_id: Number(creds.client_id) }),
        source: 'shopee',
        operation: 'oauth_refresh',
      }
    );

    if (!result.ok || !result.data?.access_token) {
      return { error: `Falha ao renovar token da Shopee: ${result.error ?? 'resposta inválida'}` };
    }

    await saveTokens('shopee', {
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_at: new Date(Date.now() + result.data.expire_in * 1000).toISOString(),
      shop_id: tokens.shop_id,
    });

    return { token: result.data.access_token, shopId: tokens.shop_id, partnerId: creds.client_id, partnerKey: creds.client_secret };
  } finally {
    await releaseRefreshLock('shopee');
  }
}

async function signedUrl(path: string, auth: Auth, extraParams: Record<string, string> = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = await hmacSha256Hex(auth.partnerKey, `${auth.partnerId}${path}${timestamp}${auth.token}${auth.shopId}`);
  const url = new URL(`${HOST}${path}`);
  url.searchParams.set('partner_id', auth.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  url.searchParams.set('access_token', auth.token);
  url.searchParams.set('shop_id', auth.shopId);
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  return url.toString();
}

export async function testConnection(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, ms: 0, error: auth.error };
  const url = await signedUrl('/api/v2/shop/get_shop_info', auth);
  const result = await httpRequest(url, { source: 'shopee', operation: 'test_connection' });
  return { ok: result.ok, ms: result.ms, error: result.error };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// BLOCO 3 (correção de auditoria — item 3.1): paginação completa.
// get_item_list: paginamos incrementando `offset` até a página vir com
// menos itens que `page_size` (condição de parada conservadora que não
// depende de conhecer o nome exato de um eventual campo `has_next_page` —
// não confirmei esse campo na documentação oficial nesta sessão sem
// internet, então preferi não presumir o nome exato).
// get_item_base_info: fatiado em lotes — usei 50 itens por lote como valor
// conservador; NÃO consegui confirmar com certeza o limite oficial exato da
// sua versão da API nesta sessão. Validar com uma chamada real antes de
// produção e ajustar BATCH_SIZE se a Shopee retornar erro de "too many ids".
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // teto de segurança
const BATCH_SIZE = 50;

export async function getListings(): Promise<{ ok: true; data: ShopeeListing[] } | { ok: false; error: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };

  const allIds: number[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const listUrl = await signedUrl('/api/v2/product/get_item_list', auth, { offset: String(offset), page_size: String(PAGE_SIZE), item_status: 'NORMAL' });
    const listRes = await httpRequest<{ response: { item: Array<{ item_id: number }> } }>(listUrl, { source: 'shopee', operation: 'get_listings' });
    if (!listRes.ok) return { ok: false, error: listRes.error ?? 'erro desconhecido' };
    const pageItems = listRes.data?.response?.item ?? [];
    allIds.push(...pageItems.map((i) => i.item_id));
    if (pageItems.length < PAGE_SIZE) break;
  }
  if (!allIds.length) return { ok: true, data: [] };

  const listings: ShopeeListing[] = [];
  for (const batch of chunk(allIds, BATCH_SIZE)) {
    const detailUrl = await signedUrl('/api/v2/product/get_item_base_info', auth, { item_id_list: batch.join(',') });
    const detailRes = await httpRequest<{ response: { item_list: Array<Record<string, unknown>> } }>(detailUrl, { source: 'shopee', operation: 'get_listings_detail' });
    if (!detailRes.ok) return { ok: false, error: detailRes.error ?? 'erro desconhecido' };

    // NOTA: item_sku aqui é o SKU em nível de item (sem variação). Para
    // produtos com variação (models), o SKU real fica em cada model — seria
    // necessário chamar get_model_list por item. Não fiz essa chamada extra
    // para não presumir a estrutura de variações da conta.
    for (const it of detailRes.data?.response?.item_list ?? []) {
      const skuRaw = typeof it.item_sku === 'string' ? it.item_sku.trim() : '';
      listings.push({
        itemId: Number(it.item_id),
        sku: skuRaw ? skuRaw : null,
        name: String(it.item_name ?? ''),
        stock: Number((it as { stock_info_v2?: { summary_info?: { total_available_stock?: number } } }).stock_info_v2?.summary_info?.total_available_stock ?? 0),
        status: String(it.item_status ?? 'DELETED') as ShopeeListing['status'],
      });
    }
  }
  return { ok: true, data: listings };
}

export async function updateStock(itemId: number, quantity: number): Promise<{ ok: boolean; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };
  const url = await signedUrl('/api/v2/product/update_stock', auth);
  const result = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, stock_list: [{ model_id: 0, seller_stock: [{ stock: quantity }] }] }),
    source: 'shopee',
    operation: 'update_stock',
  });
  return { ok: result.ok, error: result.error };
}

export async function unlistItem(itemId: number): Promise<{ ok: boolean; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };
  const url = await signedUrl('/api/v2/product/unlist_item', auth);
  const result = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_list: [{ item_id: itemId, unlist: true }] }),
    source: 'shopee',
    operation: 'unlist_item',
  });
  return { ok: result.ok, error: result.error };
}
