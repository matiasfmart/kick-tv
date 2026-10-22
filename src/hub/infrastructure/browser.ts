import { CancelHandle, Complete, HttpClient, KeyValueStore, Player, SourceError, StreamCandidate } from '../domain/contracts';

export class LocalStorageStore implements KeyValueStore {
  get(key: string): string | null { try { return window.localStorage.getItem(key); } catch (error) { return null; } }
  set(key: string, value: string): void { window.localStorage.setItem(key, value); }
}

export class XhrHttpClient implements HttpClient {
  constructor(private baseURL: string) {}
  setBaseURL(value: string): void { this.baseURL = value.replace(/\/$/, ''); }
  get(path: string, done: Complete<unknown>): CancelHandle {
    var request = new XMLHttpRequest();
    var canceled = false;
    function finish(result: Parameters<Complete<unknown>>[0]): void { if (!canceled) { done(result); } }
    request.onload = function () {
      var value: unknown;
      try { value = JSON.parse(request.responseText); }
      catch (error) { finish({ ok: false, error: { code: 'INVALID_JSON', message: 'El proxy no devolvio JSON valido.' } }); return; }
      if (request.status < 200 || request.status >= 300) {
        var info = value as { code?: string; message?: string } | null;
        finish({ ok: false, error: { code: info && info.code || 'HTTP_ERROR', message: info && info.message || 'Error HTTP ' + request.status } }); return;
      }
      finish({ ok: true, value: value });
    };
    request.onerror = function () { finish({ ok: false, error: { code: 'NETWORK', message: 'Sin conexion con el proxy. Verificar Internet y la URL en Ajustes.' } }); };
    request.ontimeout = function () { finish({ ok: false, error: { code: 'TIMEOUT', message: 'El proxy no respondio en 35 segundos.' } }); };
    try { request.open('GET', this.baseURL.replace(/\/$/, '') + path, true); request.timeout = 35000; request.send(); }
    catch (error) { finish({ ok: false, error: { code: 'REQUEST', message: 'No se pudo iniciar la consulta al proxy.' } }); }
    return { cancel: function () { canceled = true; request.abort(); } };
  }
}

export class Html5Player implements Player {
  private sequence = 0;
  constructor(private readonly video: HTMLVideoElement) {}
  open(candidate: StreamCandidate): void {
    if (candidate.headers && (candidate.headers.referrer || candidate.headers.userAgent)) { throw new Error('El reproductor HTML5 no permite esos headers.'); }
    this.sequence++;
    this.video.src = candidate.url; this.video.load();
  }
  play(onError?: (error: SourceError) => void): void {
    if (!this.video.getAttribute('src')) { return; }
    var sequence = this.sequence;
    var self = this;
    function fail(error: { name?: string }): void {
      if (sequence === self.sequence && error.name !== 'AbortError' && onError) { onError({ code: 'PLAY_FAILED', message: 'No se pudo reproducir: ' + (error.name || 'Error') }); }
    }
    try {
      var result = this.video.play() as unknown as { catch?: (callback: (error: { name?: string }) => void) => void } | undefined;
      if (result && typeof result.catch === 'function') { result.catch(fail); }
    } catch (error) { fail(error as { name?: string }); }
  }
  pause(): void { this.video.pause(); }
  stop(): void { this.sequence++; this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
  dispose(): void { this.stop(); }
}