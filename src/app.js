(function () {
  'use strict';

  var actionIds = ['check', 'clear', 'reload', 'local'];
  var dialogIds = ['cancel', 'exit'];
  var specialKeys = ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop'];
  var keyNames = { 13: 'OK', 19: 'Pause', 27: 'Back', 37: 'Izquierda', 38: 'Arriba', 39: 'Derecha', 40: 'Abajo', 403: 'Rojo', 404: 'Verde', 405: 'Amarillo', 406: 'Azul', 413: 'Stop', 415: 'Play', 427: 'CH+', 428: 'CH-', 10009: 'Back', 10252: 'Play/Pause' };
  var modalOpen = false;
  var lastAction = 'check';
  var scriptLoading = false;

  function element(id) { return document.getElementById(id); }
  function text(id, value) { element(id).textContent = value; }

  function log(message) {
    var entry = document.createElement('li');
    entry.textContent = message;
    var list = element('log');
    list.insertBefore(entry, list.firstChild);
    while (list.children.length > 6) { list.removeChild(list.lastChild); }
  }

  function focus(id) {
    element(id).focus();
    element(id).scrollIntoView(false);
  }

  function checkAVPlay() {
    if (window.webapis && window.webapis.avplay) {
      try { text('avplay', 'Disponible / v' + window.webapis.avplay.getVersion()); }
      catch (error) { text('avplay', 'API presente / ' + error.name); }
      return;
    }
    text('avplay', 'No disponible en este documento');
  }

  function loadAVPlay() {
    checkAVPlay();
    if (!window.tizen || scriptLoading || (window.webapis && window.webapis.avplay)) { return; }
    scriptLoading = true;
    var script = document.createElement('script');
    script.src = '$WEBAPIS/webapis/webapis.js';
    script.onload = function () { scriptLoading = false; checkAVPlay(); log('Carga de webapis.js finalizada.'); };
    script.onerror = function () { scriptLoading = false; text('avplay', 'webapis.js no se pudo cargar'); log('AVPlay: ruta nativa no accesible.'); };
    document.head.appendChild(script);
  }

  function checkEnvironment() {
    var platform = 'Navegador de escritorio / sin Tizen';
    var registered = 0;
    if (window.tizen) {
      try { platform = 'Tizen ' + window.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); }
      catch (error) { platform = 'Tizen presente / ' + error.name; }
      if (window.tizen.tvinputdevice) {
        var supported = [];
        try { supported = window.tizen.tvinputdevice.getSupportedKeys(); }
        catch (error) { log('Consulta de teclas: ' + error.name); }
        for (var keyIndex = 0; keyIndex < specialKeys.length; keyIndex++) {
          for (var supportedIndex = 0; supportedIndex < supported.length; supportedIndex++) {
            if (supported[supportedIndex].name === specialKeys[keyIndex]) {
              try { window.tizen.tvinputdevice.registerKey(specialKeys[keyIndex]); registered++; }
              catch (error) { log(specialKeys[keyIndex] + ': ' + error.name); }
              break;
            }
          }
        }
      }
    }
    text('platform', platform);
    text('keys', window.tizen ? registered + ' / ' + specialKeys.length + ' registradas' : 'Simulacion con teclado');
    var video = document.createElement('video');
    var hls = video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL');
    text('hls', hls ? 'canPlayType: ' + hls + ' / falta reproducir' : 'No declarado / falta prueba real');
    try {
      window.localStorage.setItem('kick-tv-diagnostic', 'ok');
      if (window.localStorage.getItem('kick-tv-diagnostic') !== 'ok') { throw new Error('Lectura fallida'); }
      window.localStorage.removeItem('kick-tv-diagnostic');
      text('storage', 'Lectura y escritura OK');
    } catch (error) { text('storage', 'No disponible / ' + error.name); }
    text('agent', navigator.userAgent);
    text('origin', window.location.protocol + '//' + window.location.host);
    loadAVPlay();
    log('Entorno comprobado.');
  }

  function setModal(open) {
    modalOpen = open;
    element('exit-dialog').hidden = !open;
    focus(open ? 'cancel' : lastAction);
  }

  function moveFocus(direction) {
    var ids = modalOpen ? dialogIds : actionIds;
    var current = ids.indexOf(document.activeElement.id);
    var next = current < 0 ? 0 : (current + direction + ids.length) % ids.length;
    focus(ids[next]);
  }

  element('check').onclick = checkEnvironment;
  element('clear').onclick = function () { element('log').textContent = ''; text('last-key', 'Sin eventos'); };
  element('reload').onclick = function () { window.location.reload(); };
  element('local').onclick = function () {
    if (window.location.hostname === '192.168.0.220' || window.location.hostname === 'localhost') {
      log('Ya estas en el servidor local.');
      return;
    }
    window.location.href = 'http://192.168.0.220:5173/app/index.html';
  };
  element('cancel').onclick = function () { setModal(false); };
  element('exit').onclick = function () {
    if (window.tizen && window.tizen.application) {
      try { window.tizen.application.getCurrentApplication().exit(); }
      catch (error) { log('No se pudo salir: ' + error.name); setModal(false); }
    } else { setModal(false); log('Salida simulada. El navegador sigue abierto.'); }
  };

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    var name = keyNames[code] || event.key || 'Desconocida';
    text('last-key', name + ' / ' + code);
    log(name + ' (' + code + ')');
    if (code === 37 || code === 38 || code === 39 || code === 40) {
      event.preventDefault();
      moveFocus(code === 37 || code === 38 ? -1 : 1);
    } else if (code === 13) {
      event.preventDefault();
      var active = document.activeElement;
      var allowed = modalOpen ? dialogIds : actionIds;
      if (allowed.indexOf(active.id) >= 0) { active.click(); }
    } else if (code === 10009 || code === 27 || code === 8) {
      event.preventDefault();
      if (!modalOpen) { lastAction = actionIds.indexOf(document.activeElement.id) >= 0 ? document.activeElement.id : 'check'; }
      setModal(!modalOpen);
    } else if (specialKeys.length && keyNames[code]) { event.preventDefault(); }
  });

  document.addEventListener('focusin', function (event) {
    if (modalOpen && dialogIds.indexOf(event.target.id) < 0) { focus('cancel'); }
  });
  checkEnvironment();
  element('check').focus();
}());