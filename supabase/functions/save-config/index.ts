import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/db.ts';
import { z } from 'npm:zod@3.23.8';

const ALLOWED_KEYS = [
  'audit_frequency',
  'conciliation_auto',
  'conciliation_frequency',
  'export_format',
  // Módulo 03 — Precificação: parâmetros de negócio usados para calcular
  // preço mínimo, preço recomendado e rentabilidade. Não são credenciais
  // nem tocam nas integrações homologadas — são apenas números de negócio.
  'pricing_ml_commission_pct',
  'pricing_shopee_commission_pct',
  'pricing_target_margin_pct',
  'pricing_fixed_costs_monthly',
  // Módulo 04 — Financeiro / Estoque Inteligente: prazo médio do
  // fornecedor e estoque de segurança, usados para sugerir reposição.
  'inventory_supplier_lead_time_days',
  'inventory_safety_stock_days',
  'inventory_low_coverage_threshold_days',
  // Módulo 09 — Central de Administração: Centro de Estratégias. Define
  // os pesos que o Índice CIO usa para combinar as 3 saúdes (Módulo 01 /
  // Documento 11, seção 10). Não é credencial nem toca integrações.
  'motor_cio_strategy',
  'motor_cio_weight_operacional',
  'motor_cio_weight_financeira',
  'motor_cio_weight_comercial',
  // Módulo 09 — Central de Administração: Empresa. Usado para exibir
  // identidade e preferências regionais (moeda, fuso) em relatórios e
  // no restante do sistema.
  'company_name',
  'company_cnpj',
  'company_timezone',
  'company_currency',
] as const;

const BodySchema = z.object({
  config: z.record(
    z.enum(ALLOWED_KEYS),
    z.string().max(500)
  ).refine((entries) => Object.keys(entries).length > 0, {
    message: 'Pelo menos uma chave de configuração deve ser fornecida',
  }),
});

Deno.serve(async (req: Request) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido' }, 405);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo inválido' }, 400);
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  }

  const entries = parsed.data.config;
  const now = new Date().toISOString();
  const rows = Object.entries(entries).map(([key, value]) => ({ key, value, updated_at: now }));

  const db = serviceClient();
  const { error } = await db.from('system_config').upsert(rows, { onConflict: 'key' });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true });
});
