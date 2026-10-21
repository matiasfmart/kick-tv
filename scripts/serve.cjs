const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'app');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const relative = pathname.replace(/^\/app\//, '/');
  const filename = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  response.setHeader('Cache-Control', 'no-store');
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