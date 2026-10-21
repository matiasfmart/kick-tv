# Kick TV para TizenBrew

Estado: fase 2, diagnostico de entorno y control remoto. Todavia no reproduce Kick.

## Mac

Abrir `Iniciar.command` con doble clic. Mantener esa terminal abierta mientras se prueba.
Abrir http://localhost:5173 en Chrome. Flechas mueven el foco, Enter activa la accion
y Escape o Backspace abren/cancelan la confirmacion de salida.

Despues de editar el codigo fuente, ejecutar `npm run build` y recargar la pagina.
El servidor envia `Cache-Control: no-store`. Detenerlo con Control+C.

## Build

`npm install` y `npm test` generan `app/bundle.js` y verifican su sintaxis con
Acorn en modo ES5. Babel no agrega polyfills automaticamente; el runtime usa
DOM clasico y APIs ES5. Las herramientas de build requieren Node 18 o superior
en la Mac, no en la TV.

El bundle generado debe incluirse en GitHub: TizenBrew no ejecuta el build.
El paquete es privado para evitar una publicacion accidental en npm. Esto no
impide usar un repositorio publico de GitHub mediante TizenBrew.

## TV: siguiente paso

Crear un repositorio publico de GitHub y subir el proyecto, incluyendo el bundle.
En Module Manager, elegir GitHub e ingresar `USUARIO/REPO` (sin URL ni prefijo `gh/`).
No hace falta reinstalar TizenBrew ni cambiar la Host IP: mantener `127.0.0.1`.

TizenBrew 2.0.5 usa jsDelivr, por lo que el repositorio debe ser publico y los
cambios publicados pueden tardar en aparecer por cache del CDN.
Para iterar, la accion "Abrir version local" navega a
http://192.168.0.220:5173/app/index.html. La Mac debe estar encendida, en la misma
red y permitir conexiones entrantes a Node. La disponibilidad de APIs nativas
despues de navegar a ese origen aun debe probarse en la TV.

No se puede detectar de forma fiable un fallo de navegacion a la Mac desde la
pagina que se abandona. Si aparece un error de conexion, volver a abrir TizenBrew
y el modulo. Los datos de localStorage pertenecen a cada origen y no se comparten
entre la version de jsDelivr/loopback y la version de la Mac.

## Que registrar en la TV

- Plataforma y version del User-Agent.
- Disponibilidad de AVPlay antes y despues de abrir la version local.
- Resultado de carga de `$WEBAPIS/webapis/webapis.js`.
- Teclas especiales registradas y codigos recibidos al presionarlas.
- Lectura/escritura de localStorage.

`canPlayType` es solamente un indicio de soporte HLS, no una prueba de reproduccion.
La confirmacion de salida cierra TizenBrew completo en la TV. En Chrome es simulada.
La reproduccion real, busqueda, favoritos y calidad corresponden a fases siguientes.

## Fuentes verificadas

- [Contrato de modulos v2.0.5](https://github.com/reisxd/TizenBrew/blob/v2.0.5/docs/MODULES.md)
- [Cargador de modulos](https://github.com/reisxd/TizenBrew/blob/v2.0.5/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js)
- [AVPlay](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [Control remoto](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
- [Motor web](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)