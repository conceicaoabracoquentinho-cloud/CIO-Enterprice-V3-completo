import { getCredentials, getTokens, saveTokens, acquireRefreshLock, releaseRefreshLock } from './db.ts';
import { httpRequest } from './http-client.ts';

const API_BASE = 'https://api.bling.com.br/Api/v3';

export interface BlingProduct {
  id: string;
  sku: string;
  name: string;
  stock: number;
  price: number;
  hasPhoto: boolean;
  hasDescription: boolean;
  photoCount: number;
  descriptionText: string | null;
  categoria: string | null;
  marca: string | null;
  gtin: string | null;
  peso: number | null;
  situacao: string | null;
  ncm: string | null;
  precoCusto: number | null;
  tipo: string | null;
  unidade: string | null;
}

export type AuthResult = { token: string } | { error: string };

export async function refreshIfNeeded(): Promise<AuthResult> {
  const tokens = await getTokens('bling');
  if (!tokens?.access_token) return { error: 'Integração não configurada.' };

  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return { token: tokens.access_token };

  if (!tokens.refresh_token) return { error: 'Token do Bling expirado e sem refresh_token. Refaça a conexão OAuth.' };

  // BLOCO 4 (item 3.3): lock otimista de refresh — mesma lógica do ml.ts.
  const gotLock = await acquireRefreshLock('bling');
  if (!gotLock) {
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await getTokens('bling');
    if (fresh?.access_token && fresh.expires_at && new Date(fresh.expires_at).getTime() - Date.now() > 0) {
      return { token: fresh.access_token };
    }
    return { error: 'Renovação de token do Bling em andamento por outra chamada; tente novamente em alguns segundos.' };
  }

  try {
    const creds = await getCredentials('bling');
    if (!creds?.client_id || !creds?.client_secret) return { error: 'Credenciais do Bling não configuradas.' };

    const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
    const result = await httpRequest<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${API_BASE}/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0', Authorization: `Basic ${basic}` },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokens.refresh_token)}`,
        source: 'bling',
        operation: 'oauth_refresh',
      }
    );

    if (!result.ok || !result.data?.access_token) {
      return { error: `Falha ao renovar token do Bling: ${result.error ?? 'resposta inválida'}` };
    }

    await saveTokens('bling', {
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_at: new Date(Date.now() + result.data.expires_in * 1000).toISOString(),
    });

    return { token: result.data.access_token };
  } finally {
    await releaseRefreshLock('bling');
  }
}

export async function testConnection(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, ms: 0, error: auth.error };
  const result = await httpRequest(`${API_BASE}/produtos?limite=1`, { headers: { Authorization: `Bearer ${auth.token}` }, source: 'bling', operation: 'test_connection' });
  return { ok: result.ok, ms: result.ms, error: result.error };
}

// BLOCO 3 (correção de auditoria — item 3.1): paginação completa.
// A API v3 do Bling não devolve um total explícito no envelope de /produtos;
// o padrão documentado é paginar incrementando `pagina` até a página vir com
// menos itens que `limite` (ou vazia). Um teto de segurança (MAX_PAGES) evita
// loop infinito caso a API se comporte de forma inesperada.
const PAGE_SIZE = 100;
const MAX_PAGES = 500; // teto de segurança (até 50.000 registros)

async function paginateBling<T>(path: string, token: string, operation: string): Promise<{ ok: true; data: T[] } | { ok: false; error: string }> {
  const all: T[] = [];
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const sep = path.includes('?') ? '&' : '?';
    const result = await httpRequest<{ data: T[] }>(
      `${API_BASE}${path}${sep}limite=${PAGE_SIZE}&pagina=${pagina}`,
      { headers: { Authorization: `Bearer ${token}` }, source: 'bling', operation }
    );
    if (!result.ok) return { ok: false, error: result.error ?? 'erro desconhecido' };
    const page = result.data?.data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { ok: true, data: all };
}

export async function getProducts(): Promise<{ ok: true; data: BlingProduct[] } | { ok: false; error: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };

  const result = await paginateBling<Record<string, unknown>>('/produtos', auth.token, 'get_products');
  if (!result.ok) return result;

  // ATENÇÃO: os nomes de campo abaixo (codigo, descricao, preco, imagens,
  // descricaoComplementar) seguem o padrão documentado do recurso /produtos
  // da API v3, mas o campo de estoque disponível pode vir aninhado
  // (ex: objeto "estoque") dependendo do plano/conta Bling. Confirme o
  // schema exato com uma chamada real (Testar Conexão) e ajuste se preciso.
  const products: BlingProduct[] = result.data.map((p) => {
    const estoqueField = p.estoque as { saldoVirtualTotal?: number } | undefined;
    const stock = Number((p as { estoqueAtual?: number }).estoqueAtual ?? estoqueField?.saldoVirtualTotal ?? 0);
    const imagens = Array.isArray(p.imagens) ? (p.imagens as unknown[]) : [];
    const descComp = typeof p.descricaoComplementar === 'string' ? p.descricaoComplementar.trim() : '';
    const categoriaObj = p.categoria as { descricao?: string } | undefined;
    return {
      id: String(p.id ?? ''),
      sku: String(p.codigo ?? ''),
      name: String(p.descricao ?? ''),
      stock,
      price: Number(p.preco ?? 0),
      hasPhoto: imagens.length > 0,
      hasDescription: descComp.length > 0,
      photoCount: imagens.length,
      descriptionText: descComp || null,
      categoria: categoriaObj?.descricao ?? null,
      marca: typeof p.marca === 'string' ? p.marca : null,
      gtin: typeof p.gtin === 'string' ? p.gtin : null,
      peso: p.pesoLiq != null ? Number(p.pesoLiq) : null,
      situacao: typeof p.situacao === 'string' ? p.situacao : null,
      ncm: typeof p.ncm === 'string' ? p.ncm : null,
      precoCusto: p.precoCusto != null ? Number(p.precoCusto) : null,
      tipo: typeof p.tipo === 'string' ? p.tipo : null,
      unidade: typeof p.unidade === 'string' ? p.unidade : null,
    };
  });
  return { ok: true, data: products };
}

export async function getOrders(): Promise<{ ok: true; data: Array<Record<string, unknown>> } | { ok: false; error: string }> {
  const auth = await refreshIfNeeded();
  if ('error' in auth) return { ok: false, error: auth.error };
  return paginateBling<Record<string, unknown>>('/pedidos/vendas', auth.token, 'get_orders');
}
