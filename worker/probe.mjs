const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export async function handleRequest(request, fetcher = fetch) {
  if (request.method === 'OPTIONS') { return new Response(null, { status: 204, headers }); }
  if (request.method !== 'GET') { return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405); }
  const pathname = new URL(request.url).pathname;
  if (pathname === '/') {
    return json({ service: 'kick-tv-probe', version: 2, next: '/probe' });
  }
  if (pathname !== '/probe') { return json({ ok: false, code: 'NOT_FOUND' }, 404); }

  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher('https://kick.com/api/v2/channels/xqc', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'manual'
    });
    const body = await response.text();
    const result = { ok: false, upstreamStatus: response.status };
    if (response.status >= 300 && response.status < 400) {
      let locationHost = null;
      try { locationHost = new URL(response.headers.get('location'), 'https://kick.com').hostname; }
      catch { }
      return json({ ...result, code: 'KICK_REDIRECT', locationHost });
    }
    if (response.status === 403 || /<!doctype html|<html[\s>]/i.test(body)) {
      return json({ ...result, code: 'KICK_BLOCKED', message: 'Kick rechazo la consulta desde este alojamiento o devolvio HTML de un posible desafio.' });
    }
    if (!response.ok) { return json({ ...result, code: 'KICK_HTTP_ERROR' }); }
    let channel;
    try { channel = JSON.parse(body); }
    catch { return json({ ...result, code: 'KICK_INVALID_JSON' }); }
    if (!channel || typeof channel.slug !== 'string') { return json({ ...result, code: 'KICK_INVALID_SCHEMA' }); }
    return json({
      ok: true,
      upstreamStatus: response.status,
      channel: channel.slug,
      name: channel.user?.username || channel.slug,
      live: Boolean(channel.livestream?.is_live),
      playbackUrlPresent: typeof channel.playback_url === 'string' && Boolean(channel.playback_url)
    });
  } catch (error) {
    return json({
      ok: false,
      code: 'KICK_NETWORK_ERROR',
      timedOut: controller.signal.aborted,
      durationMs: Date.now() - startedAt,
      errorName: String(error && error.name || 'Error').slice(0, 80),
      errorMessage: String(error && error.message || 'Sin detalle').replace(/https?:\/\/[^\s]+/gi, '[URL]').slice(0, 200)
    });
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  fetch(request) { return handleRequest(request); }
};