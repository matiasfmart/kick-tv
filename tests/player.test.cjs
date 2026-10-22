const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const code = esbuild.buildSync({ stdin: { contents: "export * from './src/hub/presentation/player'; export * from './src/hub/domain/contracts'; export * from './src/hub/application/services'; export * from './src/hub/application/grid';", resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text;

function fixture(unverified = false) {
  const elements = {};
  const document = { activeElement: null, hidden: false, body: {}, addEventListener() {}, getElementById(id) {
    if (!elements[id]) elements[id] = { id, hidden: false, textContent: '', className: '', src: '', paused: false, currentTime: 0, videoWidth: 1280, videoHeight: 720, events: {},
      addEventListener(name, callback) { this.events[name] = callback; },
      emit(name) { this.events[name]?.(); },
      getAttribute(name) { return name === 'src' ? this.src : null; },
      setAttribute() {}, focus() { document.activeElement = this; },
      getBoundingClientRect() { return { height: 20 }; }, contains() { return false; }
    };
    return elements[id];
  } };
  const window = { setTimeout() { return 1; }, clearTimeout() {} };
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', 'document', 'window', 'navigator', code)(loaded, loaded.exports, require, document, window, { onLine: true });
  const core = loaded.exports;
  document.activeElement = document.getElementById('watch');
  const values = {};
  const store = { get(key) { return values[key] || null; }, set(key, value) { values[key] = value; } };
  const registry = new core.ServiceRegistry();
  const item = new core.LiveChannel({ sourceId: 'iptv', itemId: 'One.ar' }, 'Canal Uno', '', 'AR', ['general'], ['spa'], { status: unverified ? 'unverified' : 'ok' });
  const candidates = [{ id: 'main', url: 'https://official.example/main.m3u8', label: 'Original', height: 720, fps: 0 }, { id: 'backup', url: 'https://official.example/backup.m3u8', label: 'Alternativa', height: 480, fps: 0 }];
  registry.register({ id: 'iptv', name: 'IPTV', view: { describe() { return item; } }, source: { resolvePlayback(ref, done) { done({ ok: true, value: { item, candidates } }); return { cancel() {} }; } } });
  const video = document.getElementById('player-video'); const opened = [];
  const adapter = { open(candidate) { video.src = candidate.url; opened.push(candidate.id); }, play() { video.paused = false; video.emit('playing'); }, pause() { video.paused = true; video.emit('pause'); }, stop() { video.src = ''; }, dispose() {} };
  const health = new core.StreamHealthService(store, { now: () => 1000 });
  const playback = new core.PlaybackService(registry, adapter, new core.HistoryService(store, { now: () => 1000 }));
  const controller = new core.PlayerController(playback, registry, new core.FavoritesService(store), new core.ZappingService(), new core.ChannelGridService(store), health, store, { play: '', pause: '', star: '', 'star-off': '' });
  return { controller, video, health, opened, values, document };
}

test('reproductor comun: cambia al fallback antes de mostrar error final', () => {
  const context = fixture();
  context.controller.open({ sourceId: 'iptv', itemId: 'One.ar' });
  assert.deepEqual(context.opened, ['main']);
  context.video.error = { code: 2 }; context.video.emit('error');
  assert.deepEqual(context.opened, ['main', 'backup']);
  assert.equal(context.health.blocked('main'), true);
  context.video.emit('error');
  assert.equal(context.health.blocked('channel:iptv:One.ar'), true);
  assert.match(context.document.getElementById('player-message').textContent, /Reintentar/);
});

test('reproductor comun: solo el avance real registra historial y limpia fallos', () => {
  const context = fixture();
  context.health.fail('channel:iptv:One.ar');
  context.controller.open({ sourceId: 'iptv', itemId: 'One.ar' });
  assert.equal(context.values['stream-hub-history-v1'], undefined);
  context.video.currentTime = 5; context.video.emit('timeupdate');
  assert.equal(JSON.parse(context.values['stream-hub-history-v1'])[0].ref.itemId, 'One.ar');
  assert.equal(context.health.blocked('channel:iptv:One.ar'), false);
});

test('reproductor comun: Back/cierre libera el video sin registrar una caida', () => {
  const context = fixture(); context.controller.open({ sourceId: 'iptv', itemId: 'One.ar' }); context.controller.close();
  assert.equal(context.video.src, '');
  assert.equal(context.values['stream-hub-stream-health-v1'], undefined);
  assert.equal(context.document.getElementById('library').hidden, false);
});

test('reproductor comun: avance normal no escribe salud local sin fallos previos', () => {
  const context = fixture(); context.controller.open({ sourceId: 'iptv', itemId: 'One.ar' });
  context.video.currentTime = 1; context.video.emit('timeupdate');
  assert.equal(context.values['stream-hub-stream-health-v1'], undefined);
});

test('reproductor bajo demanda: informa disponibilidad real y fallo final del dispositivo', () => {
  const context = fixture(true);
  context.controller.open({ sourceId: 'iptv', itemId: 'One.ar' });
  assert.match(context.document.getElementById('player-message').textContent, /Esperando avance del video/);
  context.video.currentTime = 1; context.video.emit('timeupdate');
  assert.match(context.document.getElementById('player-message').textContent, /Disponible en este dispositivo/);
  context.video.error = { code: 2 }; context.video.emit('error'); context.video.emit('error');
  assert.match(context.document.getElementById('player-message').textContent, /No disponible en este dispositivo/);
});