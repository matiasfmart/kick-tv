const fs = require('node:fs');
const path = require('node:path');
const { prepareCatalog, validateDatasets, failure, hash } = require('./policy.cjs');
const { SafeHttpClient } = require('./network.cjs');
const { HlsVerifier, VerificationState, verifyIncrementally, atomicJSON } = require('./verifier.cjs');
const { publishCatalog } = require('./publisher.cjs');

const datasetNames = ['channels', 'feeds', 'streams', 'logos', 'categories', 'languages', 'countries', 'blocklist'];

function validateConfig(config) {
  if (!Array.isArray(config.countries) || !config.countries.length || config.countries.some(country => !/^[A-Z]{2}$/.test(country))) throw failure('CONFIG', 'Paises invalidos.');
  if (!/^[a-z0-9-]{1,50}$/.test(config.environment)) throw failure('CONFIG', 'Identificador de entorno invalido.');
  if (config.requireReview !== true && !(config.requireReview === false && config.includeUnreviewed === true)) throw failure('CONFIG', 'Publicar candidatos sin revision requiere includeUnreviewed explicito. Usar --audit para revisar candidatos.');
  if (config.verificationMode !== undefined && !['preflight', 'on-demand'].includes(config.verificationMode)) throw failure('CONFIG', 'Modo de verificacion invalido.');
  if (config.verificationMode === 'on-demand' && config.includeUnverified !== true) throw failure('CONFIG', 'El modo on-demand requiere includeUnverified.');
  for (const [key, maximum] of Object.entries({ concurrency: 16, perHost: 4, timeoutMs: 30000, retries: 2, maxChecks: 1000, maxRunMs: 900000, successTtlMs: 604800000, failureTtlMs: 604800000, pageSize: 100, maxFileBytes: 262144 })) {
    if (!Number.isInteger(config[key]) || config[key] < (key === 'retries' ? 0 : 1) || config[key] > maximum) throw failure('CONFIG', 'Configuracion fuera de limites: ' + key);
  }
}

async function loadDatasets({ input, client, signal, cache }) {
  const data = {};
  for (const name of datasetNames) {
    if (signal?.aborted) throw failure('ABORTED', 'Cancelado.');
    if (input) data[name] = JSON.parse(fs.readFileSync(path.join(input, name + '.json'), 'utf8'));
    else {
      const response = await client.get('https://iptv-org.github.io/api/' + name + '.json', { maxBytes: 16000000, timeoutMs: 30000, signal, headers: { Accept: 'application/json' } });
      if (response.status !== 200) throw failure('DATASET_HTTP', 'No se pudo descargar ' + name + ': HTTP ' + response.status);
      try { data[name] = JSON.parse(response.body.toString('utf8')); }
      catch { throw failure('DATASET_JSON', 'JSON invalido en ' + name); }
      if (cache) atomicJSON(path.join(cache, name + '.json'), data[name]);
    }
  }
  validateDatasets(data);
  if (!data.channels.length || !data.blocklist.length) throw failure('DATASET_EMPTY', 'Metadata o blocklist vacias. No se publica.');
  return data;
}

async function generate({ config, overrides, input, output, stateFile, audit = false, signal, client = new SafeHttpClient(), onProgress, clock = Date.now }) {
  validateConfig(config);
  const data = await loadDatasets({ input, client, signal, cache: path.join(path.dirname(stateFile), 'sources') });
  const prepared = prepareCatalog(data, audit ? { ...config, requireReview: false } : config, overrides, clock());
  if (audit) {
    const channelMap = new Map(data.channels.map(channel => [channel.id, channel]));
    const report = {
      generatedAt: new Date(clock()).toISOString(), mode: 'audit-only', environment: config.environment,
      ...prepared.report,
      channels: prepared.channels.map(channel => ({
        id: channel.id, name: channel.name, website: channelMap.get(channel.id)?.website || null,
        streamHosts: [...new Set(channel.candidates.map(candidate => new URL(candidate.url).hostname))],
        streams: channel.candidates.length, requiresHeaders: channel.candidates.some(candidate => candidate.transport === 'requires-adapter')
      }))
    };
    atomicJSON(path.join(path.dirname(stateFile), 'audit.json'), report);
    return { report, audit: true };
  }
  const state = new VerificationState(stateFile, config.environment, config, clock);
  let publicationState = state;
  let run;
  if (config.verificationMode === 'on-demand') {
    publicationState = { environment: state.environment, fresh() { return null; } };
    run = { mode: 'on-demand', started: 0, completed: 0, remaining: prepared.candidates.length, budgetExpired: false };
  } else {
    const verifier = new HlsVerifier(client, config, { clock });
    run = await verifyIncrementally(prepared.candidates, state, verifier, config, { signal, onProgress });
  }
  if (signal?.aborted) throw failure('ABORTED', 'Cancelado. Checkpoint conservado; catalogo anterior sin cambios.');
  prepared.report.verificationRun = run;
  prepared.report.sourceFingerprint = hash(JSON.stringify(data.blocklist));
  return publishCatalog(prepared, publicationState, config, output, clock());
}

module.exports = { generate, loadDatasets, validateConfig, datasetNames };