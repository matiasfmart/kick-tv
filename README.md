# Kick TV para TizenBrew

Cliente personal de Kick para Samsung UN50MU6100 (2017), Tizen 3.0 y TizenBrew
2.0.5. Interfaz vanilla JavaScript compilada a ES5. Sin WebAssembly, login ni chat.

Estado: v1 local (`V1-01`), pendiente de validar sus recorridos completos en la TV.
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

## Mac

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
contiene el diagnostico; los cambios de v1 requieren un commit/push posterior.

1. Iniciar el servidor en la Mac.
2. Abrir TizenBrew y usar el boton verde para entrar a Module Manager.
3. Elegir GitHub e ingresar `matiasfmart/kick-tv`, sin URL ni prefijo `gh/`.
4. Cerrar la edicion del campo para que pierda el foco: TizenBrew 2.0.5 agrega
	el modulo en `onBlur`, no con un boton Submit.
5. Abrir el modulo. Si aparece el diagnostico publicado, elegir "Abrir version local".
6. En el diagnostico local actualizado, elegir "Abrir Kick TV". Debe aparecer `V1-01`.

El manifiesto de v1 usa `packageType: app`, `appName: Kick TV` y
`appPath: app/tv.html`. `main` no es la entrada de un modulo app y no se necesita
`serviceFile`: el proxy se ejecuta en la Mac, no como servicio Node antiguo de la TV.
No hace falta reinstalar TizenBrew ni cambiar la Host IP: mantener `127.0.0.1`.

TizenBrew 2.0.5 usa jsDelivr, por lo que el repositorio debe ser publico y los
cambios publicados pueden tardar en aparecer por cache del CDN.
Para iterar, la accion "Abrir version local" navega a
http://192.168.0.220:5173/app/index.html. La Mac debe estar encendida, en la misma
red y permitir conexiones entrantes a Node. Desde alli, "Abrir Kick TV" navega a
`/app/tv.html`. La app necesita el proxy de la Mac para datos y calidades; los
segmentos de video se descargan directamente del CDN de Kick.

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
defecto es `http://192.168.0.220:5173/api`; si cambia la IP de la Mac, actualizarla
alli. La calidad y los favoritos se guardan en el origen actual, no en Kick.
No borrar los datos del navegador ni cambiar de origen si se quieren conservar.

El contrato HTTP del proxy es:

- `GET /api/search?q=nombre`: `{ channels: [...] }`, hasta 24 resultados.
- `GET /api/channels/{slug}/status`: estado normalizado sin descargar HLS.
- `GET /api/channels/{slug}`: estado y `qualities` con URLs vigentes.

Los canales incluyen `slug`, `name`, `avatar`, `live`, `title`, `category` y
`viewers`. Las variantes incluyen `id`, `label`, `height`, `fps`, `bandwidth`
y `url`. Un Worker puede sustituir a la Mac si implementa este contrato con CORS;
todavia no se incluye un despliegue Worker ni se garantiza que evite Cloudflare.

## Prueba de alojamiento sin la Mac

El Worker `kick-tv-proxy.martinez-matiashc.workers.dev` se publico correctamente,
pero Kick respondio HTTP 403 desde ese alojamiento. No se cambio la app para
depender de ese Worker.

La prueba alternativa esta en `api/probe.mjs` y se ejecuta en Node.js en Vercel.
Reutiliza el diagnostico de `worker/probe.mjs`; no es todavia el proxy completo.

1. Importar `matiasfmart/kick-tv` en Vercel con el plan Hobby para uso personal.
2. Usar la raiz del repositorio como Root Directory y framework Other.
3. La configuracion de `vercel.json` define `npm run build`, salida `app` y una
	funcion de prueba con duracion maxima de 20 segundos.
4. Una vez desplegado, consultar `https://NOMBRE.vercel.app/api/probe`.
5. Comprobar el JSON `ok` y `upstreamStatus` antes de adaptar o configurar el
	proxy definitivo. Otra IP tampoco garantiza que Kick acepte la consulta.

La prueba no devuelve tokens ni URLs firmadas. Solo consulta un canal fijo y
admite GET/OPTIONS. No se necesitan credenciales de Kick ni variables secretas.
Usar la URL de produccion del proyecto, no una URL privada de preview. Si aparece
una pantalla de autenticacion de Vercel, primero comprobar la proteccion del
despliegue: ese error no demuestra un bloqueo de Kick.

Hasta validar el proxy completo y la reproduccion en la TV con la Mac apagada,
la configuracion de la app sigue usando el servidor local. Publicar el codigo
no elimina por si solo esa dependencia.

## Troubleshooting

- Sin conexion al proxy: comprobar que `Iniciar.command` sigue abierto, misma red,
	IP correcta y permiso de conexiones entrantes para Node en macOS.
- Pantalla vieja: comprobar `V1-01`, recargar desde el servidor local. jsDelivr
	puede conservar el modulo publicado en cache; no implica que el build local fallo.
- Offline: el canal no emite; elegir otro o reintentar mas tarde.
- Cloudflare/403: el servidor tambien puede ser bloqueado; probar otra ubicacion
	del proxy. No se ejecutan desafios JS ni se garantiza eludirlos.
- Error de video: reintentar para renovar las URLs, o elegir una calidad menor.
	Tener panel 4K no garantiza decodificar cualquier codec, bitrate o fps.
- CH sin respuesta: usar arriba/abajo en el reproductor y registrar el problema
	en Diagnostico antes de cambiar el manifiesto o reinstalar TizenBrew.
- Sin persistencia: la app avisa si localStorage falla. Cambiar entre el origen
	local y el del modulo publicado crea almacenamientos separados.

No se han incluido login, chat, VOD, clips ni multivista. El servidor es para la
red local y no debe exponerse en Internet.

## Fuentes verificadas

- [Contrato de modulos v2.0.5](https://github.com/reisxd/TizenBrew/blob/v2.0.5/docs/MODULES.md)
- [Cargador de modulos](https://github.com/reisxd/TizenBrew/blob/v2.0.5/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js)
- [AVPlay](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [Control remoto](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
- [Motor web](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)