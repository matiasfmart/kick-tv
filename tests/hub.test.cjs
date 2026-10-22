const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const output = esbuild.buildSync({
  stdin: {
    contents: "export * from './src/hub/domain/contracts'; export * from './src/hub/application/services'; export * from './src/hub/application/grid'; export * from './src/hub/services/kick/source'; export * from './src/hub/infrastructure/browser';",
    resolveDir: path.join(__dirname, '..'), loader: 'ts'
  }, bundle: true, write: false, platform: 'node', format: 'cjs'
}).outputFiles[0].text;
const loaded = { exports: {} };
new Function('module', 'exports', output)(loaded, loaded.exports);
const hub = loaded.exports;

function store(values = {}) { return { get: key => values[key] || null, set: (key, value) => { values[key] = value; }, values }; }

test('hub: migra favoritos Kick sin borrar claves anteriores y mantiene fuentes separadas', () => {
  const storage = store({ 'kick-tv-favorites': '["xqc","XQC","ibai"]' });
  const favorites = new hub.FavoritesService(storage);
  assert.deepEqual(favorites.list('kick').map(ref => ref.itemId), ['xqc', 'ibai']);
  favorites.replaceSource('radio', ['station']);
  favorites.replaceSource('kick', ['xqc']);
  favorites.setName({ sourceId: 'iptv', itemId: 'Canal7Neuquen.ar' }, 'Canal 7 Neuquen');
  assert.deepEqual(favorites.list(), [{ sourceId: 'radio', itemId: 'station' }, { sourceId: 'kick', itemId: 'xqc' }]);
  assert.equal(storage.values['kick-tv-favorites'], '["xqc"]');
  assert.deepEqual(new hub.FavoritesService(storage).list(), favorites.list());
  assert.equal(new hub.FavoritesService(storage).name({ sourceId: 'iptv', itemId: 'Canal7Neuquen.ar' }), 'Canal 7 Neuquen');
});

test('hub: registro rechaza ids duplicados y zapping no conoce Kick', () => {
  const registry = new hub.ServiceRegistry();
  registry.register({ id: 'test' });
  assert.throws(() => registry.register({ id: 'test' }), /duplicado/);
  const zapping = new hub.ZappingService();
  const refs = [{ sourceId: 'test', itemId: 'one' }, { sourceId: 'test', itemId: 'two' }];
  assert.deepEqual(zapping.next(refs[0], refs, 1), refs[1]);
  assert.deepEqual(zapping.next(refs[0], refs, -1), refs[1]);
  assert.equal(zapping.next(refs[0], [refs[0]], 1), null);
});

test('hub: fuente Kick normaliza HTTP sin exponer DTOs al dominio', () => {
  const paths = [];
  const data = { slug: 'xqc', name: 'xQc', live: true, title: 'Live', qualities: [{ id: 'auto', label: 'Auto', url: 'https://example.live-video.net/live.m3u8', height: 0, fps: 0 }] };
  const source = new hub.KickSource({ get(pathname, done) { paths.push(pathname); done({ ok: true, value: pathname.startsWith('/search') ? { channels: [data] } : data }); return { cancel() {} }; } });
  source.search('xqc', result => assert.equal(result.value.items[0].ref.sourceId, 'kick'));
  source.resolvePlayback({ sourceId: 'kick', itemId: 'xqc' }, result => assert.equal(result.value.candidates.length, 1));
  assert.deepEqual(paths, ['/search?q=xqc', '/channels/xqc']);
});

test('hub: cancela resoluciones viejas y registra historial solo despues de playback real', () => {
  const callbacks = [];
  const registry = new hub.ServiceRegistry();
  registry.register({ id: 'test', source: { resolvePlayback(ref, done) { callbacks.push(done); return { cancel() {} }; } } });
  const storage = store();
  const history = new hub.HistoryService(storage, { now: () => 123 });
  const opened = [];
  const player = { open: candidate => opened.push(candidate), play() {}, pause() {}, stop() {}, dispose() {} };
  const playback = new hub.PlaybackService(registry, player, history);
  let stale = false;
  playback.resolve({ sourceId: 'test', itemId: 'old' }, () => { stale = true; });
  playback.resolve({ sourceId: 'test', itemId: 'new' }, () => {});
  callbacks[0]({ ok: true, value: {} });
  assert.equal(stale, false);
  const item = new hub.LiveStream({ sourceId: 'test', itemId: 'new' }, 'New', '', '', true, '', 0);
  const quality = { id: 'auto', url: 'https://example.com/live.m3u8' };
  callbacks[1]({ ok: true, value: { item, candidates: [quality] } });
  assert.equal(history.list().length, 0);
  playback.select(quality); playback.confirmPlayback(); playback.confirmPlayback();
  assert.equal(opened.length, 1);
  assert.equal(history.list().length, 1);
  assert.equal(history.list()[0].playedAt, 123);
  assert.throws(() => playback.select({ id: 'bad', url: 'https://arbitrary.example' }), /resuelta/);
});

test('hub: Html5Player admite play sin promesa y rechaza headers no soportados', () => {
  let stopped = false;
  const video = { src: '', load() {}, play() {}, pause() {}, getAttribute() { return this.src; }, removeAttribute() { this.src = ''; stopped = true; } };
  const player = new hub.Html5Player(video);
  player.open({ url: 'https://example.com/live.m3u8' }); player.play();
  assert.throws(() => player.open({ url: 'https://example.com/live.m3u8', headers: { referrer: 'https://example.com' } }), /headers/);
  player.stop(); assert.equal(stopped, true);
});

test('Mi grilla: numeros unicos, reordenamiento por numero y persistencia', () => {
  const storage = store(); const grid = new hub.ChannelGridService(storage);
  const first = { sourceId: 'iptv', itemId: 'One.ar' }; const second = { sourceId: 'iptv', itemId: 'Two.ar' };
  grid.assign(first, 7); grid.assign(second, 2);
  assert.deepEqual(grid.list().map(entry => entry.number), [2, 7]);
  assert.throws(() => grid.assign(second, 7), /asignado/);
  assert.throws(() => grid.assign(first, 0), /999/);
  assert.deepEqual(new hub.ChannelGridService(storage).list(), grid.list());
  grid.remove(first); assert.equal(grid.list().length, 1);
});

test('salud local: cooldown vence y un exito limpia la penalizacion', () => {
  let now = 1000; const storage = store(); const health = new hub.StreamHealthService(storage, { now: () => now });
  health.fail('candidate'); assert.equal(health.blocked('candidate'), true);
  now += 1800001; assert.equal(health.blocked('candidate'), false);
  health.fail('candidate'); health.succeed('candidate'); assert.equal(health.blocked('candidate'), false);
  health.setPolicy('hide'); assert.equal(health.policy(), 'hide'); health.reset();
});