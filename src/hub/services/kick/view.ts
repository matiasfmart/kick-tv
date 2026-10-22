import { LiveStream, MediaItem, MediaRef, ServiceView } from '../../domain/contracts';
import { KickChannel } from './source';

export interface KickController {
  activate(section: string): void;
  watch(slug: string): void;
  describe(slug: string): KickChannel | null;
}

export class KickServiceView implements ServiceView {
  private controller: KickController | null = null;
  bind(controller: KickController): void { this.controller = controller; }
  activate(section: string): void {
    (document.getElementById('kick-content') as HTMLElement).hidden = false;
    if (this.controller) { this.controller.activate(section); }
  }
  deactivate(): void { (document.getElementById('kick-content') as HTMLElement).hidden = true; }
  openItem(ref: MediaRef): void { if (this.controller) { this.controller.watch(ref.itemId); } }
  describe(ref: MediaRef): MediaItem | null {
    var data = this.controller && this.controller.describe(ref.itemId);
    return data ? new LiveStream(ref, data.name || data.slug, data.title || '', data.avatar || '', data.live, data.category || '', data.viewers || 0) : null;
  }
}