import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// IMPORTANTE: este client usa a SERVICE_ROLE_KEY, que só existe no ambiente
// de execução da Edge Function (nunca é enviada ao navegador). É o que
// permite ler/escrever nas tabelas oauth_credentials e oauth_tokens, que
// não têm nenhuma policy de RLS liberada para anon/authenticated.
export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

export interface OAuthCredentials {
  source: string;
  client_id: string | null;
  client_secret: string | null;
  redirect_uri: string | null;
  extra: Record<string, unknown>;
  oauth_state?: string | null;
  oauth_state_expires_at?: string | null;
}

export interface OAuthTokens {
  source: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  shop_id: string | null;
  scope: string | null;
}

export async function getCredentials(source: string): Promise<OAuthCredentials | null> {
  const db = serviceClient();
  const { data } = await db.from('oauth_credentials').select('*').eq('source', source).maybeSingle();
  return data as OAuthCredentials | null;
}

export async function getTokens(source: string): Promise<OAuthTokens | null> {
  const db = serviceClient();
  const { data } = await db.from('oauth_tokens').select('*').eq('source', source).maybeSingle();
  return data as OAuthTokens | null;
}

export async function saveTokens(source: string, fields: Partial<OAuthTokens>): Promise<void> {
  const db = serviceClient();
  await db.from('oauth_tokens').upsert({ source, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'source' });
}

// BLOCO 4 (correção de auditoria — item 3.3): lock otimista para evitar que
// duas chamadas concorrentes (ex: Monitor.tsx buscando produtos e pedidos ao
// mesmo tempo) tentem renovar o mesmo refresh_token simultaneamente — os
// refresh_tokens do Mercado Livre são de uso único, então uma renovação
// concorrente derruba a outra sem isso.
export async function acquireRefreshLock(source: string, lockSeconds = 15): Promise<boolean> {
  const db = serviceClient();
  const nowIso = new Date().toISOString();
  const lockUntil = new Date(Date.now() + lockSeconds * 1000).toISOString();
  const { data } = await db
    .from('oauth_tokens')
    .update({ refresh_lock_until: lockUntil })
    .eq('source', source)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${nowIso}`)
    .select('source');
  return Boolean(data && data.length > 0);
}

export async function releaseRefreshLock(source: string): Promise<void> {
  const db = serviceClient();
  await db.from('oauth_tokens').update({ refresh_lock_until: null }).eq('source', source);
}

// BLOCO 1 (correção de auditoria — item 2.3): valida o `state` recebido no
// callback OAuth contra o valor persistido em oauth-start, e o consome
// (limpa) para que não possa ser reaproveitado — fecha o CSRF que existia
// antes (state era gerado mas nunca conferido).
export async function validateAndConsumeState(source: string, receivedState: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!receivedState) return { ok: false, reason: 'state ausente na resposta' };
  const creds = await getCredentials(source);
  if (!creds?.oauth_state) return { ok: false, reason: 'nenhum state pendente para esta integração' };
  if (creds.oauth_state !== receivedState) return { ok: false, reason: 'state não corresponde (possível CSRF)' };
  if (creds.oauth_state_expires_at && new Date(creds.oauth_state_expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'state expirado' };
  }
  const db = serviceClient();
  await db.from('oauth_credentials').update({ oauth_state: null, oauth_state_expires_at: null }).eq('source', source);
  return { ok: true };
}

export async function insertSyncLog(entry: {
  source: string;
  operation: string;
  status: 'success' | 'error' | 'partial';
  duration_ms?: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  // Encontrado ao escrever os testes do BLOCO 5: logging nunca pode quebrar
  // o fluxo principal (uma chamada real ao Bling/ML/Shopee não pode falhar
  // só porque o insert do log deu erro). Por isso o try/catch aqui.
  try {
    const db = serviceClient();
    await db.from('sync_logs').insert({
      source: entry.source,
      operation: entry.operation,
      status: entry.status,
      duration_ms: entry.duration_ms ?? null,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error('Falha ao gravar sync_log (não bloqueante):', err);
  }
}

export async function insertAuditRecord(entry: {
  module: string;
  description: string;
  result: 'success' | 'error' | 'partial' | 'info';
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = serviceClient();
    await db.from('audit_records').insert({
      module: entry.module,
      description: entry.description,
      result: entry.result,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error('Falha ao gravar audit_record (não bloqueante):', err);
  }
}
