# RELATORIO_MONITOR.md — Melhoria da Tela Monitorar
Data: 10/07/2026

## 1. Resumo

Melhoria exclusiva da tela **Monitorar** (aba Produtos) utilizando somente dados
que ja sao retornados pelas APIs do Bling e do Mercado Livre. Nenhuma nova API
foi consultada, nenhum endpoint novo foi adicionado, e nenhuma funcionalidade
de OAuth foi alterada.

---

## 2. Campos Utilizados do Bling (ERP)

### Campos ja utilizados antes desta melhoria

| Campo | Tipo | Uso anterior |
|-------|------|--------------|
| `id` | string | Identificador interno |
| `codigo` | string | SKU |
| `descricao` | string | Nome do produto |
| `estoqueAtual` / `estoque.saldoVirtualTotal` | number | Estoque ERP |
| `preco` | number | Preco ERP (ja era retornado mas nao exibido no Monitor) |
| `imagens` (boolean) | boolean | hasPhoto |
| `descricaoComplementar` (boolean) | boolean | hasDescription |

### Campos novos adicionados (ja existiam na resposta da API, eram descartados)

| Campo | Tipo | Uso agora |
|-------|------|-----------|
| `imagens` (count) | number | Contagem de fotos do ERP |
| `descricaoComplementar` (texto) | string | Texto real da descricao (Completa/Curta/Ausente) |
| `categoria.descricao` | string | Categoria ERP no painel de detalhe |
| `marca` | string | Marca ERP no painel de detalhe |
| `gtin` | string | GTIN/EAN ERP no painel de detalhe |
| `pesoLiq` | number | Peso liquido no painel de detalhe |
| `situacao` | string | Situacao do produto (ativo/inativo) |
| `ncm` | string | NCM no painel de detalhe |
| `precoCusto` | number | Preco de custo no painel de detalhe |
| `tipo` | string | Tipo (produto/servico) |
| `unidade` | string | Unidade de medida |

---

## 3. Campos Utilizados do Mercado Livre

### Campos ja utilizados antes desta melhoria

| Campo | Tipo | Uso anterior |
|-------|------|--------------|
| `id` | string | itemId |
| `title` | string | Titulo do anuncio |
| `available_quantity` | number | Estoque ML |
| `status` | string | Status (active/paused/closed) |
| `attributes[SELLER_SKU].value_name` | string | SKU para conciliacao |

### Campos novos adicionados (ja existiam na resposta da API, eram descartados)

| Campo | Tipo | Uso agora |
|-------|------|-----------|
| `price` | number | Preco anunciado ML (coluna + detalhe) |
| `sold_quantity` | number | Quantidade vendida (detalhe) |
| `health` | number | **Health Score** do anuncio (coluna + detalhe) |
| `permalink` | string | Link do anuncio (detalhe) |
| `thumbnail` | string | Thumbnail (detalhe) |
| `pictures` (count) | number | Contagem de fotos ML |
| `video_id` | string | Video do YouTube (Possui/Nao possui) |
| `listing_type_id` | string | Tipo do anuncio (gold_pro, gold_special, etc.) |
| `condition` | string | Condicao (novo/usado) |
| `category_id` | string | Categoria ML |
| `shipping.free_shipping` | boolean | Frete gratis |
| `shipping.local_pick_up` | boolean | Retirada local |
| `warranty` | string | Texto da garantia |
| `accept_mercadopago` | boolean | Aceita Mercado Pago |
| `catalog_listing` | boolean | Anuncio de catalogo |
| `attributes` (todos) | array | Marca, modelo, cor, GTIN, EAN, etc. (detalhe) |
| `tags` | array | Tags do anuncio (detalhe) |
| `date_created` | string | Data de criacao (detalhe) |
| `last_updated` | string | Ultima atualizacao (detalhe) |

---

## 4. Campos Novos Adicionados a Interface

### Colunas novas na tabela de Produtos

| Coluna | Origem | Funcionamento |
|--------|--------|---------------|
| **Preco ERP** | Bling `preco` | Exibe `R$ X.XX` |
| **Preco ML** | ML `price` | Exibe `R$ X.XX` ou `—` se nao listado |
| **Saude** | ML `health` | Dot colorido + percentual (verde/amarelo/laranja/vermelho) |
| **Fotos** | ML `pictures.length` / Bling `imagens.length` | `8 fotos` (verde), `2 foto(s)` (amber), `Nenhuma` (vermelho) |
| **Descricao** | Bling `descricaoComplementar` | `Completa` (verde), `Curta` (amber), `Ausente` (vermelho) |
| **Video** | ML `video_id` | `Possui` (verde), `Nao possui` (vermelho) |
| **Pendencias** | Calculado | Lista de problemas: Sem video, Poucas fotos, Descricao incompleta, Poucos atributos, etc. |

### Painel de detalhe (drawer lateral)

Ao clicar em qualquer produto, abre um painel lateral (right drawer) com:

**Secao ERP (Bling):**
- Estoque, Preco, Custo, Categoria, Marca, GTIN, Peso, Situacao, NCM, Tipo, Unidade
- Fotos (contagem), Descricao (Completa/Curta/Ausente)

**Secao Marketplace (Mercado Livre):**
- Item ID, Titulo ML, Status, Estoque ML, Preco ML, Qtd. vendida
- Tipo do anuncio, Condicao, Categoria ML, Fotos ML, Video
- Frete gratis, Retirada local, Garantia, Mercado Pago, Catalogo
- GTIN (ML), Data de criacao, Ultima atualizacao, Tags
- Lista completa de atributos (marca, modelo, cor, etc.)

**Secao Saude do Anuncio:**
- Health Score em destaque com cor e label (Excelente/Boa/Regular/Critica)
- Link direto para o anuncio no Mercado Livre
- Quantidade vendida

**Secao Pendencias:**
- Lista de problemas detectados ou "Nenhuma pendencia detectada"

### Health Score — cores e faixas

| Faixa | Cor | Label |
|-------|-----|-------|
| >= 85% | Verde | Excelente |
| 70-84% | Amarelo | Boa |
| 50-69% | Laranja | Regular |
| < 50% | Vermelho | Critica |
| N/D | Cinza | Nao disponivel |

### Logica de Pendencias

| Pendencia | Condicao | Campo verificado |
|-----------|----------|-------------------|
| Sem video | `mlVideoId === null` | ML `video_id` |
| Poucas fotos | `mlPictureCount < 3` | ML `pictures.length` |
| Descricao incompleta | `!hasDescription` | Bling `descricaoComplementar` |
| Poucos atributos | `mlAttributes.length < 5` | ML `attributes` |
| Categoria incompleta | `mlCategoryId === null` | ML `category_id` |
| Titulo fraco | `mlTitle.length < 30` | ML `title` |
| Sem GTIN | Atributo GTIN/EAN ausente | ML `attributes[GTIN]` |
| Sem garantia | `mlWarranty === null` | ML `warranty` |

---

## 5. Arquivos Alterados

| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/_shared/ml.ts` | Interface `MLListing` expandida + `getListings()` extrai 20+ campos do multiget |
| `supabase/functions/_shared/bling.ts` | Interface `BlingProduct` expandida + `getProducts()` extrai 11 campos adicionais |
| `src/types/index.ts` | Interface `ProductMonitor` expandida + nova interface `MLAttribute` |
| `src/lib/integrations/index.ts` | DTOs expandidos + mapping propagando todos os novos campos |
| `src/pages/Monitor.tsx` | Aba Produtos reescrita com novas colunas, health score, pendencias, painel de detalhe |

### Arquivos NAO alterados (confirmacao)

| Arquivo | Status |
|---------|--------|
| `supabase/functions/ml-oauth-start/index.ts` | Nao modificado |
| `supabase/functions/ml-oauth-callback/index.ts` | Nao modificado |
| `supabase/functions/bling-oauth-start/index.ts` | Nao modificado |
| `supabase/functions/bling-oauth-callback/index.ts` | Nao modificado |
| `supabase/functions/save-credentials/index.ts` | Nao modificado |
| `supabase/functions/save-config/index.ts` | Nao modificado |
| `supabase/functions/_shared/db.ts` | Nao modificado |
| `supabase/functions/_shared/auth.ts` | Nao modificado |
| `supabase/functions/_shared/cors.ts` | Nao modificado |
| `supabase/functions/_shared/http-client.ts` | Nao modificado |
| `supabase/functions/_shared/schemas.ts` | Nao modificado |
| `supabase/migrations/*` | Nenhuma migration criada ou alterada |
| `src/pages/Dashboard.tsx` | Nao modificado |
| `src/pages/Conciliation.tsx` | Nao modificado |
| `src/pages/Analyze.tsx` | Nao modificado |
| `src/pages/Admin.tsx` | Nao modificado |
| `src/pages/Integrate.tsx` | Nao modificado |

---

## 6. Justificativa Tecnica

### Por que apenas extrair campos ja retornados?

O endpoint `/items?ids=...` (multiget) do Mercado Livre ja retorna todos os
campos usados (price, health, permalink, pictures, video_id, listing_type_id,
condition, shipping, warranty, attributes, tags, etc.). A funcao `getListings()`
em `ml.ts` simplesmente nao os extraiam — fazia `Record<string, unknown>` e
descartava tudo exceto 5 campos.

Da mesma forma, o endpoint `/produtos` do Bling ja retorna categoria, marca,
gtin, peso, situacao, ncm, precoCusto, tipo, unidade, e o texto real da
descricao e URLs das imagens. A funcao `getProducts()` em `bling.ts` so
extraia 7 campos.

**Nenhum endpoint novo foi adicionado.** As mesmas chamadas HTTP que ja
existiam agora extraem mais campos da resposta JSON.

### Por que nao alterar OAuth?

O fluxo OAuth (start, callback, refresh, lock) funciona corretamente e foi
auditado na rodada anterior. As funcoes `refreshIfNeeded()` em `ml.ts` e
`bling.ts` nao foram tocadas — apenas as funcoes de extracao de dados
(`getListings()` e `getProducts()`).

### Performance

Nenhuma chamada HTTP adicional foi feita. O multiget do ML ja retornava
todos os campos — so nao eram lidos. A paginacao Bling ja trazia todos os
campos — so nao eram mapeados. O custo de rede e o mesmo; o custo de
parsing e marginal (alguns `typeof` e `Number()` por item).

---

## 7. Provas de Funcionamento

### Build

```
npm run build
  vite v5.4.8 building for production...
  1555 modules transformed.
  dist/index.html                   0.83 kB │ gzip:  0.46 kB
  dist/assets/index-hmyaFJlf.css   26.64 kB │ gzip:  5.24 kB
  dist/assets/index-D0rcYpLv.js   369.59 kB │ gzip: 102.95 kB
  built in 8.36s
```
Resultado: **PASS**

### TypeCheck

```
npm run typecheck
  tsc --noEmit -p tsconfig.app.json
```
Resultado: **PASS** (0 erros)

### Edge Functions

14 funcoes ativas, incluindo:
- `ml-api` — redeployada com extracao expandida
- `bling-api` — redeployada com extracao expandida
- `ml-oauth-start` — ativa, nao modificada
- `ml-oauth-callback` — ativa, nao modificada
- `bling-oauth-start` — ativa, nao modificada
- `bling-oauth-callback` — ativa, nao modificada
- `save-credentials` — ativa, nao modificada
- `save-config` — ativa, nao modificada

### Migrations

4 migrations existentes. **Nenhuma migration criada.**

### OAuth

- `refreshIfNeeded()` em `ml.ts`: nao modificado
- `refreshIfNeeded()` em `bling.ts`: nao modificado
- `bling-oauth-start/index.ts`: nao modificado
- `bling-oauth-callback/index.ts`: nao modificado
- `ml-oauth-start/index.ts`: nao modificado
- `ml-oauth-callback/index.ts`: nao modificado
- Tabela `oauth_tokens`: nao modificada
- Tabela `oauth_credentials`: nao modificada
- RLS policies de OAuth: nao modificadas

### Conexao Bling

A funcao `testConnection()` em `bling.ts` nao foi alterada. O endpoint
`/produtos?limite=1` continua sendo usado para teste. A funcao `getProducts()`
continua paginando com o mesmo endpoint `/produtos?limite=100&pagina={n}`.

### Conexao Mercado Livre

A funcao `testConnection()` em `ml.ts` nao foi alterada. O endpoint
`/users/me` continua sendo usado para teste. A funcao `getListings()` continua
usando `/users/{sellerId}/items/search` + `/items?ids=...` (multiget).

---

## 8. Confirmacoes Finais

| Item | Status |
|------|--------|
| Build completo | PASS |
| TypeCheck | PASS (0 erros) |
| OAuth Bling | Nao modificado |
| OAuth Mercado Livre | Nao modificado |
| Endpoint de autenticacao alterado | Nenhum |
| Edge Function de autenticacao modificada | Nenhuma |
| Migration criada | Nenhuma |
| Funcionalidade existente removida | Nenhuma |
| Nova tela criada | Nenhuma (apenas drawer inline no Monitor) |
| Dashboard alterado | Nao |
| Conciliacao alterada | Nao |
| Analisar alterada | Nao |
| Administracao alterada | Nao |
| Nova integracao implementada | Nenhuma |
| Shopee implementada | Nao |
| Endpoint novo chamado | Nenhum |
| Tabela nova criada | Nenhuma |
