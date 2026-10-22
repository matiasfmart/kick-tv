import { CancelHandle, Complete, HttpClient, LiveStream, MediaPage, MediaRef, PlaybackRequest, SourceCapabilities, StreamCandidate, VideoSource } from '../../domain/contracts';

export interface KickChannel {
  slug: string; name: string; title: string; avatar: string; live: boolean; category: string; viewers: number; qualities: StreamCandidate[];
}

export class KickSource extends VideoSource {
  constructor(private readonly http: HttpClient, private readonly id: string = 'kick') { super(); }
  getCapabilities(): SourceCapabilities { return { live: true, vod: false, search: true, qualities: true, epg: false }; }
  private item(value: unknown): LiveStream {
    var data = value as KickChannel;
    if (!data || typeof data.slug !== 'string' || !/^[a-z0-9_-]{1,50}$/i.test(data.slug) || typeof data.live !== 'boolean') { throw new Error('Respuesta de Kick invalida.'); }
    return new LiveStream({ sourceId: this.id, itemId: data.slug }, data.name || data.slug, data.title || '', data.avatar || '', data.live, data.category || '', Number(data.viewers) || 0);
  }
  browse(done: Complete<MediaPage>): CancelHandle {
    done({ ok: false, error: { code: 'BROWSE_UNAVAILABLE', message: 'Kick ofrece favoritos y busqueda en esta version.' } });
    return { cancel: function () {} };
  }
  search(query: string, done: Complete<MediaPage>): CancelHandle {
    var self = this;
    return this.http.get('/search?q=' + encodeURIComponent(query), function (result) {
      if (!result.ok) { done(result); return; }
      try {
        var data = result.value as { channels?: unknown[] };
        if (!data || !Array.isArray(data.channels)) { throw new Error('Busqueda invalida.'); }
        done({ ok: true, value: { items: data.channels.map(function (channel) { return self.item(channel); }) } });
      } catch (error) { done({ ok: false, error: { code: 'KICK_SCHEMA', message: 'Kick devolvio resultados de busqueda invalidos.' } }); }
    });
  }
  status(slug: string, done: Complete<LiveStream>): CancelHandle {
    var self = this;
    return this.http.get('/channels/' + encodeURIComponent(slug) + '/status', function (result) {
      if (!result.ok) { done(result); return; }
      try { done({ ok: true, value: self.item(result.value) }); }
      catch (error) { done({ ok: false, error: { code: 'KICK_SCHEMA', message: 'Kick devolvio un estado de canal invalido.' } }); }
    });
  }
  resolvePlayback(ref: MediaRef, done: Complete<PlaybackRequest>): CancelHandle {
    if (ref.sourceId !== this.id || !/^[a-z0-9_-]{1,50}$/i.test(ref.itemId)) {
      done({ ok: false, error: { code: 'INVALID_ITEM', message: 'Canal no valido para esta fuente.' } }); return { cancel: function () {} };
    }
    var self = this;
    return this.http.get('/channels/' + encodeURIComponent(ref.itemId), function (result) {
      if (!result.ok) { done(result); return; }
      try {
        var data = result.value as KickChannel;
        var item = self.item(data);
        if (!Array.isArray(data.qualities)) { throw new Error('Calidades invalidas.'); }
        var candidates = data.qualities.filter(function (quality) { return quality && typeof quality.id === 'string' && typeof quality.url === 'string' && /^https:\/\//i.test(quality.url); });
        done({ ok: true, value: { item: item, candidates: candidates } });
      } catch (error) { done({ ok: false, error: { code: 'KICK_SCHEMA', message: 'Kick devolvio datos de reproduccion invalidos.' } }); }
    });
  }
}

export function legacyChannel(item: LiveStream, candidates: StreamCandidate[] = []): KickChannel {
  return { slug: item.ref.itemId, name: item.name, title: item.title, avatar: item.artwork, live: item.live, category: item.category, viewers: item.viewers, qualities: candidates };
}