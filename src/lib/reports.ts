// ─── Módulo 07 — Central de Relatórios ───────────────────────────────────
// A maior ideia do documento é inverter "quais relatórios existem" por
// "o usuário monta o que quer ver" (Construtor Inteligente de Relatórios).
// Implementamos isso primeiro, em vez de dezenas de relatórios fixos —
// é o que o próprio documento recomenda como prioridade.
//
// LIMITAÇÃO HONESTA: exportação aqui é CSV (abre no Excel) e JSON, gerados
// no navegador sem nenhuma biblioteca nova. PDF e .xlsx binário exigiriam
// adicionar dependências novas ao projeto — não fiz isso sem combinar,
// já que pode exigir reinstalar pacotes no bolt.new. Agendamento de envio
// por e-mail também fica de fora por enquanto: exige um serviço de e-mail
// que ainda não está integrado.

export type DatasetId = 'produtos_erp' | 'anuncios_ml' | 'divergencias' | 'precificacao' | 'estoque';

export interface ColumnDef<T> {
  key: string;
  label: string;
  get: (row: T) => string | number | null;
}

export interface DatasetDef<T> {
  id: DatasetId;
  label: string;
  description: string;
  columns: ColumnDef<T>[];
}

export function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(';'), ...rows.map((r) => r.map(escape).join(';'))];
  return lines.join('\n');
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
