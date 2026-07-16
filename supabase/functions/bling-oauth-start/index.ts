import { corsHeaders, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { getCredentials, serviceClient } from '../_shared/db.ts';

// Endpoint oficial de autorização do Bling API v3 (developer.bling.com.br/aplicativos):
// GET https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=...&state=...
//
// BLOCO 1 (correção de auditoria — item 2.3): o `state` agora é persistido e
// validado no callback (ver bling-oauth-callback/index.ts), fechando o CSRF
// que existia antes (state era gerado mas nunca conferido).
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const creds = await getCredentials('bling');
  if (!creds?.client_id) {
    return jsonResponse({ error: 'Integração não configurada. Cadastre o Client ID do Bling em Administrar antes de conectar.' }, 400);
  }

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutos

  const db = serviceClient();
  await db.from('oauth_credentials').update({ oauth_state: state, oauth_state_expires_at: expiresAt }).eq('source', 'bling');

  const authorizeUrl = new URL('https://www.bling.com.br/Api/v3/oauth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', creds.client_id);
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: authorizeUrl.toString() },
  });
});
