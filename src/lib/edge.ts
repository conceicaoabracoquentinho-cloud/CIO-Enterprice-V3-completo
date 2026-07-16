const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function authHeaders(): Record<string, string> {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };
}

export function edgeFunctionUrl(name: string): string {
  return `${FUNCTIONS_URL}/${name}`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Resposta inválida da Edge Function (HTTP ${res.status})`);
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : `Erro HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function callEdgeFunction<T = unknown>(name: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(edgeFunctionUrl(name), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return parseResponse<T>(res);
}

export async function getEdgeFunction<T = unknown>(name: string): Promise<T> {
  const res = await fetch(edgeFunctionUrl(name), { headers: authHeaders() });
  return parseResponse<T>(res);
}
