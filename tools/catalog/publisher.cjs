const fs = require('node:fs');
const path = require('node:path');
const { compareCandidates, hash, failure } = require('./policy.cjs');
const { atomicJSON } = require('./verifier.cjs');

function fold(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

function publishCatalog(prepared, state, config, output, now = Date.now()) {
  const selected = []; const adapters = []; const unverified = [];
  const counts = { verified: 0, unverified: 0, requiresAdapter: 0, failedStreams: 0, pendingReview: (prepared.report.discarded['provenance-review'] || 0) + prepared.channels.filter(channel => channel.provenance.status !== 'reviewed').length };
  for (const channel of prepared.channels) {
    if (!config.countries.includes(channel.country) || (channel.provenance.status !== 'reviewed' && !config.includeUnreviewed)) continue;
    const candidates = channel.candidates.map(candidate => ({ ...candidate, verification: state.fresh(candidate) || { status: 'unverified' } })).sort(compareCandidates);
    counts.failedStreams += candidates.filter(candidate => candidate.verification.status === 'failed').length;
    const direct = candidates.filter(candidate => candidate.transport === 'direct' && candidate.verification.status === 'ok');
    const unknown = candidates.filter(candidate => candidate.transport === 'direct' && candidate.verification.status !== 'ok').map(candidate => ({ ...candidate, verification: { status: 'unverified' } }));
    const requiresAdapter = candidates.filter(candidate => candidate.transport === 'requires-adapter' && candidate.verification.status === 'ok');
    let status;
    let choices;
    if (direct.length) { status = 'verified'; choices = direct.concat(config.includeUnverified ? unknown : []); counts.verified++; }
    else if (requiresAdapter.length) { status = 'requires-adapter'; choices = requiresAdapter; counts.requiresAdapter++; }
    else if ((config.includeUnverified || channel.forceInclude) && unknown.length) { status = 'unverified'; choices = unknown; counts.unverified++; }
    else continue;
    const primary = choices[0];
    const detail = {
      id: channel.id, status, primary,
      fallbacks: choices.slice(1).filter(candidate => candidate.feedId === primary.feedId),
      alternateFeeds: choices.filter(candidate => candidate.feedId !== primary.feedId),
      provenance: channel.provenance
    };
    const record = {
      id: channel.id, name: channel.name, aliases: channel.aliases, logo: channel.logo,
      country: channel.country, languages: channel.languages, categories: channel.categories, status, provenance: channel.provenance,
      verification: primary.verification, detail
    };
    if (status === 'verified') selected.push(record);
    else if (status === 'requires-adapter') adapters.push(record);
    else unverified.push(record);
  }
  const records = selected.concat(unverified, adapters).sort((first, second) => first.name.localeCompare(second.name));
  const version = new Date(now).toISOString().replace(/[-:.]/g, '') + '-' + hash(JSON.stringify(records)).slice(0, 8);
  const relativeRoot = 'versions/' + version;
  const staging = path.join(output, '.staging-' + version);
  const finalDirectory = path.join(output, relativeRoot);
  fs.mkdirSync(staging, { recursive: true });
  const files = [];
  function write(relative, value, limit = config.maxFileBytes) {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > limit) throw failure('PARTITION_LIMIT', 'Una particion supera el presupuesto: ' + relative);
    const filename = path.join(staging, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, body);
    const entry = { path: relativeRoot + '/' + relative, bytes: Buffer.byteLength(body), hash: hash(body) };
    files.push(entry);
    return entry.path;
  }
  function pages(prefix, values) {
    const paths = [];
    let group = [];
    for (const value of values) {
      const next = group.concat([value]);
      if (group.length && (next.length > config.pageSize || Buffer.byteLength(JSON.stringify({ items: next })) > config.maxFileBytes)) {
        paths.push(write(prefix + '/' + paths.length + '.json', { items: group })); group = [];
      }
      group.push(value);
    }
    if (group.length) paths.push(write(prefix + '/' + paths.length + '.json', { items: group }));
    return paths;
  }
  try {
    const details = pages('details', records.map(record => record.detail));
    const lookup = {};
    for (const detailPath of details) {
      const data = JSON.parse(fs.readFileSync(path.join(staging, detailPath.slice(relativeRoot.length + 1)), 'utf8'));
      for (const item of data.items) lookup[item.id] = detailPath;
    }
    const lookupPath = write('lookup.json', lookup);
    const cards = records.map(({ detail, aliases, ...card }) => ({ ...card, detailPage: lookup[card.id] }));
    const countryPages = {}; const categoryPages = {}; const languagePages = {};
    for (const country of config.countries) countryPages[country] = pages('countries/' + country, cards.filter(card => card.country === country && card.status !== 'requires-adapter'));
    for (const category of [...new Set(cards.flatMap(card => card.categories))]) categoryPages[category] = pages('categories/' + category, cards.filter(card => card.categories.includes(category) && card.status !== 'requires-adapter').map(card => card.id));
    for (const language of [...new Set(cards.flatMap(card => card.languages))]) languagePages[language] = pages('languages/' + language, cards.filter(card => card.languages.includes(language) && card.status !== 'requires-adapter').map(card => card.id));
    const search = pages('search', records.filter(record => record.status !== 'requires-adapter').map(record => [record.id, fold(record.name), record.aliases.map(fold), lookup[record.id]]));
    const adapterPages = pages('requires-adapter', cards.filter(card => card.status === 'requires-adapter'));
    const report = { ...prepared.report, published: counts, environment: state.environment, generatedAt: new Date(now).toISOString(), devicePlaybackVerified: false };
    const reportPath = write('report.json', report);
    const manifest = {
      schemaVersion: 1, version, generatedAt: report.generatedAt, countries: config.countries,
      verificationEnvironment: state.environment, devicePlaybackVerified: false, counts,
      partitions: { countries: countryPages, categories: categoryPages, languages: languagePages, details, lookup: lookupPath, search, requiresAdapter: adapterPages },
      categories: prepared.categories, replacements: prepared.aliases, report: reportPath, files: files.slice()
    };
    write('manifest.json', manifest, 131072);
    fs.mkdirSync(path.dirname(finalDirectory), { recursive: true });
    if (fs.existsSync(finalDirectory)) fs.rmSync(staging, { recursive: true, force: true });
    else fs.renameSync(staging, finalDirectory);
    atomicJSON(path.join(output, 'manifest.json'), manifest);
    return { manifest, report };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { publishCatalog, fold };