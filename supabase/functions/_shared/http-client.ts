import { insertSyncLog, serviceClient } from './db.ts';

// Camada HTTP ÚNICA usada por Bling, Mercado Livre e Shopee.
// Exigência do contrato: retry, timeout, rate limit, logs, tratamento de erro,
// tudo centralizado — nenhuma integração deve reimplementar isso por conta própria.

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  source: 'bling' | 'mercadolivre' | 'shopee';
  operation: string;
}

export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  ms: number;
}

// BLOCO 4 (correção de auditoria — item 3.4): o limiter anterior era um
// objeto em memória do módulo, que não é confiável entre instâncias/cold
// starts de Edge Function. Agora o contador vive no Postgres
// (increment_rate_limit, ver migration 20260706000000) — uma única
// instrução UPDATE atômica compartilhada por qualquer instância que rodar.
const MAX_PER_SECOND: Record<string, number> = {
  bling: 3,
  mercadolivre: 8,
  shopee: 8,
};

async function respectRateLimit(source: string) {
  const max = MAX_PER_SECOND[source] ?? 5;
  for (let i = 0; i < 20; i++) {
    try {
      const db = serviceClient();
      const { data: count, error } = await db.rpc('increment_rate_limit', { p_source: source });
      if (error) return;
      if ((count as number) <= max) return;
    } catch {
      // Se o client/RPC falhar por qualquer motivo (env vars ausentes,
      // migration não aplicada, rede indisponível), não bloqueia a chamada
      // real — degrada sem rate limit em vez de derrubar a integração.
      return;
    }
    await new Promise((r) => setTimeout(r, 1000 / max));
  }
}

export async function httpRequest<T = unknown>(url: string, opts: RequestOptions): Promise<HttpResult<T>> {
  const { method = 'GET', headers = {}, body, timeoutMs = 10000, retries = 2, source, operation } = opts;
  let attempt = 0;
  let lastError = '';
  const t0 = Date.now();

  while (attempt <= retries) {
    await respectRateLimit(source);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      clearTimeout(timeout);
      const ms = Date.now() - t0;
      const text = await res.text();
      let data: T | null = null;
      try {
        data = text ? (JSON.parse(text) as T) : null;
      } catch {
        data = text as unknown as T;
      }

      if (res.status === 429 && attempt < retries) {
        // Rate limited pela própria API — espera exponencial e tenta de novo.
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        attempt++;
        continue;
      }

      if (!res.ok) {
        await insertSyncLog({
          source,
          operation,
          status: 'error',
          duration_ms: ms,
          details: { url, status: res.status, response: data },
        });
        return { ok: false, status: res.status, data, error: `HTTP ${res.status}`, ms };
      }

      await insertSyncLog({ source, operation, status: 'success', duration_ms: ms, details: { url, status: res.status } });
      return { ok: true, status: res.status, data, ms };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err.message : 'Erro de conexão';
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
        attempt++;
        continue;
      }
      const ms = Date.now() - t0;
      await insertSyncLog({ source, operation, status: 'error', duration_ms: ms, details: { url, error: lastError } });
      return { ok: false, status: 0, data: null, error: lastError, ms };
    }
  }

  return { ok: false, status: 0, data: null, error: lastError || 'Erro desconhecido', ms: Date.now() - t0 };
}
