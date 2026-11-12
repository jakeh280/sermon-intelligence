import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { RequestBudget, ADDRESS_LIMIT, DAY_LIMIT, MONTH_LIMIT } from './worker.mjs';
function fixture() {
  const db = new DatabaseSync(':memory:');
  const alarm = { at: null };
  const ctx = { storage: {
    getAlarm: async () => alarm.at,
    setAlarm: async at => { alarm.at = at; },
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
  return { db, ctx, budget, consume, alarm };
}
test('per-address admission persists across instances and concurrent requests', async () => {
  const f = fixture();
  try {
    const decisions = await Promise.all(Array.from({ length: 25 }, () => f.consume()));
    assert.equal(decisions.filter(x => x.allowed).length, ADDRESS_LIMIT);
    assert.ok(decisions.filter(x => !x.allowed).every(x => x.scope === 'address'));
    assert.equal((await f.consume('a'.repeat(64), new RequestBudget(f.ctx))).allowed, false);
    assert.equal((await f.consume('b'.repeat(64))).allowed, true);
    f.db.prepare('UPDATE hits SET at = ?').run(Date.now() - 3600001);
    assert.equal((await f.consume()).allowed, true);
  } finally { f.db.close(); }
});
test('sitewide day and month ceilings cannot be bypassed with more addresses', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < DAY_LIMIT; i++) assert.equal((await f.consume(i.toString(16).padStart(64, '0'))).allowed, true);
    assert.deepEqual(await f.consume('f'.repeat(64)).then(x => [x.allowed, x.scope]), [false, 'site']);
    const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
    f.db.prepare('UPDATE totals SET count = 0 WHERE bucket = ?').run(day);
    f.db.prepare('UPDATE totals SET count = ? WHERE bucket = ?').run(MONTH_LIMIT, month);
    assert.equal((await f.consume('e'.repeat(64))).allowed, false);
    f.db.prepare('DELETE FROM totals').run();
    assert.equal((await f.consume('e'.repeat(64))).allowed, true);
  } finally { f.db.close(); }
});
test('an alarm deletes address digests an hour after they are written', async () => {
  const f = fixture();
  try {
    const before = Date.now();
    await f.consume('a'.repeat(64));
    assert.ok(f.alarm.at >= before + 3600000 && f.alarm.at <= Date.now() + 3600000);
    const firstAlarm = f.alarm.at;
    await f.consume('b'.repeat(64));
    assert.equal(f.alarm.at, firstAlarm, 'a pending alarm is not pushed back');
    const now = Date.now();
    f.db.prepare('UPDATE hits SET at = ? WHERE ip = ?').run(now - 3600001, 'a'.repeat(64));
    f.db.prepare('UPDATE hits SET at = ? WHERE ip = ?').run(now - 600000, 'b'.repeat(64));
    await f.budget.alarm();
    assert.deepEqual(f.db.prepare('SELECT ip FROM hits').all().map(x => x.ip), ['b'.repeat(64)]);
    assert.equal(f.alarm.at, now - 600000 + 3600000, 'rearmed for the next digest to expire');
    f.alarm.at = null;
    f.db.prepare('UPDATE hits SET at = ?').run(now - 3600001);
    await f.budget.alarm();
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM hits').get().n, 0);
    assert.equal(f.alarm.at, null, 'no alarm once nothing is left to expire');
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

test('authenticated health probes exercise storage without using any allowance', async () => {
  const f = fixture();
  const names = [];
  const env = { LIMITER_SECRET: 'test-secret', BUDGET: {
    idFromName: name => { names.push(name); return name; },
    get: () => f.budget,
  } };
  try {
    assert.equal((await worker.fetch(new Request('https://limits.example/health/production'), env)).status, 401);
    for (const environment of ['production', 'preview']) {
      const request = new Request(`https://limits.example/health/${environment}`, { headers: { Authorization: 'Bearer test-secret' } });
      assert.deepEqual(await (await worker.fetch(request, env)).json(), { healthy: true });
    }
    assert.deepEqual(names, ['production', 'preview']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM hits').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM totals').get().n, 0);
    assert.equal(f.alarm.at, null);
    for (let i = 0; i < ADDRESS_LIMIT; i++) assert.equal((await f.consume()).allowed, true);
    assert.equal((await f.consume()).allowed, false);
  } finally { f.db.close(); }
});
