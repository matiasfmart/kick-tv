const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const apiReady = import('../api/index.mjs');

const root = path.resolve(__dirname, '..', 'app');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname.startsWith('/catalog/')) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    const catalogRoot = path.resolve(__dirname, '..', 'catalog-output');
    const filename = path.resolve(catalogRoot, '.' + pathname.slice('/catalog'.length));
    if (!filename.startsWith(catalogRoot + path.sep) || path.extname(filename) !== '.json') { response.writeHead(403); response.end(); return; }
    fs.readFile(filename, (error, content) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (error) { response.writeHead(404); response.end(JSON.stringify({ message: 'Catalogo no generado. Ejecutar catalog:generate.' })); return; }
      response.end(content);
    });
    return;
  }
  if (pathname.startsWith('/api/')) {
    const api = (await apiReady).default;
    const result = await api.fetch(new Request(url, { method: request.method }));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
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