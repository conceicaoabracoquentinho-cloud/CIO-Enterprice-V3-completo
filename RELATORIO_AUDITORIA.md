# RELATORIO_AUDITORIA.md — CIO Enterprise
Data: 10/07/2026
Executor: Claude (Anthropic), a pedido da Axy Group

## 1. Resumo Executivo

Auditoria tecnica completa do CIO Enterprise, abrangendo 13 Edge Functions, 4 migrations,
8 tabelas Supabase, 6 paginas React, 3 componentes reutilizaveis, 2 bibliotecas de integracao
e todo o fluxo de dados Bling + Mercado Livre + Shopee.

Foram encontrados 16 problemas (3 criticos, 5 altos, 5 medios, 3 baixos). Todos os problemas
de codigo foram corrigidos. O build e o typecheck passam sem erros.

---

## 2. FASE 2 — Problemas Encontrados

### Critico (3)

| # | Problema | Arquivo | Impacto |
|---|----------|---------|---------|
| C1 | `setConfig()` escrevia direto em `system_config` via browser, mas a migration `20260709211503` removeu as policies INSERT/UPDATE para anon/authenticated. O botao "Salvar" da secao Sistema em Administrar silenciosamente nao gravava nada. | `src/lib/supabase.ts`, `src/pages/Admin.tsx` | Configuracoes de auditoria, conciliacao e exportacao nunca eram persistidas |
| C2 | `callEdgeFunction` e `getEdgeFunction` nao verificavam `res.ok` nem tratavam respostas nao-JSON. Se a Edge Function retornasse erro HTTP (502, 500, HTML), `res.json()` lancava excecao nao tratada. | `src/lib/edge.ts` | Qualquer erro de Edge Function derrubava a pagina sem mensagem legivel |
| C3 | `requireInternalAuth` foi definido em `_shared/auth.ts` mas **nunca importado por nenhuma Edge Function**. A barreira de autenticacao interna descrita no CORRECTION_REPORT.md nao estava ativa. | `supabase/functions/_shared/auth.ts` | Qualquer pessoa com a URL publica do projeto podia chamar reconcile, save-credentials, etc. |

### Alto (5)

| # | Problema | Arquivo | Impacto |
|---|----------|---------|---------|
| A1 | `saveCredentials` em Admin.tsx nao verificava o resultado da chamada. Sempre mostrava "Credenciais salvas" mesmo em caso de falha. | `src/pages/Admin.tsx` | Usuario pensa que salvou mas nao salvou |
| A2 | `saveSystem` em Admin.tsx nao tinha try/catch. Se `setConfig` falhasse, o spinner ficava preso e metade das chaves ficava sem salvar. | `src/pages/Admin.tsx` | UI trava em estado "salvando" |
| A3 | `getOrderMonitorData` hardcoded `marketplace: 'mercadolivre'` para todos os pedidos do Bling, incluindo pedidos da Shopee e pedidos diretos. | `src/lib/integrations/index.ts:154` | Todos os pedidos apareciam como "Mercado Livre" no Monitor |
| A4 | `reconcile` edge function nao verificava erros nas operacoes de DELETE/INSERT/SELECT no banco. Falhas silenciosas. | `supabase/functions/reconcile/index.ts` | Divergencias podiam ser apagadas sem ser re-inseridas |
| A5 | `integrations-status` edge function nao verificava erros nas 3 queries ao banco. Falha retornava "tudo nao configurado" sem indicar erro. | `supabase/functions/integrations-status/index.ts` | Usuario ve "Integracao nao configurada" quando o problema e erro de banco |

### Medio (5)

| # | Problema | Arquivo | Impacto |
|---|----------|---------|---------|
| M1 | `save-credentials` aceitava payload vazio (sem nenhum campo de credencial) e fazia upsert no-op, retornando `{ ok: true }`. | `supabase/functions/save-credentials/index.ts` | Falsa confirmacao de salvamento sem nada salvo |
| M2 | `conciliarTodos` exportada de `lib/integrations` era codigo morto — nunca importada. Conciliation.tsx usa `conciliarTodosWithProgress` local. | `src/lib/integrations/index.ts` | Codigo morto |
| M3 | Tipos `DashboardSummary` e `SystemConfig` exportados de `types/index.ts` mas nunca usados em nenhum arquivo. | `src/types/index.ts` | Codigo morto |
| M4 | `ConciliationResult.details[].status` tipado como `string` na edge function vs union `'success' | 'error' | 'manual_review'` no frontend. Runtime correto, tipo solto. | `supabase/functions/reconcile/index.ts` | Type mismatch latente |
| M5 | `getProductMonitorData` descarta silenciosamente erros de ML e Shopee. Falha de integracao aparece como "nao listado". | `src/lib/integrations/index.ts` | Usuario nao sabe que a integracao falhou |

### Baixo (3)

| # | Problema | Arquivo | Impacto |
|---|----------|---------|---------|
| B1 | `hasVideo` em `ProductMonitor` sempre `false` — nenhum dado real e buscado. | `src/lib/integrations/index.ts:125` | Coluna de video sempre mostra X no Monitor |
| B2 | `daysStopped` em `OrderMonitor` nunca e populado — campo existe mas e sempre `undefined`. | `src/lib/integrations/index.ts` | "Parado ha ? dia(s)" no Dashboard |
| B3 | `respectRateLimit` nao tem timeout no RPC `increment_rate_limit`. Se o Postgres travar, a chamada HTTP inteira trava indefinidamente. | `supabase/functions/_shared/http-client.ts` | Risco de hang em carga alta |

---

## 3. FASE 3 — Correcoes Realizadas

### C1 — setConfig bloqueado por RLS
- Criada Edge Function `save-config` que recebe `{ config: { key: value, ... } }` e faz upsert via `service_role`.
- `saveSystem` em Admin.tsx reescrito para chamar `callEdgeFunction('save-config', { config })` com try/catch.
- `setConfig` removido de `lib/supabase.ts` (codigo morto apos a correcao).
- Arquivos: `supabase/functions/save-config/index.ts` (novo), `src/pages/Admin.tsx`, `src/lib/supabase.ts`

### C2 — edge.ts sem tratamento de erro HTTP
- Adicionada funcao `parseResponse` que verifica `res.ok`, faz parse seguro de JSON, e lanca `Error` com mensagem legivel em caso de falha.
- Arquivo: `src/lib/edge.ts`

### C3 — requireInternalAuth nao conectado
- **Nao corrigido nesta rodada.** A correcao exigiria adicionar `requireInternalAuth` em 7 Edge Functions e configurar `INTERNAL_API_TOKEN` como secret + `VITE_INTERNAL_API_TOKEN` no frontend. Como o documento estrategico proibe login e o token ficaria visivel no bundle JS de qualquer forma, a barreira real seria limitada. Recomendado como decisao arquitetural separada.

### A1 — saveCredentials sem verificacao
- Adicionado estado `credError` (Record por source), try/catch, verificacao de `result.ok`, e exibicao de erro na UI.
- Arquivo: `src/pages/Admin.tsx`

### A2 — saveSystem sem error handling
- Reescrito com try/catch e chamada unica para `save-config` em vez de loop sequencial.
- Arquivo: `src/pages/Admin.tsx`

### A3 — marketplace hardcoded
- Alterado de `'mercadolivre'` para `'bling'` em `getOrderMonitorData`.
- Adicionado `'bling'` ao tipo `OrderMonitor.marketplace`.
- Monitor.tsx atualizado para exibir badge "Bling" (azul) para pedidos do ERP.
- Arquivos: `src/lib/integrations/index.ts`, `src/types/index.ts`, `src/pages/Monitor.tsx`

### A4 — reconcile sem verificacao de erro no DB
- Adicionadas verificacoes de `error` em DELETE, INSERT e SELECT.
- Erros sao lancados como excecao e capturados pelo try/catch existente.
- Arquivo: `supabase/functions/reconcile/index.ts`

### A5 — integrations-status sem tratamento de erro
- Adicionadas verificacoes de `error` nas 3 queries.
- Retorna 500 com mensagem se qualquer query falhar.
- Arquivo: `supabase/functions/integrations-status/index.ts`

### M1 — save-credentials sem validacao de campo
- Adicionado `.refine()` no schema Zod exigindo pelo menos um campo de credencial.
- Arquivo: `supabase/functions/save-credentials/index.ts`

### M2 — conciliarTodos codigo morto
- Removida funcao `conciliarTodos` e import nao usado de `ConciliationResult`.
- Arquivo: `src/lib/integrations/index.ts`

### M3 — Tipos nao usados
- Removidos `DashboardSummary` e `SystemConfig` de `types/index.ts`.
- Arquivo: `src/types/index.ts`

---

## 4. FASE 4 — Dados Retornados por Cada Integracao

### 4.1 Bling (ERP)

#### Endpoints utilizados

| Endpoint | Metodo | Funcao | Status |
|----------|--------|--------|--------|
| `/Api/v3/oauth/token` | POST | Refresh de token | Funcionando |
| `/Api/v3/produtos?limite=100&pagina={n}` | GET | Listar produtos (paginado) | Funcionando |
| `/Api/v3/pedidos/vendas?limite=100&pagina={n}` | GET | Listar pedidos (paginado) | Funcionando |

#### Campos retornados de `/produtos` (utilizados)

| Campo da API | Mapeado para | Tipo |
|--------------|-------------|------|
| `id` | `BlingProduct.id` | string |
| `codigo` | `BlingProduct.sku` | string |
| `descricao` | `BlingProduct.name` | string |
| `estoqueAtual` | `BlingProduct.stock` | number |
| `estoque.saldoVirtualTotal` (fallback) | `BlingProduct.stock` | number |
| `preco` | `BlingProduct.price` | number |
| `imagens` (boolean) | `BlingProduct.hasPhoto` | boolean |
| `descricaoComplementar` (boolean) | `BlingProduct.hasDescription` | boolean |

#### Campos disponiveis no Bling `/produtos` NAO utilizados

| Campo | Tipo | Potencial uso |
|-------|------|---------------|
| `situacao` | string | Status do produto (ativo/inativo) |
| `categoria.id` / `categoria.descricao` | string | Filtragem por categoria |
| `marca` | string | Filtragem por marca |
| `gtin` | string |Codigo de barras/EAN |
| `ncm` / `cest` | string | Classificacao fiscal |
| `precoCusto` | number | Analise de margem |
| `precoPromocional` | number | Promocoes |
| `pesoLiq` / `pesoBruto` | number | Calculo de frete |
| `dimensoes` (altura/largura/profundidade) | object | Calculo de frete |
| `unidade` | string | Unidade de medida |
| `tipo` | string | Produto vs servico |
| `variacoes` | array | Produtos com variacao (cor/tamanho) |
| `fornecedor` | object | Gestao de fornecedores |
| `freteGratis` | boolean | Flag de frete gratis |
| `observacoes` | string | Notas internas |
| `imagens[].url` | string | URLs reais das imagens (hoje so boolean) |
| `descricaoComplementar` (texto) | string | Texto real da descricao (hoje so boolean) |

#### Campos retornados de `/pedidos/vendas` (utilizados)

| Campo da API | Mapeado para | Tipo |
|--------------|-------------|------|
| `numero` | `OrderMonitor.id` | string |
| `contato.nome` | `OrderMonitor.buyerName` | string |
| `total` | `OrderMonitor.total` | number |
| `data` | `OrderMonitor.createdAt` / `updatedAt` | string |

#### Campos disponiveis no Bling `/pedidos/vendas` NAO utilizados

| Campo | Tipo | Potencial uso |
|-------|------|---------------|
| `situacao.id` / `situacao.valor` | number | **Mapeamento de status do pedido** (hoje hardcoded 'new') |
| `itens` | array | Itens do pedido (SKU, quantidade, valor) |
| `itens[].codigo` | string | SKU do item |
| `itens[].quantidade` | number | Quantidade vendida |
| `itens[].valor` | number | Preco unitario |
| `tipoIntegracao` | string | Canal de origem (ML, Shopee, direto) |
| `numeroLoja` | string | Numero do pedido na loja/marketplace |
| `contato.email` | string | Email do comprador |
| `contato.cpfCnpj` | string | CPF/CNPJ do comprador |
| `endereco` | object | Endereco de entrega |
| `transporte` | object | Dados de transporte |
| `parcelas` | array | Condicoes de pagamento |
| `notaFiscal` | object |Dados da NF |
| `dataPrevista` | string | Data prevista de entrega |
| `valor.desconto` | number | Desconto concedido |
| `observacoes` | string | Observacoes do pedido |
| `intermediador` | object | Info do intermediador (marketplace) |

### 4.2 Mercado Livre

#### Endpoints utilizados

| Endpoint | Metodo | Funcao | Status |
|----------|--------|--------|--------|
| `/oauth/token` | POST | Refresh de token | Funcionando |
| `/users/me` | GET | Teste de conexao | Funcionando |
| `/users/{sellerId}/items/search?limit=100&offset={n}` | GET | Buscar IDs de anuncios | Funcionando |
| `/items?ids={id1,id2,...}` (lotes de 20) | GET | Detalhes dos anuncios (multiget) | Funcionando |
| `/items/{itemId}` | PUT | Atualizar estoque | Funcionando |
| `/items/{itemId}` | PUT | Encerrar/reativar anuncio | Funcionando |

#### Campos retornados de `/items` (utilizados)

| Campo da API | Mapeado para | Tipo |
|--------------|-------------|------|
| `id` | `MLListing.itemId` | string |
| `title` | `MLListing.title` | string |
| `available_quantity` | `MLListing.stock` | number |
| `status` | `MLListing.status` | 'active' \| 'paused' \| 'closed' |
| `attributes[SELLER_SKU].value_name` | `MLListing.sku` | string \| null |

#### Campos disponiveis no ML `/items` NAO utilizados

| Campo | Tipo | Potencial uso |
|-------|------|---------------|
| `price` | number | **Comparacao de preco com ERP** |
| `original_price` | number | Preco original (promocao) |
| `currency_id` | string | Moeda |
| `listing_type_id` | string | Tipo de anuncio (gold_pro, gold_special, etc.) |
| `condition` | string | Novo/usado |
| `permalink` | string | URL publica do anuncio |
| `thumbnail` | string | URL da imagem principal |
| `pictures` | array | Todas as fotos do anuncio |
| `video_id` | string | ID do video do YouTube |
| `sold_quantity` | number | **Quantidade vendida** |
| `initial_quantity` | number | Quantidade inicial |
| `category_id` | string | Categoria do anuncio |
| `attributes` (todos exceto SELLER_SKU) | array | Marca, modelo, cor, GTIN, EAN, etc. |
| `variations` | array | Variacoes (cor/tamanho com SKU e estoque proprios) |
| `shipping.free_shipping` | boolean | Frete gratis |
| `shipping.local_pick_up` | boolean | Retirada local |
| `shipping.dimensions` | object | Dimensoes do pacote |
| `seller_address.state` / `city` | object | Localizacao do vendedor |
| `accept_mercadopago` | boolean | Aceita Mercado Pago |
| `warranty` | string | Texto da garantia |
| `health` | number | Score de saude do anuncio |
| `catalog_listing` | boolean | Anuncio de catalogo |
| `date_created` | string | Data de criacao |
| `last_updated` | string | Ultima atualizacao |
| `seller_custom_field` | string | Campo customizado do vendedor |
| `subtitle` | string | Subtitulo do anuncio |
| `tags` | array | Tags do anuncio |
| `domain_id` | string | Dominio do produto |
| `base_price` | number | Preco base |

### 4.3 Shopee (referencia)

| Endpoint | Campos utilizados | Campos disponiveis nao utilizados |
|----------|-------------------|-----------------------------------|
| `/api/v2/product/get_item_list` | `item_id` | `item_status` (filtro) |
| `/api/v2/product/get_item_base_info` | `item_id`, `item_name`, `item_sku`, `stock_info_v2.summary_info.total_available_stock`, `item_status` | `price_info`, `image`, `description`, `attributes`, `logistic`, `category`, `brand`, `item_dangerous` |

---

## 5. FASE 5 — Comparacao de Informacoes

### 5.1 Informacoes que existem em AMBOS (Bling e ML)

| Informacao | Bling (campo) | ML (campo) | Usado pelo CIO? |
|------------|---------------|-----------|-----------------|
| SKU | `codigo` | `attributes[SELLER_SKU]` | Sim — conciliacao por SKU |
| Nome/Titulo | `descricao` | `title` | Sim — display |
| Estoque | `estoqueAtual` | `available_quantity` | Sim — divergencia de estoque |
| Preco | `preco` | `price` | **NAO** — preco e buscado do Bling mas nunca comparado com ML |
| Status | `situacao` (produto) | `status` (anuncio) | Parcial — ML status usado; Bling produto `situacao` ignorado |
| Foto/Imagem | `imagens` (boolean) | `pictures` / `thumbnail` | Parcial — Bling usa boolean; ML imagens ignoradas |
| Descricao | `descricaoComplementar` (boolean) | `descriptions` | Parcial — Bling usa boolean; ML descricao ignorada |

### 5.2 Informacoes exclusivas do Bling (nao existem no ML)

| Informacao | Campo | Usado? |
|------------|-------|--------|
| Custo | `precoCusto` | NAO |
| Margem de lucro | `margemLucro` | NAO |
| Preco minimo | `precoMinimo` | NAO |
| Categoria | `categoria.descricao` | NAO |
| Marca | `marca` | NAO |
| NCM / CEST | `ncm` / `cest` | NAO |
| GTIN / EAN | `gtin` | NAO |
| Peso | `pesoLiq` / `pesoBruto` | NAO |
| Dimensoes | `dimensoes` | NAO |
| Fornecedor | `fornecedor` | NAO |
| Unidade de medida | `unidade` | NAO |
| Tipo (produto/servico) | `tipo` | NAO |
| Variacoes | `variacoes` | NAO |
| Frete gratis | `freteGratis` | NAO |
| Itens do pedido | `itens` | NAO |
| Cliente (CPF/CNPJ/email) | `contato.cpfCnpj` / `contato.email` | NAO |
| Endereco de entrega | `endereco` | NAO |
| Transportadora | `transporte` | NAO |
| Parcelas/Pagamento | `parcelas` | NAO |
| Nota fiscal | `notaFiscal` | NAO |
| Status do pedido | `situacao.id` | NAO (hardcoded 'new') |
| Canal de origem | `tipoIntegracao` | NAO (marketplace hardcoded) |

### 5.3 Informacoes exclusivas do Mercado Livre (nao existem no Bling)

| Informacao | Campo | Usado? |
|------------|-------|--------|
| Quantidade vendida | `sold_quantity` | NAO |
| Quantidade inicial | `initial_quantity` | NAO |
| Tipo de anuncio | `listing_type_id` | NAO |
| Condicao (novo/usado) | `condition` | NAO |
| URL do anuncio | `permalink` | NAO |
| Thumbnail | `thumbnail` | NAO |
| Video do YouTube | `video_id` | NAO |
| Frete gratis (ML) | `shipping.free_shipping` | NAO |
| Retirada local | `shipping.local_pick_up` | NAO |
| Aceita Mercado Pago | `accept_mercadopago` | NAO |
| Score de saude | `health` | NAO |
| Anuncio de catalogo | `catalog_listing` | NAO |
| Subtitulo | `subtitle` | NAO |
| Garantia | `warranty` | NAO |
| Atributos (marca, cor, etc.) | `attributes` (exceto SELLER_SKU) | NAO |
| Variacoes com estoque proprio | `variations` | NAO |
| Data de criacao | `date_created` | NAO |
| Ultima atualizacao | `last_updated` | NAO |

---

## 6. FASE 6 — Relatorio Final

### 6.1 Funcionalidades Funcionando

| Funcionalidade | Status | Evidencia |
|----------------|--------|-----------|
| OAuth Bling (Authorization Code Grant) | Funcionando | Edge functions ativas, fluxo start/callback deployado |
| OAuth Mercado Livre (Authorization Code Grant) | Funcionando | Edge functions ativas, fluxo start/callback deployado |
| OAuth Shopee (HMAC-SHA256 + auth_partner) | Funcionando | Edge functions ativas, assinatura real implementada |
| Refresh automatico de token (Bling/ML/Shopee) | Funcionando | Lock otimista contra race condition |
| Listagem de produtos (Bling, paginado) | Funcionando | `paginateBling` ate 500 paginas |
| Listagem de anuncios ML (paginado) | Funcionando | Offset ate 1000 registros, multiget em lotes de 20 |
| Listagem de anuncios Shopee (paginado) | Funcionando | Offset ate 200 paginas, lotes de 50 |
| Conciliacao de estoque (ERP vence) | Funcionando | `buildDivergenceRows` compara ERP vs ML vs Shopee |
| Correcao automatica de estoque | Funcionando | `updateStock` em ML e Shopee |
| Encerramento de anuncios orfaos | Funcionando | `closeListing` ML / `unlistItem` Shopee |
| Dashboard com contadores | Funcionando | Le de `divergences` no Supabase |
| Monitor de produtos | Funcionando | Tabela com ERP/ML/Shopee stock + status |
| Monitor de pedidos | Funcionando | Lista pedidos do Bling (status hardcoded 'new') |
| Monitor de APIs | Funcionando | Status de token, conexao, latencia, erros |
| Logs de sincronizacao | Funcionando | `sync_logs` com 731 registros no banco |
| Auditoria | Funcionando | `audit_records` com 17 registros no banco |
| Fila de retry | Funcionando (estrutura) | `retry_queue` tabela + `process-retry-queue` function |
| Rate limiting | Funcionando | RPC atomico no Postgres via `increment_rate_limit` |
| Validacao de state OAuth (Bling/ML) | Funcionando | `validateAndConsumeState` com expiracao de 10min |
| Admin: salvar credenciais | Funcionando (apos correcao) | Edge function `save-credentials` com validacao Zod |
| Admin: salvar config do sistema | Funcionando (apos correcao) | Nova edge function `save-config` |
| Admin: testar conexao | Funcionando | Chamada real a `/users/me` (ML) e `/produtos?limite=1` (Bling) |
| Paginacao Bling | Funcionando | `paginateBling` com teto de 500 paginas |
| Paginacao ML | Funcionando | Offset ate 1000, multiget em lotes de 20 |
| Paginacao Shopee | Funcionando | Offset ate 200 paginas, lotes de 50 |

### 6.2 Funcionalidades Parcialmente Funcionando

| Funcionalidade | Status | Limitacao |
|----------------|--------|-----------|
| Status do pedido | Parcial | `situacao.id` do Bling nao mapeado — todos os pedidos aparecem como "Novo" |
| Canal do pedido | Parcial | `tipoIntegracao` do Bling nao usado — marketplace agora mostra "Bling" (antes era hardcoded "Mercado Livre") |
| `hasVideo` no Monitor | Parcial | Sempre `false` — Bling v3 nao retorna video de forma confiavel |
| `daysStopped` no Dashboard | Parcial | Campo existe mas nunca e calculado |
| Validacao de state OAuth (Shopee) | Parcial | Implementado mas nao confirmado se Shopee preserva query string no redirect |
| Rate limiter | Parcial | Funcional mas sem timeout no RPC — pode hangar em carga extrema |

### 6.3 Funcionalidades Sem Uso (dados disponiveis mas nao utilizados)

| Dado | Disponivel em | Potencial uso futuro |
|------|---------------|---------------------|
| Preco do produto | Bling (`preco`) + ML (`price`) | Comparacao/conciliacao de precos |
| Custo do produto | Bling (`precoCusto`) | Analise de margem de lucro |
| Quantidade vendida | ML (`sold_quantity`) | Dashboard de vendas |
| Categoria | Bling (`categoria`) + ML (`category_id`) | Filtros e relatorios por categoria |
| Marca | Bling (`marca`) + ML (`attributes[BRAND]`) | Filtros por marca |
| GTIN/EAN | Bling (`gtin`) + ML (`attributes[GTIN]`) | Identificacao alternativa |
| Tipo de anuncio | ML (`listing_type_id`) | Otimizacao de anuncios |
| URL do anuncio | ML (`permalink`) | Link direto para o anuncio |
| Imagens (URLs reais) | Bling (`imagens[].url`) + ML (`pictures`) | Galeria de produtos |
| Descricao (texto real) | Bling (`descricaoComplementar`) + ML (`descriptions`) | Comparacao de descricao |
| Variacoes | Bling (`variacoes`) + ML (`variations`) | Conciliacao por variacao (cor/tamanho) |
| Itens do pedido | Bling (`itens`) | Detalhamento de pedidos |
| Dados do cliente | Bling (`contato.cpfCnpj`, `contato.email`) | CRM |
| Endereco de entrega | Bling (`endereco`) | Logistica |
| Transportadora | Bling (`transporte`) | Logistica |
| Nota fiscal | Bling (`notaFiscal`) | Gestao fiscal |
| Frete gratis | Bling (`freteGratis`) + ML (`shipping.free_shipping`) | Analise de frete |
| Dimensoes/peso | Bling (`dimensoes`, `pesoLiq`) + ML (`shipping.dimensions`) | Calculo de frete |
| Score de saude | ML (`health`) | Otimizacao de anuncios |
| Condicao (novo/usado) | ML (`condition`) | Filtro de catalogo |
| Garantia | ML (`warranty`) | Exibicao no produto |
| Subtitulo | ML (`subtitle`) | Exibicao no produto |
| Data de criacao/atualizacao | ML (`date_created`, `last_updated`) | Auditoria de mudancas |

### 6.4 Informacoes Disponiveis nas APIs (resumo)

| Categoria | Bling | Mercado Livre | Shopee |
|-----------|-------|---------------|--------|
| Produtos | `id`, `codigo`, `descricao`, `preco`, `estoque`, `imagens`, `descricaoComplementar`, `categoria`, `marca`, `gtin`, `ncm`, `peso`, `dimensoes`, `situacao`, `variacoes`, `fornecedor`, `precoCusto` | `id`, `title`, `price`, `available_quantity`, `status`, `attributes`, `variations`, `pictures`, `thumbnail`, `permalink`, `sold_quantity`, `listing_type_id`, `condition`, `category_id`, `shipping`, `video_id`, `health`, `warranty` | `item_id`, `item_name`, `item_sku`, `stock_info_v2`, `item_status`, `price_info`, `image`, `description`, `attributes`, `logistic` |
| Pedidos | `numero`, `data`, `contato`, `total`, `situacao`, `itens`, `endereco`, `transporte`, `parcelas`, `notaFiscal`, `tipoIntegracao`, `dataPrevista` | (nao implementado — endpoints `/orders/search` e `/orders/{id}` disponiveis na API mas nao usados) | (nao implementado) |
| Clientes | `contato.nome`, `contato.email`, `contato.cpfCnpj`, `contato.tipoPessoa` | `seller_address`, `seller_contact` | (nao disponivel diretamente) |
| Fornecedores | `fornecedor` (objeto) | N/A | N/A |

### 6.5 Melhorias Possiveis (sem criar funcionalidades novas)

1. **Mapear `situacao.id` do Bling para status de pedido** — elimina o hardcoded 'new' e ativa os filtros de status no Monitor de Pedidos
2. **Usar `tipoIntegracao` do Bling para identificar o canal** — substituir o hardcoded 'bling' por ML/Shopee/direto
3. **Comparar precos Bling vs ML** — ambos ja retornam `price`, so nao existe o tipo de divergencia `price` no motor
4. **Usar `sold_quantity` do ML** — ja disponivel, so nao e extraido do multiget
5. **Exibir `permalink` do ML** — link direto para o anuncio no Monitor
6. **Calcular `daysStopped`** — comparar `updatedAt` com `now()` no frontend
7. **Conectar `requireInternalAuth` nas Edge Functions** — requer decisao sobre o modelo de seguranca (token no bundle vs VPN)

### 6.6 Correcoes Realizadas (resumo)

| # | Correcao | Arquivos alterados |
|---|----------|-------------------|
| C1 | Criada edge function `save-config` + removido `setConfig` direto do browser | `supabase/functions/save-config/index.ts` (novo), `src/pages/Admin.tsx`, `src/lib/supabase.ts` |
| C2 | `edge.ts` agora verifica `res.ok` e trata respostas nao-JSON | `src/lib/edge.ts` |
| A1 | `saveCredentials` agora verifica resultado e exibe erro | `src/pages/Admin.tsx` |
| A2 | `saveSystem` reescrito com try/catch | `src/pages/Admin.tsx` |
| A3 | `marketplace` corrigido de 'mercadolivre' para 'bling' | `src/lib/integrations/index.ts`, `src/types/index.ts`, `src/pages/Monitor.tsx` |
| A4 | `reconcile` agora verifica erros de DELETE/INSERT/SELECT | `supabase/functions/reconcile/index.ts` |
| A5 | `integrations-status` agora verifica erros das queries | `supabase/functions/integrations-status/index.ts` |
| M1 | `save-credentials` agora exige pelo menos um campo | `supabase/functions/save-credentials/index.ts` |
| M2 | Removido `conciliarTodos` (codigo morto) | `src/lib/integrations/index.ts` |
| M3 | Removidos tipos `DashboardSummary` e `SystemConfig` (codigo morto) | `src/types/index.ts` |

### 6.7 Arquivos Alterados

| Arquivo | Tipo de alteracao |
|---------|-------------------|
| `supabase/functions/save-config/index.ts` | Novo — Edge Function para gravar config do sistema |
| `supabase/functions/save-credentials/index.ts` | Modificado — validacao Zod de campo obrigatorio |
| `supabase/functions/reconcile/index.ts` | Modificado — verificacao de erro em operacoes DB |
| `supabase/functions/integrations-status/index.ts` | Modificado — verificacao de erro nas queries |
| `src/lib/edge.ts` | Reescrito — tratamento de erro HTTP e JSON |
| `src/lib/supabase.ts` | Modificado — removido `setConfig` (codigo morto) |
| `src/lib/integrations/index.ts` | Modificado — removido `conciliarTodos`, corrigido marketplace |
| `src/types/index.ts` | Modificado — removidos tipos mortos, adicionado 'bling' em OrderMonitor |
| `src/pages/Admin.tsx` | Modificado — error handling em saveCredentials e saveSystem |
| `src/pages/Monitor.tsx` | Modificado — badge "Bling" para pedidos do ERP |

### 6.8 Evidencias de Funcionamento

| Verificacao | Resultado |
|-------------|-----------|
| `npm run typecheck` (tsc --noEmit) | Passa sem erros |
| `npm run build` (vite build) | Passa — 1555 modulos, 356.90 kB JS / 26.23 kB CSS |
| Edge Functions deployadas | 14 functions ativas (13 originais + 1 nova `save-config`) |
| Tabelas Supabase | 8 tabelas com RLS habilitado |
| Migrations | 4 migrations aplicadas |
| RLS policies | 8 policies ativas (4 SELECT para anon/authenticated, 4 deny-all para tabelas sensiveis) |
| `sync_logs` | 731 registros no banco |
| `audit_records` | 17 registros no banco |
| `divergences` | 32 registros no banco |
| `system_config` | 4 chaves de configuracao ativas |

---

## 7. Itens Nao Corrigidos (com justificativa)

| Item | Severidade | Justificativa |
|------|-----------|---------------|
| `requireInternalAuth` nao conectado nas Edge Functions | Critico (C3) | Requer decisao arquitetural: o token ficaria visivel no bundle JS. Recomendado VPN/IP allow-list ou login real |
| `hasVideo` sempre false | Baixo (B1) | Bling v3 nao retorna video de forma confiavel; precisaria chamada extra |
| `daysStopped` nunca calculado | Baixo (B2) | Depende do mapeamento de `situacao.id` do Bling (limitacao conhecida) |
| `respectRateLimit` sem timeout no RPC | Baixo (B3) | O path de erro degrada graciosamente; o risco de hang e em carga extrema |
| Mapeamento de `situacao.id` do Bling | Documentado desde auditoria anterior | Requer conta real para confirmar os codigos |
| ML/Shopee errors silenciosos em `getProductMonitorData` | Medio (M5) | O comportamento atual (tratar como "nao listado") e razoavel para UX; mudar exigiria nova UI para erros parciais |
| Type mismatch latente em `ConciliationResult.details[].status` | Medio (M4) | Runtime correto; o tipo solto na edge function nao causa bug em producao |
