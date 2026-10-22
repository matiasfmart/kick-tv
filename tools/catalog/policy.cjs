const crypto = require('node:crypto');
const ipaddr = require('ipaddr.js');

const categories = {
  auto: 'Automoviles', animation: 'Animacion', business: 'Economia', classic: 'Clasicos',
  comedy: 'Comedia', cooking: 'Cocina', culture: 'Cultura', documentary: 'Documentales',
  education: 'Educacion', entertainment: 'Entretenimiento', family: 'Familia', general: 'General',
  interactive: 'Interactivo', kids: 'Infantil', legislative: 'Legislativo', lifestyle: 'Estilo de vida',
  movies: 'Peliculas', music: 'Musica', news: 'Noticias', outdoor: 'Aire libre', public: 'Servicio publico',
  relax: 'Relax', religious: 'Religion', series: 'Series', science: 'Ciencia', shop: 'Compras',
  sports: 'Deportes', travel: 'Viajes', weather: 'Clima'
};

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24); }
function safeURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (ipaddr.isValid(hostname) && ipaddr.process(hostname).range() !== 'unicast')) return null;
    return url;
  } catch { return null; }
}

function validateDatasets(data) {
  const fields = {
    channels: ['id', 'name', 'country', 'categories', 'is_nsfw'],
    feeds: ['channel', 'id', 'languages', 'is_main'], streams: ['channel', 'feed', 'url', 'labels'],
    logos: ['channel', 'feed', 'url', 'format'], categories: ['id', 'name'],
    languages: ['code', 'name'], countries: ['code', 'name'], blocklist: ['channel', 'reason']
  };
  for (const [name, keys] of Object.entries(fields)) {
    if (!Array.isArray(data[name])) throw failure('DATASET_SCHEMA', 'Dataset invalido: ' + name);
    for (const row of data[name]) {
      if (!row || typeof row !== 'object' || keys.some(key => !(key in row))) throw failure('DATASET_SCHEMA', 'Fila invalida en ' + name);
      if (name === 'blocklist' && (typeof row.channel !== 'string' || !['dmca', 'nsfw'].includes(row.reason))) throw failure('BLOCKLIST_SCHEMA', 'Blocklist con formato inesperado. No se publica.');
      if (name === 'channels' && (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.is_nsfw !== 'boolean' || !Array.isArray(row.categories) || (row.closed && !/^\d{4}-\d{2}-\d{2}$/.test(row.closed)))) throw failure('DATASET_SCHEMA', 'Canal con formato inesperado.');
      if (name === 'streams' && (typeof row.url !== 'string' || !Array.isArray(row.labels))) throw failure('DATASET_SCHEMA', 'Stream con formato inesperado.');
    }
  }
}

function replacementOf(id, channelMap) {
  const visited = new Set();
  let channel = channelMap.get(id);
  while (channel?.replaced_by) {
    if (visited.has(channel.id)) return null;
    visited.add(channel.id);
    channel = channelMap.get(channel.replaced_by);
    if (!channel) return null;
  }
  return channel && channel.id !== id ? channel.id : null;
}

function prepareCatalog(data, config, overrides = {}, now = Date.now()) {
  validateDatasets(data);
  const today = new Date(now).toISOString().slice(0, 10);
  const blocked = new Set(data.blocklist.map(item => item.channel));
  const hidden = new Set(overrides.hidden || []);
  const channelMap = new Map(data.channels.map(channel => [channel.id, channel]));
  const feedMap = new Map(data.feeds.map(feed => [feed.channel + '|' + feed.id, feed]));
  const logoMap = new Map();
  for (const logo of data.logos) {
    if (!['PNG', 'JPEG'].includes(logo.format) || !safeURL(logo.url) || !logo.url.startsWith('https:') || !(logo.width > 0 && logo.width <= 512 && logo.height > 0 && logo.height <= 512)) continue;
    const existing = logoMap.get(logo.channel);
    if (!existing || (logo.in_use && !existing.in_use) || ((logo.width || 10000) < (existing.width || 10000) && Boolean(logo.in_use) === Boolean(existing.in_use))) logoMap.set(logo.channel, logo);
  }
  const channels = new Map();
  const reasons = {};
  const discard = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };
  for (const channel of data.channels) {
    if (!config.countries.includes(channel.country)) { discard('other-country'); continue; }
    if (blocked.has(channel.id)) { discard('blocklist'); continue; }
    if (channel.is_nsfw || channel.categories.includes('xxx')) { discard('nsfw'); continue; }
    if (channel.closed && channel.closed <= today) { discard('closed'); continue; }
    if (hidden.has(channel.id)) { discard('hidden'); continue; }
    const override = overrides.channels?.[channel.id] || {};
    const approved = override.approved === true && Boolean(safeURL(override.evidence)) && Array.isArray(override.allowedHosts) && override.allowedHosts.length > 0;
    if (config.requireReview && !approved) { discard('provenance-review'); continue; }
    const chosenCategories = override.categories || channel.categories;
    if (!Array.isArray(chosenCategories) || chosenCategories.some(category => !Object.prototype.hasOwnProperty.call(categories, category))) { discard('category-review'); continue; }
    channels.set(channel.id, {
      id: channel.id, name: typeof override.name === 'string' ? override.name : channel.name,
      aliases: Array.isArray(channel.alt_names) ? channel.alt_names.filter(value => typeof value === 'string') : [], country: channel.country, languages: [],
      categories: chosenCategories.length ? chosenCategories : ['general'],
      logo: logoMap.get(channel.id)?.url || '', provenance: approved ? { status: 'reviewed', evidence: override.evidence } : { status: 'unreviewed' },
      allowedHosts: override.allowedHosts || [], forceInclude: override.forceInclude === true, candidates: []
    });
  }
  const candidates = [];
  const seen = new Set();
  for (const stream of data.streams) {
    const channel = channels.get(stream.channel);
    if (!channel) continue;
    const url = safeURL(stream.url);
    if (!url) { discard('invalid-stream-url'); continue; }
    if (['token', 'sig', 'signature', 'expires', 'auth'].some(key => url.searchParams.has(key))) { discard('ephemeral-url'); continue; }
    if (config.requireReview && !channel.allowedHosts.some(host => typeof host === 'string' && (url.hostname === host || url.hostname.endsWith('.' + host)))) { discard('unreviewed-stream-host'); continue; }
    if ([stream.referrer, stream.user_agent].some(value => value && (typeof value !== 'string' || /[\r\n]/.test(value)))) { discard('invalid-headers'); continue; }
    const headers = {};
    if (stream.referrer) headers.Referer = stream.referrer;
    if (stream.user_agent) headers['User-Agent'] = stream.user_agent;
    const id = hash(JSON.stringify({ url: url.href, headers }));
    const identity = channel.id + '|' + id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const feed = feedMap.get(stream.channel + '|' + stream.feed);
    const candidate = {
      id, channelId: channel.id, feedId: stream.feed || null, url: url.href, headers,
      quality: stream.quality || '', height: Number((stream.quality || '').match(/\d+/)?.[0]) || 0,
      mainFeed: Boolean(feed?.is_main), languages: Array.isArray(feed?.languages) ? feed.languages : [],
      labels: stream.labels.slice(), transport: Object.keys(headers).length ? 'requires-adapter' : 'direct',
      compatibility: 'unknown'
    };
    channel.candidates.push(candidate); candidates.push(candidate);
    channel.languages = [...new Set(channel.languages.concat(candidate.languages))];
  }
  const aliases = {};
  for (const channel of data.channels.filter(item => config.countries.includes(item.country) && item.closed && item.closed <= today)) {
    const replacement = replacementOf(channel.id, channelMap);
    if (replacement && channels.has(replacement)) aliases[channel.id] = replacement;
  }
  const resultChannels = [...channels.values()].filter(channel => channel.candidates.length);
  return { channels: resultChannels, candidates, aliases, categories, report: { sourceChannels: data.channels.length, selectedChannels: resultChannels.length, candidateStreams: candidates.length, discarded: reasons } };
}

function compareCandidates(first, second) {
  return Number(second.verification?.status === 'ok') - Number(first.verification?.status === 'ok') ||
    Number(first.transport !== 'direct') - Number(second.transport !== 'direct') ||
    second.height - first.height || Number(second.mainFeed) - Number(first.mainFeed) ||
    Number(first.labels.includes('Not 24/7')) - Number(second.labels.includes('Not 24/7')) || first.id.localeCompare(second.id);
}

module.exports = { prepareCatalog, validateDatasets, replacementOf, compareCandidates, safeURL, hash, failure };