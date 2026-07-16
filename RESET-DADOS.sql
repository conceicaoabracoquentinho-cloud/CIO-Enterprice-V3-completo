-- ═══════════════════════════════════════════════════════════════════════
-- RESET-DADOS.sql — CIO Enterprise
--
-- Use isto SE você optar por continuar usando o mesmo projeto Supabase de
-- antes (em vez de criar um novo, que é a opção mais segura — ver
-- LEIA-ME-ANTES-DE-TESTAR.md). Ele apaga TODO dado operacional e TODA
-- credencial salva, deixando o banco como se fosse recém-criado.
--
-- Como rodar: Supabase Dashboard → SQL Editor → cole este arquivo → Run.
-- ═══════════════════════════════════════════════════════════════════════

-- Dados operacionais (divergências, logs, auditorias, fila de retentativa)
truncate table divergences restart identity;
truncate table sync_logs restart identity;
truncate table audit_records restart identity;
truncate table retry_queue restart identity;

-- Credenciais e tokens do OAuth (Bling, Mercado Livre, Shopee) — depois de
-- rodar isto, as três integrações voltam ao estado "não configurado" e
-- você pode cadastrar credenciais novas do zero em Administrar.
delete from oauth_tokens;
delete from oauth_credentials;
insert into oauth_credentials (source) values ('bling'), ('mercadolivre'), ('shopee');
insert into oauth_tokens (source) values ('bling'), ('mercadolivre'), ('shopee');

-- Limites de chamada às APIs (zera as janelas de rate limit)
truncate table api_rate_limits restart identity;
insert into api_rate_limits (source) values ('bling'), ('mercadolivre'), ('shopee');

-- system_config (parâmetros de negócio: comissões, estratégia, empresa)
-- NÃO é apagado de propósito — são só números de configuração, não dados
-- de API, e não atrapalham o teste de integração. Se quiser zerar também:
-- truncate table system_config;
