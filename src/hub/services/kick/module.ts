import { HttpClient, ServiceConfiguration, ServiceModule } from '../../domain/contracts';
import { KickSource } from './source';
import { KickServiceView } from './view';

export interface KickModuleDependencies { http: HttpClient; }
export function createModule(dependencies: KickModuleDependencies, configuration: ServiceConfiguration): ServiceModule {
  var source = new KickSource(dependencies.http, configuration.id);
  return {
    id: configuration.id, name: 'Kick', icon: configuration.icon || 'kick', capabilities: source.getCapabilities(), source: source, view: new KickServiceView(),
    routes: [{ id: 'browse', title: 'Mis canales', section: 'favorites' }, { id: 'search', title: 'Buscar', section: 'search' }, { id: 'settings', title: 'Ajustes', section: 'settings' }]
  };
}