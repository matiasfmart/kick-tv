import { FavoritesService } from '../../application/services';
import { ChannelGridService, StreamHealthService } from '../../application/grid';
import { KeyValueStore, ServiceConfiguration, ServiceModule } from '../../domain/contracts';
import { PlayerController } from '../../presentation/player';
import { IptvOrgPlaylistSource } from './playlist-source';
import { CatalogXhrTransport } from './transport';
import { IptvView } from './view';

interface Dependencies { favorites: FavoritesService; grid: ChannelGridService; health: StreamHealthService; presenter: PlayerController; navigate(route: string): void; icons: { [name: string]: string }; storage: KeyValueStore; }
export function createModule(dependencies: Dependencies, configuration: ServiceConfiguration): ServiceModule {
  var browser = window as unknown as { HUB_CONFIG?: { iptvPlaylistUrl?: string; iptvBlocklistUrl?: string } };
  var playlistURL = browser.HUB_CONFIG && browser.HUB_CONFIG.iptvPlaylistUrl || dependencies.storage.get('stream-hub-iptv-url') || configuration.playlistUrl || 'https://iptv-org.github.io/iptv/countries/ar.m3u';
  var blocklistURL = browser.HUB_CONFIG && browser.HUB_CONFIG.iptvBlocklistUrl || configuration.blocklistUrl || 'https://iptv-org.github.io/api/blocklist.json';
  var source = new IptvOrgPlaylistSource(new CatalogXhrTransport(), playlistURL, blocklistURL, configuration.id, configuration.hiddenChannels || []);
  var view = new IptvView(source, dependencies.favorites, dependencies.grid, dependencies.health, dependencies.presenter, dependencies.navigate, dependencies.icons, dependencies.storage);
  return { id: configuration.id, name: 'IPTV Argentina', icon: configuration.icon || 'tv', source, view, capabilities: source.getCapabilities(), routes: [{ id: 'browse', title: 'Argentina', section: 'browse' }, { id: 'favorites', title: 'Mi grilla', section: 'favorites' }, { id: 'search', title: 'Buscar', section: 'search' }] };
}