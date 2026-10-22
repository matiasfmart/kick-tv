const fs = require('node:fs');
const path = require('node:path');
const { Parser } = require('m3u8-parser');
const { failure } = require('./policy.cjs');

const verifierVersion = 'hls-v1';

function atomicJSON(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, filename);
}

class VerificationState {
  constructor(filename, environment, config, clock = Date.now) {
    this.filename = filename; this.environment = environment; this.config = config; this.clock = clock;
    try { this.data = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw failure('STATE_INVALID', 'Checkpoint invalido. Conservarlo y revisar antes de continuar.'); }
    if (!this.data) this.data = { version: 1, streams: {} };
    if (this.data.version !== 1 || !this.data.streams || typeof this.data.streams !== 'object' || Array.isArray(this.data.streams)) throw failure('STATE_VERSION', 'Checkpoint incompatible.');
  }
  get(candidate) { return this.data.streams[candidate.id]?.[this.environment]; }
  fresh(candidate) {
    const result = this.get(candidate);
    if (!result || result.verifierVersion !== verifierVersion) return null;
    if (!Number.isFinite(Date.parse(result.checkedAt)) || Date.parse(result.checkedAt) > this.clock()) return null;
    const ttl = result.status === 'ok' ? this.config.successTtlMs : this.config.failureTtlMs;
    return this.clock() - Date.parse(result.checkedAt) < ttl ? result : null;
  }
  put(candidate, result) {
    this.data.streams[candidate.id] ||= {};
    const previous = this.get(candidate);
    this.data.streams[candidate.id][this.environment] = {
      ...result, environment: this.environment, verifierVersion,
      lastSuccessAt: result.status === 'ok' ? result.checkedAt : previous?.lastSuccessAt || null
    };
    atomicJSON(this.filename, this.data);
  }
  queue(candidates) {
    const groups = [[], [], []];
    const unique = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
    for (const candidate of unique) {
      if (this.fresh(candidate)) continue;
      const previous = this.get(candidate);
      groups[!previous ? 0 : previous.status === 'failed' ? 1 : 2].push(candidate);
    }
    for (const group of groups) group.sort((first, second) => Date.parse(this.get(first)?.checkedAt || '1970-01-01') - Date.parse(this.get(second)?.checkedAt || '1970-01-01'));
    const queue = [];
    while (groups.some(group => group.length)) for (const group of groups) if (group.length) queue.push(group.shift());
    return queue;
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure('ABORTED', 'Cancelado.')); return; }
    const abort = () => { clearTimeout(timer); reject(failure('ABORTED', 'Cancelado.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

class HlsVerifier {
  constructor(client, config, { clock = Date.now, wait = delay, random = Math.random } = {}) {
    this.client = client; this.config = config; this.clock = clock; this.wait = wait; this.random = random;
  }
  async inspect(candidate, signal) {
    let url = candidate.url;
    let testedHeight = null;
    let codecs = '';
    for (let depth = 0; depth < 3; depth++) {
      const response = await this.client.get(url, { headers: candidate.headers, timeoutMs: this.config.timeoutMs, maxBytes: 262144, signal });
      if (response.status < 200 || response.status >= 300) throw failure('HTTP_' + response.status, 'HTTP no satisfactorio.');
      const text = response.body.toString('utf8').trimStart();
      if (!text.startsWith('#EXTM3U')) throw failure('NOT_HLS', 'La respuesta no es HLS.');
      const parser = new Parser();
      parser.push(text); parser.end();
      const manifest = parser.manifest;
      if (manifest.playlists?.length) {
        const variants = manifest.playlists.filter(item => item.uri).sort((first, second) => (first.attributes?.BANDWIDTH || Infinity) - (second.attributes?.BANDWIDTH || Infinity));
        if (!variants.length) throw failure('EMPTY_MASTER', 'Sin variantes.');
        const selected = variants.find(item => /avc1/i.test(item.attributes?.CODECS || '')) || variants[0];
        testedHeight = selected.attributes?.RESOLUTION?.height || null;
        codecs = selected.attributes?.CODECS || '';
        url = new URL(selected.uri, response.url).href;
        continue;
      }
      const segment = manifest.segments?.[0];
      if (!segment?.uri) throw failure('EMPTY_MEDIA', 'Sin segmentos.');
      if (segment.key && segment.key.method !== 'NONE') throw failure('ENCRYPTED_MEDIA', 'Contenido cifrado fuera de esta fase.');
      const segmentURL = new URL(segment.uri, response.url).href;
      const sample = await this.client.get(segmentURL, { headers: { ...candidate.headers, Range: 'bytes=0-65535' }, timeoutMs: this.config.timeoutMs, maxBytes: 65536, prefix: true, signal });
      if (sample.status !== 200 && sample.status !== 206) throw failure('SEGMENT_HTTP_' + sample.status, 'No se pudo leer el segmento.');
      const bytes = sample.body;
      const mp4 = ['ftyp', 'styp', 'moof'].includes(bytes.subarray(4, 8).toString('ascii'));
      let transportStream = false;
      for (let offset = 0; offset < Math.min(188, bytes.length - 188); offset++) if (bytes[offset] === 0x47 && bytes[offset + 188] === 0x47) { transportStream = true; break; }
      if (!transportStream && !mp4) throw failure('SEGMENT_FORMAT_UNKNOWN', 'La muestra no identifica TS o fMP4.');
      return { level: 'segment-ok', testedHeight, codecs, compatibility: /avc1/i.test(codecs) && /mp4a/i.test(codecs) ? 'h264-aac-declared' : 'unknown', devicePlaybackVerified: false };
    }
    throw failure('HLS_DEPTH_LIMIT', 'Demasiados playlists anidados.');
  }
  async verify(candidate, signal) {
    const started = this.clock();
    let reason = 'UNKNOWN';
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      if (signal?.aborted) throw failure('ABORTED', 'Cancelado.');
      try {
        const inspection = await this.inspect(candidate, signal);
        return { status: 'ok', checkedAt: new Date(this.clock()).toISOString(), latencyMs: this.clock() - started, ...inspection };
      } catch (error) {
        if (signal?.aborted) throw failure('ABORTED', 'Cancelado.');
        reason = error.code === 'ABORTED' ? 'TIMEOUT' : error.code || 'NETWORK';
        const transient = ['TIMEOUT', 'NETWORK', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'].includes(reason);
        if (!transient || attempt === this.config.retries) break;
        await this.wait(300 * Math.pow(2, attempt) + Math.floor(this.random() * 200), signal);
      }
    }
    return { status: 'failed', reason, checkedAt: new Date(this.clock()).toISOString(), latencyMs: this.clock() - started, devicePlaybackVerified: false };
  }
}

async function verifyIncrementally(candidates, state, verifier, config, { signal, onProgress = () => {} } = {}) {
  const queue = state.queue(candidates);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, config.maxRunMs);
  const hosts = new Map();
  let active = 0; let started = 0; let completed = 0;
  try {
    await new Promise((resolve, reject) => {
      let failed = false;
      function pump() {
        if (failed) return;
        while (!controller.signal.aborted && active < config.concurrency && started < config.maxChecks) {
          const position = queue.findIndex(candidate => (hosts.get(new URL(candidate.url).host) || 0) < config.perHost);
          if (position < 0) break;
          const candidate = queue.splice(position, 1)[0];
          const host = new URL(candidate.url).host;
          active++; started++; hosts.set(host, (hosts.get(host) || 0) + 1);
          verifier.verify(candidate, controller.signal).then(result => {
            state.put(candidate, result); completed++; onProgress(completed, started);
          }).catch(error => {
            if (error.code !== 'ABORTED') { failed = true; controller.abort(); reject(error); }
          }).finally(() => { active--; hosts.set(host, hosts.get(host) - 1); pump(); });
        }
        if (!active && (controller.signal.aborted || !queue.length || started >= config.maxChecks)) resolve();
      }
      pump();
    });
    return { started, completed, remaining: state.queue(candidates).length, budgetExpired: controller.signal.aborted && !signal?.aborted };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

module.exports = { VerificationState, HlsVerifier, verifyIncrementally, atomicJSON, verifierVersion };