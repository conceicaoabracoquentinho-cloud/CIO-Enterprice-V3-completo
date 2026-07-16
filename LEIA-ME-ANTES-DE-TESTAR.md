# Antes de testar no bolt.new — leia isto primeiro

## O que estava causando "informação aparecendo sem nenhuma API conectada"

O zip que você abriu tinha um arquivo `.env` com a URL e a chave de um
projeto Supabase **já existente**, com dados reais de testes anteriores
(divergências, auditorias, e possivelmente credenciais já salvas). Toda vez
que esse zip é aberto no bolt.new, ele se conecta a esse **mesmo banco
antigo** — por isso parecia ter "informação" mesmo sem você ter configurado
nada agora. Não é dado inventado pelo código; é dado real, só que de uma
sessão anterior, num banco que continuava conectado.

Removi esse `.env` do projeto. Em `.env.example` deixei um modelo do que
precisa existir ali.

## Por que "a API não está integrando"

Alterei bastante código dentro de `supabase/functions/` ao longo dessas
fases (a Edge Function `reconcile`, `save-config`, etc.). **Subir o zip no
bolt.new não redeploya automaticamente as Edge Functions no Supabase** —
isso é uma ação separada. Então é bem provável que o projeto Supabase que
você estava usando ainda estivesse rodando a versão *antiga* dessas
funções, sem as correções que eu fiz (por exemplo, a ação `ignore_one`
que criei na Fase 8 não existiria lá até você reimplantar as funções).

## O que fazer agora, passo a passo

1. **Crie um projeto Supabase novo e limpo.** No bolt.new, use a integração
   nativa do Supabase (ícone do Supabase na barra lateral) para conectar um
   projeto novo. Isso evita qualquer resquício de dado ou função antiga.
   - Se preferir continuar com o projeto antigo em vez de criar um novo,
     rode o `RESET-DADOS.sql` (incluído nesta pasta) no SQL Editor do
     Supabase antes de mais nada.

2. **Rode as migrações.** Os arquivos em `supabase/migrations/` precisam
   ser aplicados no projeto Supabase (o bolt.new geralmente faz isso
   automaticamente ao conectar um projeto novo; se não fizer, rode-os
   manualmente e na ordem, pelo nome do arquivo).

3. **Implante (deploy) as Edge Functions.** Todas as pastas dentro de
   `supabase/functions/` precisam ser publicadas no projeto Supabase. No
   bolt.new isso normalmente acontece pela própria integração do Supabase;
   confirme que todas apareceram lá (deveria ter bling-api, bling-oauth-start,
   ml-api, ml-oauth-start, ml-oauth-callback, shopee-api,
   shopee-oauth-start, shopee-oauth-callback, reconcile, save-config,
   save-credentials, integrations-status, process-retry-queue).

4. **Configure o `.env`.** Copie `.env.example` para `.env` com a URL e a
   anon key do SEU projeto Supabase (a integração do bolt.new normalmente
   já faz isso por você).

5. **Cadastre as credenciais reais** do Bling, Mercado Livre e Shopee em
   Administrar → clique em "Conectar" em cada uma → autorize no site
   oficial → "Testar Conexão" pra confirmar com uma chamada real.

6. Só depois disso o Dashboard, Monitorar, Precificação etc. vão mostrar
   dado real. Até lá, o esperado é a tela mostrar "Integração não
   configurada" — isso não é bug, é o comportamento correto.

## Se ainda aparecer dado sem API conectada depois disso

Me avisa exatamente qual tela e qual número/informação apareceu — aí eu
consigo rastrear se é resquício do banco ou algo no código que eu não vi
nesta auditoria.
