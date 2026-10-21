import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { RequestBudget } from './worker.mjs';
function fixture() {
  const db = new DatabaseSync(':memory:');
  const ctx = { storage: {
    sql: { exec(query, ...args) {
      const statement = db.prepare(query);
      if (/^SELECT/.test(query)) { const rows = statement.all(...args); return { toArray: () => rows }; }
      statement.run(...args); return { toArray: () => [] };
    } },
    transactionSync(callback) {
      db.exec('BEGIN');
      try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } };
  const budget = new RequestBudget(ctx);
  const consume = async (ip = 'a'.repeat(64), instance = budget) => (await instance.fetch(new Request('https://internal', { method: 'POST', body: JSON.stringify({ ip }) }))).json();
  return { db, ctx, budget, consume };
}
test('per-address admission persists across instances and concurrent requests', async () => {
  const f = fixture();
  try {
    const decisions = await Promise.all(Array.from({ length: 25 }, () => f.consume()));
    assert.equal(decisions.filter(x => x.allowed).length, 20);
    assert.equal((await f.consume('a'.repeat(64), new RequestBudget(f.ctx))).allowed, false);
    assert.equal((await f.consume('b'.repeat(64))).allowed, true);
    f.db.prepare('UPDATE hits SET at = ?').run(Date.now() - 3600001);
    assert.equal((await f.consume()).allowed, true);
  } finally { f.db.close(); }
});
test('sitewide day and month ceilings cannot be bypassed with more addresses', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 50; i++) assert.equal((await f.consume(i.toString(16).padStart(64, '0'))).allowed, true);
    assert.equal((await f.consume('f'.repeat(64))).allowed, false);
    const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
    f.db.prepare('UPDATE totals SET count = 0 WHERE bucket = ?').run(day);
    f.db.prepare('UPDATE totals SET count = 500 WHERE bucket = ?').run(month);
    assert.equal((await f.consume('e'.repeat(64))).allowed, false);
    f.db.prepare('DELETE FROM totals').run();
    assert.equal((await f.consume('e'.repeat(64))).allowed, true);
  } finally { f.db.close(); }
});
test('worker refuses unauthenticated, oversized, invalid and unexpected requests', async () => {
  let calls = 0;
  const env = { LIMITER_SECRET: 'private-test-key', BUDGET: { idFromName: x => x, get: () => ({ fetch: () => { calls++; return Response.json({ allowed: true }); } }) } };
  const send = (path, headers = {}, body = JSON.stringify({ ip: 'a'.repeat(64) })) => worker.fetch(new Request(`https://limits.example${path}`, { method: 'POST', headers, body }), env);
  assert.equal((await send('/consume/production')).status, 401);
  assert.equal((await send('/consume/production', { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await send('/other')).status, 404);
  const headers = { Authorization: 'Bearer private-test-key' };
  assert.equal((await send('/consume/production', headers, 'a'.repeat(129))).status, 413);
  assert.equal((await send('/consume/production', headers, '{}')).status, 400);
  assert.equal(calls, 0);
  assert.equal((await send('/consume/production', headers)).status, 200);
  assert.equal(calls, 1);
});
