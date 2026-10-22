import { ChannelGridService, StreamHealthService } from '../application/grid';
import { FavoritesService, PlaybackService, ServiceRegistry, ZappingService } from '../application/services';
import { LiveChannel, LiveStream, MediaRef, PlaybackRequest, StreamCandidate, sameRef } from '../domain/contracts';

export class PlayerController {
  private opened = false;
  private modal = false;
  private playing = false;
  private failed = false;
  private session = 0;
  private request: PlaybackRequest | null = null;
  private candidate: StreamCandidate | null = null;
  private attempted: string[] = [];
  private origin = '';
  private closed: (() => void) | null = null;
  private overlayTimer = 0;
  private watchdog = 0;
  private numberTimer = 0;
  private digits = '';
  private lastTime = -1;
  private previous: MediaRef | null = null;
  private requested: MediaRef | null = null;
  private successful: MediaRef | null = null;
  private readonly video: HTMLVideoElement;
  constructor(private readonly playback: PlaybackService, private readonly registry: ServiceRegistry, private readonly favorites: FavoritesService,
    private readonly zapping: ZappingService, private readonly grid: ChannelGridService, private readonly health: StreamHealthService,
    private readonly storage: { get(key: string): string | null; set(key: string, value: string): void }, private readonly icons: { [name: string]: string }) {
    this.video = document.getElementById('player-video') as HTMLVideoElement;
    var self = this;
    document.addEventListener('keydown', function (event) { self.key(event); }, true);
    document.addEventListener('click', function (event) {
      if (!self.opened) return;
      var node = event.target as HTMLElement;
      while (node && node !== document.body && !node.getAttribute('data-action')) node = node.parentElement as HTMLElement;
      if (node && self.node('player').contains(node)) { self.action(node.getAttribute('data-action') || ''); event.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('focusin', function (event) {
      if (!self.opened) return;
      var root = self.node(self.modal ? 'modal' : 'player');
      if (!root.contains(event.target as Node)) self.focus(self.modal ? 'modal-close' : 'player-toggle');
    });
    this.video.addEventListener('playing', function () { if (self.opened) { self.playing = true; self.failed = false; self.showMessage(self.checkingAvailability() ? 'Esperando avance del video...' : ''); self.toggleIcon(false); self.arm(); self.controls(); } });
    this.video.addEventListener('pause', function () { if (self.opened && self.video.getAttribute('src')) { self.playing = false; window.clearTimeout(self.watchdog); self.toggleIcon(true); self.controls(); } });
    this.video.addEventListener('waiting', function () { if (self.opened) { self.playing = false; self.showMessage(self.checkingAvailability() ? 'Comprobando disponibilidad en este dispositivo...' : 'Cargando video...'); self.arm(); self.controls(); } });
    this.video.addEventListener('error', function () { if (self.opened && self.video.error && self.video.getAttribute('src')) self.fail('Error de video ' + self.video.error.code + '.'); });
    this.video.addEventListener('ended', function () { if (self.opened) self.fail('La transmision finalizo.'); });
    this.video.addEventListener('timeupdate', function () {
      if (!self.opened || self.video.paused || self.video.currentTime <= self.lastTime) return;
      self.lastTime = self.video.currentTime; self.arm(); self.text('player-resolution', self.video.videoWidth + 'x' + self.video.videoHeight);
      if (self.video.currentTime > 0 && self.request && self.candidate) {
        if (self.checkingAvailability()) self.showMessage('Disponible en este dispositivo.');
        self.health.succeed(self.candidate.id); self.health.succeed('channel:' + self.request.item.ref.sourceId + ':' + self.request.item.ref.itemId); self.playback.confirmPlayback();
        var ref = self.request.item.ref;
        if (!self.successful || !sameRef(self.successful, ref)) { self.previous = self.successful; self.successful = ref; }
      }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden && self.opened) self.close(); });
  }
  private node(id: string): HTMLElement { return document.getElementById(id) as HTMLElement; }
  private checkingAvailability(): boolean { return Boolean(this.request && this.request.item instanceof LiveChannel && this.request.item.verification.status !== 'ok'); }
  private text(id: string, value: string): void { this.node(id).textContent = value; }
  private focus(id: string): void { this.node(id).focus(); }
  private showMessage(value: string): void { this.text('player-message', value); this.node('player-message').hidden = !value; }
  private toggleIcon(paused: boolean): void {
    this.node('player-toggle').innerHTML = '<span data-icon="' + (paused ? 'play' : 'pause') + '">' + this.icons[paused ? 'play' : 'pause'] + '</span>';
    this.node('player-toggle').setAttribute('aria-label', paused ? 'Reproducir' : 'Pausar');
  }
  private controls(): void {
    window.clearTimeout(this.overlayTimer); this.node('player-overlay').className = 'player-overlay';
    var self = this;
    if (this.playing && !this.modal) this.overlayTimer = window.setTimeout(function () { self.node('player-overlay').className = 'player-overlay hidden-controls'; }, 5000);
  }
  private arm(): void { window.clearTimeout(this.watchdog); var self = this; this.watchdog = window.setTimeout(function () { self.fail('El video no avanza.'); }, 20000); }
  open(ref: MediaRef, onClosed?: () => void): void {
    if (!this.opened) { this.origin = document.activeElement ? document.activeElement.id : ''; this.closed = onClosed || null; }
    this.requested = ref;
    this.opened = true; this.modal = false; this.playing = false; this.failed = false; this.request = null; this.candidate = null; this.attempted = [];
    window.clearTimeout(this.watchdog); window.clearTimeout(this.numberTimer); this.digits = '';
    this.node('modal').hidden = true; this.node('library').hidden = true; this.node('player').hidden = false;
    this.text('player-name', ref.itemId); this.text('player-title', ''); this.text('player-meta', ''); this.text('player-resolution', ''); this.text('current-quality', 'Original');
    this.showMessage('Resolviendo reproduccion...'); this.controls(); this.focus('player-toggle');
    var self = this; var sequence = ++this.session;
    this.playback.resolve(ref, function (result) {
      if (!self.opened || sequence !== self.session) return;
      if (!result.ok) { self.error(result.error.message); return; }
      self.request = result.value;
      var item = result.value.item; self.text('player-name', item.name); self.text('player-title', item.title);
      var service = self.registry.get(item.ref.sourceId);
      var number = self.grid.list().filter(function (entry) { return sameRef(entry.ref, ref); })[0];
      self.text('player-meta', (number ? number.number + ' / ' : '') + (service ? service.name : '') + (item instanceof LiveChannel ? ' / ' + item.country + ' / ' + item.categories.join(', ') + (item.provenance.status === 'reviewed' ? '' : ' / Fuente no revisada') : item instanceof LiveStream ? ' / ' + item.viewers + ' espectadores' : ''));
      if (item instanceof LiveStream && !item.live) { self.error('Este canal esta offline.'); return; }
      self.updateFavorite();
      var preferred = self.storage.get('kick-tv-default-quality') || 'auto';
      var candidates = result.value.candidates.slice();
      if (preferred !== 'auto') candidates = candidates.filter(function (candidate) { return candidate.height > 0 && candidate.height <= Number(preferred); }).sort(function (first, second) { return second.height - first.height || second.fps - first.fps; }).concat(candidates);
      var healthy = candidates.filter(function (candidate) { return !self.health.blocked(candidate.id); });
      self.select(healthy[0] || candidates[0]);
    });
  }
  private select(candidate: StreamCandidate | undefined): void {
    if (!candidate) { this.error('No hay un stream compatible disponible.'); return; }
    this.candidate = candidate; this.lastTime = -1; this.failed = false; this.playing = false;
    if (this.attempted.indexOf(candidate.id) < 0) this.attempted.push(candidate.id);
    this.text('current-quality', candidate.label); this.showMessage(this.checkingAvailability() ? 'Comprobando disponibilidad en este dispositivo...' : 'Cargando video...'); this.controls();
    try { this.playback.select(candidate); this.arm(); var self = this; this.playback.play(function (error) { if (self.opened && self.candidate === candidate) self.fail(error.message); }); }
    catch (error) { this.fail((error as Error).message); }
  }
  private fail(message: string): void {
    if (!this.opened || this.failed) return;
    this.failed = true; this.playing = false; window.clearTimeout(this.watchdog);
    if (this.candidate && navigator.onLine !== false) this.health.fail(this.candidate.id);
    var attempted = this.attempted;
    var next = this.request && this.request.candidates.filter(function (candidate) { return attempted.indexOf(candidate.id) < 0; })[0];
    if (next && this.attempted.length < 3 && navigator.onLine !== false) { this.select(next); return; }
    if (this.request && navigator.onLine !== false) this.health.fail('channel:' + this.request.item.ref.sourceId + ':' + this.request.item.ref.itemId);
    this.error((this.checkingAvailability() ? 'No disponible en este dispositivo. ' : '') + message + ' Reintentar, elegir otra calidad o volver.');
  }
  private error(message: string): void { this.failed = true; this.playing = false; window.clearTimeout(this.watchdog); this.showMessage(message); this.controls(); }
  close(): void {
    this.opened = false; this.session++; this.modal = false; window.clearTimeout(this.watchdog); window.clearTimeout(this.overlayTimer); window.clearTimeout(this.numberTimer);
    this.playback.stop(); this.node('modal').hidden = true; this.node('player').hidden = true; this.node('library').hidden = false;
    if (this.closed) this.closed();
    var target = document.getElementById(this.origin); if (target && target.getBoundingClientRect().height) target.focus();
  }
  private list(): MediaRef[] {
    if (!this.request) return [];
    var sourceId = this.request.item.ref.sourceId;
    var numbered = this.grid.list().filter(function (entry) { return entry.ref.sourceId === sourceId; }).map(function (entry) { return entry.ref; });
    var module = this.registry.get(sourceId);
    return (numbered.length ? numbered : this.favorites.list(sourceId)).filter(function (ref) { var item = module && module.view.describe(ref); return Boolean(item && (!(item instanceof LiveStream) || item.live)); });
  }
  private change(direction: number): void { var next = this.zapping.next(this.request ? this.request.item.ref : null, this.list(), direction); if (next) this.open(next); else this.showMessage('No hay otro canal en Mi grilla o favoritos.'); }
  private updateFavorite(): void {
    if (!this.request) return;
    var ref = this.request.item.ref; var saved = this.favorites.list().some(function (item) { return sameRef(item, ref); });
    this.node('player-favorite').innerHTML = '<span data-icon="star">' + this.icons[saved ? 'star-off' : 'star'] + '</span>';
    this.node('player-favorite').setAttribute('aria-label', saved ? 'Quitar de favoritos' : 'Agregar a favoritos');
  }
  private quality(): void {
    if (!this.request || !this.request.candidates.length) return;
    this.modal = true; this.controls(); this.node('modal').hidden = false; this.text('modal-title', 'Calidad de video');
    var root = this.node('modal-options'); root.textContent = ''; var self = this;
    this.node('modal-close').onclick = function (event) { event.stopPropagation(); self.modal = false; self.node('modal').hidden = true; self.focus('player-quality'); self.controls(); };
    this.request.candidates.forEach(function (candidate, index) {
      var button = document.createElement('button'); button.type = 'button'; button.id = 'shared-quality-' + index; button.className = 'menu-option'; button.textContent = candidate.label;
      button.onclick = function () { self.modal = false; self.node('modal').hidden = true; var persisted = true; try { self.storage.set('kick-tv-default-quality', candidate.height ? String(candidate.height) : 'auto'); } catch (error) { persisted = false; } self.attempted = []; self.select(candidate); if (!persisted) self.showMessage('Calidad aplicada, pero no se pudo guardar la preferencia.'); self.focus('player-quality'); };
      root.appendChild(button);
    });
    this.focus('shared-quality-0');
  }
  private action(action: string): void {
    if (action === 'close-player') this.close();
    else if (action === 'toggle') { if (this.video.paused) { this.arm(); this.playback.play(); } else this.playback.pause(); }
    else if (action === 'next') this.change(1);
    else if (action === 'previous') this.change(-1);
    else if (action === 'retry' && this.requested) this.open(this.requested);
    else if (action === 'quality') this.quality();
    else if (action === 'player-favorite' && this.request) {
      var ref = this.request.item.ref; var ids = this.favorites.list(ref.sourceId).map(function (item) { return item.itemId; });
      var position = ids.indexOf(ref.itemId); if (position >= 0) ids.splice(position, 1); else ids.push(ref.itemId);
      try { this.favorites.replaceSource(ref.sourceId, ids); this.updateFavorite(); }
      catch (error) { this.showMessage('No se pudo guardar el favorito. Revisar almacenamiento.'); }
    }
    this.controls();
  }
  private key(event: KeyboardEvent): void {
    if (!this.opened) return;
    var code = event.keyCode; var active = document.activeElement as HTMLElement;
    if (this.modal) {
      if (code === 27 || code === 10009 || code === 8) { this.modal = false; this.node('modal').hidden = true; this.focus('player-quality'); }
      else if (code === 13) active.click();
      else if (code === 38 || code === 40) { var options = this.node('modal').querySelectorAll('button'); var position = 0; for (var index = 0; index < options.length; index++) if (options[index] === active) position = index; (options[Math.max(0, Math.min(options.length - 1, position + (code === 38 ? -1 : 1)))] as HTMLElement).focus(); }
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    var hidden = this.node('player-overlay').className.indexOf('hidden-controls') >= 0; this.controls();
    if (code === 27 || code === 10009 || code === 8 || code === 413) this.close();
    else if (code === 427 || code === 38) this.change(1);
    else if (code === 428 || code === 40) this.change(-1);
    else if (code === 10252) this.action('toggle');
    else if (code === 415) { this.arm(); this.playback.play(); }
    else if (code === 19) this.playback.pause();
    else if (code === 405) this.quality();
    else if (code === 403) this.action('player-favorite');
    else if (code === 406 && this.previous) this.open(this.previous);
    else if (code >= 48 && code <= 57) {
      this.digits = (this.digits + String(code - 48)).slice(-3); this.showMessage('Canal ' + this.digits); window.clearTimeout(this.numberTimer); var self = this;
      this.numberTimer = window.setTimeout(function () { var number = Number(self.digits); self.digits = ''; var entry = self.grid.list().filter(function (item) { return item.number === number; })[0]; if (entry) self.open(entry.ref); else self.showMessage('Numero sin asignar.'); }, 2000);
    } else if (code === 13) { if (hidden) this.focus('player-toggle'); else if (this.node('player').contains(active)) active.click(); }
    else if (code === 37 || code === 39) { var buttons = this.node('player').querySelectorAll('button'); var current = 0; for (var button = 0; button < buttons.length; button++) if (buttons[button] === active) current = button; (buttons[(current + (code === 37 ? -1 : 1) + buttons.length) % buttons.length] as HTMLElement).focus(); }
    event.preventDefault(); event.stopImmediatePropagation();
  }
}