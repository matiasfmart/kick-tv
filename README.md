# Kick TV para TizenBrew

Cliente personal de Kick para Samsung UN50MU6100 (2017), Tizen 3.0 y TizenBrew
2.0.5. Interfaz vanilla JavaScript compilada a ES5. Sin WebAssembly, login ni chat.

## Rama del hub: IPTV local

La entrada actual de `feature/catalogo-online` muestra `HUB-02 / IPTV LOCAL`.
Kick e IPTV Argentina aparecen como modulos del mismo shell y usan un solo
elemento video y PlayerController. La version publicada V1-02 no se modifica
con estos cambios locales. La prueba fisica de este refactor sigue pendiente.

IPTV consulta directamente `countries/ar.m3u` y `blocklist.json` de iptv-org por
XHR. La prueba en Chrome obtuvo CORS 200 y la app cargó 180 canales tras aplicar
blocklist, filtros de URL, opciones VLC incompatibles y exclusiones conocidas.
Todos quedan marcados con procedencia no revisada y se prueban al seleccionarlos;
la disponibilidad real de Tizen aún debe verificarse en la Samsung.

Para probar en Chrome: mantener abierto `Iniciar.command`, abrir
http://localhost:5173 y elegir IPTV Argentina. `Catalogo.command` ya no hace falta
para que la vista cargue. La TV consultará iptv-org directamente al ejecutar el
módulo; el CORS de Tizen y la reproducción de streams siguen pendientes de prueba.

IPTV incluye categorias, busqueda por teclado en pantalla, una ventana
de 12 tarjetas, Mi grilla con numeros 1-999, CH+/CH-, numero con espera de dos
segundos y canal anterior con Azul. La estrella agrega/quita de Mi grilla y el
boton numerico permite reasignar. Los duplicados se rechazan; ordenar numeros
ordena Mi grilla. Los digitos tambien estan declarados en el manifiesto TizenBrew,
pero sus eventos reales deben comprobarse al publicar/probar el modulo.

Los fallos locales tienen cooldown, politica de despriorizar/ocultar/mostrar y
restablecimiento. El fallback intenta hasta tres URLs del mismo canal antes de
mostrar error; no cambia de emision regional automaticamente. No se declara un
geobloqueo a partir de un error generico del reproductor. Si ocultar dejara toda
la grilla vacia, se conservan los canales para reintentar.

El engranaje de IPTV configura la URL M3U y recarga la app. Usa la clave
`stream-hub-iptv-url`; también admite `HUB_CONFIG.iptvPlaylistUrl` o `playlistUrl`
en el registro. La blocklist se toma de iptv-org; las URLs se verifican en el
reproductor de cada dispositivo y los resultados pueden variar por red/región.

### Generador IPTV: fase 3 local

El usuario decidio posponer la prueba fisica de la fase 2 y avanzar con el
generador de Argentina. Esa prueba sigue pendiente; no es una validacion de la TV.
El generador, CLI de doble clic y workflow manual estan preparados en esta rama,
sin activacion de GitHub Pages ni publicacion. Ver [catalog/README.md](catalog/README.md)
para auditoria, procedencia, verificacion incremental, checkpoints y salida.

La app ya no depende del catálogo generado. `Catalogo.command` sigue disponible
para auditar o generar un snapshot estático alternativo; ese flujo encontró 180
canales AR y 238 URLs candidatas y conserva sus filtros y revisión de procedencia.

La fase 2 introdujo el shell que ahora se extiende en `HUB-02`.
Esta iteracion no se publico ni modifica la version V1-02 de produccion descrita
mas abajo. Abrir http://localhost:5173 despues de ejecutar `Iniciar.command`.

Incluye shell con Inicio, sidebar colapsable, Kick e IPTV como ServiceModule,
favoritos migrados, recientes y un transporte de video compartido. El registro
`src/hub/config/services.json` decide que servicios aparecen. IPTV esta limitado
a Argentina y muestra errores controlados si el catalogo todavia no se genero.

Estructura implementada:

- `src/hub/domain/contracts.ts`: entidades, referencias, fuentes, Player y contratos.
- `src/hub/application/services.ts`: registro, favoritos, historial, reproduccion y zapping.
- `src/hub/infrastructure/browser.ts`: HTTP XHR, localStorage y Html5Player.
- `src/hub/presentation/shell.ts`: sidebar, rutas comunes, Inicio y sus scopes de foco.
- `src/hub/services/kick/`: fuente, modulo y adaptador de vista de Kick.
- `src/hub/services/iptv/`: repositorio, integridad, fuente y vista de IPTV.
- `src/hub/application/grid.ts`: numeros de canal y salud local.
- `src/hub/presentation/player.ts`: presentacion comun y fallback de reproduccion.
- `src/hub/bootstrap/root.ts`: composition root y puente con la UI anterior.

El nucleo usa TypeScript strict con lib ES5 + DOM. El build descubre
`src/hub/services/*/module.ts`, genera las imports de factories en memoria,
ensambla el hub, transpila a ES5 y valida la gramatica con Acorn. No se carga
JavaScript de plugins desde URLs remotas. `npm test` verifica ambos bundles y
tests de datos, navegacion, nucleo y catalogo. `npx tsc -p tsconfig.hub.json` permite
ejecutar solo el typecheck.

La presentacion de Kick conserva por ahora `src/tv.js` como adaptador de migracion.
Delega HTTP y resolucion en KickSource, favoritos en FavoritesService, transporte
de video y controles en PlayerController/PlaybackService/Html5Player.
No es una conversion completa de todas las pantallas a TypeScript. Inicio y
Favoritos del menu agregan referencias de todas las fuentes e indican el servicio.
La busqueda permanece dentro de cada app para evitar mezclar resultados. Mi grilla
de IPTV esta dentro de su propia seccion.

Los favoritos nuevos usan `stream-hub-favorites-v1` con sourceId/itemId; la clave
antigua `kick-tv-favorites` se conserva y sincroniza para Kick. La migracion no
guarda URLs de video ni borra calidad o proxy. Los recientes solo se registran
cuando el video confirma avance y se limitan a 20 elementos. El origen de la
pagina sigue determinando el almacenamiento; la version local no comparte sus
favoritos con el origen del modulo publicado.

Control de la fase 2: izquierda desde el borde del contenido entra al sidebar;
arriba/abajo recorre sus items; OK abre una seccion y derecha regresa al contenido.
Back cierra modal o video, vuelve de una seccion a Inicio y alli confirma salida.
Conservar las teclas y preferencias de Kick. La edicion del proxy mantiene sus
flechas nativas, sin que el sidebar robe el foco.

Para agregar un servicio: crear su `VideoSource`, `ServiceView` y exportar
`createModule(dependencies, configuration)` desde `services/<tipo>/module.ts`.
Debe devolver ServiceModule con id, nombre, icono, capacidades y rutas. La vista
monta su contenido en `service-content` y describe/abre sus MediaRef. Agregar
la entrada JSON con id estable, type igual al directorio, enabled, order e icon
(nombre de Lucide), y recompilar. El sidebar toma el modulo y sus rutas sin
editar el shell. El build incluye los iconos declarados por los modulos habilitados.

Pendiente de prueba fisica en la TV: sidebar/foco, Kick real con calidad y
CH+/CH-, persistencia de la migracion y memoria de este bundle. Playwright
moderno y Acorn ES5 no certifican rendimiento ni APIs de la TV. No habilitar
el generador de Actions o desplegar esta rama sin una autorizacion posterior.

Estado: `V1-02` preparada para el proxy de Vercel; pendiente de verificar el
despliegue completo y la reproduccion en la TV con la Mac apagada.
La TV ya reprodujo el HLS de referencia y Kick en vivo con imagen y sonido en
720p; tambien confirmo seleccion 1080p60 y video 1920x1080. Esto no certifica
otros codecs o resoluciones. No hay un tope 1080p impuesto al selector.

## Funciones

- Favoritos en localStorage, con avatar, estado, titulo y espectadores cuando estan disponibles.
- Canales en vivo primero; actualizacion cada 90 segundos, con dos consultas simultaneas como maximo.
- Busqueda de canales con teclado en pantalla o teclado fisico en Chrome.
- Video HTML5 a pantalla completa, overlay temporal y cambio entre favoritos en vivo.
- Todas las variantes del master HLS y Auto; calidad preferida persistida.
- Mensajes de offline, red/TLS, timeout, posible bloqueo de Cloudflare y errores del reproductor.

Una consulta fallida se muestra como "Sin datos", no como offline. Los favoritos
empiezan vacios y se agregan con el boton de estrella de cada resultado.

## Mac: desarrollo opcional

Abrir `Iniciar.command` con doble clic. Mantener esa terminal abierta mientras se prueba.
Abrir http://localhost:5173 en Chrome. Flechas mueven el foco, Enter activa la accion
y Escape o Back vuelven a la vista anterior. En favoritos se pide confirmar salida.

Despues de editar el codigo fuente, ejecutar `npm run build` y recargar la pagina.
El servidor envia `Cache-Control: no-store`. Detenerlo con Control+C.

## Build

`npm install` y `npm test` generan `app/tv.bundle.js` y `app/bundle.js`, verifican
su sintaxis con Acorn en modo ES5 y ejecutan tests del adaptador de Kick y del foco espacial.
Babel no agrega polyfills automaticamente; el runtime usa
DOM clasico y APIs ES5. Las herramientas de build requieren Node 18 o superior
en la Mac, no en la TV.

Los bundles generados deben incluirse en GitHub: TizenBrew no ejecuta el build.
El paquete es privado para evitar una publicacion accidental en npm. Esto no
impide usar un repositorio publico de GitHub mediante TizenBrew.

## Instalar y actualizar en la TV

El repositorio publico es `matiasfmart/kick-tv`. La version publicada inicialmente
contenia el diagnostico; el manifiesto actual abre la interfaz principal.

1. Mantener la TV conectada a Internet; no hace falta iniciar el servidor local para V1-02.
2. Abrir TizenBrew y usar el boton verde para entrar a Module Manager.
3. Elegir GitHub e ingresar `matiasfmart/kick-tv`, sin URL ni prefijo `gh/`.
4. Cerrar la edicion del campo para que pierda el foco: TizenBrew 2.0.5 agrega
	el modulo en `onBlur`, no con un boton Submit.
5. Abrir el modulo desde TizenBrew, sin elegir "Abrir version local".
6. Comprobar que aparece `V1-02` y que Ajustes muestra `https://kick-tv-phi.vercel.app/api`.

El manifiesto de v1 usa `packageType: app`, `appName: Kick TV` y
`appPath: app/tv.html`. `main` no es la entrada de un modulo app y no se necesita
`serviceFile`: el proxy se ejecuta en Node.js en Vercel, no como servicio Node antiguo de la TV.
No hace falta reinstalar TizenBrew ni cambiar la Host IP: mantener `127.0.0.1`.

TizenBrew 2.0.5 usa jsDelivr, por lo que el repositorio debe ser publico y los
cambios publicados pueden tardar en aparecer por cache del CDN. Si hace falta
fijar una revision, jsDelivr admite el identificador GitHub `matiasfmart/kick-tv@COMMIT`.
Para desarrollar, la accion "Abrir version local" navega a
http://192.168.0.220:5173/app/index.html. La Mac debe estar encendida, en la misma
red y permitir conexiones entrantes a Node. Desde alli, "Abrir Kick TV" navega a
`/app/tv.html`. Esta ruta es solo para iterar. La interfaz V1-02 consulta el proxy
publico por defecto, incluso cuando se sirve localmente. Se puede elegir la API
local en Ajustes. Los segmentos se descargan directamente del CDN de Kick.

Flujo rapido: editar, ejecutar `npm run build` y recargar la pagina en la TV.
Los cambios en el servidor requieren reiniciarlo. No es necesario publicar cada
iteracion en GitHub. Para una nueva instalacion desde GitHub, publicar el build
primero; npm tambien es soportado por TizenBrew, pero no se usa en este proyecto.

No se puede detectar de forma fiable un fallo de navegacion a la Mac desde la
pagina que se abandona. Si aparece un error de conexion, volver a abrir TizenBrew
y el modulo. Los datos de localStorage pertenecen a cada origen y no se comparten
entre la version de jsDelivr/loopback y la version de la Mac.

## Controles

| Control | Accion |
| --- | --- |
| Flechas y OK | Foco espacial y activar |
| Back | Cerrar selector, volver del video o confirmar salida en favoritos |
| CH+ / CH- | Siguiente/anterior favorito en vivo |
| Arriba / abajo en video | Alternativa a CH+ / CH- |
| Izquierda / derecha en video | Recorrer controles del overlay |
| OK con overlay oculto | Mostrar controles |
| Play / Pause / PlayPause | Control de reproduccion |
| Rojo | Agregar/quitar favorito del canal enfocado o reproduciendose |
| Verde en biblioteca | Buscar |
| Amarillo | Calidad en video, ajustes en biblioteca |
| Azul en biblioteca | Actualizar favoritos |

TizenBrew registra las teclas del manifiesto antes de abrir la pagina. Como
`window.tizen` no aparece en el contexto observado, CH+ / CH- y colores deben
comprobarse fisicamente en esta interfaz. Flechas arriba/abajo no requieren ese
registro. El overlay se oculta a los cinco segundos de reproduccion; Back y los
controles de canal siguen funcionando aunque este oculto.

La estrella agrega o quita favoritos. El engranaje del reproductor lista todas
las calidades; elegir una tambien actualiza la preferencia guardada. Cambiar
calidad reinicia el pipeline de video y puede producir una pausa breve. Auto
deja adaptar el master al motor nativo. Una calidad predeterminada no disponible
usa la mejor variante de menor altura, o Auto si no se encontro ninguna.

## Diagnostico

En Ajustes, "Diagnostico" abre la pantalla anterior y conserva las pruebas
independientes. Los datos que muestra incluyen:

- Plataforma y version del User-Agent.
- Disponibilidad de AVPlay antes y despues de abrir la version local.
- Resultado de carga de `$WEBAPIS/webapis/webapis.js`.
- Teclas especiales registradas y codigos recibidos al presionarlas.
- Lectura/escritura de localStorage.

`canPlayType` es solamente un indicio de soporte HLS, no una prueba de reproduccion.
"Probar HLS 720p" abre una variante H.264/AAC del stream de referencia de
[Mux](https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8) con el elemento video,
sin hls.js ni AVPlay. Back vuelve al diagnostico y libera el recurso de video.
El contador, resolucion, timeout y MediaError permiten distinguir carga de avance
real. Se debe confirmar imagen, audio y avance del contador en la TV.
El acceso HTTP al manifiesto se comprobo desde la Mac; eso no confirma TLS ni
decodificacion en Tizen 3.0. No se asume HLS nativo por `canPlayType` solamente.

En la TV probada, tanto el origen local de la Mac como `127.0.0.1:8081` mostraron
`window.tizen` ausente. Esto no convierte la TV en un navegador de escritorio:
la deteccion de dispositivo por User-Agent y la disponibilidad de APIs son
comprobaciones distintas. La carga de webapis.js tambien se intenta en una TV
identificada por User-Agent, aunque no exponga `window.tizen`.

La pantalla de diagnostico conserva la salida simulada si la API no esta
expuesta. En v1, la confirmacion de salida usa la API application cuando existe;
si no, vuelve con el historial del navegador. Si no hay historial se informa
usar Home del control. No se puede garantizar cerrar TizenBrew desde un
documento que no exponga las APIs nativas.

## Pruebas aisladas anteriores

Mantener la Mac encendida y el servidor abierto. Volver del video con Back,
elegir "Recargar" y comprobar la etiqueta `KICK-01`. "Kick 720p" y "Kick 1080p"
consultan el canal `xqc` de prueba, eligen la variante mas alta que no exceda la
resolucion solicitada y abren el video con HTML5. Si no hay variantes con altura,
usan el master en Auto. El nombre de la calidad elegida aparece en el reproductor.
Los botones son pruebas de resolucion, no el selector final ni un tope 1080p.

La Mac consulta Kick y parsea el master con `m3u8-parser` mediante
`GET /api/channels/{slug}`. El endpoint devuelve datos normalizados y variantes.
No retransmite segmentos: la TV descarga el video directamente del CDN de Kick.
Cada apertura o reintento resuelve nuevamente las URLs con token; no se guardan
en localStorage ni se imprimen en logs. Back cancela consultas pendientes y
libera el video.

La URL base del adaptador es `http://192.168.0.220:5173/api`. Se puede reemplazar
sin tocar el reproductor definiendo `window.KICK_TV_CONFIG` antes del bundle:

```js
window.KICK_TV_CONFIG = {
	apiBaseUrl: 'http://192.168.0.220:5173/api',
	channel: 'xqc'
};
```

Tambien se puede guardar la base en la clave `kick-tv-api-base` de localStorage.
Un Worker u otro proxy debe ofrecer el mismo contrato JSON para ser intercambiable.
El proxy local incluye CORS para datos publicos y solo consulta Kick y hosts HTTPS
de `*.live-video.net`; no admite URLs arbitrarias ni endpoints de escritura.
No publicar este servidor en Internet ni abrir el puerto en el router.

Errores de canal offline, red/TLS, rate limit y posible bloqueo de Cloudflare se
muestran en pantalla. Un proxy no garantiza evitar bloqueos de Kick. Si Kick cambia
de CDN, esta prueba rechaza el nuevo host hasta verificarlo y actualizar la lista.
La ausencia de API Tizen impide confirmar el registro de nuevas teclas dentro de
la pagina: CH+/CH- todavia requieren prueba fisica en v1.

## Proxy y almacenamiento de v1

En Ajustes se cambia la base del proxy sin modificar el reproductor. La base por
defecto de V1-02 es `https://kick-tv-phi.vercel.app/api`. Si se habia guardado
manualmente la URL de la Mac, actualizarla en Ajustes: el valor guardado tiene
prioridad sobre el predeterminado. La calidad y los favoritos se guardan en el origen actual, no en Kick.
No borrar los datos del navegador ni cambiar de origen si se quieren conservar.

El contrato HTTP del proxy es:

- `GET /api/search?q=nombre`: `{ channels: [...] }`, hasta 24 resultados.
- `GET /api/channels/{slug}/status`: estado normalizado sin descargar HLS.
- `GET /api/channels/{slug}`: estado y `qualities` con URLs vigentes.
- `GET /api/health`: identificacion del servicio desplegado.

Los canales incluyen `slug`, `name`, `avatar`, `live`, `title`, `category` y
`viewers`. Las variantes incluyen `id`, `label`, `height`, `fps`, `bandwidth`
y `url`. La API compartida en `api/index.mjs` usa el mismo adaptador tanto en
Vercel como en el servidor local. Las respuestas llevan no-store para no cachear
URLs firmadas. No se garantiza que Kick siga aceptando consultas desde un proveedor.

## Prueba de alojamiento sin la Mac

El Worker `kick-tv-proxy.martinez-matiashc.workers.dev` se publico correctamente,
pero Kick respondio HTTP 403 desde ese alojamiento. No se cambio la app para
depender de ese Worker.

La prueba alternativa `https://kick-tv-phi.vercel.app/api/probe` respondio
`ok: true`, `upstreamStatus: 200` y URL de reproduccion presente. Se ejecuto en
Node.js en Vercel reutilizando `worker/probe.mjs`. La API completa se agrego
despues en `api/index.mjs` y todavia requiere verificar sus endpoints publicados.

1. Importar `matiasfmart/kick-tv` en Vercel con el plan Hobby para uso personal.
2. Usar la raiz del repositorio como Root Directory y framework Other.
3. La configuracion de `vercel.json` define `npm run build`, salida `app`, prueba
	de 20 segundos y API completa de 40 segundos. Las rutas se reescriben al handler compartido.
4. Una vez desplegado, consultar `https://NOMBRE.vercel.app/api/probe`.
5. Comprobar tambien `/api/health`, `/api/search?q=xqc` y las variantes de
	`/api/channels/xqc`. La raiz del sitio abre `tv.html` en Vercel.

La prueba no devuelve tokens ni URLs firmadas. Solo consulta un canal fijo y
admite GET/OPTIONS. No se necesitan credenciales de Kick ni variables secretas.
Usar la URL de produccion del proyecto, no una URL privada de preview. Si aparece
una pantalla de autenticacion de Vercel, primero comprobar la proteccion del
despliegue: ese error no demuestra un bloqueo de Kick.

La configuracion predeterminada de V1-02 ya no apunta a la Mac. Para certificar
que es independiente, cerrar TizenBrew, apagar la Mac, volver a abrir el modulo
desde TizenBrew y probar busqueda, favoritos, calidad y video. Tambien falta
confirmar CH+/CH- y persistencia en ese origen; arriba/abajo es la alternativa.

## Troubleshooting

- Sin conexion al proxy: comprobar Internet, disponibilidad del servicio y URL
	guardada en Ajustes. Si se eligio el servidor local para desarrollar, comprobar la Mac.
- Pantalla vieja: comprobar `V1-02`. jsDelivr puede conservar el modulo publicado
	en cache; usar la revision concreta del commit al agregar el modulo si es necesario.
- Offline: el canal no emite; elegir otro o reintentar mas tarde.
- Cloudflare/403: el servidor tambien puede ser bloqueado; probar otra ubicacion
	del proxy. No se ejecutan desafios JS ni se garantiza eludirlos.
- Error de video: reintentar para renovar las URLs, o elegir una calidad menor.
	Tener panel 4K no garantiza decodificar cualquier codec, bitrate o fps.
- CH sin respuesta: usar arriba/abajo en el reproductor y registrar el problema
	en Diagnostico antes de cambiar el manifiesto o reinstalar TizenBrew.
- Sin persistencia: la app avisa si localStorage falla. Cambiar entre el origen
	local y el del modulo publicado crea almacenamientos separados.

No se han incluido login, chat, VOD, clips ni multivista. No exponer el servidor
de desarrollo de la Mac en Internet. Vercel aloja solo la interfaz y metadatos,
no el transporte de los segmentos de video.

## Fuentes verificadas

- [Contrato de modulos v2.0.5](https://github.com/reisxd/TizenBrew/blob/v2.0.5/docs/MODULES.md)
- [Cargador de modulos](https://github.com/reisxd/TizenBrew/blob/v2.0.5/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js)
- [AVPlay](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [Control remoto](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
- [Motor web](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)