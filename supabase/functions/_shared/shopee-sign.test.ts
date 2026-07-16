import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hmacSha256Hex } from './shopee-sign.ts';

// Vetor de referência calculado de forma independente com Python
// (hmac.new(key, msg, hashlib.sha256).hexdigest()), não com o próprio código
// sendo testado — garante que o teste pegaria um erro real de implementação.
Deno.test('hmacSha256Hex produz o mesmo resultado que hmac/hashlib do Python (vetor de referência)', async () => {
  const key = 'minha_partner_key_teste';
  const message = '123456/api/v2/shop/get_shop_info1700000000';
  const expected = '1fdf2de0631780afcd590da4b97235fcdf6f94740c2d56e043848357013c26bd';
  const result = await hmacSha256Hex(key, message);
  assertEquals(result, expected);
});

Deno.test('hmacSha256Hex muda completamente com 1 caractere diferente na mensagem', async () => {
  const key = 'minha_partner_key_teste';
  const a = await hmacSha256Hex(key, '123456/api/v2/shop/get_shop_info1700000000');
  const b = await hmacSha256Hex(key, '123456/api/v2/shop/get_shop_info1700000001');
  assertEquals(a === b, false);
});

Deno.test('hmacSha256Hex é determinístico (mesma chave + mensagem = mesma assinatura sempre)', async () => {
  const key = 'outra-chave';
  const msg = 'partner_id/api/v2/product/get_item_list1700000000';
  const a = await hmacSha256Hex(key, msg);
  const b = await hmacSha256Hex(key, msg);
  assertEquals(a, b);
});
