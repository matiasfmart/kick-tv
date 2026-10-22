const { Parser } = require('m3u8-parser');

function failure(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function mediaURL(value, base) {
  let url;
  try { url = new URL(value, base); }
  catch { throw failure('PLAYBACK_URL', 'Kick devolvio una URL de video invalida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.live-video.net')) {
    throw failure('PLAYBACK_HOST', 'El CDN de video no es uno de los hosts admitidos en esta prueba.');
  }
  return url.href;
}

async function readUpstream(url, fetcher) {
  let response;
  let body;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    body = await response.text();
  } catch {
    throw failure('UPSTREAM_NETWORK', 'No se pudo contactar a Kick o su CDN: red, TLS o timeout.');
  }
  if (response.status === 403 || /<!doctype html|<html[\s>]/i.test(body)) {
    throw failure('KICK_BLOCKED', 'Kick rechazo la consulta: posible bloqueo o desafio de Cloudflare. Probar otro proxy.');
  }
  if (response.status === 404) { throw failure('NOT_FOUND', 'El canal o stream ya no esta disponible.', 404); }
  if (response.status === 429) { throw failure('RATE_LIMIT', 'Kick limito las consultas. Reintentar mas tarde.', 503); }
  if (!response.ok) { throw failure('UPSTREAM_HTTP', 'Kick o su CDN respondio HTTP ' + response.status + '.'); }
  return body;
}

async function readChannel(slug, fetcher) {
  if (!/^[a-z0-9_-]{1,50}$/i.test(slug)) { throw failure('INVALID_SLUG', 'Nombre de canal invalido.', 400); }
  const body = await readUpstream('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), fetcher);
  let data;
  try { data = JSON.parse(body); }
  catch { throw failure('KICK_JSON', 'Kick no devolvio un JSON valido.'); }
  if (!data || typeof data.slug !== 'string') { throw failure('KICK_SCHEMA', 'La respuesta de Kick no tiene el formato esperado.'); }
  return data;
}

function normalizeChannel(data) {
  const stream = data.livestream;
  return {
    slug: data.slug,
    name: data.user?.username || data.slug,
    avatar: data.user?.profile_pic || data.user?.profilePic || '',
    live: Boolean(stream?.is_live),
    title: stream?.session_title || '',
    category: stream?.categories?.[0]?.name || '',
    viewers: Number(stream?.viewer_count) || 0,
    qualities: []
  };
}

async function channelStatus(slug, fetcher = fetch) {
  return normalizeChannel(await readChannel(slug, fetcher));
}

async function searchChannels(query, fetcher = fetch) {
  if (typeof query !== 'string' || !query.trim() || query.length > 50) {
    throw failure('INVALID_QUERY', 'Ingresar entre 1 y 50 caracteres.', 400);
  }
  const body = await readUpstream('https://kick.com/api/search?searched_word=' + encodeURIComponent(query.trim()), fetcher);
  let data;
  try { data = JSON.parse(body); }
  catch { throw failure('KICK_JSON', 'Kick no devolvio un JSON valido.'); }
  if (!Array.isArray(data?.channels)) { throw failure('KICK_SCHEMA', 'La busqueda de Kick cambio de formato.'); }
  const seen = new Set();
  return data.channels.filter(channel => {
    if (!channel || typeof channel.slug !== 'string' || !/^[a-z0-9_-]{1,50}$/i.test(channel.slug) || seen.has(channel.slug)) { return false; }
    seen.add(channel.slug);
    return true;
  }).slice(0, 24).map(channel => {
    const result = normalizeChannel(channel);
    result.live = typeof channel.isLive === 'boolean' ? channel.isLive : result.live;
    return result;
  });
}

async function resolveChannel(slug, fetcher = fetch) {
  const data = await readChannel(slug, fetcher);
  const result = normalizeChannel(data);
  if (!result.live) { return result; }
  if (typeof data.playback_url !== 'string' || !data.playback_url) {
    throw failure('MISSING_PLAYBACK', 'El canal esta en vivo, pero Kick no devolvio la URL de video.');
  }
  const masterURL = mediaURL(data.playback_url);
  const manifest = await readUpstream(masterURL, fetcher);
  if (!manifest.trimStart().startsWith('#EXTM3U')) { throw failure('HLS_MANIFEST', 'El CDN no devolvio un playlist HLS valido.'); }
  const parser = new Parser();
  try { parser.push(manifest); parser.end(); }
  catch { throw failure('HLS_PARSE', 'No se pudo interpretar el playlist HLS.'); }
  const variants = (parser.manifest.playlists || []).map((playlist, index) => {
    const attributes = playlist.attributes || {};
    const height = Number(attributes.RESOLUTION?.height) || 0;
    const fps = Number(attributes['FRAME-RATE']) || 0;
    return {
      id: 'variant-' + index,
      height,
      fps,
      bandwidth: Number(attributes.BANDWIDTH) || 0,
      label: height ? height + 'p' + (fps ? ' / ' + fps + ' fps' : '') : 'Variante ' + (index + 1),
      url: mediaURL(playlist.uri, masterURL)
    };
  }).sort((first, second) => second.height - first.height || second.fps - first.fps || second.bandwidth - first.bandwidth);
  result.qualities = [{ id: 'auto', label: 'Auto', height: 0, fps: 0, bandwidth: 0, url: masterURL }].concat(variants);
  return result;
}

module.exports = { resolveChannel, channelStatus, searchChannels };