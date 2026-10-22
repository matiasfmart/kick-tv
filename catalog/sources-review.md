# Revision del piloto argentino

Revision realizada el 2026-10-22. Se limita a la procedencia del reproductor
publicado por el medio, no a una certificacion juridica ni de disponibilidad.
No se agregan emisiones de terceros para sustituir canales que fallen.

| Canal | Evidencia | Relacion comprobada |
| --- | --- | --- |
| Canal 7 Neuquen | https://arcast.com.ar/c7nq/ | El sitio indicado para el canal, https://www.c7neuquen.com.ar/, redirige a este reproductor; su HTML contiene la URL HLS de stream.arcast.com.ar/c7nq. |
| Canal Universidad UNMdP | https://canal.mdp.edu.ar/canalvivo.html | La pagina de la Universidad Nacional de Mar del Plata enlaza este vivo y su reproductor publica referencias a videostream.shockmedia.com.ar. |
| Canal 26 | https://www.canal26.com/canal26-en-vivo/ | La pagina oficial se titula Canal 26 en vivo y la portada oficial enlaza esa seccion. El host candidato stream-gtlc.telecentro.net.ar coincide con la infraestructura de Telecentro. La playlist HLS y una muestra de segmento respondieron desde home-ar; esto no prueba playback en la TV. |
| Itel TV Canal 2 | https://iteltv.com.ar/ | El sitio de Itel S.A. identifica su servicio de TV local en Chajari y muestra "Itel TV Online. En vivo"; su HTML incluye el host del stream candidato. HLS y segmento respondieron desde home-ar con H.264/AAC declarados, sin headers especiales. |
| Correa Radiovision | https://www.correadigital.com.ar/canal12.html | La pagina del canal redirige al reproductor Arcast `/canal12correa/`; su host de stream es `stream.arcast.net`. El HLS declaro H.264/AAC a 720p y paso una muestra de segmento desde home-ar. |
| Canal Orbe 21 | https://canalorbe21.com/ | El sitio del canal redirige al reproductor Arcast `/canal21/`; su host de stream es `stream.arcast.net`. El HLS declaro H.264/AAC y paso una muestra de segmento desde home-ar. |

`AiredeSantaFe.ar` queda oculto: el candidato encontrado corresponde a radio en
vivo y no hay evidencia de que sea un canal de TV. El reproductor de Canal 7
informaba que no habia emision al revisar la pagina.
Esto no se convierte en un exito: el generador conserva el resultado real del HLS.
Canal 5 Santa Fe tambien redirige su web al reproductor oficial Arcast, pero el
HLS de iptv-org no coincide con la playlist publicada por ese reproductor y la
ruta vigente agoto 15 segundos de espera desde home-ar. No se agrego ninguno de
los dos enlaces. Canal 4 Esquel y Catamarca TV tambien agotaron el timeout;
Canal 9 Litoral respondio 404 y AlternaTV agoto el timeout. Los otros candidatos
de la auditoria siguen pendientes.

Los overrides no evitan blocklist, NSFW, canal cerrado, controles de red ni
revision humana de procedencia. La generacion normal no consulta las playlists:
publica los seis hosts aprobados como pendientes de prueba local. El reproductor
solo informa disponibilidad despues de observar avance real de video; un error
en un dispositivo/red no se toma como conclusion universal sobre el canal.
Fuentes que requieren headers siguen fuera del player HTML5.