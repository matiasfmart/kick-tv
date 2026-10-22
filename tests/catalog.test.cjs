const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCatalog, compareCandidates } = require('../tools/catalog/policy.cjs');
const { SafeHttpClient, publicAddress, resolvePublic } = require('../tools/catalog/network.cjs');
const { VerificationState, HlsVerifier, verifyIncrementally } = require('../tools/catalog/verifier.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishCatalog } = require('../tools/catalog/publisher.cjs');
const { generate } = require('../tools/catalog/generate.cjs');
const yaml = require('yaml');

function fixture() {
  const channel = (id, changes = {}) => ({ id, name: id, country: 'AR', categories: ['news'], is_nsfw: false, closed: null, ...changes });
  return {
    channels: [channel('Good.ar'), channel('Blocked.ar'), channel('Adult.ar', { is_nsfw: true }), channel('Closed.ar', { closed: '2020-01-01', replaced_by: 'Good.ar' }), channel('Other.us', { country: 'US' })],
    feeds: [{ channel: 'Good.ar', id: 'HD', is_main: true, languages: ['esp'] }, { channel: 'Other.us', id: 'HD', is_main: false, languages: ['eng'] }],
    streams: ['Good.ar', 'Blocked.ar', 'Adult.ar', 'Closed.ar', 'Other.us'].map(channel => ({ channel, feed: 'HD', url: 'https://cdn.example/' + channel + '.m3u8', labels: [], quality: '720p' })),
    logos: [], categories: [], languages: [], countries: [], blocklist: [{ channel: 'Blocked.ar', reason: 'dmca' }]
  };
}
const config = { countries: ['AR'], requireReview: false };

test('catalogo: filtra AR y exclusiones antes de verificar, y join de feeds es compuesto', () => {
  const result = prepareCatalog(fixture(), config);
  assert.deepEqual(result.channels.map(channel => channel.id), ['Good.ar']);
  assert.deepEqual(result.channels[0].languages, ['esp']);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.aliases['Closed.ar'], 'Good.ar');
  assert.equal(result.channels[0].categories[0], 'news');
});

test('catalogo: overrides no evitan blocklist o NSFW y la revision es obligatoria por defecto', () => {
  const approved = { approved: true, evidence: 'https://official.example/live', allowedHosts: ['cdn.example'], name: 'Canal revisado', categories: ['general'] };
  const overrides = { channels: { 'Good.ar': approved, 'Blocked.ar': approved, 'Adult.ar': approved } };
  assert.equal(prepareCatalog(fixture(), { ...config, requireReview: true }).channels.length, 0);
  const result = prepareCatalog(fixture(), { ...config, requireReview: true }, overrides);
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].name, 'Canal revisado');
  assert.equal(result.channels[0].provenance.status, 'reviewed');
});

test('catalogo: en modo amplio incluye candidatos no revisados pero mantiene bloqueos y filtros AR', () => {
  const prepared = prepareCatalog(fixture(), { ...config, requireReview: false });
  assert.deepEqual(prepared.channels.map(channel => channel.id), ['Good.ar']);
  assert.equal(prepared.channels[0].provenance.status, 'unreviewed');
  const hidden = prepareCatalog(fixture(), { ...config, requireReview: false }, { hidden: ['Good.ar'] });
  assert.equal(hidden.channels.length, 0);
  assert.equal(hidden.report.discarded.hidden, 1);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const result = publishCatalog(prepared, { environment: 'test', fresh: () => null }, { ...config, requireReview: false, includeUnreviewed: true, includeUnverified: true, pageSize: 32, maxFileBytes: 262144 }, directory);
    assert.equal(result.manifest.counts.unverified, 1);
    assert.equal(result.manifest.counts.pendingReview, 1);
    const cardPath = result.manifest.partitions.countries.AR[0];
    const cards = JSON.parse(fs.readFileSync(path.join(directory, cardPath), 'utf8')).items;
    assert.deepEqual(cards.map(card => card.id), ['Good.ar']);
    assert.equal(cards[0].status, 'unverified');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('catalogo: blocklist invalida falla cerrada, sin producir un catalogo nuevo', () => {
  const data = fixture(); data.blocklist = null;
  assert.throws(() => prepareCatalog(data, config), { code: 'DATASET_SCHEMA' });
  data.blocklist = [{ channel: 'Good.ar', reason: 'new-unknown-reason' }];
  assert.throws(() => prepareCatalog(data, config), { code: 'BLOCKLIST_SCHEMA' });
});

test('catalogo: conserva requisitos de headers y rechaza URLs efimeras o credenciales', () => {
  const data = fixture();
  data.streams = [
    { channel: 'Good.ar', feed: 'HD', url: 'https://cdn.example/live.m3u8', labels: ['Not 24/7'], referrer: 'https://official.example', user_agent: 'Test' },
    { channel: 'Good.ar', feed: 'HD', url: 'https://cdn.example/live.m3u8?token=secret', labels: [] },
    { channel: 'Good.ar', feed: 'HD', url: 'https://user:password@cdn.example/live.m3u8', labels: [] }
  ];
  const result = prepareCatalog(data, config);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].transport, 'requires-adapter');
  assert.equal(result.candidates[0].headers.Referer, 'https://official.example');
});

test('catalogo: el ranking no impone un tope 1080p', () => {
  const base = { id: 'base', labels: [], mainFeed: true, transport: 'direct', verification: { status: 'ok' } };
  const sorted = [{ ...base, id: '720', height: 720 }, { ...base, id: '4k', height: 2160 }].sort(compareCandidates);
  assert.equal(sorted[0].height, 2160);
});

test('verificador: bloquea IPs internas, reservadas e IPv4 mapeada en IPv6', async () => {
  for (const address of ['127.0.0.1', '192.168.0.70', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '203.0.113.1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  await assert.rejects(resolvePublic('https://example.com/live', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), { code: 'UNSAFE_ADDRESS' });
  await assert.rejects(resolvePublic('file:///private/file'), { code: 'UNSAFE_URL' });
});

test('verificador: fija el DNS validado y revisa redirecciones a redes privadas', async () => {
  const { EventEmitter } = require('node:events');
  const { Readable } = require('node:stream');
  let requests = 0;
  const client = new SafeHttpClient({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request(url, options, callback) {
      requests++;
      options.lookup('example.com', {}, (error, address) => assert.equal(address, '8.8.8.8'));
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () => {
        const response = Readable.from(['Redirect']);
        response.statusCode = 302; response.headers = { location: 'http://127.0.0.1/private' };
        callback(response);
      };
      return request;
    }
  });
  await assert.rejects(client.get('https://example.com/live'), { code: 'UNSAFE_URL' });
  assert.equal(requests, 1);
});

test('HLS: parsea master y segmento acotado sin certificar el decoder de la TV', async () => {
  const seen = [];
  const sample = Buffer.alloc(376); sample[0] = 0x47; sample[188] = 0x47;
  const client = { async get(url, options) {
    seen.push({ url, options });
    return { status: 200, url, body: url.endsWith('.ts') ? sample : Buffer.from(url.endsWith('master.m3u8') ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"\nmedia.m3u8\n' : '#EXTM3U\n#EXTINF:10,\nsegment.ts\n') };
  } };
  const verifier = new HlsVerifier(client, { timeoutMs: 10, retries: 0 });
  const result = await verifier.verify({ url: 'https://example.com/master.m3u8', headers: { Referer: 'https://official.example' } });
  assert.equal(result.status, 'ok'); assert.equal(result.level, 'segment-ok');
  assert.equal(result.testedHeight, 720); assert.equal(result.devicePlaybackVerified, false);
  assert.equal(seen[2].options.prefix, true); assert.equal(seen[2].options.maxBytes, 65536);
  assert.equal(seen[2].options.headers.Referer, 'https://official.example');
});

test('HLS: no reintenta 403 y no descarga claves de contenido cifrado', async () => {
  let requests = 0;
  const verifier = new HlsVerifier({ async get() { requests++; return { status: 403 }; } }, { retries: 2 });
  assert.equal((await verifier.verify({ url: 'https://example.com/live', headers: {} })).reason, 'HTTP_403');
  assert.equal(requests, 1);
  const encrypted = new HlsVerifier({ async get(url) { return { status: 200, url, body: Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:10,\nsegment.ts\n') }; } }, { retries: 0 });
  assert.equal((await encrypted.verify({ url: 'https://example.com/live', headers: {} })).reason, 'ENCRYPTED_MEDIA');
});

test('checkpoint: persiste, separa entornos y vence verificaciones', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    let now = 1000;
    const filename = path.join(directory, 'state.json');
    const config = { successTtlMs: 100, failureTtlMs: 20 };
    const candidate = { id: 'one' };
    const state = new VerificationState(filename, 'home-ar', config, () => now);
    state.put(candidate, { status: 'ok', checkedAt: new Date(now).toISOString() });
    assert.equal(new VerificationState(filename, 'home-ar', config, () => now).fresh(candidate).status, 'ok');
    assert.equal(new VerificationState(filename, 'github-hosted', config, () => now).fresh(candidate), null);
    now += 101; assert.equal(state.fresh(candidate), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('incremental: limita concurrencia por host y numero de chequeos, y retoma lo faltante', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const config = { concurrency: 3, perHost: 1, maxChecks: 2, maxRunMs: 1000, successTtlMs: 100000, failureTtlMs: 100 };
    const state = new VerificationState(path.join(directory, 'state.json'), 'test', config);
    const candidates = [1, 2, 3].map(number => ({ id: String(number), url: 'https://example.com/' + number }));
    let active = 0; let peak = 0;
    const verifier = { async verify() { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { status: 'ok', checkedAt: new Date().toISOString() }; } };
    const result = await verifyIncrementally(candidates, state, verifier, config);
    assert.equal(peak, 1); assert.equal(result.completed, 2); assert.equal(state.queue(candidates).length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('publicacion: solo AR revisados, paginas pequenas, busqueda sin URLs e integridad de referencias', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const approved = { approved: true, evidence: 'https://official.example/live', allowedHosts: ['cdn.example'] };
    const prepared = prepareCatalog(fixture(), { ...config, requireReview: true }, { channels: { 'Good.ar': approved } });
    const state = { environment: 'github-hosted', fresh() { return { status: 'ok', checkedAt: new Date(1000).toISOString(), environment: 'github-hosted', devicePlaybackVerified: false }; } };
    const result = publishCatalog(prepared, state, { ...config, includeUnverified: false, pageSize: 1, maxFileBytes: 262144 }, directory, 1000);
    assert.equal(result.report.published.verified, 1);
    assert.deepEqual(result.manifest.countries, ['AR']);
    for (const entry of result.manifest.files) assert.ok(fs.existsSync(path.join(directory, entry.path)), entry.path);
    const search = fs.readFileSync(path.join(directory, result.manifest.partitions.search[0]), 'utf8');
    assert.equal(search.includes('https:'), false);
    assert.equal(search.includes('headers'), false);
    assert.equal(result.manifest.devicePlaybackVerified, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'versions', result.manifest.version, 'manifest.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('publicacion: una particion fallida conserva el manifest anterior', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    fs.writeFileSync(path.join(directory, 'manifest.json'), '{"previous":true}');
    const prepared = prepareCatalog(fixture(), config);
    prepared.channels[0].provenance = { status: 'reviewed', evidence: 'https://official.example' };
    prepared.channels[0].name = 'A'.repeat(1000);
    assert.throws(() => publishCatalog(prepared, { environment: 'test', fresh: () => ({ status: 'ok' }) }, { ...config, pageSize: 1, maxFileBytes: 100 }, directory), { code: 'PARTITION_LIMIT' });
    assert.equal(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'), '{"previous":true}');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pipeline: auditoria no consulta streams ni modifica un catalogo existente', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const data = fixture();
    const input = path.join(directory, 'input'); fs.mkdirSync(input);
    for (const [name, value] of Object.entries(data)) fs.writeFileSync(path.join(input, name + '.json'), JSON.stringify(value));
    const output = path.join(directory, 'output'); fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'manifest.json'), '{"previous":true}');
    const defaults = require('../catalog/config.json');
    const result = await generate({ config: defaults, overrides: {}, input, output, stateFile: path.join(directory, 'state.json'), audit: true, client: { get() { throw new Error('No network allowed'); } } });
    assert.equal(result.audit, true);
    assert.equal(result.report.candidateStreams, 1);
    assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), '{"previous":true}');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('workflow: manual y seguro por defecto, sin cron ni publicación automática, acciones fijadas', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/catalog.yml'), 'utf8'));
  assert.equal(workflow.on.schedule, undefined);
  assert.equal(workflow.on.workflow_dispatch.inputs.audit.default, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.deploy.permissions.pages, 'write');
  assert.equal(workflow.jobs.deploy.permissions['id-token'], 'write');
  assert.match(workflow.jobs.generate.outputs.publish, /workflow_dispatch/);
  assert.match(workflow.jobs.generate.outputs.publish, /inputs.publish/);
  assert.match(workflow.jobs.deploy.if, /outputs.publish/);
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const persistence = workflow.jobs.generate.steps.find(step => step.name === 'Conservar checkpoint fuera de main');
  assert.match(persistence.with.script, /refs\/heads\/catalog-state/);
  assert.equal(persistence.with.script.includes("ref: 'heads/main'"), false);
});

test('override forceInclude: incluye solo como no verificado, sin evadir procedencia ni blocklist', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const approval = { approved: true, evidence: 'https://official.example', allowedHosts: ['cdn.example'], forceInclude: true };
    const prepared = prepareCatalog(fixture(), { ...config, requireReview: true }, { channels: { 'Good.ar': approval, 'Blocked.ar': approval } });
    const result = publishCatalog(prepared, { environment: 'test', fresh: () => null }, { ...config, includeUnverified: false, pageSize: 32, maxFileBytes: 262144 }, directory);
    assert.equal(result.manifest.counts.verified, 0);
    assert.equal(result.manifest.counts.unverified, 1);
    assert.equal(prepared.channels.length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('on-demand: no sondea streams, conserva solo el candidato revisado y normaliza fallos remotos', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const data = fixture(); const input = path.join(directory, 'input'); fs.mkdirSync(input);
    for (const [name, value] of Object.entries(data)) fs.writeFileSync(path.join(input, name + '.json'), JSON.stringify(value));
    let requests = 0;
    const result = await generate({ config: { ...require('../catalog/config.json'), countries: ['AR'] }, overrides: { channels: { 'Good.ar': { approved: true, evidence: 'https://official.example/live', allowedHosts: ['cdn.example'] } } }, input, output: path.join(directory, 'output'), stateFile: path.join(directory, 'state.json'), client: { async get() { requests++; throw new Error('No stream requests expected'); } } });
    assert.equal(requests, 0);
    assert.equal(result.manifest.counts.unverified, 1);
    assert.equal(result.report.verificationRun.started, 0);
    const detailPath = result.manifest.partitions.details[0];
    const detail = JSON.parse(fs.readFileSync(path.join(directory, 'output', detailPath), 'utf8')).items[0];
    assert.equal(detail.primary.verification.status, 'unverified');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pipeline: una cancelacion no marca fallo ni reemplaza el catalogo anterior', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const data = fixture(); const input = path.join(directory, 'input'); fs.mkdirSync(input);
    for (const [name, value] of Object.entries(data)) fs.writeFileSync(path.join(input, name + '.json'), JSON.stringify(value));
    const output = path.join(directory, 'output'); fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'manifest.json'), '{"previous":true}');
    const controller = new AbortController();
    const stateFile = path.join(directory, 'state.json');
    await assert.rejects(generate({ config: { ...require('../catalog/config.json'), verificationMode: 'preflight', includeUnverified: false }, overrides: { channels: { 'Good.ar': { approved: true, evidence: 'https://official.example', allowedHosts: ['cdn.example'] } } }, input, output, stateFile, signal: controller.signal,
      client: { async get() { controller.abort(); throw Object.assign(new Error('Canceled'), { code: 'ABORTED' }); } }
    }), { code: 'ABORTED' });
    assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), '{"previous":true}');
    assert.equal(fs.existsSync(stateFile), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pipeline completo: genera un canal revisado y reutiliza la verificacion al repetir', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-catalog-'));
  try {
    const input = path.join(directory, 'input'); fs.mkdirSync(input);
    for (const [name, value] of Object.entries(fixture())) fs.writeFileSync(path.join(input, name + '.json'), JSON.stringify(value));
    const sample = Buffer.alloc(376); sample[0] = 0x47; sample[188] = 0x47;
    let calls = 0;
    const client = { async get(url) { calls++; return { status: 200, url, body: url.endsWith('.ts') ? sample : Buffer.from('#EXTM3U\n#EXTINF:10,\nsegment.ts\n') }; } };
    const options = {
      config: { ...require('../catalog/config.json'), verificationMode: 'preflight', includeUnverified: false }, overrides: { channels: { 'Good.ar': { approved: true, evidence: 'https://official.example', allowedHosts: ['cdn.example'] } } },
      input, output: path.join(directory, 'output'), stateFile: path.join(directory, 'state.json'), client
    };
    const first = await generate(options);
    assert.equal(first.manifest.counts.verified, 1);
    assert.equal(first.report.verificationRun.completed, 1);
    assert.equal(calls, 2);
    const second = await generate(options);
    assert.equal(second.manifest.counts.verified, 1);
    assert.equal(second.report.verificationRun.started, 0);
    assert.equal(calls, 2);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('red: limita respuestas completas y permite una muestra de prefijo acotada', async () => {
  const { EventEmitter } = require('node:events');
  const { Readable } = require('node:stream');
  const client = new SafeHttpClient({ lookup: async () => [{ address: '8.8.8.8', family: 4 }], request(url, options, callback) {
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = () => { const response = Readable.from([Buffer.alloc(100)]); response.statusCode = 200; response.headers = {}; callback(response); };
    return request;
  } });
  await assert.rejects(client.get('https://example.com/large', { maxBytes: 8 }), { code: 'BODY_LIMIT' });
  const prefix = await client.get('https://example.com/large', { maxBytes: 8, prefix: true });
  assert.equal(prefix.body.length, 8);
});

test('red: el timeout tambien limita una resolucion DNS que no termina', async () => {
  const client = new SafeHttpClient({ lookup: () => new Promise(() => {}) });
  await assert.rejects(client.get('https://example.com/live', { timeoutMs: 10 }), { code: 'ABORTED' });
});