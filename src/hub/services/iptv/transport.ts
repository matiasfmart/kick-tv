import { CancelHandle, Complete } from '../../domain/contracts';
import { CatalogTransport } from './source';

export class CatalogXhrTransport implements CatalogTransport {
  read(url: string, maxBytes: number, done: Complete<string>): CancelHandle {
    var xhr = new XMLHttpRequest(); var canceled = false;
    function fail(message: string): void { if (!canceled) done({ ok: false, error: { code: 'CATALOG_NETWORK', message: message } }); }
    xhr.onprogress = function (event) { if (event.loaded > maxBytes || (event.lengthComputable && event.total > maxBytes)) { fail('La particion supera el limite de memoria.'); canceled = true; xhr.abort(); } };
    xhr.onload = function () {
      if (canceled) return;
      if (xhr.status < 200 || xhr.status >= 300) { fail('Catalogo no disponible (HTTP ' + xhr.status + '). Generar o actualizar el catalogo.'); return; }
      if (unescape(encodeURIComponent(xhr.responseText)).length > maxBytes) { fail('La particion supera el limite de memoria.'); return; }
      done({ ok: true, value: xhr.responseText });
    };
    xhr.onerror = function () { fail('Sin acceso al catalogo. Verificar su URL, CORS y conexion.'); };
    xhr.ontimeout = function () { fail('El catalogo no respondio. Reintentar.'); };
    try { xhr.open('GET', url, true); xhr.timeout = 15000; xhr.send(); }
    catch (error) { fail('No se pudo iniciar la descarga del catalogo.'); }
    return { cancel: function () { canceled = true; xhr.abort(); } };
  }
}