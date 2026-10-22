import { CancelHandle, Clock, Complete, KeyValueStore, MediaRef, PlaybackRequest, Player, ServiceModule, StreamCandidate, sameRef, validRef } from '../domain/contracts';

export class ServiceRegistry {
  private readonly modules: ServiceModule[] = [];
  register(module: ServiceModule): void {
    if (this.get(module.id)) { throw new Error('Servicio duplicado: ' + module.id); }
    this.modules.push(module);
  }
  get(id: string): ServiceModule | undefined { return this.modules.filter(function (module) { return module.id === id; })[0]; }
  list(): ServiceModule[] { return this.modules.slice(); }
}

export class FavoritesService {
  private refs: MediaRef[] = [];
  private names: { ref: MediaRef; name: string }[] = [];
  private readonly key = 'stream-hub-favorites-v1';
  private readonly namesKey = 'stream-hub-favorite-names-v1';
  constructor(private readonly storage: KeyValueStore) {
    var raw: unknown = null;
    try { raw = JSON.parse(storage.get(this.key) || 'null'); } catch (error) { }
    if (Array.isArray(raw)) {
      for (var storedIndex = 0; storedIndex < raw.length; storedIndex++) {
        var storedRef: unknown = raw[storedIndex];
        if (validRef(storedRef)) {
          var normalized = { sourceId: storedRef.sourceId, itemId: storedRef.itemId };
          if (!this.refs.some(function (existing) { return sameRef(existing, normalized); })) { this.refs.push(normalized); }
        }
      }
    }
    else {
      try {
        var legacy: unknown = JSON.parse(storage.get('kick-tv-favorites') || '[]');
        if (Array.isArray(legacy)) {
          for (var index = 0; index < legacy.length; index++) {
            var slug: unknown = legacy[index];
            if (typeof slug === 'string' && /^[a-z0-9_-]{1,50}$/i.test(slug)) {
              var ref = { sourceId: 'kick', itemId: slug.toLowerCase() };
              if (!this.refs.some(function (existing) { return sameRef(existing, ref); })) { this.refs.push(ref); }
            }
          }
        }
      } catch (error) { }
    }
    try {
      var savedNames: unknown = JSON.parse(storage.get(this.namesKey) || '[]');
      if (Array.isArray(savedNames)) {
        for (var nameIndex = 0; nameIndex < savedNames.length && this.names.length < 512; nameIndex++) {
          var savedName = savedNames[nameIndex];
          if (savedName && validRef(savedName.ref) && typeof savedName.name === 'string' && savedName.name.length > 0 && savedName.name.length <= 200) {
            this.names.push({ ref: { sourceId: savedName.ref.sourceId, itemId: savedName.ref.itemId }, name: savedName.name });
          }
        }
      }
    } catch (error) { }
  }
  list(sourceId?: string): MediaRef[] { return this.refs.filter(function (ref) { return !sourceId || ref.sourceId === sourceId; }).map(function (ref) { return { sourceId: ref.sourceId, itemId: ref.itemId }; }); }
  name(ref: MediaRef): string | null { var entry = this.names.filter(function (saved) { return sameRef(saved.ref, ref); })[0]; return entry ? entry.name : null; }
  setName(ref: MediaRef, name: string | null): void {
    if (!validRef(ref)) { return; }
    var next = this.names.filter(function (saved) { return !sameRef(saved.ref, ref); });
    if (name && name.length <= 200) { next.push({ ref: { sourceId: ref.sourceId, itemId: ref.itemId }, name: name }); }
    this.names = next.slice(-512);
    try { this.storage.set(this.namesKey, JSON.stringify(this.names)); } catch (error) { }
  }
  replaceSource(sourceId: string, ids: string[]): void {
    var next = this.refs.filter(function (ref) { return ref.sourceId !== sourceId; });
    for (var index = 0; index < ids.length; index++) {
      var ref = { sourceId: sourceId, itemId: ids[index] };
      if (validRef(ref) && !next.some(function (existing) { return sameRef(existing, ref); })) { next.push(ref); }
    }
    this.storage.set(this.key, JSON.stringify(next));
    this.refs = next;
    if (sourceId === 'kick') { this.storage.set('kick-tv-favorites', JSON.stringify(this.list('kick').map(function (ref) { return ref.itemId; }))); }
  }
}

export interface HistoryEntry { ref: MediaRef; name: string; playedAt: number; }
export class HistoryService {
  constructor(private readonly storage: KeyValueStore, private readonly clock: Clock) {}
  list(): HistoryEntry[] {
    try {
      var data: unknown = JSON.parse(this.storage.get('stream-hub-history-v1') || '[]');
      return Array.isArray(data) ? data.filter(function (entry) { return entry && validRef(entry.ref) && typeof entry.name === 'string' && typeof entry.playedAt === 'number'; }).slice(0, 20) : [];
    } catch (error) { return []; }
  }
  record(ref: MediaRef, name: string): void {
    var entries = this.list().filter(function (entry) { return !sameRef(entry.ref, ref); });
    entries.unshift({ ref: { sourceId: ref.sourceId, itemId: ref.itemId }, name: name, playedAt: this.clock.now() });
    try { this.storage.set('stream-hub-history-v1', JSON.stringify(entries.slice(0, 20))); } catch (error) { }
  }
}

export class PlaybackService {
  private pending: CancelHandle | null = null;
  private sequence = 0;
  private request: PlaybackRequest | null = null;
  private recorded = false;
  constructor(private readonly registry: ServiceRegistry, private readonly player: Player, private readonly history: HistoryService) {}
  resolve(ref: MediaRef, done: Complete<PlaybackRequest>): CancelHandle {
    this.stop();
    var sequence = this.sequence;
    var module = this.registry.get(ref.sourceId);
    var self = this;
    if (!module) { done({ ok: false, error: { code: 'SOURCE_NOT_FOUND', message: 'Servicio no disponible.' } }); return { cancel: function () {} }; }
    this.pending = module.source.resolvePlayback(ref, function (result) {
      if (sequence !== self.sequence) { return; }
      self.pending = null;
      if (result.ok) { self.request = result.value; }
      done(result);
    });
    return { cancel: function () { if (sequence === self.sequence) { self.stop(); } } };
  }
  select(candidate: StreamCandidate): void {
    if (!this.request || !this.request.candidates.some(function (item) { return item.id === candidate.id && item.url === candidate.url; })) { throw new Error('Calidad no resuelta por la fuente actual.'); }
    this.player.open(candidate);
  }
  play(onError?: (error: { code: string; message: string }) => void): void { this.player.play(onError); }
  pause(): void { this.player.pause(); }
  confirmPlayback(): void {
    if (this.request && !this.recorded) { this.recorded = true; this.history.record(this.request.item.ref, this.request.item.name); }
  }
  stop(): void {
    this.sequence++;
    if (this.pending) { this.pending.cancel(); this.pending = null; }
    this.request = null; this.recorded = false; this.player.stop();
  }
  dispose(): void { this.stop(); this.player.dispose(); }
}

export class ZappingService {
  next(current: MediaRef | null, refs: MediaRef[], direction: number): MediaRef | null {
    if (!refs.length || (refs.length === 1 && current && sameRef(refs[0], current))) { return null; }
    var position = -1;
    for (var index = 0; index < refs.length; index++) { if (current && sameRef(refs[index], current)) { position = index; break; } }
    var next = position < 0 ? (direction > 0 ? 0 : refs.length - 1) : (position + direction + refs.length) % refs.length;
    return refs[next];
  }
}