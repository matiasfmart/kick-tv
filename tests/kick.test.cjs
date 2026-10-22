const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveChannel, channelStatus, searchChannels } = require('../scripts/kick.cjs');

const masterURL = 'https://example.playback.live-video.net/path/master.m3u8?token=fresh';
const liveChannel = { slug: 'xqc', user: { username: 'xQc' }, playback_url: masterURL, livestream: { is_live: true, session_title: 'Live', viewer_count: 42, categories: [{ name: 'Games' }] } };
const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="avc1.4d401f,mp4a.40.2"\n720.m3u8?token=variant\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,FRAME-RATE=60.000\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=16000000,RESOLUTION=3840x2160,FRAME-RATE=30.000\n4k.m3u8\n';

test('resuelve una URL fresca, conserva query y ofrece variantes sin tope 1080p', async () => {
  const requests = [];
  const channel = await resolveChannel('xqc', async url => {
    requests.push(url);
    return new Response(requests.length === 1 ? JSON.stringify(liveChannel) : manifest);
  });
  assert.deepEqual(requests, ['https://kick.com/api/v2/channels/xqc', masterURL]);
  assert.equal(channel.name, 'xQc');
  assert.equal(channel.viewers, 42);
  assert.equal(channel.category, 'Games');
  assert.deepEqual(channel.qualities.map(quality => quality.height), [0, 2160, 1080, 720]);
  assert.equal(channel.qualities[3].url, 'https://example.playback.live-video.net/path/720.m3u8?token=variant');
  assert.equal(channel.qualities[3].fps, 60);
});

test('offline no consulta playlists', async () => {
  let requests = 0;
  const result = await resolveChannel('offline', async () => {
    requests++;
    return new Response(JSON.stringify({ slug: 'offline', livestream: null }));
  });
  assert.equal(result.live, false);
  assert.deepEqual(result.qualities, []);
  assert.equal(requests, 1);
});

test('distingue bloqueo, rate limit, JSON invalido y red', async () => {
  await assert.rejects(resolveChannel('xqc', async () => new Response('Forbidden', { status: 403 })), { code: 'KICK_BLOCKED' });
  await assert.rejects(resolveChannel('xqc', async () => new Response('<html>Challenge</html>')), { code: 'KICK_BLOCKED' });
  await assert.rejects(resolveChannel('xqc', async () => new Response('Limited', { status: 429 })), { code: 'RATE_LIMIT' });
  await assert.rejects(resolveChannel('xqc', async () => new Response('invalid')), { code: 'KICK_JSON' });
  await assert.rejects(resolveChannel('xqc', async () => { throw new Error('TLS failure'); }), { code: 'UPSTREAM_NETWORK' });
});

test('rechaza slugs y hosts arbitrarios antes de consultarlos', async () => {
  await assert.rejects(resolveChannel('../secret'), { code: 'INVALID_SLUG' });
  let requests = 0;
  await assert.rejects(resolveChannel('xqc', async () => {
    requests++;
    return new Response(JSON.stringify({ ...liveChannel, playback_url: 'http://127.0.0.1/private' }));
  }), { code: 'PLAYBACK_HOST' });
  assert.equal(requests, 1);
});

test('detecta playlist invalido y stream sin playback', async () => {
  let requests = 0;
  await assert.rejects(resolveChannel('xqc', async () => new Response(++requests === 1 ? JSON.stringify(liveChannel) : 'not a playlist')), { code: 'HLS_MANIFEST' });
  await assert.rejects(resolveChannel('xqc', async () => new Response(JSON.stringify({ ...liveChannel, playback_url: null }))), { code: 'MISSING_PLAYBACK' });
});

test('el estado de un canal en vivo no consulta HLS ni expone tokens', async () => {
  let requests = 0;
  const channel = await channelStatus('xqc', async () => {
    requests++;
    return new Response(JSON.stringify(liveChannel));
  });
  assert.equal(requests, 1);
  assert.equal(channel.live, true);
  assert.deepEqual(channel.qualities, []);
  assert.equal(JSON.stringify(channel).includes('token='), false);
});

test('busqueda codifica el nombre, normaliza isLive y filtra duplicados', async () => {
  const result = await searchChannels(' xqc ', async url => {
    assert.equal(url, 'https://kick.com/api/search?searched_word=xqc');
    return new Response(JSON.stringify({ channels: [
      { slug: 'xqc', isLive: true, user: { username: 'xQc', profilePic: 'https://files.kick.com/avatar.webp' } },
      { slug: 'xqc' }, { slug: '../invalid' }, {}, { slug: null }, { slug: 'offline', isLive: false }
    ] }));
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'xQc');
  assert.equal(result[0].avatar, 'https://files.kick.com/avatar.webp');
  assert.equal(result[0].live, true);
  assert.equal(result[1].live, false);
});

test('busqueda invalida o fallida no devuelve resultados vacios silenciosos', async () => {
  await assert.rejects(searchChannels(''), { code: 'INVALID_QUERY' });
  await assert.rejects(searchChannels('xqc', async () => new Response('{}')), { code: 'KICK_SCHEMA' });
  await assert.rejects(channelStatus('xqc', async () => { throw new Error('Offline network'); }), { code: 'UPSTREAM_NETWORK' });
});