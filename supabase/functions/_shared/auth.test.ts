import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { timingSafeEqual, requireInternalAuth } from './auth.ts';

Deno.test('timingSafeEqual: valores iguais retornam true', () => {
  assertEquals(timingSafeEqual('segredo-123', 'segredo-123'), true);
});

Deno.test('timingSafeEqual: valores diferentes retornam false', () => {
  assertEquals(timingSafeEqual('segredo-123', 'segredo-456'), false);
});

Deno.test('timingSafeEqual: tamanhos diferentes retornam false sem lançar erro', () => {
  assertEquals(timingSafeEqual('curto', 'um-valor-bem-mais-longo-que-o-anterior'), false);
});

Deno.test('requireInternalAuth: bloqueia com 500 se INTERNAL_API_TOKEN não estiver configurado', () => {
  Deno.env.delete('INTERNAL_API_TOKEN');
  const req = new Request('https://example.com/fn', { headers: { 'x-internal-token': 'qualquer-coisa' } });
  const result = requireInternalAuth(req);
  assertEquals(result?.status, 500);
});

Deno.test('requireInternalAuth: bloqueia com 401 se o header não bater com o secret', () => {
  Deno.env.set('INTERNAL_API_TOKEN', 'token-correto');
  const req = new Request('https://example.com/fn', { headers: { 'x-internal-token': 'token-errado' } });
  const result = requireInternalAuth(req);
  assertEquals(result?.status, 401);
  Deno.env.delete('INTERNAL_API_TOKEN');
});

Deno.test('requireInternalAuth: libera (retorna null) quando o header bate com o secret', () => {
  Deno.env.set('INTERNAL_API_TOKEN', 'token-correto');
  const req = new Request('https://example.com/fn', { headers: { 'x-internal-token': 'token-correto' } });
  const result = requireInternalAuth(req);
  assertEquals(result, null);
  Deno.env.delete('INTERNAL_API_TOKEN');
});

Deno.test('requireInternalAuth: bloqueia se o header estiver ausente', () => {
  Deno.env.set('INTERNAL_API_TOKEN', 'token-correto');
  const req = new Request('https://example.com/fn');
  const result = requireInternalAuth(req);
  assertEquals(result?.status, 401);
  Deno.env.delete('INTERNAL_API_TOKEN');
});
