const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

async function handle(pathname, services, method = 'GET') {
  const { handleAPI } = await import('../api/index.mjs');
  return handleAPI(new Request('https://kick-tv-phi.vercel.app' + pathname, { method }), services);
}

test('API publicada: enruta busqueda, estado y reproduccion al adaptador compartido', async () => {
  const calls = [];
  const services = {
    async searchChannels(query) { calls.push(['search', query]); return [{ slug: 'xqc' }]; },
    async channelStatus(slug) { calls.push(['status', slug]); return { slug, live: true }; },
    async resolveChannel(slug) { calls.push(['playback', slug]); return { slug, qualities: [{ url: 'https://video.example/?token=temporary' }] }; }
  };
  const search = await handle('/api/search?q=xqc', services);
  assert.equal((await search.json()).channels[0].slug, 'xqc');
  const status = await handle('/api/channels/xqc/status', services);
  assert.equal((await status.json()).live, true);
  const playback = await handle('/api/channels/xqc', services);
  assert.equal((await playback.json()).qualities.length, 1);
  assert.deepEqual(calls, [['search', 'xqc'], ['status', 'xqc'], ['playback', 'xqc']]);
  assert.equal(playback.headers.get('cache-control'), 'no-store');
  assert.equal(playback.headers.get('vercel-cdn-cache-control'), 'no-store');
  assert.equal(playback.headers.get('access-control-allow-origin'), '*');
});

test('API publicada: salud, OPTIONS, metodos y rutas invalidas no consultan Kick', async () => {
  const services = new Proxy({}, { get() { throw new Error('No debe consultar Kick'); } });
  assert.equal((await (await handle('/api/health', services)).json()).service, 'kick-tv-api');
  assert.equal((await handle('/api/search', services, 'OPTIONS')).status, 204);
  assert.equal((await handle('/api/search', services, 'POST')).status, 405);
  assert.equal((await handle('/api/channels/invalid/extra', services)).status, 404);
});

test('API publicada: conserva errores conocidos y oculta excepciones internas', async () => {
  const blocked = await handle('/api/channels/xqc', {
    async resolveChannel() { throw Object.assign(new Error('Posible bloqueo de Cloudflare.'), { code: 'KICK_BLOCKED', status: 502 }); }
  });
  assert.equal(blocked.status, 502);
  assert.equal((await blocked.json()).code, 'KICK_BLOCKED');
  const internal = await handle('/api/channels/xqc', { async resolveChannel() { throw new Error('Internal secret'); } });
  const body = await internal.text();
  assert.equal(internal.status, 502);
  assert.equal(body.includes('secret'), false);
});

test('release publicada: el proxy predeterminado no depende de una IP local y las rutas se despliegan', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src/tv.js'), 'utf8');
  const program = acorn.parse(source, { ecmaVersion: 5 });
  const declarations = program.body[0].expression.callee.body.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  assert.equal(declarations.find(node => node.id.name === 'proxyURL').init.value, 'https://kick-tv-phi.vercel.app/api');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  for (const route of ['/api/health', '/api/search', '/api/channels/:slug', '/api/channels/:slug/status']) {
    assert.equal(config.rewrites.find(rewrite => rewrite.source === route).destination, '/api/index');
  }
  assert.equal(config.functions['api/index.mjs'].maxDuration, 40);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(manifest.dependencies['m3u8-parser']);
  fs.accessSync(path.join(root, manifest.appPath));
});