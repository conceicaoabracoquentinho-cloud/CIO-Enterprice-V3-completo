import { getAllConfig } from './supabase';
import { callEdgeFunction } from './edge';

// ─── Módulo 09 — Central de Administração: Centro de Estratégias ───────
// "Em vez de o usuário configurar dezenas de parâmetros técnicos, ele
// escolheria uma estratégia de negócio." Isso substitui os pesos fixos
// que o Índice CIO (Módulo 01 / Documento 11, seção 10) usava até aqui —
// eram uma média simples porque este módulo ainda não existia.

export type StrategyId = 'crescimento' | 'lucratividade' | 'equilibrio' | 'personalizado';

export interface StrategyWeights {
  operacional: number; // soma dos 3 deve dar 1
  financeira: number;
  comercial: number;
}

export const STRATEGY_PRESETS: Record<Exclude<StrategyId, 'personalizado'>, { label: string; description: string; weights: StrategyWeights }> = {
  crescimento: {
    label: 'Crescimento',
    description: 'Prioriza giro e presença nos marketplaces. Aceita margens menores para ganhar faturamento e alcance.',
    weights: { operacional: 0.45, financeira: 0.2, comercial: 0.35 },
  },
  lucratividade: {
    label: 'Lucratividade',
    description: 'Prioriza margem e saúde financeira. Reduz peso de produtos pouco rentáveis mesmo que vendam bem.',
    weights: { operacional: 0.25, financeira: 0.5, comercial: 0.25 },
  },
  equilibrio: {
    label: 'Equilíbrio',
    description: 'Balanço entre crescimento, giro e margem — o ponto de partida recomendado.',
    weights: { operacional: 0.34, financeira: 0.33, comercial: 0.33 },
  },
};

export interface StrategyConfig {
  strategy: StrategyId;
  weights: StrategyWeights;
}

const DEFAULT_CONFIG: StrategyConfig = { strategy: 'equilibrio', weights: STRATEGY_PRESETS.equilibrio.weights };

function toNumber(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getStrategyConfig(): Promise<StrategyConfig> {
  const cfg = await getAllConfig();
  const strategy = (cfg.motor_cio_strategy as StrategyId) ?? DEFAULT_CONFIG.strategy;

  if (strategy !== 'personalizado' && strategy in STRATEGY_PRESETS) {
    return { strategy, weights: STRATEGY_PRESETS[strategy as Exclude<StrategyId, 'personalizado'>].weights };
  }

  return {
    strategy: 'personalizado',
    weights: {
      operacional: toNumber(cfg.motor_cio_weight_operacional, DEFAULT_CONFIG.weights.operacional),
      financeira: toNumber(cfg.motor_cio_weight_financeira, DEFAULT_CONFIG.weights.financeira),
      comercial: toNumber(cfg.motor_cio_weight_comercial, DEFAULT_CONFIG.weights.comercial),
    },
  };
}

export async function saveStrategyConfig(config: StrategyConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await callEdgeFunction('save-config', {
      config: {
        motor_cio_strategy: config.strategy,
        motor_cio_weight_operacional: String(config.weights.operacional),
        motor_cio_weight_financeira: String(config.weights.financeira),
        motor_cio_weight_comercial: String(config.weights.comercial),
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao salvar estratégia.' };
  }
}
