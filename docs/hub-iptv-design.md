# Hub de streaming: diseno e investigacion IPTV

Estado: propuesta de fase 1, pendiente de aprobacion. Rama: `feature/catalogo-online`.
Fecha de medicion: 2026-10-21, hora de Argentina.
Este documento no implementa el hub ni cambia Kick, TizenBrew, Vercel o GitHub Pages.

## 1. Decisiones propuestas

- Hub vanilla TypeScript orientado a objetos, compilado a ES5, sin framework de UI.
- Dominio, aplicacion, presentacion e infraestructura separados por contratos.
- Registro JSON de servicios y factories conocidas al compilar, no ejecucion de JavaScript remoto.
- Un unico reproductor activo, inicialmente Html5Player, que conserva el camino ya probado con Kick.
- Generador Node separado de la TV, reutilizando el parser HLS existente.
- Catalogo IPTV estatico, particionado y versionado, publicado en GitHub Pages.
- Primera entrega limitada a canales IPTV con country=AR; otros paises quedan para una ampliacion configurable.
- Verificacion diaria en GitHub Actions, ejecucion manual en Mac y futura ejecucion en una Raspberry Pi.
- Fallos observados en la TV guardados localmente por stream, con vencimiento y politica configurable.
- Ninguna garantia de legalidad o disponibilidad basada solamente en aparecer en iptv-org.
- Ninguna afirmacion de "verificado desde Argentina" para resultados de runners de GitHub.

### Alcance inicial: Argentina

El usuario acoto la primera entrega a contenido de Argentina. El filtro inicial
es country=AR en la metadata de canales, no "todo lo emitido en espanol" ni
"cualquier stream accesible desde Argentina". Kick conserva su alcance actual.

El generador descarga las fuentes mundiales porque estos endpoints no ofrecen
el subconjunto argentino como JSON independiente. Filtra los canales, feeds,
streams y logos antes de verificar streams, construir indices y publicar.
La TV solo descarga el resultado argentino: no procesa el catalogo mundial.
El idioma es un filtro de exploracion, no motivo para descartar un canal argentino.

Medicion adicional del mismo dia: 498 canales AR en metadata; 481 pasan filtros
basicos de blocklist, NSFW, categoria xxx y fecha de cierre; 180 tienen streams
asociados, con 238 URLs candidatas. De estas URLs, 16 declaran headers especiales
y 5 llevan etiqueta Geo-blocked. No se probaron esas URLs y estas cifras no
certifican derechos, funcionamiento ni compatibilidad de reproduccion.

Primero se revisan procedencia, transporte y reproduccion de ese subconjunto.
No se generan particiones ni indices de otros paises en esta entrega. La seleccion
de paises sera configuracion del generador, de modo que ampliarla no requiera
cambiar el shell, los contratos ni el reproductor. La arquitectura global sigue vigente.

## 2. Base actual y refactor

`src/tv.js` contiene HTTP, localStorage, favoritos, busqueda, foco, control remoto,
render de tarjetas y reproduccion en una unica IIFE orientada a Kick. No hay
generador, catalogo IPTV, registro de servicios ni historial de reproduccion.
`scripts/kick.cjs` ya separa busqueda, estado y resolucion HLS en el servidor.
`api/index.mjs` lo expone en Vercel y el servidor de desarrollo usa el mismo handler.

Reutilizar comportamiento, no copiar el monolito para cada servicio:

| Comportamiento actual | Destino propuesto |
| --- | --- |
| spatial(), focus(), scopes de modal | SpatialFocusManager y FocusScope |
| keydown, teclas de colores y CH | RemoteInput y acciones normalizadas |
| HTML5 video, promesa opcional de play(), watchdog | Html5Player y PlaybackService |
| cancelacion de XHR y secuencias de reproduccion | HttpClient y PlaybackSession |
| overlay y selector de calidad | PlayerOverlay compartido |
| favoritos y sus claves existentes | FavoritesService con migracion versionada |
| endpoints y DTO de Kick | KickSource y KickApiClient |
| tarjetas, teclado y vistas de Kick | pantallas del KickServiceModule |

El refactor se hace incrementalmente. Se conserva la entrada publicada actual
hasta que Hub + Kick pase las regresiones. No renombrar las claves antiguas sin
migrarlas ni borrar favoritos. Revisar tambien la salida del modulo: history.back()
no garantiza volver a TizenBrew cuando window.tizen no esta expuesto.

## 3. Verificaciones: API iptv-org

Se descargaron y parsearon los nueve JSON, sin sondear sus streams.
Todos respondieron HTTP 200 y `Access-Control-Allow-Origin: *`.
Los tamanos son bytes de JSON descomprimido, no consumo de heap ni trafico comprimido.

| Archivo | Filas | Bytes | Campos principales comprobados |
| --- | ---: | ---: | --- |
| channels.json | 31.645 | 7.950.475 | id, name, alt_names, country, categories, is_nsfw, closed, replaced_by, website |
| feeds.json | 45.254 | 8.092.931 | channel, id, name, is_main, broadcast_area, timezones, languages, format |
| streams.json | 18.173 | 3.775.179 | channel, feed, title, url, quality, labels, user_agent, referrer |
| logos.json | 35.413 | 5.751.952 | channel, feed, in_use, tags, width, height, format, url |
| categories.json | 30 | 2.773 | id, name, description |
| languages.json | 7.893 | 269.003 | code, name |
| countries.json | 250 | 18.955 | code, name, languages, flag |
| blocklist.json | 864 | 89.208 | channel, reason, ref |
| guides.json | 180.681 | 25.618.682 | channel, feed, site, site_id, site_name, lang, sources |

Total sin EPG: 25.950.476 bytes, 24,75 MiB. Con guides: 49,18 MiB.
No se descargan estos archivos completos en la TV. guides queda fuera del generador
normal de esta etapa: se midio para confirmar su contrato y volumen, no para implementar EPG.

Hallazgos que afectan el modelo:

- La base de canales no equivale a una lista de canales con stream disponible.
- feed.id no es globalmente unico: 2.410 valores se repiten. Join por (channel, feed.id).
- 1.943 streams no tienen channel: excluir del catalogo normal mientras no haya asociacion revisada.
- 1.024 streams declaran referrer o user_agent; 1.217 tienen Geo-blocked y 1.806 Not 24/7.
- 17.481 URLs terminan en .m3u8. La extension sola no valida HLS ni compatibilidad.
- Hay 14.240 URLs HTTPS y 3.920 HTTP, ademas de 13 con otros protocolos.
- blocklist contiene 496 registros dmca y 368 nsfw.
- Hay 1.450 canales con closed y 624 con replaced_by. Interpretar fechas, no solo presencia.
- Idiomas de feeds usan ISO 639-3: spa para espanol, no es. El pais usa ISO 3166-1 alpha-2: AR.
- Logos incluyen PNG, JPEG, SVG, WebP y AVIF; no se asume soporte universal en Tizen 3.0.
- Country.flag es un emoji: para la TV se prefieren assets de bandera empaquetados y codigo AR como respaldo.

La metadata de iptv-org se actualiza durante el dia. Estas cifras son una fotografia,
no constantes del programa ni cantidad de canales reproducibles o autorizados.

## 4. Limites de legalidad, verificacion y transporte

La blocklist es obligatoria, pero no es una certificacion de derechos. El propio
proyecto publica enlaces aportados por usuarios, publicos segun su mejor conocimiento.
No es correcto prometer "todos los canales legitimos del mundo" por filtrar esa lista.

Politica propuesta: excluir blocklist, NSFW, categoria xxx, streams sin canal asociado,
paywalls, DRM/licencias, credenciales embebidas y fuentes no suficientemente identificadas.
Dar preferencia a URLs y fuentes oficiales con procedencia documentada. Una fuente
ambigua queda en revision, no se publica como autorizada. Los overrides no pueden
saltarse blocklist o NSFW ni convertir una senal paga en contenido permitido.

Resolver replaced_by con deteccion de ciclos, destino existente y reaplicacion de
filtros. No atribuir automaticamente al reemplazo la URL vieja: debe tener su propio
stream asociado. Excluir canales cerrados a la fecha de generacion.

### Headers y reproductor

| Camino | Evidencia y decision |
| --- | --- |
| Html5Player | Ya se comprobo HLS real en la TV. HTMLMediaElement no expone una API de headers arbitrarios para sus peticiones. No puede prometer Referer/User-Agent custom. |
| AVPlay | Samsung documenta USER_AGENT y COOKIE. No se encontro una propiedad publica documentada para Referer arbitrario. Ademas, webapis.avplay no estuvo disponible en nuestro contexto real de TizenBrew. |
| XHR o fetch previo | Descargar el manifest con headers no cambia las peticiones posteriores del reproductor nativo. No resuelve el problema. |
| Proxy de medios | Puede agregar headers, pero debe tratar playlists, segmentos y otros recursos referenciados. No basta proxificar el master. Requiere alojamiento, seguridad, limites y ancho de banda propios. |

Decision inicial: reproducir directo lo compatible sin headers especiales. Conservar
en el catalogo los requisitos de los demas streams y marcarlos "requiere adaptador",
no "verificado compatible". Evaluar AvPlayPlayer solamente si un probe confirma su
disponibilidad y propiedades en esta TV. No fingir soporte por tener la clase creada.

Si se desea reproducir tambien los canales que realmente exigen headers, se necesita
aprobar un proxy de medios aparte. El plan gratuito de Vercel ya usado para metadata
no se propone como retransmisor de video permanente. Un proxy en casa requeriria
un equipo encendido; uno externo no comprueba disponibilidad desde Argentina y no
se usara para eludir restricciones territoriales o de acceso.

Las URLs HTTP requieren prueba desde el contexto TizenBrew: una pagina HTTPS puede
bloquear contenido mixto. No transformar HTTP en HTTPS sin verificar el servidor.
URLs firmadas efimeras requieren resolver en runtime o excluirlas del catalogo estatico inicial.

### Significado de verificado

Separar estado de catalogo, salud y compatibilidad:

- manifest-ok: se descargo y parseo HLS valido con headers requeridos.
- segment-ok: se pudo leer un fragmento acotado de una variante elegida, cuando corresponda.
- device-supported / requires-adapter / unknown: compatibilidad estimada, no decodificacion comprobada.
- playback-ok: la TV confirmo avance real de reproduccion; registro local.

Guardar checkedAt, checkEnvironmentId, tipo de prueba y version del verificador.
Un runner de GitHub se identifica como github-hosted, sin inventar su pais.
Un verificador local se configura como home-ar. Geo-blocked y broadcast_area
son informacion, no pruebas de acceso desde una IP concreta.

El criterio de aceptacion se separa en "verificado HTTP/HLS desde GitHub" y
"reproducido desde mi TV". Solo lo verificado desde un equipo de la casa puede
llevar la primera afirmacion desde Argentina. Ningun estado garantiza disponibilidad futura.

## 5. Arquitectura propuesta

```text
src/hub/
  domain/          MediaItem, LiveChannel, LiveStream, Video, MediaRef,
                   PlaybackRequest, StreamCandidate, Category, VideoSource,
                   Player, SourceCapabilities, Verification, FailureRecord
  application/     PlaybackService, FavoritesService, HistoryService,
                   GlobalSearchService, ZappingService, StreamHealthService,
                   ports de storage, catalogo, reloj y transporte
  presentation/    shell, sidebar, router, input remoto, foco, teclado,
                   virtualizacion, overlays, pantallas transversales
  infrastructure/  XhrHttpClient, LocalStorageStore, CatalogRepository,
                   Html5Player, AvPlayPlayer opcional, TizenApplicationLauncher futuro
  services/
    kick/           module.ts, KickSource, KickApiClient, pantallas
    iptv/           module.ts, IptvSource, pantallas, CatalogQuery
  bootstrap/        composition-root.ts, registro generado de factories
  config/           services.json
tools/catalog/      CLI Node, ingesta, politica, verificador, estado,
                    normalizacion, ranking, particionado y publicacion
catalog/            configuracion, overrides y evidencias de procedencia
tests/              unitarios, fixtures, contratos y recorridos de control
```

Dependencias hacia adentro: presentacion usa aplicacion y contratos; aplicacion
depende del dominio y puertos; infraestructura implementa esos puertos. El dominio
no importa DOM, localStorage, Tizen, Kick, iptv-org ni Node.
Los modulos de servicio son puntos de ensamblado, no dependencias del nucleo.

TypeScript aporta interfaces, clases abstractas y comprobacion de contratos sin
framework runtime. Usar strict, target ES5 y lib ES5 + DOM. target no agrega
polyfills. Mantener cancelacion y callbacks explicitos al principio para no asumir
Promise, async/await, Map, Set, Proxy, fetch o APIs DOM modernas en la TV.
El generador Node puede usar APIs modernas y configuracion de compilacion distinta.
El bundle final conserva el chequeo Acorn ES5 existente; flags y clases no sustituyen esa validacion.

### Contratos de referencia, no implementacion

```ts
interface MediaRef {
  sourceId: string;
  itemId: string;
}

interface CancelHandle { cancel(): void; }
type Result<T> = { ok: true; value: T } | { ok: false; error: SourceError };
type Complete<T> = (result: Result<T>) => void;

abstract class VideoSource {
  abstract browse(query: BrowseQuery, done: Complete<MediaPage>): CancelHandle;
  abstract search(query: SearchQuery, done: Complete<MediaPage>): CancelHandle;
  abstract resolvePlayback(item: MediaRef, done: Complete<PlaybackRequest>): CancelHandle;
  abstract getCapabilities(): SourceCapabilities;
}

interface Player {
  getCapabilities(): PlayerCapabilities;
  open(request: PlaybackRequest, events: PlaybackEvents): CancelHandle;
  play(): void;
  pause(): void;
  stop(): void;
  dispose(): void;
}

interface ServiceModule {
  id: string;
  name: string;
  icon: string;
  capabilities: SourceCapabilities;
  source: VideoSource;
  routes: RouteContribution[];
  dispose(): void;
}
```

MediaItem es una base abstracta de metadata; LiveChannel, LiveStream y Video
expresan sus diferencias. MediaRef identifica favoritos sin persistir URLs firmadas.
PlaybackRequest contiene candidatos ordenados, headers requeridos, vigencia,
tipo live/VOD/audio y referencia EPG opcional; PlayerCapabilities decide cuales
pueden ejecutarse. No usar un bool "headers" para prometer cualquier cabecera:
declarar explicitamente nombres soportados y requisitos por candidato.

SourceCapabilities incluye live, vod, audio, search (local/remote/none), EPG,
qualities, browse, launcher y requisitos de transporte. El modulo devuelve sus
rutas; el shell solo monta RouteContribution, sin switch por id de servicio.
Una fuente sin busqueda no participa en GlobalSearchService.
Un launcher futuro no se envia al reproductor: necesita un puerto ApplicationLauncher
y una capacidad habilitada solo si las APIs de Tizen estan realmente disponibles.

### Registro y factory

El JSON contiene id, tipo conocido, enabled, orden y opciones. El build descubre
`services/*/module.ts` y genera una tabla de factories tipadas. Al agregar un
servicio se crea su modulo y entrada JSON, y se recompila. No editar el shell,
los casos de uso ni un switch central para cada servicio nuevo.
El composition root inyecta HttpClient, storage, reloj y configuracion por
constructor. Sin contenedor DI ni service locator global. Servicios deshabilitados
no cargan sus catalogos. Modulos desconocidos generan error controlado.

### Transversales

- FavoritesService guarda MediaRef y metadata minima. Migra favoritos Kick a sourceId=kick de forma idempotente.
- HistoryService registra exitos reales y recientes acotados; no persiste URLs firmadas.
- GlobalSearchService combina busqueda local IPTV y remota Kick, cancela consultas viejas y pagina resultados.
- ZappingService opera sobre una lista de MediaRef; en Mi grilla usa numeros explicitos, unicos y reordenables.
- PlaybackService resuelve la fuente, elige candidato compatible, maneja fallback y mantiene una sola sesion.
- StreamHealthService aplica fallos locales con vencimiento, separado de favoritos y salud global del catalogo.

## 6. Shell y experiencia TV

Sidebar izquierda colapsada a iconos, ampliada al recibir foco. Orden: Inicio,
servicios habilitados en el registro, Busqueda global, Favoritos, Ajustes.
Conservar el ancho reservado de contenido para evitar saltos de grilla al expandir.
Izquierda desde el borde del contenido entra al sidebar; derecha regresa al ultimo
item. Los controles de transporte interceptan las flechas solo en el contexto del video.

Reutilizar el foco por rectangulos y alineacion ya corregido. Introducir scopes
explicitos para sidebar, contenido, modal y reproductor, con prioridad exclusiva.
No crear listas manuales de ids que olviden botones nuevos. Las listas virtuales
guardan itemId e indice logico, no la referencia a un nodo reciclado.

Inicio agrega favoritos, recientes y canales disponibles, sin inventar la
programacion actual de IPTV: EPG no se implementa en esta fase.
Kick conserva sus grillas; IPTV usa filtros combinables por pais, categoria e idioma.
En la primera entrega IPTV solo se muestra Argentina. Se conservan categorias
e idiomas para filtrar ese subconjunto; el selector de paises solo se habilita
cuando una configuracion futura publique mas de un pais.
Categorias y nombres de paises se traducen en la ingesta; conservar ids estables.

Mi grilla guarda numero, MediaRef y orden. CH+/CH- y arriba/abajo cambian de canal;
0-9 acumulan numero con timer de aproximadamente 2 segundos y maximo de digitos.
Registrar las teclas numericas en el manifiesto TizenBrew; comprobar los eventos
fisicos. Canal anterior cambia solo despues de una sintonia exitosa. El fallback
del mismo canal no modifica ese historial. El banner muestra numero, logo, nombre,
pais y categoria, y se oculta sin bloquear el control.

Back cierra primero modal, luego reproductor, luego pantalla interna; en Inicio
confirma salida. No prometer cerrar TizenBrew sin API nativa: detectar capacidades,
probar retorno al launcher y mostrar una alternativa si no existe.

## 7. Generador del catalogo

Elegir Node sobre .NET en esta etapa: ya existe toolchain, parser HLS y tests en
el repo; evita otro runtime de build y facilita Mac, Actions y Linux ARM. La
eleccion no obliga a compartir codigo DOM con el generador ni impide otro verificador futuro.

Pipeline: descargar metadata y blocklist, validar esquema, resolver identidades,
filtrar al alcance AR, aplicar politica, normalizar, verificar incrementalmente, ordenar candidatos,
particionar, validar artefactos, generar reporte y publicar snapshot.
Si no se puede cargar la blocklist o su esquema cambia, no publicar un catalogo nuevo.
Se conserva el ultimo snapshot valido y se informa antiguedad; no se ignoran filtros.

Overrides propios para ocultar, renombrar, clasificar y habilitar un canal en
revision una vez documentada su procedencia. Forzar inclusion no evita blocklist,
NSFW, requisitos de transporte ni el estado de no verificado.

### Verificacion incremental

- Identidad de stream: hash de URL y headers normalizados, sin guardar secretos en ids o logs.
- Estado: ultimo intento, ultimo exito, latencia, fallo, proximo intento, entorno y version de comprobacion.
- Tres colas con cuotas para nuevo, fallo reintentable y mas antiguo, evitando inanicion de alguna cola.
- Concurrencia inicial propuesta 8, limite por host 2, timeouts y presupuesto de peticiones/bytes configurables.
- GET acotado, validacion HLS con m3u8-parser y fragmento limitado cuando corresponde. No grabar senales completas.
- Hasta dos reintentos transitorios con backoff y jitter; no bombardear un 403 ni saltarse geobloqueos.
- Presupuesto temporal del job y salida ordenada con checkpoint; la primera pasada puede necesitar varias ejecuciones.
- Persistencia atomica local, manejo de SIGINT y reanudacion por hashes y version de politica/verificador.
- En Actions, checkpoint duradero en rama catalog-state, separado de main y de los artefactos publicos.
- Artifacts/cache pueden acelerar descargas, pero no son la unica copia del estado incremental.
- Si un job se cancela abruptamente, se recupera el ultimo checkpoint subido; no se promete retomar cada request en curso.

Un verificador Node no puede certificar el decoder de la TV. Separar HLS valido
de audio/video reproducible; evaluar CODECS y contenedores declarados y marcar
como desconocido lo que no se pudo determinar. No excluir 4K solo por resolucion,
ni marcarlo compatible sin prueba del perfil y bitrate reales.

Seleccion: primero politica y compatibilidad de transporte, luego salud vigente,
entorno de comprobacion, calidad compatible, feed principal y ausencia de Not 24/7.
Conservar alternativas de feeds, sin confundir diferentes emisiones regionales.
Feed elegido y su idioma/region se muestran o quedan seleccionables.

### Publicacion y actualizacion, sin depender de la Mac

Propuesta: GitHub Actions diario, horario fuera del inicio de la hora, mas
workflow_dispatch y CLI manual con lanzador .command. GitHub Pages publica JSON,
indices y logos compatibles; los streams siguen en los servidores de sus titulares.
No usar jsDelivr como catalogo mutable diario ni hacer push a main por cada chequeo.

GitHub documenta publicacion via configure-pages, upload-pages-artifact y
deploy-pages, con pages:write e id-token:write en el job de publicacion. El job
que guarda checkpoints necesita contents:write solo para el estado autorizado.
No ejecutar el publicador con secretos o permisos de escritura para PRs no confiables.
Fijar actions a revisiones verificadas y limitar concurrencia de publicacion.

schedule funciona en la rama por defecto y puede retrasarse; en repos publicos se
deshabilita tras 60 dias sin actividad. Durante esta feature no se modifica main
ni se activa produccion. El workflow se habilita al aprobar su integracion.
Runners estandar de repos publicos pueden no tener coste de minutos, pero hay
limites de ejecucion y almacenamiento; no se promete servicio gratuito ilimitado.
Pages tiene limite publicado de 1 GB y ancho de banda blando de 100 GB/mes.

Snapshot generado en directorio temporal; validar referencias y tamanos antes de
desplegar el artefacto completo. Manifest apunta a una version coherente. No
mezclar indices de una version con particiones de otra: hash/version por archivo,
invalidacion y recarga controlada; conservar ultimo snapshot publicado si la ingesta falla.
No publicar checkpoints, IP de la casa, logs de verificacion o credenciales en Pages.

### Particionado y presupuestos iniciales

- manifest.json: version, generatedAt, procedencia, entornos, conteos, diccionarios y referencias a particiones.
- countries/AR/*.json: paginas pequenas; category/ y language/ son indices de ids o referencias, sin duplicar todos los streams.
- channels/:shard.json: detalles y fallbacks bajo demanda, para no cargar URLs de todos los canales en memoria.
- search/:shard.json: ids, nombres y alias normalizados, sin headers o URLs de reproduccion.
- report.json: conteos por motivo, cobertura verificada/no verificada y antiguedad; no equiparar metadata candidata con canales funcionales.
- Logos preferentemente PNG/JPEG pequenos, con procedencia y uso autorizado; fallback local. No depender de AVIF o emojis de bandera.

Objetivos iniciales, pendientes de medir con el catalogo resultante: manifest
menor a 128 KiB, pagina menor a 256 KiB y busqueda compacta menor a 2 MiB sin
comprimir. Si no entra, aumentar shards y cargar progresivamente. Presupuesto
del DOM: alrededor de 24-48 tarjetas recicladas y dos paginas de overscan/cache.
Busqueda local en lotes con yield y debounce, no un bloqueo sincronico de miles
de elementos. En la primera entrega cargar solo las particiones AR y su indice; no llenar localStorage
con el catalogo. Cache LRU en memoria y carga de logos por visibilidad gestionada
por el virtualizador, sin requerir IntersectionObserver nativo.

## 8. Fallos locales y fallback

Por candidato guardar streamId, failedAt, failureCount, retryAfter y razon.
Propuesta inicial de cooldown progresivo: 30 minutos, 2 horas y hasta 24 horas,
configurable. Exito confirmado limpia la penalizacion; expiracion permite otra prueba.
No confundir un error MediaError generico con geobloqueo demostrado.

Por canal: intentar candidatos compatibles sin repetir, con cancelacion inmediata
al cambiar de canal. Propuesta: hasta tres intentos automaticos por sintonia,
con mensaje de progreso y reintento manual para los demas. Si todos fallan,
marcar temporalmente el canal como fallido. No borrar favoritos ni numeros.

Politicas de la TV: despriorizar por defecto, ocultar temporalmente como opcion,
mostrar todo o restablecer fallos. Reportar canal caido puede marcarlo al instante,
pero no envia datos a un servidor en esta etapa. Una caida general de Internet no
debe ocultar toda la grilla. Pausa, Back, cambio de canal, apagado y cancelacion
no se registran como streams fallidos.

El exito de la TV se comprueba con avance de tiempo/video, no con que play()
se haya llamado. Watchdog distingue arranque y rebuffering; reintentos no crean
un segundo reproductor. HistoryService y canal anterior se actualizan al confirmar exito.

## 9. Seguridad y limites operativos

- Verificador admite HTTP/HTTPS publicos. Rechaza file, localhost, redes privadas,
  link-local, credenciales embebidas y destinos internos tras cada redireccion y resolucion DNS.
- Limitar redirecciones, tamano de metadata, profundidad HLS, segmentos y bytes descargados.
- Tratar catalogo, logos y overrides como datos; renderizar texto sin inyectar HTML remoto.
- Configurar CSP/CORS segun origen y verificar HTTPS/TLS en la TV, no solo en Chrome moderno.
- Nunca crear un proxy abierto con un parametro url arbitrario: usar ids de candidatos aprobados.
- No superar limitaciones de derechos, region, autenticacion o DRM para hacer funcionar un canal.
- Separar estado local de usuario del catalogo publico y versionar migraciones de almacenamiento.

## 10. Plan y puertas de validacion

1. Aprobar este diseno y resolver el alcance de canales con headers/proxy.
2. Introducir TS, contratos, composition root y shell; extraer Kick como modulo.
   Regresiones: busqueda por control, favoritos, calidad, cancelacion, Back y playback.
   Pedir prueba fisica de Kick antes de sumar IPTV al camino principal.
3. Generador con fixtures: filtro AR antes de sondeos e indices, blocklist fail-closed, joins compuestos, reemplazos,
   ranking, headers, timeouts, checkpoint, estado por entorno y limites de particiones.
   Primera prueba real acotada de canales oficiales; no verificar miles sin presupuesto.
4. Pages y Actions, con autorizacion separada para publicar y configurar permisos.
   Confirmar CORS, integridad y actualizacion sin Mac; mostrar estado/antiguedad del catalogo.
5. IptvSource para Argentina, virtualizacion, filtros, busqueda, Mi grilla, numeros, anteriores y fallback.
   Prueba fisica AR: codigo numerico, CH, timers, error/alternativas, audio, memoria y reanudacion.
6. Inicio y transversales; migracion de favoritos Kick y historial, mas documentacion de nuevo servicio.

Antes de cada fase de TV: pruebas de contratos y comportamiento, typecheck,
bundle ES5 con Acorn y recorridos de teclado en Chrome. El tipo de hardware y
sus APIs no se certifican con Playwright moderno. No arrancar un servidor para
este documento ni cambiar la Host IP 127.0.0.1.

## 11. Fuentes verificadas

- [Contrato de la API iptv-org](https://github.com/iptv-org/api)
- [Legal de iptv-org](https://github.com/iptv-org/iptv#legal)
- [FAQ: base de canales no equivale a streams disponibles](https://github.com/iptv-org/iptv/blob/master/FAQ.md)
- [Samsung AVPlay y propiedades de streaming](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement)
- [Referer y restricciones del navegador](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer)
- [TypeScript target](https://www.typescriptlang.org/tsconfig/target.html)
- [TypeScript lib](https://www.typescriptlang.org/tsconfig/lib.html)
- [Publicar Pages desde Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Limites de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Eventos y limitaciones de schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Limites de Actions](https://docs.github.com/en/actions/reference/limits)