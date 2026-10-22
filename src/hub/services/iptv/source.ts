import { sha256 } from 'js-sha256';
import { CancelHandle, Complete, LiveChannel, MediaPage, MediaRef, PlaybackRequest, SourceCapabilities, StreamCandidate, VideoSource } from '../../domain/contracts';

export interface CatalogManifest {
  schemaVersion: number; version: string; generatedAt: string; countries: string[]; verificationEnvironment: string;
  categories: { [id: string]: string };
  files: { path: string; bytes: number; hash: string }[];
  partitions: { countries: { [country: string]: string[] }; search: string[]; lookup: string; details: string[] };
}
export interface CatalogCard {
  id: string; name: string; logo: string; country: string; categories: string[]; languages: string[];
  status: string; provenance?: { status?: string }; verification: { status?: string; checkedAt?: string; environment?: string }; detailPage: string;
}
export interface CatalogTransport { read(url: string, maxBytes: number, done: Complete<string>): CancelHandle; }
export interface IptvSourceInfo { mode?: string; generatedAt: string; verificationEnvironment: string; categories: { [id: string]: string }; }
export interface IptvDirectorySource extends VideoSource {
  info(): IptvSourceInfo | null;
  refresh(): void;
  describe(id: string): LiveChannel | null;
  playlistURL(): string;
}

export class CatalogRepository {
  private manifest: CatalogManifest | null = null;
  private readonly cache: { path: string; value: unknown }[] = [];
  constructor(private readonly manifestURL: string, private readonly transport: CatalogTransport) {}
  getManifest(): CatalogManifest | null { return this.manifest; }
  load(done: Complete<CatalogManifest>): CancelHandle {
    var self = this;
    if (this.manifest) { done({ ok: true, value: this.manifest }); return { cancel: function () {} }; }
    return this.transport.read(this.manifestURL, 131072, function (result) {
      if (!result.ok) { done(result); return; }
      try {
        var manifest = JSON.parse(result.value) as CatalogManifest;
        if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || !Array.isArray(manifest.files) || manifest.files.length > 5000 || !manifest.partitions || !manifest.partitions.countries || !Array.isArray(manifest.partitions.search)) { throw new Error('Manifest invalido'); }
        self.manifest = manifest; done({ ok: true, value: manifest });
      } catch (error) { done({ ok: false, error: { code: 'CATALOG_SCHEMA', message: 'El catalogo no tiene un formato compatible.' } }); }
    });
  }
  reset(): void { this.manifest = null; this.cache.length = 0; }
  read(file: string, done: Complete<unknown>): CancelHandle {
    var manifest = this.manifest;
    if (!manifest) { done({ ok: false, error: { code: 'CATALOG_NOT_LOADED', message: 'El catalogo todavia no esta cargado.' } }); return { cancel: function () {} }; }
    var entry = manifest.files.filter(function (candidate) { return candidate.path === file; })[0];
    if (!entry || typeof file !== 'string' || file.indexOf('versions/' + manifest.version + '/') !== 0 || !/^[a-zA-Z0-9_./-]+\.json$/.test(file) || file.indexOf('..') >= 0 || typeof entry.bytes !== 'number' || !isFinite(entry.bytes) || entry.bytes < 1 || entry.bytes > 262144 || !/^[a-f0-9]{24}$/.test(entry.hash)) {
      done({ ok: false, error: { code: 'CATALOG_PATH', message: 'Particion no admitida.' } }); return { cancel: function () {} };
    }
    var cached = this.cache.filter(function (item) { return item.path === file; })[0];
    if (cached) { done({ ok: true, value: cached.value }); return { cancel: function () {} }; }
    var anchor = document.createElement('a'); anchor.href = this.manifestURL;
    var base = anchor.href.slice(0, anchor.href.lastIndexOf('/') + 1);
    var self = this;
    return this.transport.read(base + file, entry.bytes, function (result) {
      if (!result.ok) { done(result); return; }
      try {
        if (sha256(result.value).slice(0, 24) !== entry.hash) { throw new Error('Hash incorrecto'); }
        var value = JSON.parse(result.value) as unknown;
        self.cache.push({ path: file, value: value });
        if (self.cache.length > 3) { self.cache.shift(); }
        done({ ok: true, value: value });
      } catch (error) { done({ ok: false, error: { code: 'CATALOG_INTEGRITY', message: 'El catalogo cambio o esta incompleto. Actualizar e intentar de nuevo.' } }); }
    });
  }
}

export class IptvSource extends VideoSource implements IptvDirectorySource {
  private readonly cards: { [id: string]: CatalogCard } = Object.create(null) as { [id: string]: CatalogCard };
  private allItems: LiveChannel[] | null = null;
  constructor(private readonly repository: CatalogRepository, private readonly id: string = 'iptv') { super(); }
  getCapabilities(): SourceCapabilities { return { live: true, vod: false, search: true, qualities: false, epg: false }; }
  info(): CatalogManifest | null { return this.repository.getManifest(); }
  playlistURL(): string { return this.repository.getManifest() ? '' : '/catalog/manifest.json'; }
  refresh(): void { this.repository.reset(); this.allItems = null; for (var id in this.cards) { delete this.cards[id]; } }
  describe(id: string): LiveChannel | null { return this.cards[id] ? this.item(this.cards[id]) : null; }
  private item(value: CatalogCard): LiveChannel {
    if (!value || typeof value.id !== 'string' || !value.id.length || value.id.length > 120 || typeof value.name !== 'string' || value.name.length > 200 || value.country !== 'AR' || !Array.isArray(value.categories) || value.categories.length > 10 || value.categories.some(function (category) { return typeof category !== 'string' || category.length > 30; }) || !Array.isArray(value.languages) || value.languages.length > 8 || value.languages.some(function (language) { return typeof language !== 'string' || !/^[a-z]{3}$/.test(language); }) || typeof value.logo !== 'string' || value.logo.length > 2048 || (value.status !== 'verified' && value.status !== 'unverified')) { throw new Error('Canal no compatible'); }
    return new LiveChannel({ sourceId: this.id, itemId: value.id }, value.name, value.logo || '', value.country, value.categories, value.languages, value.verification || {}, value.provenance || { status: 'unreviewed' });
  }
  browse(done: Complete<MediaPage>): CancelHandle {
    if (this.allItems) { done({ ok: true, value: { items: this.allItems.slice() } }); return { cancel: function () {} }; }
    var self = this; var canceled = false; var items: LiveChannel[] = []; var handles: CancelHandle[] = [];
    function next(page: number): void {
      handles.push(self.browsePage(page, function (result) {
        if (canceled) return;
        if (!result.ok) { done(result); return; }
        items = items.concat(result.value.items as LiveChannel[]);
        if (items.length > 512) { done({ ok: false, error: { code: 'CATALOG_MEMORY', message: 'El catalogo supera el perfil de 512 canales. Reducir o particionar el alcance.' } }); return; }
        if (result.value.nextPage) { next(Number(result.value.nextPage)); }
        else { self.allItems = items; done({ ok: true, value: { items: items.slice() } }); }
      }));
    }
    next(0);
    return { cancel: function () { canceled = true; for (var index = 0; index < handles.length; index++) handles[index].cancel(); } };
  }
  browsePage(page: number, done: Complete<MediaPage>): CancelHandle {
    var canceled = false; var handles: CancelHandle[] = []; var self = this;
    handles.push(this.repository.load(function (loaded) {
      if (canceled) return;
      if (!loaded.ok) { done(loaded); return; }
      var paths = loaded.value.partitions.countries.AR || [];
      if (page < 0 || page >= paths.length) { done({ ok: true, value: { items: [] } }); return; }
      handles.push(self.repository.read(paths[page], function (result) {
        if (canceled) return;
        if (!result.ok) { done(result); return; }
        try {
          var rows = (result.value as { items: CatalogCard[] }).items;
          if (!Array.isArray(rows) || rows.length > 100) throw new Error('Pagina invalida');
          var items: LiveChannel[] = [];
          for (var index = 0; index < rows.length; index++) {
            if (rows[index].status !== 'verified' && rows[index].status !== 'unverified') continue;
            var item = self.item(rows[index]); self.cards[item.ref.itemId] = rows[index]; items.push(item);
          }
          done({ ok: true, value: { items: items, nextPage: page + 1 < paths.length ? String(page + 1) : undefined } });
        } catch (error) { done({ ok: false, error: { code: 'CATALOG_CARD', message: 'Pagina de canales invalida.' } }); }
      }));
    }));
    return { cancel: function () { canceled = true; for (var index = 0; index < handles.length; index++) handles[index].cancel(); } };
  }
  search(query: string, done: Complete<MediaPage>): CancelHandle {
    var folded = query.toLowerCase().trim();
    var self = this;
    return this.browse(function (result) {
      if (!result.ok) { done(result); return; }
      done({ ok: true, value: { items: result.value.items.filter(function (item) { return item.name.toLowerCase().indexOf(folded) >= 0; }) } });
    });
  }
  resolvePlayback(ref: MediaRef, done: Complete<PlaybackRequest>): CancelHandle {
    var card = this.cards[ref.itemId];
    if (ref.sourceId !== this.id) { done({ ok: false, error: { code: 'IPTV_ITEM', message: 'Referencia de canal invalida.' } }); return { cancel: function () {} }; }
    var self = this;
    if (!card) {
      var canceled = false; var handles: CancelHandle[] = [];
      handles.push(this.browse(function (result) {
        if (canceled) return;
        if (!result.ok) { done(result); return; }
        if (!self.cards[ref.itemId]) { done({ ok: false, error: { code: 'IPTV_ITEM', message: 'El canal ya no esta en el catalogo.' } }); return; }
        handles.push(self.resolvePlayback(ref, done));
      }));
      return { cancel: function () { canceled = true; for (var index = 0; index < handles.length; index++) handles[index].cancel(); } };
    }
    return this.repository.read(card.detailPage, function (result) {
      if (!result.ok) { done(result); return; }
      try {
        var detail = (result.value as { items: { id: string; primary: unknown; fallbacks: unknown[] }[] }).items.filter(function (item) { return item.id === ref.itemId; })[0];
        if (!detail) throw new Error('Sin detalles');
        var candidates = [detail.primary].concat(detail.fallbacks || []).map(function (value) {
          var stream = value as { id: string; url: string; quality: string; height: number; transport: string; headers: { [key: string]: string }; verification: { status: string } };
          if (!stream || !/^https?:\/\//i.test(stream.url) || stream.transport !== 'direct' || (stream.verification.status !== 'ok' && stream.verification.status !== 'unverified') || Object.keys(stream.headers || {}).length) return null;
          return { id: stream.id, url: stream.url, label: stream.quality || 'Original', height: stream.height || 0, fps: 0 } as StreamCandidate;
        }).filter(function (item): item is StreamCandidate { return item !== null; });
        if (!candidates.length) throw new Error('Sin transporte compatible');
        done({ ok: true, value: { item: self.item(card), candidates: candidates } });
      } catch (error) { done({ ok: false, error: { code: 'IPTV_TRANSPORT', message: 'No hay un stream directo compatible para este canal.' } }); }
    });
  }
}