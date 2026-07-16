import { jsonResponse } from './cors.ts';

// BLOCO 1 (correção de auditoria): nenhuma Edge Function chamável via fetch()
// pelo frontend pode mais responder só com a anon key pública. Toda function
// que recebe ações de leitura/escrita sensíveis (save-credentials, bling-api,
// ml-api, shopee-api, integrations-status, reconcile) agora exige o header
// `x-internal-token`, comparado em tempo constante contra o secret
// INTERNAL_API_TOKEN (configurado só no servidor via `supabase secrets set`).
//
// LIMITAÇÃO HONESTA (documentada também no CORRECTION_REPORT.md): como o
// Documento Estratégico proíbe login/usuários, o token precisa estar
// disponível para o frontend enviar em toda chamada — ele fica no bundle JS,
// assim como a anon key. Isto NÃO é autenticação de usuário; é uma barreira
// que fecha o ataque mais barato (chamar as functions só sabendo a URL
// pública do projeto Supabase, sem nunca ter tocado o app real) e obriga um
// atacante a extrair o token de uma sessão real em execução. Eliminar esse
// risco por completo exigiria login (proibido pelo SSOT) ou expor a
// aplicação atrás de autenticação de rede (VPN/IP allow-list/basic auth no
// proxy) — recomendado como próximo passo, fora do escopo desta correção.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) {
    // Ainda assim percorre um buffer de tamanho fixo para não vazar o
    // comprimento via timing de forma trivial.
    let dummy = 0;
    for (let i = 0; i < bufA.length; i++) { dummy |= bufA[i]; }
    void dummy; // intencional: apenas iterar para evitar timing leak
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export function requireInternalAuth(req: Request): Response | null {
  const expected = Deno.env.get('INTERNAL_API_TOKEN');
  if (!expected) {
    // Falha segura: sem o secret configurado no ambiente, bloqueia por
    // padrão em vez de deixar a function aberta.
    return jsonResponse({ error: 'INTERNAL_API_TOKEN não configurado no servidor. Configure com `supabase secrets set INTERNAL_API_TOKEN=...` antes do deploy.' }, 500);
  }
  const provided = req.headers.get('x-internal-token') ?? '';
  if (!provided || !timingSafeEqual(expected, provided)) {
    return jsonResponse({ error: 'Não autorizado.' }, 401);
  }
  return null;
}
