import kick from '../scripts/kick.cjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store'
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}

export async function handleAPI(request, services = kick) {
  if (request.method === 'OPTIONS') { return new Response(null, { status: 204, headers }); }
  if (request.method !== 'GET') { return json({ code: 'METHOD', message: 'Solo se admite GET.' }, 405); }
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/channels\/([a-z0-9_-]{1,50})(\/status)?$/i);
  if (url.pathname === '/api/health') { return json({ service: 'kick-tv-api', version: 1 }); }
  if (!match && url.pathname !== '/api/search') { return json({ code: 'API_ROUTE', message: 'Endpoint no encontrado.' }, 404); }
  try {
    const result = match
      ? await (match[2] ? services.channelStatus(match[1]) : services.resolveChannel(match[1]))
      : { channels: await services.searchChannels(url.searchParams.get('q')) };
    return json(result);
  } catch (error) {
    return json({ code: error.code || 'PROXY_ERROR', message: error.code ? error.message : 'Error del proxy. Reintentar mas tarde.' }, error.status || 502);
  }
}

export default {
  fetch(request) { return handleAPI(request); }
};