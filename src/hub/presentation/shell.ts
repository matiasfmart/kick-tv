import { FavoritesService, HistoryService, ServiceRegistry } from '../application/services';
import { LiveStream, MediaRef } from '../domain/contracts';

export class HubShell {
  private route = 'home';
  private activeService: string | null = null;
  private lastContent = '';
  private lastNav = 'hub-nav-home';
  private readonly nav: HTMLElement;
  private readonly home: HTMLElement;
  private readonly globalFavorites: HTMLElement;
  constructor(private readonly registry: ServiceRegistry, private readonly favorites: FavoritesService, private readonly history: HistoryService, private readonly icons: { [name: string]: string }) {
    this.nav = document.getElementById('hub-nav') as HTMLElement;
    this.home = document.getElementById('hub-home') as HTMLElement;
    this.globalFavorites = document.createElement('section'); this.globalFavorites.id = 'hub-global-favorites'; this.globalFavorites.hidden = true;
    this.globalFavorites.innerHTML = '<div class="section-heading"><div><h1>Favoritos</h1><p class="hub-muted">Canales guardados de todos los servicios</p></div></div><div id="hub-global-favorites-list" class="hub-row"></div>';
    (document.getElementById('service-content') as HTMLElement).appendChild(this.globalFavorites);
    this.addNav('home', 'Inicio', 'house');
    var modules = registry.list();
    for (var index = 0; index < modules.length; index++) { this.addNav('source:' + modules[index].id, modules[index].name, modules[index].icon); }
    this.addNav('favorites', 'Favoritos', 'star');
    this.addNav('settings', 'Ajustes', 'settings');
    var self = this;
    document.addEventListener('keydown', function (event) { self.onKey(event); }, true);
    this.nav.addEventListener('focusin', function () { self.expand(true); });
    this.nav.addEventListener('focusout', function () {
      window.setTimeout(function () { if (!self.nav.contains(document.activeElement)) { self.expand(false); } }, 0);
    });
  }
  private iconButton(label: string, name: string): HTMLButtonElement {
    var button = document.createElement('button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    var image = document.createElement('span'); image.setAttribute('data-icon', name); image.innerHTML = this.icons[name] || ''; button.appendChild(image);
    var text = document.createElement('span'); text.className = 'hub-nav-label'; text.textContent = label; button.appendChild(text);
    return button;
  }
  private addNav(route: string, label: string, icon: string): void {
    var self = this;
    var button = this.iconButton(label, icon); button.id = 'hub-nav-' + route.replace(':', '-'); button.setAttribute('data-route', route);
    button.onclick = function () { self.navigate(route); };
    this.nav.appendChild(button);
  }
  private expand(expanded: boolean): void {
    (document.getElementById('hub-sidebar') as HTMLElement).className = 'hub-sidebar' + (expanded ? ' expanded' : '');
    (document.getElementById('hub-sidebar') as HTMLElement).setAttribute('aria-expanded', String(expanded));
  }
  private focus(node: HTMLElement | null): void {
    if (!node || !node.getBoundingClientRect().height) { return; }
    node.focus();
    var rect = node.getBoundingClientRect();
    if (rect.top < 16 || rect.bottom > window.innerHeight - 16) { node.scrollIntoView(rect.top < 16); }
  }
  navigate(route: string): void {
    var modules = this.registry.list();
    for (var index = 0; index < modules.length; index++) { modules[index].view.deactivate(); }
    this.activeService = null;
    this.route = route;
    this.home.hidden = route !== 'home';
    this.globalFavorites.hidden = route !== 'favorites';
    (document.getElementById('kick-tabs') as HTMLElement).hidden = true;
    var navButtons = this.nav.querySelectorAll('button');
    for (var navIndex = 0; navIndex < navButtons.length; navIndex++) {
      var selected = navButtons[navIndex].getAttribute('data-route') === route;
      navButtons[navIndex].className = selected ? 'selected' : '';
      if (selected) { navButtons[navIndex].setAttribute('aria-current', 'page'); this.lastNav = navButtons[navIndex].id; }
      else { navButtons[navIndex].removeAttribute('aria-current'); }
    }
    if (route === 'home') { this.renderHome(); this.enterContent(); return; }
    if (route === 'favorites') { this.renderRefs('hub-global-favorites-list', this.favorites.list(), 'global-favorite'); this.enterContent(); return; }
    var selectedId = route.indexOf('source:') === 0 ? route.slice(7) : route.indexOf('search:') === 0 ? route.slice(7) : '';
    var module = selectedId ? this.registry.get(selectedId) : route === 'settings' ? modules[0] : null;
    if (!module) { this.navigate('home'); return; }
    this.activeService = module.id;
    (document.getElementById('kick-tabs') as HTMLElement).hidden = module.id !== 'kick';
    var routeId = route.indexOf('search:') === 0 ? 'search' : route === 'settings' ? 'settings' : 'browse';
    var contribution = module.routes.filter(function (entry) { return entry.id === routeId; })[0] || module.routes[0];
    module.view.activate(contribution ? contribution.section : 'browse');
    this.expand(false);
  }
  renderHome(): void {
    if (this.route !== 'home') { return; }
    var active = document.activeElement && document.activeElement.id;
    var self = this;
    var services = document.getElementById('hub-services') as HTMLElement; services.textContent = '';
    this.registry.list().forEach(function (module) {
      var button = self.iconButton(module.name, module.icon); button.id = 'hub-service-' + module.id; button.className = 'hub-service';
      button.onclick = function () { self.navigate('source:' + module.id); }; services.appendChild(button);
    });
    this.renderRefs('hub-favorites', this.favorites.list(), 'favorite');
    this.renderRefs('hub-recents', this.history.list().map(function (entry) { return entry.ref; }), 'recent');
    if (active && active.indexOf('hub-') === 0) { this.focus(document.getElementById(active)); }
  }
  private renderRefs(id: string, refs: MediaRef[], prefix: string): void {
    var root = document.getElementById(id) as HTMLElement; root.textContent = '';
    var self = this;
    refs.slice(0, 8).forEach(function (ref, index) {
      var module = self.registry.get(ref.sourceId);
      if (!module) { return; }
      var view = module.view;
      var item = view.describe(ref);
      var button = document.createElement('button'); button.type = 'button'; button.id = 'hub-' + prefix + '-' + index; button.className = 'hub-media';
      if (item && /^https:\/\//i.test(item.artwork)) {
        var image = document.createElement('img'); image.src = item.artwork; image.alt = ''; image.onerror = function () { image.hidden = true; }; button.appendChild(image);
      }
      var name = document.createElement('strong'); name.textContent = item ? item.name : self.favorites.name(ref) || ref.itemId; button.appendChild(name);
      var service = document.createElement('span'); service.textContent = module.name + (item instanceof LiveStream && item.live ? ' / EN VIVO' : ''); button.appendChild(service);
      button.onclick = function () { self.navigate('source:' + ref.sourceId); view.openItem(ref); };
      root.appendChild(button);
    });
    if (!root.children.length) { var empty = document.createElement('p'); empty.className = 'hub-muted'; empty.textContent = prefix.indexOf('favorite') === 0 ? 'Sin favoritos' : 'Sin reproducciones recientes'; root.appendChild(empty); }
  }
  private enterContent(): void {
    this.expand(false);
    var root = this.route === 'home' ? this.home : this.route === 'favorites' ? this.globalFavorites : document.getElementById('service-content') as HTMLElement;
    var previous = document.getElementById(this.lastContent);
    var first = root.querySelector('button, input') as HTMLElement | null;
    this.focus(previous && root.contains(previous) ? previous : first || document.getElementById('hub-nav-home'));
  }
  isServiceActive(id: string): boolean { return this.activeService === id; }
  isHome(): boolean { return this.route === 'home'; }
  focusRoot(): HTMLElement { return this.route === 'home' ? this.home : document.getElementById('service-content') as HTMLElement; }
  private onKey(event: KeyboardEvent): void {
    var player = document.getElementById('player') as HTMLElement;
    var modal = document.getElementById('modal') as HTMLElement;
    if (!player.hidden || !modal.hidden) { return; }
    var active = document.activeElement as HTMLElement;
    if (active.tagName === 'INPUT' && !(active as HTMLInputElement).readOnly) { return; }
    var code = event.keyCode;
    var inNav = this.nav.contains(active);
    if (inNav) {
      var buttons = this.nav.querySelectorAll('button'); var position = 0;
      for (var index = 0; index < buttons.length; index++) { if (buttons[index] === active) { position = index; } }
      if (code === 38 || code === 40) { this.focus(buttons[Math.max(0, Math.min(buttons.length - 1, position + (code === 38 ? -1 : 1)))] as HTMLElement); }
      else if (code === 39 || code === 27 || code === 10009) { this.enterContent(); }
      else if (code === 13) { active.click(); }
      else { return; }
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (code === 37) {
      var root = this.focusRoot(); var origin = active.getBoundingClientRect();
      var nodes = root.querySelectorAll('button, input'); var hasLeft = false;
      for (var candidate = 0; candidate < nodes.length; candidate++) {
        var rect = nodes[candidate].getBoundingClientRect();
        if (rect.width && rect.height && rect.left + rect.width / 2 < origin.left + origin.width / 2 - 2 && Math.min(rect.bottom, origin.bottom) > Math.max(rect.top, origin.top)) { hasLeft = true; break; }
      }
      if (!hasLeft) { this.lastContent = active.id; this.focus(document.getElementById(this.lastNav)); event.preventDefault(); event.stopImmediatePropagation(); return; }
    }
    if (this.route === 'home') {
      if (code === 13) { active.click(); }
      else if (code === 27 || code === 10009 || code === 8) { return; }
      else if (code >= 37 && code <= 40) {
        var choices = this.home.querySelectorAll('button'); var best: HTMLElement | null = null; var score = Infinity; var current = active.getBoundingClientRect();
        for (var choice = 0; choice < choices.length; choice++) {
          if (choices[choice] === active) { continue; }
          var box = choices[choice].getBoundingClientRect(); if (!box.width || !box.height) { continue; }
          var deltaX = box.left + box.width / 2 - current.left - current.width / 2;
          var deltaY = box.top + box.height / 2 - current.top - current.height / 2;
          var primary = code === 37 ? -deltaX : code === 39 ? deltaX : code === 38 ? -deltaY : deltaY;
          var distance = primary + Math.abs(code === 37 || code === 39 ? deltaY : deltaX) * 3;
          if (primary > 2 && distance < score) { best = choices[choice]; score = distance; }
        }
        this.focus(best);
      } else { return; }
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }
}