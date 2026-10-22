import { Clock, KeyValueStore, MediaRef, sameRef, validRef } from '../domain/contracts';

export interface GridEntry { number: number; ref: MediaRef; }
export class ChannelGridService {
  constructor(private readonly storage: KeyValueStore) {}
  list(): GridEntry[] {
    try {
      var data = JSON.parse(this.storage.get('stream-hub-grid-v1') || '[]') as GridEntry[];
      return Array.isArray(data) ? data.filter(function (entry) { return entry && validRef(entry.ref) && typeof entry.number === 'number' && Math.floor(entry.number) === entry.number && entry.number >= 1 && entry.number <= 999; }).sort(function (first, second) { return first.number - second.number; }) : [];
    } catch (error) { return []; }
  }
  assign(ref: MediaRef, number: number): void {
    if (number < 1 || number > 999 || Math.floor(number) !== number) throw new Error('Usar un numero entre 1 y 999.');
    var entries = this.list();
    if (entries.some(function (entry) { return entry.number === number && !sameRef(entry.ref, ref); })) throw new Error('Ese numero ya esta asignado.');
    entries = entries.filter(function (entry) { return !sameRef(entry.ref, ref); });
    entries.push({ number: number, ref: ref });
    this.storage.set('stream-hub-grid-v1', JSON.stringify(entries));
  }
  remove(ref: MediaRef): void { this.storage.set('stream-hub-grid-v1', JSON.stringify(this.list().filter(function (entry) { return !sameRef(entry.ref, ref); }))); }
}

export class StreamHealthService {
  constructor(private readonly storage: KeyValueStore, private readonly clock: Clock) {}
  private read(): { [id: string]: { failedAt: number; failures: number; retryAfter: number } } {
    try { var data = JSON.parse(this.storage.get('stream-hub-stream-health-v1') || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch (error) { return {}; }
  }
  blocked(id: string): boolean { var entry = this.read()[id]; return Boolean(entry && entry.retryAfter > this.clock.now()); }
  fail(id: string): void {
    var entries = this.read(); var failures = Math.min(3, (entries[id] && entries[id].failures || 0) + 1);
    entries[id] = { failedAt: this.clock.now(), failures: failures, retryAfter: this.clock.now() + [1800000, 7200000, 86400000][failures - 1] };
    try { this.storage.set('stream-hub-stream-health-v1', JSON.stringify(entries)); } catch (error) { }
  }
  succeed(id: string): void { var entries = this.read(); if (!Object.prototype.hasOwnProperty.call(entries, id)) return; delete entries[id]; try { this.storage.set('stream-hub-stream-health-v1', JSON.stringify(entries)); } catch (error) { } }
  policy(): string { var value = this.storage.get('stream-hub-health-policy'); return value === 'hide' || value === 'all' ? value : 'deprioritize'; }
  setPolicy(value: string): void { this.storage.set('stream-hub-health-policy', value); }
  reset(): void { this.storage.set('stream-hub-stream-health-v1', '{}'); }
}