# Catalogo IPTV Argentina

Estado: el runtime de IPTV consulta directamente el M3U argentino y la blocklist
de iptv-org. Este generador queda como alternativa para auditoría/snapshot estático;
no es requisito para mostrar canales en el módulo. El workflow es solo manual,
auditoría por defecto, sin cron ni despliegue automático.
El usuario eligio omitir por ahora la prueba fisica de la fase 2; sigue pendiente.

## Ejecucion en la Mac

Abrir `Catalogo.command` con doble clic para auditar candidatos o generar un
snapshot estático opcional. La app actual no consume ese snapshot: al abrir IPTV
descarga `https://iptv-org.github.io/iptv/countries/ar.m3u` y la blocklist JSON,
y comprueba cada stream solo cuando se selecciona. El lanzador no publica ni hace commits.

Comandos equivalentes desde la raiz del repo:

```sh
npm run catalog:audit
npm run catalog:generate
```

La auditoría del generador encontró 180 canales AR con 238 URLs candidatas.
El M3U directo consultado por la app contiene su propio subconjunto publicado;
no es una certificación de emisiones gratuitas o reproducibles.
El reporte queda en `.catalog/audit.json`, con nombre, sitio y hosts candidatos,
sin URLs firmadas ni contenido de video. Los JSON originales quedan en
`.catalog/sources/`, fuera de Git. No se descarga EPG.

Para repetir sin descargar nuevamente la metadata:

```sh
npm run catalog:audit -- --input .catalog/sources
npm run catalog:generate -- --input .catalog/sources
```

Los reportes y resultados locales se excluyen de Git mediante `.gitignore`.
El preflight HLS incremental es opcional: cambiar `verificationMode` a `preflight`
en `config.json`; solo entonces aplican `--max-checks` y el checkpoint.

## Revision de fuentes y overrides

`overrides.json` contiene seis aprobaciones del piloto, documentadas en
[sources-review.md](sources-review.md). El modo amplio tambien lista canales sin
revision de fuente, claramente marcados, tras aplicar pais, blocklist, NSFW,
canal cerrado, URL segura y filtros del player. La blocklist se aplica siempre,
incluso si existe un override.

Formato de ejemplo, con dominios ficticios:

```json
{
  "hidden": ["CanalOculto.ar"],
  "channels": {
    "CanalEjemplo.ar": {
      "approved": true,
      "evidence": "https://sitio-oficial.example/en-vivo",
      "allowedHosts": ["cdn-del-canal.example"],
      "name": "Nombre visible",
      "categories": ["news"],
      "forceInclude": false
    }
  }
}
```

Antes de aprobar, comprobar la fuente oficial y que el host de emision realmente
corresponda a su transmision publica. `evidence` documenta esa revision humana;
no es un resultado automatico del verificador ni una garantia juridica.

El parser directo de la app exige IDs M3U, consulta blocklist, descarta opciones
VLC/headers que HTML5 no puede aplicar y filtra URLs inválidas, privadas o con
tokens efímeros. También excluye la entrada radio-only conocida y marcas
`Geo-blocked`. Los nombres/grupos vienen del M3U; no equivale a revisión de
procedencia individual. El generador estático conserva sus filtros adicionales.

Los logos se seleccionan entre PNG/JPEG HTTPS con dimensiones declaradas de
hasta 512x512. No se redimensionan ni re-alojan en esta fase; si no hay uno
adecuado, el campo queda vacio para que la TV use su imagen de respaldo.

## Verificacion y limites

La configuracion predeterminada esta en `config.json`:

- Solo `countries: ["AR"]`, filtro aplicado antes de los sondeos y los indices.
- Entorno local `home-ar`, configurable; no se determina ubicacion por IP ni se publica la IP de la casa.
- Runtime directo: M3U argentino y blocklist se consultan por XHR; los streams no se sondean al abrir IPTV.
- En la TV, el reproductor determina disponibilidad mediante eventos reales de video. No se usa `fetch`/HEAD de playlist porque muchos hosts no exponen CORS y una respuesta HTTP correcta no prueba decodificacion.
- La app intenta hasta tres URLs del mismo canal; al avanzar el video informa disponible y al agotar fallbacks informa que no esta disponible en ese dispositivo. Salud y cooldown se guardan localmente.
- Para un preflight manual de HLS, cambiar `verificationMode` a `preflight`; ese chequeo HTTP desde la Mac no certifica playback en la TV.
- Concurrencia 6, dos chequeos por host, timeout de 6 segundos por recurso.
- Hasta un reintento transitorio con backoff; no reintentar automaticamente HTTP 403.
- Maximo 80 streams y cuatro minutos para la fase de verificacion por ejecucion.
- Exitos vigentes durante 24 horas y fallos durante 6 horas antes de reintentar.
- Paginas de hasta 32 items y 256 KiB; manifest de hasta 128 KiB.

El cliente de red bloquea direcciones privadas, loopback, link-local y reservadas.
Valida todos los resultados DNS, fija la IP elegida y revisa cada redireccion.
Los manifests estan acotados y solo se descarga un prefijo de hasta 64 KiB del
primer segmento de una variante. Se usa el parser m3u8-parser, no un parser HLS propio.

Se respetan Referer y User-Agent declarados al verificar. Eso no significa que
el reproductor HTML5 de la TV pueda enviarlos. Esas fuentes quedan separadas en
`requires-adapter`, fuera de los listados reproducibles normales. No se implementa
un proxy de video ni se eluden geobloqueos, paywalls o DRM. Contenido cifrado y
URLs con tokens efimeros quedan fuera de esta primera etapa.

`segment-ok` significa HLS parseado y muestra de TS/fMP4 accesible; NO significa
que el decoder de Samsung funciono. El resultado lleva `devicePlaybackVerified: false`,
fecha, entorno y version de verificador. CODECS declarados se conservan cuando
existen; si no hay informacion suficiente la compatibilidad queda `unknown`.
El primer control real se hizo con el HLS de referencia de Mux. Despues se
verificaron manifest y muestra de segmento de las fuentes aprobadas del piloto;
Canal 26 declara H.264/AAC a 1080p, Itel TV H.264/AAC sin altura declarada y
Correa/Orbe tambien pasaron la muestra. Los otros candidatos siguen pendientes.
Ninguno de estos resultados equivale a playback en la TV.

La cola alterna nuevos, fallos reintentables y verificaciones antiguas. Guarda
checkpoint atomico por resultado. Ctrl+C conserva lo terminado y no reemplaza el
catalogo anterior. Una cancelacion no marca streams caidos. Una terminacion
abrupta puede perder los resultados aun no persistidos/subidos.

## Salida para la TV

`catalog-output/manifest.json` apunta a una version coherente en `versions/`:

- `countries/AR/`: tarjetas ligeras, sin el catalogo mundial.
- `categories/` y `languages/`: indices de ids.
- `details/`: principal, fallbacks del mismo feed, emisiones alternativas y headers.
- `lookup.json`: ubicacion de los detalles por id.
- `search/`: nombres/alias normalizados, sin URLs de reproduccion ni headers.
- `requires-adapter/`: canales que no puede reproducir directamente HTML5.
- `report.json`: conteos y razones de exclusion, entorno y alcance de verificacion.

Los fallbacks automaticos no deben cambiar a otra emision regional sin avisar:
por eso se separan los candidatos del mismo feed de `alternateFeeds`. IptvSource
debe comprobar version/hash y recargar el manifest si una particion vieja ya no
esta disponible despues de un despliegue de Pages.

El manifest se actualiza solo despues de escribir y validar todos los archivos.
Si hay metadata invalida, blocklist inaccesible o particiones demasiado grandes,
se conserva el catalogo anterior. Una lista vacia sin fuentes aprobadas es un
resultado valido y no se interpreta como error de red.

## GitHub Actions y Pages

Workflow: `.github/workflows/catalog.yml`. Se ejecuta solo manualmente; la auditoría
es el valor predeterminado y no despliega Pages. Para publicar, un operador debe
seleccionar explícitamente `publish` desde `main` y configurar GitHub Pages con
source Actions.

- Manual: auditoria por defecto, sin publicacion. Tambien permite generar sin desplegar.
- No hay cron: el runtime IPTV consume directamente iptv-org y no necesita este workflow.
- Solo main puede publicar Pages; los permisos de Pages/OIDC estan en el job de deploy.
- El checkpoint durable se guarda en `catalog-state`, nunca como commit en main.
- Se guardan artifacts de auditoria/checkpoint por siete dias, no como unica copia del estado.
- Actions oficiales fijadas a SHAs verificados. No se ejecuta este publicador para PRs.
- Pages sirve solo JSON/metadata, no video. Los streams se obtendran de sus titulares.

Los chequeos de GitHub pueden diferir de tu red argentina. La salud aprendida por
la TV, sus cooldowns y la politica de ocultar/despriorizar se implementaran al
sumar IptvSource, no en este generador. Para un futuro equipo de casa, ejecutar
la misma CLI en Node LTS con un environment propio y el mismo contrato de salida.

Los schedules pueden retrasarse o deshabilitarse tras 60 dias sin actividad.
Las ejecuciones y Pages tienen cuotas: no se promete disponibilidad ni coste
gratuito ilimitados. No se habilito ningun servicio remoto en esta iteracion.