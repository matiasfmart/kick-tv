const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { resolveChannel, channelStatus, searchChannels } = require('./kick.cjs');

const root = path.resolve(__dirname, '..', 'app');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname.startsWith('/api/')) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method !== 'GET') {
      response.writeHead(405);
      response.end(JSON.stringify({ code: 'METHOD', message: 'Solo se admite GET.' }));
      return;
    }
    const match = pathname.match(/^\/api\/channels\/([a-z0-9_-]{1,50})(\/status)?$/i);
    if (!match && pathname !== '/api/search') {
      response.writeHead(404);
      response.end(JSON.stringify({ code: 'API_ROUTE', message: 'Endpoint no encontrado.' }));
      return;
    }
    try {
      const result = pathname === '/api/search'
        ? { channels: await searchChannels(url.searchParams.get('q')) }
        : await (match[2] ? channelStatus(match[1]) : resolveChannel(match[1]));
      response.end(JSON.stringify(result));
    }
    catch (error) {
      response.writeHead(error.status || 502);
      response.end(JSON.stringify({ code: error.code || 'PROXY_ERROR', message: error.code ? error.message : 'Error del proxy local.' }));
    }
    return;
  }
  const relative = pathname.replace(/^\/app\//, '/');
  const filename = path.resolve(root, '.' + (relative === '/' ? '/tv.html' : relative));
  if (!filename.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filename, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.setHeader('Content-Type', (types[path.extname(filename)] || 'application/octet-stream') + '; charset=utf-8');
    response.end(content);
  });
}).listen(port, '0.0.0.0', () => {
  console.log('Kick TV: http://localhost:' + port);
  console.log('TV (misma red): http://192.168.0.220:' + port);
}).on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'Puerto ocupado. Probar PORT=5174 npm start.' : error.message);
  process.exitCode = 1;
});