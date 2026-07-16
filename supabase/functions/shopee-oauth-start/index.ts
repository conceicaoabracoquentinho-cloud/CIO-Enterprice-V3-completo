import { corsHeaders, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { getCredentials, serviceClient } from '../_shared/db.ts';
import { hmacSha256Hex } from '../_shared/shopee-sign.ts';

const HOST = 'https://partner.shopeemobile.com';

// Fluxo oficial de autorização de loja da Shopee Open Platform v2:
// GET /api/v2/shop/auth_partner?partner_id=...&redirect=...&timestamp=...&sign=...
// sign = HMAC-SHA256(partner_key, partner_id + path + timestamp)
//
// BLOCO 1 (correção de auditoria — item 2.3): a Shopee não documenta um
// parâmetro `state` nativo no auth_partner. Para ter a mesma proteção CSRF
// das outras duas integrações, embutimos nosso próprio `cio_state` como
// query string do `redirect` que é enviado à Shopee — ela deve devolver essa
// URL de callback exatamente como registrada, preservando a query string.
// ATENÇÃO: não tenho como confirmar neste ambiente (sem acesso à internet)
// se a Shopee de fato preserva query strings extras no `redirect`. Validar
// isto com uma conta sandbox real antes de considerar este item 100%
// fechado — ver CORRECTION_REPORT.md.
Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const creds = await getCredentials('shopee');
  if (!creds?.client_id || !creds?.client_secret || !creds?.redirect_uri) {
    return jsonResponse({ error: 'Integração não configurada. Cadastre Partner ID, Partner Key e Redirect URI da Shopee em Administrar.' }, 400);
  }

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const db = serviceClient();
  await db.from('oauth_credentials').update({ oauth_state: state, oauth_state_expires_at: expiresAt }).eq('source', 'shopee');

  const redirectWithState = new URL(creds.redirect_uri);
  redirectWithState.searchParams.set('cio_state', state);

  const path = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${creds.client_id}${path}${timestamp}`;
  const sign = await hmacSha256Hex(creds.client_secret, baseString);

  const authorizeUrl = new URL(`${HOST}${path}`);
  authorizeUrl.searchParams.set('partner_id', creds.client_id);
  authorizeUrl.searchParams.set('redirect', redirectWithState.toString());
  authorizeUrl.searchParams.set('timestamp', String(timestamp));
  authorizeUrl.searchParams.set('sign', sign);

  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: authorizeUrl.toString() } });
});
