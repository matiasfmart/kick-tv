import { FavoritesService, HistoryService, PlaybackService, ServiceRegistry, ZappingService } from '../application/services';
import { HttpClient, LiveStream, ServiceConfiguration, ServiceModule } from '../domain/contracts';
import { Html5Player, LocalStorageStore, XhrHttpClient } from '../infrastructure/browser';
import { HubShell } from '../presentation/shell';
import { PlayerController } from '../presentation/player';
import { ChannelGridService, StreamHealthService } from '../application/grid';
import { KickController, KickServiceView } from '../services/kick/view';
import { KickSource, legacyChannel } from '../services/kick/source';

interface Dependencies { http: HttpClient; favorites: FavoritesService; grid: ChannelGridService; health: StreamHealthService; presenter: PlayerController; navigate(route: string): void; icons: { [name: string]: string }; storage: LocalStorageStore; }
type Factory = (dependencies: Dependencies, configuration: ServiceConfiguration) => ServiceModule;

export function startHub(configuration: ServiceConfiguration[], factories: { [type: string]: Factory }): void {
  var browser = window as unknown as { StreamHub: unknown; KickTVIcons: { [name: string]: string }; KICK_TV_CONFIG?: { apiBaseUrl?: string } };
  var storage = new LocalStorageStore();
  var http = new XhrHttpClient(browser.KICK_TV_CONFIG && browser.KICK_TV_CONFIG.apiBaseUrl || storage.get('kick-tv-api-base') || 'https://kick-tv-phi.vercel.app/api');
  var registry = new ServiceRegistry();
  var clock = { now: function () { return Date.now(); } };
  var favorites = new FavoritesService(storage);
  var history = new HistoryService(storage, clock);
  var playback = new PlaybackService(registry, new Html5Player(document.getElementById('player-video') as HTMLVideoElement), history);
  var grid = new ChannelGridService(storage); var health = new StreamHealthService(storage, clock);
  var presenter = new PlayerController(playback, registry, favorites, new ZappingService(), grid, health, storage, browser.KickTVIcons);
  var shell: HubShell;
  configuration.filter(function (entry) { return entry.enabled; }).sort(function (first, second) { return first.order - second.order; }).forEach(function (entry) {
    if (!factories[entry.type]) { throw new Error('Tipo de servicio desconocido: ' + entry.type); }
    registry.register(factories[entry.type]({ http, favorites, grid, health, presenter, storage, icons: browser.KickTVIcons, navigate: function (route) { shell.navigate(route); } }, entry));
  });
  shell = new HubShell(registry, favorites, history, browser.KickTVIcons);
  var kickModule = registry.get('kick');
  var source = kickModule ? kickModule.source as KickSource : null;
  var kickView = kickModule ? kickModule.view as KickServiceView : null;
  browser.StreamHub = {
    favorites: favorites, playback: playback, zapping: new ZappingService(),
    openMedia: function (ref: { sourceId: string; itemId: string }, onClosed?: () => void) { presenter.open(ref, onClosed); },
    bindKickUI: function (controller: KickController) { if (kickView) { kickView.bind(controller); } },
    start: function () { shell.navigate('home'); },
    navigateLegacy: function (section: string) { shell.navigate(section === 'search' ? 'search:kick' : section === 'settings' ? 'settings' : 'source:kick'); },
    backFromSection: function () { shell.navigate('home'); },
    isHome: function () { return shell.isHome(); },
    isKickViewActive: function () { return shell.isServiceActive('kick'); },
    focusRoot: function () { return shell.focusRoot(); },
    refreshHome: function () { shell.renderHome(); },
    setBaseURL: function (value: string) { http.setBaseURL(value); },
    status: function (slug: string, done: (error: unknown, channel?: unknown) => void) {
      if (!source) { done({ code: 'SOURCE_DISABLED', message: 'Kick esta deshabilitado.' }); return { abort: function () {} }; }
      var handle = source.status(slug, function (result) { if (result.ok) { done(null, legacyChannel(result.value)); } else { done(result.error); } });
      return { abort: function () { handle.cancel(); } };
    },
    search: function (query: string, done: (error: unknown, data?: unknown) => void) {
      if (!source) { done({ code: 'SOURCE_DISABLED', message: 'Kick esta deshabilitado.' }); return { abort: function () {} }; }
      var handle = source.search(query, function (result) {
        if (result.ok) { done(null, { channels: result.value.items.map(function (item) { return legacyChannel(item as LiveStream); }) }); }
        else { done(result.error); }
      });
      return { abort: function () { handle.cancel(); } };
    },
    resolve: function (slug: string, done: (error: unknown, channel?: unknown) => void) {
      var handle = playback.resolve({ sourceId: 'kick', itemId: slug }, function (result) {
        if (result.ok) { done(null, legacyChannel(result.value.item as LiveStream, result.value.candidates)); }
        else { done(result.error); }
      });
      return { abort: function () { handle.cancel(); } };
    }
  };
}