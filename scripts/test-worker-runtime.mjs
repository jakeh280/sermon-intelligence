import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const state = await mkdtemp(join(tmpdir(), 'sermon-worker-test-'));
const port = 18879;
const runtime = spawn(process.env.WRANGLER_BIN || 'wrangler', [
  'dev', '--local', '--config', 'workers/abuse-limiter/wrangler.jsonc',
  '--port', String(port), '--persist-to', state,
  '--var', 'LIMITER_SECRET:local-test-secret',
], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let log = '';
let spawnError;
runtime.on('error', error => { spawnError = error; });
runtime.stdout.on('data', chunk => { log = (log + chunk).slice(-8000); });
runtime.stderr.on('data', chunk => { log = (log + chunk).slice(-8000); });
const headers = { Authorization: 'Bearer local-test-secret', 'Content-Type': 'application/json' };
const send = (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
  headers, signal: AbortSignal.timeout(5000), ...init,
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    if (runtime.exitCode !== null) throw Error(`Worker exited: ${log}`);
    try { ready = (await send('/health/production')).ok; } catch { /* runtime starting */ }
    if (ready) break;
    await setTimeout(200);
  }
  assert.ok(ready, `Worker did not become healthy: ${log}`);
  assert.equal((await send('/health/production', { headers: {} })).status, 401);
  for (let i = 0; i < 25; i++) {
    assert.deepEqual(await (await send('/health/production')).json(), { healthy: true });
  }
  const ip = 'c'.repeat(64);
  const consume = async environment => (await send(`/consume/${environment}`, {
    method: 'POST', body: JSON.stringify({ ip }),
  })).json();
  for (let i = 0; i < 20; i++) assert.equal((await consume('production')).allowed, true);
  const refused = await consume('production');
  assert.equal(refused.allowed, false);
  assert.equal(refused.scope, 'address');
  assert.equal((await consume('preview')).allowed, true);
  console.log('Cloudflare runtime passed: authentication, storage, health, hourly limits and preview isolation.');
} finally {
  runtime.kill('SIGTERM');
  if (runtime.exitCode === null && !spawnError) {
    await new Promise(resolve => runtime.once('exit', resolve));
  }
  await rm(state, { recursive: true, force: true });
}
