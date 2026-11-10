export const WINDOW_MS = 3600000;
// Per address within WINDOW_MS, matching RATE_LIMIT_MAX_REQUESTS in lib/rateLimitConfig.ts.
export const ADDRESS_LIMIT = 20;
// Generous ceilings against many-address abuse; Google billing limits are the spending backstop.
export const DAY_LIMIT = 2000;
export const MONTH_LIMIT = 20000;

// One persistent object serializes admission across all application instances.
export class RequestBudget {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, at INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS hits_ip_at ON hits(ip, at)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS totals (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL)');
  }

  async fetch(request) {
    const { ip } = await request.json();
    if (typeof ip !== 'string' || !/^[a-f0-9]{64}$/.test(ip)) return new Response(null, { status: 400 });
    const now = Date.now();
    const date = new Date(now);
    const day = date.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const nextDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const result = this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM hits WHERE at <= ?', now - WINDOW_MS);
      // Retain only the active day and month, including after a long idle period.
      this.sql.exec('DELETE FROM totals WHERE bucket NOT IN (?, ?)', day, month);
      const count = key => this.sql.exec('SELECT count FROM totals WHERE bucket = ?', key).toArray()[0]?.count || 0;
      // scope tells the route whether the visitor or the whole site is out of allowance.
      const retry = (reset, scope) => ({ allowed: false, scope, retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)) });
      if (count(month) >= MONTH_LIMIT) return retry(nextMonth, 'site');
      if (count(day) >= DAY_LIMIT) return retry(nextDay, 'site');
      const hits = this.sql.exec('SELECT at FROM hits WHERE ip = ? ORDER BY at', ip).toArray();
      if (hits.length >= ADDRESS_LIMIT) return retry(hits[0].at + WINDOW_MS, 'address');
      this.sql.exec('INSERT INTO hits (ip, at) VALUES (?, ?)', ip, now);
      for (const bucket of [day, month]) {
        this.sql.exec('INSERT INTO totals (bucket, count) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1', bucket);
      }
      return { allowed: true };
    });
    // Digests expire on the hour even if no further request arrives.
    if (result.allowed && await this.storage.getAlarm() === null) await this.storage.setAlarm(now + WINDOW_MS);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }

  async alarm() {
    const now = Date.now();
    this.sql.exec('DELETE FROM hits WHERE at <= ?', now - WINDOW_MS);
    const oldest = this.sql.exec('SELECT MIN(at) AS at FROM hits').toArray()[0]?.at;
    if (oldest != null) await this.storage.setAlarm(Math.max(now + 1000, oldest + WINDOW_MS));
  }
}

function sameSecret(actual, expected) {
  if (!expected || !actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

const worker = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/consume/production', '/consume/preview'].includes(path)) {
      return new Response(null, { status: 404 });
    }
    if (!sameSecret(request.headers.get('Authorization'), `Bearer ${env.LIMITER_SECRET || ''}`) || !env.LIMITER_SECRET) {
      return new Response(null, { status: 401 });
    }
    if (Number(request.headers.get('Content-Length') || 0) > 128) return new Response(null, { status: 413 });
    const text = await request.text();
    if (text.length > 128) return new Response(null, { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
    if (typeof body?.ip !== 'string' || !/^[a-f0-9]{64}$/.test(body.ip)) return new Response(null, { status: 400 });
    const id = env.BUDGET.idFromName(path.endsWith('/production') ? 'production' : 'preview');
    return env.BUDGET.get(id).fetch(new Request('https://internal/consume', { method: 'POST', body: JSON.stringify({ ip: body.ip }) }));
  },
};

export default worker;
