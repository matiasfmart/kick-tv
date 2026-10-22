const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const ipaddr = require('ipaddr.js');
const { failure, safeURL } = require('./policy.cjs');

function publicAddress(value) {
  try { return ipaddr.process(value).range() === 'unicast'; }
  catch { return false; }
}

async function resolvePublic(value, lookup = dns.lookup) {
  const url = safeURL(value);
  if (!url || !url.hostname || url.hostname.toLowerCase() === 'localhost' || url.hostname.toLowerCase().endsWith('.localhost') || url.hostname.toLowerCase().endsWith('.local')) {
    throw failure('UNSAFE_URL', 'Destino de red no permitido.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw failure('UNSAFE_ADDRESS', 'El destino no tiene exclusivamente direcciones publicas.');
  return { url, pinned: addresses.find(item => item.family === 4) || addresses[0] };
}

function abortError() { return failure('ABORTED', 'Consulta cancelada o timeout.'); }

function cancellable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

class SafeHttpClient {
  constructor({ lookup = dns.lookup, request } = {}) { this.lookup = lookup; this.request = request; }
  async get(value, options = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) throw abortError();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, options.timeoutMs || 6000);
    try {
      let current = value;
      for (let redirect = 0; redirect <= 4; redirect++) {
        const destination = await cancellable(resolvePublic(current, this.lookup), controller.signal);
        const response = await this.read(destination, { ...options, signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        if (!response.headers.location) throw failure('REDIRECT', 'Redireccion sin destino.');
        current = new URL(response.headers.location, destination.url).href;
      }
      throw failure('REDIRECT_LIMIT', 'Demasiadas redirecciones.');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
  read({ url, pinned }, options) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const maxBytes = options.maxBytes || 262144;
      const headers = { Accept: '*/*' };
      for (const [name, value] of Object.entries(options.headers || {})) {
        if (!['referer', 'user-agent', 'range', 'accept'].includes(name.toLowerCase()) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 2048) {
          reject(failure('UNSAFE_HEADER', 'Header no permitido.')); return;
        }
        headers[name] = value;
      }
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(result);
      };
      const onAbort = () => { request?.destroy(); finish(abortError()); };
      if (options.signal.aborted) { reject(abortError()); return; }
      options.signal.addEventListener('abort', onAbort, { once: true });
      const transport = this.request || (url.protocol === 'https:' ? https.request : http.request);
      request = transport(url, {
        method: 'GET', headers, agent: false, autoSelectFamily: false,
        lookup: (hostname, lookupOptions, done) => {
          if (lookupOptions.all) done(null, [pinned]); else done(null, pinned.address, pinned.family);
        }
      }, response => {
        const chunks = [];
        let bytes = 0;
        const result = () => ({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).subarray(0, maxBytes), url: url.href });
        response.on('data', chunk => {
          bytes += chunk.length; chunks.push(Buffer.from(chunk));
          if (options.prefix && bytes >= maxBytes) { finish(null, result()); response.destroy(); request.destroy(); }
          else if (bytes > maxBytes) { finish(failure('BODY_LIMIT', 'Respuesta demasiado grande.')); response.destroy(); request.destroy(); }
        });
        response.on('end', () => finish(null, result()));
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(failure('NETWORK', 'Respuesta interrumpida.')));
      });
      request.on('error', error => finish(error));
      request.end();
    });
  }
}

module.exports = { SafeHttpClient, publicAddress, resolvePublic };