const test = require('node:test');
const assert = require('node:assert/strict');

async function handler() {
  return (await import('../worker/probe.mjs')).handleRequest;
}

test('Worker probe: la entrada publica admite fetch(request, env, ctx)', async () => {
  const worker = (await import('../worker/probe.mjs')).default;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ slug: 'xqc', livestream: null }));
    const response = await worker.fetch(new Request('https://probe.workers.dev/probe'), {}, {});
    assert.equal((await response.json()).ok, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('Vercel probe: /api/probe usa el mismo diagnostico y no expone tokens', async () => {
  const vercel = (await import('../api/probe.mjs')).default;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async url => {
      calls++;
      assert.equal(url, 'https://kick.com/api/v2/channels/xqc');
      return new Response(JSON.stringify({ slug: 'xqc', livestream: { is_live: true }, playback_url: 'https://video.example/?token=secret' }));
    };
    const response = await vercel.fetch(new Request('https://probe.vercel.app/api/probe'));
    const body = await response.text();
    assert.equal(JSON.parse(body).ok, true);
    assert.equal(body.includes('secret'), false);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(calls, 1);
    const options = await vercel.fetch(new Request('https://probe.vercel.app/api/probe', { method: 'OPTIONS' }));
    assert.equal(options.status, 204);
    const post = await vercel.fetch(new Request('https://probe.vercel.app/api/probe', { method: 'POST' }));
    assert.equal(post.status, 405);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Worker probe: salud, CORS y rutas no disparan consultas arbitrarias', async () => {
  const handle = await handler();
  const fetcher = () => { throw new Error('No debe consultar Kick'); };
  const root = await handle(new Request('https://probe.workers.dev/'), fetcher);
  assert.equal((await root.json()).service, 'kick-tv-probe');
  assert.equal(root.headers.get('access-control-allow-origin'), '*');
  assert.equal((await handle(new Request('https://probe.workers.dev/probe', { method: 'OPTIONS' }), fetcher)).status, 204);
  assert.equal((await handle(new Request('https://probe.workers.dev/probe', { method: 'POST' }), fetcher)).status, 405);
  assert.equal((await handle(new Request('https://probe.workers.dev/other'), fetcher)).status, 404);
});

test('Worker probe: consulta fija y resultado sin tokens ni URL de video', async () => {
  const handle = await handler();
  const response = await handle(new Request('https://probe.workers.dev/probe?url=http://localhost'), async (url, options) => {
    assert.equal(url, 'https://kick.com/api/v2/channels/xqc');
    assert.equal(options.redirect, 'manual');
    return new Response(JSON.stringify({ slug: 'xqc', user: { username: 'xQc' }, livestream: { is_live: true }, playback_url: 'https://video.example/master.m3u8?token=secret' }));
  });
  const result = await response.text();
  assert.equal(JSON.parse(result).ok, true);
  assert.equal(JSON.parse(result).playbackUrlPresent, true);
  assert.equal(result.includes('secret'), false);
  assert.equal(result.includes('video.example'), false);
});

test('Worker probe: distingue bloqueo, HTTP, JSON, formato y fallo de red', async () => {
  const handle = await handler();
  const request = new Request('https://probe.workers.dev/probe');
  for (const [body, status, code] of [
    ['Forbidden', 403, 'KICK_BLOCKED'],
    ['<html>Challenge</html>', 200, 'KICK_BLOCKED'],
    ['Limited', 429, 'KICK_HTTP_ERROR'],
    ['Redirect', 302, 'KICK_REDIRECT'],
    ['invalid', 200, 'KICK_INVALID_JSON'],
    ['null', 200, 'KICK_INVALID_SCHEMA']
  ]) {
    const response = await handle(request, async () => new Response(body, { status }));
    assert.equal((await response.json()).code, code);
  }
  const response = await handle(request, async () => { throw new Error('Network https://example.com/?token=secret'); });
  const result = await response.json();
  assert.equal(result.code, 'KICK_NETWORK_ERROR');
  assert.equal(result.timedOut, false);
  assert.equal(result.errorName, 'Error');
  assert.equal(result.errorMessage.includes('secret'), false);
});