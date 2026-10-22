import { ChannelGridService, StreamHealthService } from '../../application/grid';
import { FavoritesService } from '../../application/services';
import { KeyValueStore, LiveChannel, MediaItem, MediaRef, ServiceView, sameRef } from '../../domain/contracts';
import { PlayerController } from '../../presentation/player';
import { IptvDirectorySource } from './source';

export class IptvView implements ServiceView {
  private readonly root: HTMLElement;
  private items: LiveChannel[] = [];
  private active = false;
  private query = '';
  private category = '';
  private language = '';
  private savedOnly = false;
  private offset = 0;
  private pending: { cancel(): void } | null = null;
  private debounce = 0;
  private numberRef: MediaRef | null = null;
  private digits = '';
  private settingsOpen = false;
  private suspended = false;
  constructor(private readonly source: IptvDirectorySource, private readonly favorites: FavoritesService, private readonly grid: ChannelGridService,
    private readonly health: StreamHealthService, private readonly player: PlayerController, private readonly navigate: (route: string) => void,
    private readonly icons: { [name: string]: string }, private readonly storage: KeyValueStore) {
    this.root = document.createElement('section'); this.root.id = 'iptv-content'; this.root.hidden = true;
    this.root.innerHTML = '<div class="section-heading"><div><h1>IPTV Argentina</h1><p id="iptv-summary" class="hub-muted"></p></div><button id="iptv-refresh" class="icon-button" aria-label="Actualizar catalogo" title="Actualizar catalogo">' + this.icons['refresh-cw'] + '</button></div>' +
      '<div class="iptv-toolbar"><button id="iptv-category">Todas las categorias</button><button id="iptv-language">Todos los idiomas</button><button id="iptv-saved">Mi grilla</button><button id="iptv-search-toggle" class="iptv-search-button" aria-label="Buscar canal en IPTV Argentina" title="Buscar canal en IPTV Argentina" aria-expanded="false"><span data-icon="search">' + this.icons.search + '</span>Buscar</button><button id="iptv-health">Fallos: despriorizar</button><button id="iptv-reset" class="icon-button" aria-label="Restablecer fallos locales" title="Restablecer fallos locales">' + this.icons['refresh-cw'] + '</button><button id="iptv-catalog-settings" class="icon-button" aria-label="URL del catalogo" title="URL del catalogo">' + this.icons.settings + '</button></div>' +
      '<div id="iptv-search" hidden><input id="iptv-query" type="text" readonly aria-label="Nombre del canal IPTV" placeholder="Nombre del canal"><div id="iptv-keyboard" class="keyboard" aria-label="Teclado IPTV"></div><div class="keyboard-actions"><button id="iptv-delete" class="icon-button" aria-label="Borrar caracter" title="Borrar caracter">' + this.icons.delete + '</button><button id="iptv-clear" class="icon-button" aria-label="Limpiar busqueda" title="Limpiar busqueda">' + this.icons.x + '</button></div></div>' +
      '<p id="iptv-status" role="status"></p><div id="iptv-grid" class="channel-grid"></div><div class="iptv-pages"><button id="iptv-prev" class="icon-button" aria-label="Pagina anterior" title="Pagina anterior">' + this.icons['arrow-left'] + '</button><span id="iptv-range"></span><button id="iptv-next" class="icon-button" aria-label="Pagina siguiente" title="Pagina siguiente">' + this.icons['arrow-right'] + '</button></div>';
    (document.getElementById('service-content') as HTMLElement).appendChild(this.root);
    var self = this;
    this.node('iptv-refresh').onclick = function () { self.source.refresh(); self.load(); };
    this.node('iptv-search-toggle').onclick = function () { var input = self.node('iptv-search'); input.hidden = !input.hidden; self.node('iptv-search-toggle').setAttribute('aria-expanded', String(!input.hidden)); if (!input.hidden) self.node('iptv-query').focus(); };
    this.node('iptv-delete').onclick = function () { self.setQuery(self.query.slice(0, -1)); };
    this.node('iptv-clear').onclick = function () { self.setQuery(''); };
    this.node('iptv-saved').onclick = function () { self.savedOnly = !self.savedOnly; self.offset = 0; self.render(); };
    this.node('iptv-category').onclick = function () {
      var categories = ['']; self.items.forEach(function (item) { item.categories.forEach(function (category) { if (categories.indexOf(category) < 0) categories.push(category); }); });
      self.category = categories[(categories.indexOf(self.category) + 1) % categories.length]; self.offset = 0; self.render();
    };
    this.node('iptv-language').onclick = function () { var languages = ['']; self.items.forEach(function (item) { item.languages.forEach(function (language) { if (languages.indexOf(language) < 0) languages.push(language); }); }); self.language = languages[(languages.indexOf(self.language) + 1) % languages.length]; self.offset = 0; self.render(); };
    this.node('iptv-health').onclick = function () { var policies = ['deprioritize', 'hide', 'all']; self.health.setPolicy(policies[(policies.indexOf(self.health.policy()) + 1) % 3]); self.render(); };
    this.node('iptv-reset').onclick = function () { self.health.reset(); self.render(); };
    this.node('iptv-catalog-settings').onclick = function () { self.settings(); };
    this.node('iptv-prev').onclick = function () { self.offset = Math.max(0, self.offset - 12); self.render(); self.focusFirst(); };
    this.node('iptv-next').onclick = function () { self.offset += 12; self.render(); self.focusFirst(); };
    var keys = 'qwertyuiopasdfghjklzxcvbnm0123456789';
    for (var index = 0; index < keys.length; index++) {
      (function (key: string, position: number) { var button = document.createElement('button'); button.type = 'button'; button.id = 'iptv-key-' + position; button.textContent = key.toUpperCase(); button.onclick = function () { self.setQuery(self.query + key); }; self.node('iptv-keyboard').appendChild(button); }(keys.charAt(index), index));
    }
    document.addEventListener('keydown', function (event) { self.key(event); }, true);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        self.suspended = true;
        if (self.pending) { self.pending.cancel(); self.pending = null; }
      } else if (self.active && self.suspended) { self.suspended = false; self.refreshCatalog(); }
    });
    document.addEventListener('focusin', function (event) { if (self.active && (self.settingsOpen || self.numberRef) && !self.node('modal').contains(event.target as Node)) (self.node('modal-options').querySelector('button') as HTMLElement).focus(); });
  }
  private node(id: string): HTMLElement { return document.getElementById(id) as HTMLElement; }
  private status(value: string): void { this.node('iptv-status').textContent = value; }
  activate(section: string): void { this.active = true; this.root.hidden = false; this.savedOnly = section === 'favorites'; if (section === 'search') this.node('iptv-search').hidden = false; this.refreshCatalog(); this.node('iptv-category').focus(); }
  deactivate(): void { this.active = false; this.root.hidden = true; if (this.pending) { this.pending.cancel(); this.pending = null; } window.clearTimeout(this.debounce); }
  describe(ref: MediaRef): MediaItem | null { return this.source.describe(ref.itemId); }
  openItem(ref: MediaRef): void { var self = this; this.player.open(ref, function () { self.render(); }); }
  private load(): void {
    if (this.pending) this.pending.cancel(); this.status('Cargando catalogo...'); var self = this;
    this.pending = this.source.browse(function (result) {
      if (!self.active) return;
      self.pending = null;
      if (!result.ok) { self.status(result.error.message); return; }
      self.items = result.value.items as LiveChannel[]; self.offset = 0; self.status(''); self.render();
    });
  }
  private refreshCatalog(): void { if (this.pending) { this.pending.cancel(); this.pending = null; } this.source.refresh(); this.items = []; this.offset = 0; this.render(); this.load(); }
  private setQuery(value: string): void { this.query = value.substring(0, 50); (this.node('iptv-query') as HTMLInputElement).value = this.query; this.offset = 0; window.clearTimeout(this.debounce); var self = this; this.debounce = window.setTimeout(function () { self.render(); }, 100); }
  private render(): void {
    var self = this; var saved = this.favorites.list('iptv'); var numbers = this.grid.list(); var info = this.source.info();
    var items = this.items.filter(function (item) { return (!self.query || item.name.toLowerCase().indexOf(self.query.toLowerCase()) >= 0) && (!self.category || item.categories.indexOf(self.category) >= 0) && (!self.language || item.languages.indexOf(self.language) >= 0) && (!self.savedOnly || saved.some(function (ref) { return sameRef(ref, item.ref); })); });
    if (this.health.policy() === 'hide') { var healthy = items.filter(function (item) { return !self.health.blocked('channel:iptv:' + item.ref.itemId); }); if (healthy.length || items.length === 0) items = healthy; else this.status('Fallos generalizados: se conserva la grilla para poder reintentar.'); }
    else if (this.health.policy() === 'deprioritize') items.sort(function (first, second) { return Number(self.health.blocked('channel:iptv:' + first.ref.itemId)) - Number(self.health.blocked('channel:iptv:' + second.ref.itemId)); });
    if (this.savedOnly) items.sort(function (first, second) { var firstNumber = numbers.filter(function (entry) { return sameRef(entry.ref, first.ref); })[0]; var secondNumber = numbers.filter(function (entry) { return sameRef(entry.ref, second.ref); })[0]; return (firstNumber ? firstNumber.number : 1000) - (secondNumber ? secondNumber.number : 1000); });
    var pendingAvailability = this.items.filter(function (item) { return item.verification.status !== 'ok'; }).length;
    var unreviewedSources = this.items.filter(function (item) { return item.provenance.status !== 'reviewed'; }).length;
    this.node('iptv-summary').textContent = this.items.length + ' canales / ' + pendingAvailability + ' pendientes / ' + (info && info.mode === 'direct' ? 'iptv-org directo' : 'catalogo local');
    this.node('iptv-category').textContent = this.category ? info && info.categories[this.category] || this.category : 'Todas las categorias';
    var hasLanguages = this.items.some(function (item) { return item.languages.length > 0; });
    (this.node('iptv-language') as HTMLButtonElement).disabled = !hasLanguages;
    this.node('iptv-language').hidden = !hasLanguages;
    this.node('iptv-language').textContent = hasLanguages ? this.language === 'spa' ? 'Espanol' : this.language || 'Todos los idiomas' : 'Idiomas no disponibles';
    this.node('iptv-saved').setAttribute('aria-pressed', String(this.savedOnly));
    this.node('iptv-health').textContent = 'Fallos: ' + (this.health.policy() === 'hide' ? 'ocultar' : this.health.policy() === 'all' ? 'mostrar todos' : 'despriorizar');
    var root = this.node('iptv-grid'); root.textContent = '';
    if (this.offset >= items.length) this.offset = Math.max(0, Math.floor((items.length - 1) / 12) * 12);
    items.slice(this.offset, this.offset + 12).forEach(function (item, index) {
      var article = document.createElement('article'); article.className = 'channel';
      var watch = document.createElement('button'); watch.type = 'button'; watch.id = 'iptv-watch-' + (self.offset + index); watch.className = 'channel-play';
      var avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = item.name.substring(0, 2).toUpperCase();
      if (/^https:\/\//i.test(item.artwork)) { var image = document.createElement('img'); image.src = item.artwork; image.alt = ''; image.onerror = function () { image.hidden = true; }; avatar.appendChild(image); }
      watch.appendChild(avatar); var name = document.createElement('span'); name.className = 'channel-name'; name.textContent = item.name; watch.appendChild(name);
      var detail = document.createElement('span'); detail.className = 'channel-title'; detail.textContent = item.categories.map(function (category) { return info && info.categories[category] || category; }).join(' / '); watch.appendChild(detail);
      var language = document.createElement('span'); language.className = 'channel-category'; language.textContent = (item.verification.status === 'ok' ? 'HLS sondeado' : 'Por probar') + ' / ' + (item.provenance.status === 'reviewed' ? 'Fuente revisada' : 'Sin revisar'); watch.appendChild(language);
      watch.onclick = function () { self.openItem(item.ref); }; article.appendChild(watch);
      var favorite = document.createElement('button'); favorite.type = 'button'; favorite.id = 'iptv-favorite-' + (self.offset + index); favorite.className = 'channel-favorite';
      var selected = saved.some(function (ref) { return sameRef(ref, item.ref); }); favorite.innerHTML = self.icons[selected ? 'star-off' : 'star']; favorite.setAttribute('aria-label', selected ? 'Quitar de Mi grilla' : 'Agregar a Mi grilla'); favorite.title = favorite.getAttribute('aria-label') || '';
      favorite.onclick = function () {
        try {
          var ids = self.favorites.list('iptv').map(function (ref) { return ref.itemId; }); var position = ids.indexOf(item.ref.itemId);
          if (position >= 0) { ids.splice(position, 1); self.grid.remove(item.ref); }
          else { ids.push(item.ref.itemId); var used = self.grid.list().map(function (entry) { return entry.number; }); var number = 1; while (used.indexOf(number) >= 0) number++; self.grid.assign(item.ref, number); }
          self.favorites.replaceSource('iptv', ids); self.favorites.setName(item.ref, position >= 0 ? null : item.name); self.render(); var target = document.getElementById(favorite.id); if (target) target.focus();
        } catch (error) { self.status('No se pudo guardar Mi grilla. Revisar almacenamiento disponible.'); }
      }; article.appendChild(favorite);
      var entry = numbers.filter(function (number) { return sameRef(number.ref, item.ref); })[0];
      if (entry) { var assign = document.createElement('button'); assign.className = 'iptv-number'; assign.type = 'button'; assign.textContent = '#' + entry.number; assign.setAttribute('aria-label', 'Asignar numero de canal'); assign.onclick = function () { self.assign(item.ref, entry.number); }; article.appendChild(assign); }
      root.appendChild(article);
    });
    (this.node('iptv-prev') as HTMLButtonElement).disabled = this.offset === 0;
    (this.node('iptv-next') as HTMLButtonElement).disabled = this.offset + 12 >= items.length;
    this.node('iptv-range').textContent = items.length ? (this.offset + 1) + '-' + Math.min(items.length, this.offset + 12) + ' / ' + items.length : 'Sin canales para este filtro';
  }
  private focusFirst(): void { var first = this.root.querySelector('.channel-play') as HTMLElement | null; if (first) first.focus(); else this.node('iptv-category').focus(); }
  private settings(): void {
    this.settingsOpen = true; this.node('modal').hidden = false; this.node('modal-title').textContent = 'URL de la lista IPTV';
    var root = this.node('modal-options'); root.textContent = ''; var input = document.createElement('input'); input.id = 'iptv-playlist-url'; input.type = 'url'; input.spellcheck = false; input.setAttribute('aria-label', 'URL de la lista IPTV'); input.value = this.storage.get('stream-hub-iptv-url') || this.source.playlistURL(); root.appendChild(input);
    var save = document.createElement('button'); save.id = 'iptv-save-catalog'; save.type = 'button'; save.className = 'menu-option'; save.textContent = 'Guardar y recargar'; root.appendChild(save); var self = this;
    save.onclick = function () {
      var value = input.value.trim(); var anchor = document.createElement('a'); anchor.href = value;
      if (!/^https?:\/\//i.test(value) || !anchor.hostname || anchor.username || anchor.password || anchor.search || anchor.hash || !/\.m3u8?$/i.test(anchor.pathname)) { self.node('modal-title').textContent = 'Ingresar URL HTTP/HTTPS de lista .m3u o .m3u8, sin credenciales.'; return; }
      try { self.storage.set('stream-hub-iptv-url', value); window.location.reload(); }
      catch (error) { self.node('modal-title').textContent = 'No se pudo guardar la URL.'; }
    };
    this.node('modal-close').onclick = function (event) { event.stopPropagation(); self.settingsOpen = false; self.node('modal').hidden = true; self.node('iptv-catalog-settings').focus(); }; input.focus();
  }
  private assign(ref: MediaRef, number: number): void {
    this.numberRef = ref; this.digits = String(number); this.node('modal').hidden = false; this.node('modal-title').textContent = 'Numero de canal (1-999)';
    var root = this.node('modal-options'); root.textContent = ''; var field = document.createElement('input'); field.id = 'iptv-number-input'; field.readOnly = true; field.value = this.digits; field.setAttribute('aria-label', 'Numero de canal'); root.appendChild(field);
    var self = this;
    for (var index = 0; index < 10; index++) (function (digit: number) { var key = document.createElement('button'); key.type = 'button'; key.className = 'iptv-digit'; key.textContent = String(digit); key.onclick = function () { self.digits = (self.digits + digit).slice(-3); field.value = self.digits; }; root.appendChild(key); }(index));
    var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Borrar'; remove.onclick = function () { self.digits = ''; field.value = ''; }; root.appendChild(remove);
    var save = document.createElement('button'); save.id = 'iptv-save-number'; save.type = 'button'; save.textContent = 'Guardar'; save.onclick = function () { try { self.grid.assign(ref, Number(self.digits)); self.numberRef = null; self.node('modal').hidden = true; self.render(); self.focusFirst(); } catch (error) { self.node('modal-title').textContent = (error as Error).message; } }; root.appendChild(save);
    this.node('modal-close').onclick = function (event) { event.stopPropagation(); self.numberRef = null; self.node('modal').hidden = true; self.focusFirst(); }; save.focus();
  }
  private key(event: KeyboardEvent): void {
    if (!this.active || !(document.getElementById('player') as HTMLElement).hidden) return;
    var active = document.activeElement as HTMLElement; var code = event.keyCode;
    if (this.settingsOpen) {
      if (code === 27 || code === 10009) { this.settingsOpen = false; this.node('modal').hidden = true; this.node('iptv-catalog-settings').focus(); }
      else if (code === 13) { if (active.tagName === 'INPUT') this.node('iptv-save-catalog').focus(); else active.click(); }
      else if (active.tagName === 'INPUT') return;
      else if (code >= 37 && code <= 40) this.move(code, this.node('modal'));
      else return;
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (this.numberRef) {
      if (code >= 48 && code <= 57) { this.digits = (this.digits + (code - 48)).slice(-3); (this.node('iptv-number-input') as HTMLInputElement).value = this.digits; }
      else if (code === 27 || code === 10009) { this.numberRef = null; this.node('modal').hidden = true; this.focusFirst(); }
      else if (code === 13) active.click();
      else if (code === 8) { this.digits = this.digits.slice(0, -1); (this.node('iptv-number-input') as HTMLInputElement).value = this.digits; }
      else if (code >= 37 && code <= 40) this.move(code, this.node('modal'));
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (!this.root.contains(active)) return;
    if (code === 27 || code === 10009) { if (!this.node('iptv-search').hidden) { this.node('iptv-search').hidden = true; this.node('iptv-search-toggle').setAttribute('aria-expanded', 'false'); this.node('iptv-search-toggle').focus(); } else this.navigate('home'); }
    else if (code === 13) { if (active.tagName === 'BUTTON') active.click(); }
    else if (code >= 37 && code <= 40) { if (!this.move(code, this.root) && code === 37) return; }
    else if (code === 8) this.setQuery(this.query.slice(0, -1));
    else if (!event.ctrlKey && !event.metaKey && event.key && event.key.length === 1) this.setQuery(this.query + event.key);
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
  }
  private move(code: number, root: HTMLElement): boolean {
    var origin = (document.activeElement as HTMLElement).getBoundingClientRect(); var nodes = root.querySelectorAll('button, input'); var best: HTMLElement | null = null; var score = Infinity; var alignedBest = false;
    for (var index = 0; index < nodes.length; index++) {
      var node = nodes[index] as HTMLElement; var rect = node.getBoundingClientRect(); if (!rect.width || !rect.height || (node as HTMLButtonElement).disabled || node === document.activeElement) continue;
      var horizontal = code === 37 || code === 39; var deltaX = rect.left + rect.width / 2 - origin.left - origin.width / 2; var deltaY = rect.top + rect.height / 2 - origin.top - origin.height / 2;
      var primary = horizontal ? deltaX * (code === 37 ? -1 : 1) : deltaY * (code === 38 ? -1 : 1); if (primary <= 2) continue;
      var aligned = horizontal ? Math.min(rect.bottom, origin.bottom) > Math.max(rect.top, origin.top) : Math.min(rect.right, origin.right) > Math.max(rect.left, origin.left);
      var distance = primary + Math.abs(horizontal ? deltaY : deltaX) * 2.5;
      if ((aligned && !alignedBest) || (aligned === alignedBest && distance < score)) { best = node; score = distance; alignedBest = aligned; }
    }
    if (!best) return false; best.focus(); var box = best.getBoundingClientRect(); if (box.top < 20 || box.bottom > window.innerHeight - 20) best.scrollIntoView(box.top < 20); return true;
  }
}