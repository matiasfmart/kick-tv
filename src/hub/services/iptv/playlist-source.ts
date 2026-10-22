import { CancelHandle, Complete, LiveChannel, MediaPage, MediaRef, PlaybackRequest, SourceCapabilities, StreamCandidate, VideoSource } from '../../domain/contracts';
import { CatalogTransport, IptvDirectorySource, IptvSourceInfo } from './source';

interface PlaylistChannel { item: LiveChannel; candidates: StreamCandidate[]; }
interface PlaylistRow { id: string; name: string; logo: string; categories: string[]; url: string; label: string; height: number; }

function parseAttributes(line: string): { [name: string]: string } {
  var result: { [name: string]: string } = {}; var match: RegExpExecArray | null;
  var expression = /([a-z0-9_-]+)="([^"]*)"/ig;
  while ((match = expression.exec(line))) result[match[1].toLowerCase()] = match[2];
  return result;
}

function titleSeparator(line: string): number {
  var quoted = false;
  for (var index = 0; index < line.length; index++) {
    if (line.charAt(index) === '"') quoted = !quoted;
    else if (line.charAt(index) === ',' && !quoted) return index;
  }
  return -1;
}

function unsafeHost(host: string): boolean {
  host = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local)$/.test(host) || host.indexOf(':') >= 0) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  var parts = host.split('.').map(function (part) { return Number(part); });
  if (parts.some(function (part) { return part < 0 || part > 255; })) return true;
  var first = parts[0]; var second = parts[1];
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && (second === 168 || (second === 0 && (parts[2] === 0 || parts[2] === 2)) || (second === 88 && parts[2] === 99) || (second === 51 && parts[2] === 100))) || (first === 100 && second >= 64 && second <= 127) || (first === 198 && (second === 18 || second === 19 || (second === 51 && parts[2] === 100))) || (first === 203 && second === 0 && parts[2] === 113);
}

function safeWebURL(value: string): string | null {
  try {
    var anchor = document.createElement('a') as HTMLAnchorElement; anchor.href = value;
    if (!/^https?:$/.test(anchor.protocol) || !anchor.hostname || anchor.username || anchor.password || unsafeHost(anchor.hostname) || /[?&](token|sig|signature|expires|auth)(=|&|$)/i.test(anchor.search)) return null;
    return anchor.href;
  } catch (error) { return null; }
}

function stableHash(value: string): string {
  var hash = 0;
  for (var index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return String(hash >>> 0);
}

export class IptvOrgPlaylistSource extends VideoSource implements IptvDirectorySource {
  private channels: PlaylistChannel[] | null = null;
  private readonly byId: { [id: string]: PlaylistChannel } = Object.create(null) as { [id: string]: PlaylistChannel };
  private sourceInfo: IptvSourceInfo | null = null;
  private requestSequence = 0;
  constructor(private readonly transport: CatalogTransport, private readonly playlist: string, private readonly blocklistURL: string, private readonly id: string = 'iptv', private readonly hiddenIds: string[] = []) { super(); }
  getCapabilities(): SourceCapabilities { return { live: true, vod: false, search: true, qualities: false, epg: false }; }
  info(): IptvSourceInfo | null { return this.sourceInfo; }
  playlistURL(): string { return this.playlist; }
  refresh(): void { this.channels = null; this.sourceInfo = null; for (var id in this.byId) delete this.byId[id]; }
  private freshURL(url: string): string { this.requestSequence++; return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'kicktv_refresh=' + new Date().getTime() + '-' + this.requestSequence; }
  describe(id: string): LiveChannel | null { return this.byId[id] ? this.byId[id].item : null; }
  browse(done: Complete<MediaPage>): CancelHandle {
    if (this.channels) { done({ ok: true, value: { items: this.channels.map(function (channel) { return channel.item; }) } }); return { cancel: function () {} }; }
    var canceled = false; var completed = false; var playlistText: string | null = null; var blocklistText: string | null = null; var error: { code: string; message: string } | null = null;
    var handles: CancelHandle[] = []; var self = this;
    function finish(): void {
      if (canceled || completed || (playlistText === null && !error) || (blocklistText === null && !error)) return;
      if (error) { completed = true; done({ ok: false, error: error }); return; }
      try {
        var rows = self.parse(playlistText as string, blocklistText as string);
        self.channels = rows;
        completed = true;
        done({ ok: true, value: { items: rows.map(function (channel) { return channel.item; }) } });
      } catch (parseError) { completed = true; done({ ok: false, error: { code: 'IPTV_PLAYLIST', message: 'No se pudo interpretar la lista IPTV o su blocklist.' } }); }
    }
    handles.push(this.transport.read(this.freshURL(this.playlist), 262144, function (result) { if (result.ok) playlistText = result.value; else error = result.error; finish(); }));
    handles.push(this.transport.read(this.freshURL(this.blocklistURL), 131072, function (result) { if (result.ok) blocklistText = result.value; else error = result.error; finish(); }));
    return { cancel: function () { canceled = true; for (var index = 0; index < handles.length; index++) handles[index].cancel(); } };
  }
  search(query: string, done: Complete<MediaPage>): CancelHandle {
    var self = this;
    return this.browse(function (result) {
      if (!result.ok) { done(result); return; }
      var folded = query.toLowerCase().trim();
      done({ ok: true, value: { items: result.value.items.filter(function (item) { return item.name.toLowerCase().indexOf(folded) >= 0; }) } });
    });
  }
  resolvePlayback(ref: MediaRef, done: Complete<PlaybackRequest>): CancelHandle {
    var channel = this.byId[ref.itemId]; var self = this;
    if (ref.sourceId !== this.id) { done({ ok: false, error: { code: 'IPTV_ITEM', message: 'Referencia de canal invalida.' } }); return { cancel: function () {} }; }
    if (!channel) {
      return this.browse(function (result) {
        if (!result.ok) { done(result); return; }
        if (!self.byId[ref.itemId]) { done({ ok: false, error: { code: 'IPTV_ITEM', message: 'El canal ya no esta en la lista.' } }); return; }
        self.resolvePlayback(ref, done);
      });
    }
    done({ ok: true, value: { item: channel.item, candidates: channel.candidates.slice() } });
    return { cancel: function () {} };
  }
  private parse(playlistText: string, blocklistText: string): PlaylistChannel[] {
    if (playlistText.substring(0, 7) !== '#EXTM3U') throw new Error('M3U header missing');
    var blocked = JSON.parse(blocklistText) as { channel: string }[];
    if (!Array.isArray(blocked) || blocked.some(function (entry) { return !entry || typeof entry.channel !== 'string'; })) throw new Error('Blocklist invalid');
    var blockedIds: { [id: string]: boolean } = Object.create(null) as { [id: string]: boolean };
    for (var blockIndex = 0; blockIndex < blocked.length; blockIndex++) blockedIds[blocked[blockIndex].channel] = true;
    var hidden: { [id: string]: boolean } = Object.create(null) as { [id: string]: boolean };
    for (var hiddenIndex = 0; hiddenIndex < this.hiddenIds.length; hiddenIndex++) hidden[this.hiddenIds[hiddenIndex]] = true;
    var output: PlaylistChannel[] = []; var groups: { [id: string]: PlaylistChannel } = Object.create(null) as { [id: string]: PlaylistChannel };
    var categories: { [id: string]: string } = {}; var lines = playlistText.split(/\r?\n/); var header = ''; var options: string[] = [];
    var self = this;
    function emit(url: string): void {
      if (!header) return;
      var attrs = parseAttributes(header); var channelId = (attrs['tvg-id'] || '').split('@')[0].trim();
      var comma = titleSeparator(header); var displayTitle = (comma >= 0 ? header.slice(comma + 1) : '').trim(); var name = (attrs['tvg-name'] || displayTitle).trim();
      if (!channelId || !/^[a-z0-9._-]{1,120}$/i.test(channelId) || !name || name.length > 200 || /\[geo-blocked\]/i.test(name) || blockedIds[channelId] || hidden[channelId] || options.length || attrs['http-referrer'] || attrs['http-user-agent']) { header = ''; options = []; return; }
      var group = (attrs['group-title'] || 'General').split(';').map(function (value) { return value.trim(); }).filter(function (value) { return value && value.toLowerCase() !== 'undefined'; });
      if (!group.length) group = ['General'];
      if (group.some(function (value) { return /(^|\W)(xxx|porn)(\W|$)/i.test(value); })) { header = ''; options = []; return; }
      var streamURL = safeWebURL(url);
      if (!streamURL) { header = ''; options = []; return; }
      var logo = attrs['tvg-logo'] ? safeWebURL(attrs['tvg-logo']) : null;
      if (logo && logo.substring(0, 6) !== 'https:') logo = null;
      var channel = groups[channelId];
      if (!channel) {
        var item = new LiveChannel({ sourceId: self.id, itemId: channelId }, name.replace(/\s+\((?:\d{3,4}p|4k)\)$/i, ''), logo || '', 'AR', [], [], { status: 'unverified' }, { status: 'unreviewed' });
        channel = { item: item, candidates: [] }; groups[channelId] = channel; self.byId[channelId] = channel; output.push(channel);
      }
      for (var categoryIndex = 0; categoryIndex < group.length; categoryIndex++) {
        var categoryName = group[categoryIndex]; var categoryId = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
        if (channel.item.categories.indexOf(categoryId) < 0) channel.item.categories.push(categoryId);
        categories[categoryId] = categoryName;
      }
      if (channel.candidates.some(function (candidate) { return candidate.url === streamURL; })) { header = ''; options = []; return; }
      var variant = (attrs['tvg-id'].split('@')[1] || '').toUpperCase();
      var quality = (displayTitle + ' ' + name).match(/\b(\d{3,4}p|4k|hd|sd)\b/i);
      var label = quality ? quality[1].toUpperCase() : variant || 'Original';
      channel.candidates.push({ id: 'iptv-org-' + stableHash(streamURL), url: streamURL, label: label, height: Number((label.match(/\d+/) || [])[0]) || 0, fps: 0 });
      header = ''; options = [];
    }
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      var line = lines[lineIndex].trim();
      if (line.indexOf('#EXTINF:') === 0) { header = line; options = []; }
      else if (line.indexOf('#EXTVLCOPT:') === 0) options.push(line);
      else if (header && /^https?:\/\//i.test(line)) emit(line);
    }
    this.sourceInfo = { mode: 'direct', generatedAt: new Date().toISOString(), verificationEnvironment: 'on-demand', categories: categories };
    return output;
  }
}