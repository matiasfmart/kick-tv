export interface MediaRef { sourceId: string; itemId: string; }
export interface SourceError { code: string; message: string; }
export type Result<Value> = { ok: true; value: Value } | { ok: false; error: SourceError };
export type Complete<Value> = (result: Result<Value>) => void;
export interface CancelHandle { cancel(): void; }
export interface SourceCapabilities { live: boolean; vod: boolean; search: boolean; qualities: boolean; epg: boolean; audio?: boolean; launcher?: boolean; requiredHeaders?: string[]; }
export interface StreamCandidate {
  id: string;
  url: string;
  label: string;
  height: number;
  fps: number;
  bandwidth?: number;
  headers?: { referrer?: string; userAgent?: string };
}

export abstract class MediaItem {
  abstract readonly kind: string;
  constructor(public readonly ref: MediaRef, public readonly name: string, public readonly title: string, public readonly artwork: string) {}
}

export class LiveStream extends MediaItem {
  readonly kind = 'live-stream';
  constructor(ref: MediaRef, name: string, title: string, artwork: string, public readonly live: boolean, public readonly category: string, public readonly viewers: number) {
    super(ref, name, title, artwork);
  }
}

export class LiveChannel extends MediaItem {
  readonly kind = 'live-channel';
  constructor(ref: MediaRef, name: string, artwork: string, public readonly country: string, public readonly categories: string[], public readonly languages: string[], public readonly verification: { status?: string; checkedAt?: string; environment?: string }, public readonly provenance: { status?: string } = {}) {
    super(ref, name, '', artwork);
  }
}

export interface MediaPage { items: MediaItem[]; nextPage?: string; }
export interface PlaybackRequest { item: MediaItem; candidates: StreamCandidate[]; }
export abstract class VideoSource {
  abstract getCapabilities(): SourceCapabilities;
  abstract browse(done: Complete<MediaPage>): CancelHandle;
  abstract search(query: string, done: Complete<MediaPage>): CancelHandle;
  abstract resolvePlayback(ref: MediaRef, done: Complete<PlaybackRequest>): CancelHandle;
}

export interface Player {
  open(candidate: StreamCandidate): void;
  play(onError?: (error: SourceError) => void): void;
  pause(): void;
  stop(): void;
  dispose(): void;
}

export interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): void; }
export interface Clock { now(): number; }
export interface HttpClient { get(path: string, done: Complete<unknown>): CancelHandle; setBaseURL(value: string): void; }
export interface ServiceView {
  activate(section: string): void;
  deactivate(): void;
  openItem(ref: MediaRef): void;
  describe(ref: MediaRef): MediaItem | null;
}
export interface ServiceModule {
  id: string;
  name: string;
  icon: string;
  capabilities: SourceCapabilities;
  source: VideoSource;
  view: ServiceView;
  routes: { id: string; title: string; section: string }[];
}
export interface ServiceConfiguration { id: string; type: string; enabled: boolean; order: number; icon?: string; catalogUrl?: string; playlistUrl?: string; blocklistUrl?: string; hiddenChannels?: string[]; }

export function validRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== 'object') { return false; }
  var ref = value as MediaRef;
  return typeof ref.sourceId === 'string' && /^[a-z0-9-]+$/.test(ref.sourceId) && typeof ref.itemId === 'string' && ref.itemId.length > 0 && ref.itemId.length <= 200;
}

export function sameRef(first: MediaRef, second: MediaRef): boolean {
  return first.sourceId === second.sourceId && first.itemId === second.itemId;
}