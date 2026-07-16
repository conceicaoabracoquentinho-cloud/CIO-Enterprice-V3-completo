/*
# CIO Enterprise — Correção de Auditoria: OAuth state, lock de refresh, fila e rate limit

## Motivo
- AUDIT_REPORT.md item 2.3: `state` do OAuth gerado mas nunca validado no
  callback (Bling/ML), e Shopee sem state nenhum — vulnerável a CSRF no
  fluxo de autorização.
- AUDIT_REPORT.md item 3.3: refresh de token sem lock, sujeito a corrida
  quando duas chamadas concorrentes disparam refresh ao mesmo tempo.
- AUDIT_REPORT.md item 3.4 / Prompt PJ (Filas: Retry, Reprocessamento):
  rate limiter só em memória (não confiável entre instâncias) e nenhuma
  estrutura de fila/reprocessamento existia.

Esta migration adiciona:
1. `oauth_state` / `oauth_state_expires_at` em `oauth_credentials`.
2. `refresh_lock_until` em `oauth_tokens` (lock otimista de refresh).
3. `retry_queue`: fila de reprocessamento de falhas de conciliação.
4. `api_rate_limits`: contador de taxa por integração, compartilhado entre
   instâncias da Edge Function (substitui o contador em memória).

Todas as tabelas novas seguem o mesmo padrão de segurança das demais tabelas
de credenciais: RLS habilitado, sem nenhuma policy para anon/authenticated —
só o service_role (Edge Functions) acessa.
*/

ALTER TABLE oauth_credentials ADD COLUMN IF NOT EXISTS oauth_state text;
ALTER TABLE oauth_credentials ADD COLUMN IF NOT EXISTS oauth_state_expires_at timestamptz;

ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS refresh_lock_until timestamptz;

-- ─── Fila de reprocessamento ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retry_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),
  source          text NOT NULL,            -- 'bling' | 'mercadolivre' | 'shopee'
  operation       text NOT NULL,            -- 'fix_divergence' | 'conciliar_todos'
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  status          text NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'done' | 'failed'
  next_attempt_at timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retry_queue_status_idx ON retry_queue (status, next_attempt_at);

ALTER TABLE retry_queue ENABLE ROW LEVEL SECURITY;

-- ─── Rate limit baseado em banco ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_rate_limits (
  source        text PRIMARY KEY,
  window_start  timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

INSERT INTO api_rate_limits (source) VALUES ('bling'), ('mercadolivre'), ('shopee')
ON CONFLICT (source) DO NOTHING;

-- Incremento atômico de janela fixa de 1s, usado pelo rate limiter em
-- _shared/http-client.ts. Uma única instrução UPDATE é atômica no Postgres,
-- eliminando a corrida que existia no contador em memória (item 3.4).
CREATE OR REPLACE FUNCTION increment_rate_limit(p_source text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE api_rate_limits
  SET
    request_count = CASE WHEN now() - window_start > interval '1 second' THEN 1 ELSE request_count + 1 END,
    window_start  = CASE WHEN now() - window_start > interval '1 second' THEN now() ELSE window_start END
  WHERE source = p_source
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN
    INSERT INTO api_rate_limits (source, window_start, request_count)
    VALUES (p_source, now(), 1)
    ON CONFLICT (source) DO UPDATE SET request_count = 1, window_start = now()
    RETURNING request_count INTO v_count;
  END IF;

  RETURN v_count;
END;
$$;
