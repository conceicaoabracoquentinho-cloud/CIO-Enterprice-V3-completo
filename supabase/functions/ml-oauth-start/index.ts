import { corsHeaders, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { getCredentials, serviceClient } from '../_shared/db.ts';

// Fluxo oficial "Authorization Code Grant Type (Server Side)" do Mercado
// Livre (developers.mercadolivre.com.br/en_us/authentication-and-authorization).
//
// BLOCO 1 (correção de auditoria — item 2.3): `state` persistido e validado
// no callback (ver ml-oauth-callback/index.ts).
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const creds = await getCredentials('mercadolivre');
  if (!creds?.client_id || !creds?.redirect_uri) {
    return jsonResponse({ error: 'Integração não configurada. Cadastre App ID e Redirect URI do Mercado Livre em Administrar.' }, 400);
  }

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const db = serviceClient();
  await db.from('oauth_credentials').update({ oauth_state: state, oauth_state_expires_at: expiresAt }).eq('source', 'mercadolivre');

  const authorizeUrl = new URL('https://auth.mercadolivre.com.br/authorization');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', creds.client_id);
  authorizeUrl.searchParams.set('redirect_uri', creds.redirect_uri);
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: authorizeUrl.toString() } });
});
