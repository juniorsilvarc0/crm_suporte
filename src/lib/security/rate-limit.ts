// Rate limiter em memória (janela fixa), por processo. Adequado a um deploy de
// INSTÂNCIA ÚNICA (servidor Node/Docker), que é o caso deste app. Para múltiplas
// instâncias/serverless, trocar por um store compartilhado (ex.: Redis/Upstash),
// pois cada processo teria seu próprio contador.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: boolean; retryAfter: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();

  // Limpeza preguiçosa para não vazar memória com chaves antigas.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

// Extrai um identificador de cliente do request (IP via proxy). Cai em "unknown"
// se ausente (ex.: local), o que só agrupa os requests locais num mesmo balde.
export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip || request.headers.get("x-real-ip") || "unknown";
}
