(function () {
  'use strict';

  var actionIds = ['open-tv', 'check', 'test-hls', 'kick-720', 'kick-1080', 'clear', 'reload', 'local'];
  var dialogIds = ['cancel', 'exit'];
  var playbackIds = ['toggle-video', 'retry-video', 'stop-video'];
  var specialKeys = ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop'];
  var keyNames = {
    13: 'OK',
    19: 'Pause',
    27: 'Back',
    37: 'Izquierda',
    38: 'Arriba',
    39: 'Derecha',
    40: 'Abajo',
    403: 'Rojo',
    404: 'Verde',
    405: 'Amarillo',
    406: 'Azul',
    413: 'Stop',
    415: 'Play',
    427: 'CH+',
    428: 'CH-',
    10009: 'Back',
    10252: 'Play/Pause'
  };
  var modalOpen = false;
  var lastAction = 'check';
  var scriptLoading = false;
  var samsungTV = /SMART-TV|SMARTTV|Tizen/i.test(navigator.userAgent);
  var playbackOpen = false;
  var playbackTimeout = null;
  var metadataRequest = null;
  var playbackSequence = 0;
  var playbackOriginId = 'test-hls';
  var playbackMode = 'reference';
  var kickHeight = 720;
  var testVideo = element('test-video');
  var testURL = 'https://test-streams.mux.dev/x36xhzz/url_0/193039199_mp4_h264_aac_hd_7.m3u8';
  function element(id) {
    return document.getElementById(id);
  }
  function text(id, value) {
    element(id).textContent = value;
  }
  function log(message) {
    var entry = document.createElement('li');
    entry.textContent = message;
    var list = element('log');
    list.insertBefore(entry, list.firstChild);
    while (list.children.length > 6) {
      list.removeChild(list.lastChild);
    }
  }
  function focus(id) {
    element(id).focus();
    element(id).scrollIntoView(false);
  }
  function checkAVPlay() {
    if (window.webapis && window.webapis.avplay) {
      try {
        text('avplay', 'Disponible / v' + window.webapis.avplay.getVersion());
      } catch (error) {
        text('avplay', 'API presente / ' + error.name);
      }
      return;
    }
    text('avplay', 'No disponible en este documento');
  }
  function loadAVPlay() {
    checkAVPlay();
    if (!window.tizen && !samsungTV || scriptLoading || window.webapis && window.webapis.avplay) {
      return;
    }
    scriptLoading = true;
    var script = document.createElement('script');
    script.src = '$WEBAPIS/webapis/webapis.js';
    script.onload = function () {
      scriptLoading = false;
      checkAVPlay();
      log('Carga de webapis.js finalizada.');
    };
    script.onerror = function () {
      scriptLoading = false;
      text('avplay', 'webapis.js no se pudo cargar');
      log('AVPlay: ruta nativa no accesible.');
    };
    document.head.appendChild(script);
  }
  function checkEnvironment() {
    var platform = samsungTV ? 'Samsung TV (User-Agent) / API Tizen no expuesta' : 'Navegador de escritorio / sin Tizen';
    var registered = 0;
    if (window.tizen) {
      try {
        platform = 'Tizen ' + window.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
      } catch (error) {
        platform = 'Tizen presente / ' + error.name;
      }
      if (window.tizen.tvinputdevice) {
        var supported = [];
        try {
          supported = window.tizen.tvinputdevice.getSupportedKeys();
        } catch (error) {
          log('Consulta de teclas: ' + error.name);
        }
        for (var keyIndex = 0; keyIndex < specialKeys.length; keyIndex++) {
          for (var supportedIndex = 0; supportedIndex < supported.length; supportedIndex++) {
            if (supported[supportedIndex].name === specialKeys[keyIndex]) {
              try {
                window.tizen.tvinputdevice.registerKey(specialKeys[keyIndex]);
                registered++;
              } catch (error) {
                log(specialKeys[keyIndex] + ': ' + error.name);
              }
              break;
            }
          }
        }
      }
    }
    text('platform', platform);
    text('keys', window.tizen ? registered + ' / ' + specialKeys.length + ' registradas' : samsungTV ? 'Sin API de registro / comprobar eventos reales' : 'Simulacion con teclado');
    var video = document.createElement('video');
    var hls = video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL');
    text('hls', hls ? 'canPlayType: ' + hls + ' / falta reproducir' : 'No declarado / falta prueba real');
    try {
      window.localStorage.setItem('kick-tv-diagnostic', 'ok');
      if (window.localStorage.getItem('kick-tv-diagnostic') !== 'ok') {
        throw new Error('Lectura fallida');
      }
      window.localStorage.removeItem('kick-tv-diagnostic');
      text('storage', 'Lectura y escritura OK');
    } catch (error) {
      text('storage', 'No disponible / ' + error.name);
    }
    text('agent', navigator.userAgent);
    text('origin', window.location.protocol + '//' + window.location.host + window.location.pathname);
    loadAVPlay();
    log('Entorno comprobado.');
  }
  function setModal(open) {
    modalOpen = open;
    element('exit-dialog').hidden = !open;
    focus(open ? 'cancel' : lastAction);
  }
  function clearPlaybackTimeout() {
    window.clearTimeout(playbackTimeout);
    playbackTimeout = null;
  }
  function armPlaybackTimeout() {
    clearPlaybackTimeout();
    playbackTimeout = window.setTimeout(function () {
      if (!playbackOpen || testVideo.error) {
        return;
      }
      text('playback-status', 'Sin avance de video durante 20 segundos');
      text('playback-detail', 'Puede ser red, TLS o soporte HLS. Reintentar o volver al diagnostico.');
    }, 20000);
  }
  function playVideo() {
    if (!testVideo.getAttribute('src')) {
      return;
    }
    var sequence = playbackSequence;
    var result;
    try {
      result = testVideo.play();
    } catch (error) {
      text('playback-status', 'No se pudo iniciar: ' + error.name);
      return;
    }
    if (result && typeof result.catch === 'function') {
      result.catch(function (error) {
        if (playbackOpen && sequence === playbackSequence && error.name !== 'AbortError') {
          text('playback-status', 'No se pudo reproducir: ' + error.name);
        }
      });
    }
  }
  function preparePlayback(title, originId) {
    playbackSequence++;
    if (metadataRequest) {
      metadataRequest.abort();
      metadataRequest = null;
    }
    playbackOpen = false;
    clearPlaybackTimeout();
    testVideo.pause();
    testVideo.removeAttribute('src');
    testVideo.load();
    playbackOriginId = originId;
    playbackOpen = true;
    element('playback').hidden = false;
    text('playback-title', title);
    text('playback-channel', '');
    text('toggle-video', 'Pausar');
    focus('stop-video');
  }
  function setMediaURL(url) {
    testVideo.src = url;
    testVideo.load();
    armPlaybackTimeout();
    playVideo();
  }
  function startPlayback() {
    playbackMode = 'reference';
    preparePlayback('HLS de referencia / 720p', 'test-hls');
    text('playback-status', 'Abriendo HLS de referencia...');
    text('playback-detail', 'Motor: video HTML5 / esperando datos');
    setMediaURL(testURL);
  }
  function apiBaseURL() {
    var config = window.KICK_TV_CONFIG || {};
    var base = config.apiBaseUrl;
    if (!base) {
      try {
        base = window.localStorage.getItem('kick-tv-api-base');
      } catch (error) {
        log('URL del proxy: almacenamiento no disponible.');
      }
    }
    return (base || 'http://192.168.0.220:5173/api').replace(/\/$/, '');
  }
  function startKickPlayback(height) {
    playbackMode = 'kick';
    kickHeight = height;
    var config = window.KICK_TV_CONFIG || {};
    var slug = config.channel || 'xqc';
    preparePlayback('Kick / ' + slug + ' / ' + height + 'p', height === 1080 ? 'kick-1080' : 'kick-720');
    text('playback-status', 'Consultando canal y calidades...');
    text('playback-detail', 'Esperando respuesta del proxy en la Mac');
    var sequence = playbackSequence;
    var request = new XMLHttpRequest();
    metadataRequest = request;
    function fail(message) {
      if (!playbackOpen || sequence !== playbackSequence) {
        return;
      }
      metadataRequest = null;
      text('playback-status', message);
      text('playback-detail', 'Reintentar o volver al diagnostico.');
    }
    request.onload = function () {
      if (!playbackOpen || sequence !== playbackSequence) {
        return;
      }
      metadataRequest = null;
      var channel;
      try {
        channel = JSON.parse(request.responseText);
      } catch (error) {
        fail('El proxy no devolvio JSON valido.');
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        fail(channel.message || 'Error HTTP ' + request.status + ' del proxy.');
        return;
      }
      if (!channel || typeof channel.live !== 'boolean' || !Array.isArray(channel.qualities)) {
        fail('Respuesta del proxy con formato inesperado.');
        return;
      }
      if (!channel.live) {
        fail('El canal ' + (channel.name || slug) + ' esta offline.');
        return;
      }
      var quality = null;
      for (var index = 0; index < channel.qualities.length; index++) {
        var candidate = channel.qualities[index];
        if (candidate.height > 0 && candidate.height <= height && (!quality || candidate.height > quality.height || candidate.height === quality.height && candidate.fps > quality.fps)) {
          quality = candidate;
        }
      }
      quality = quality || channel.qualities[0];
      if (!quality || typeof quality.url !== 'string') {
        fail('El canal no tiene una calidad reproducible.');
        return;
      }
      text('playback-title', (channel.name || slug) + ' / ' + quality.label);
      text('playback-channel', channel.title || 'Kick en vivo');
      text('playback-status', 'Abriendo stream en vivo...');
      text('playback-detail', (channel.viewers || 0) + ' espectadores / esperando video');
      setMediaURL(quality.url);
    };
    request.onerror = function () {
      fail('No se pudo contactar al proxy. Verificar que la Mac y el servidor esten encendidos.');
    };
    request.ontimeout = function () {
      fail('La consulta al proxy supero los 35 segundos.');
    };
    try {
      request.open('GET', apiBaseURL() + '/channels/' + encodeURIComponent(slug), true);
      request.timeout = 35000;
      request.send();
    } catch (error) {
      fail('No se pudo iniciar la consulta: ' + error.name);
    }
  }
  function retryPlayback() {
    if (playbackMode === 'kick') {
      startKickPlayback(kickHeight);
    } else {
      startPlayback();
    }
  }
  function stopPlayback() {
    playbackSequence++;
    playbackOpen = false;
    if (metadataRequest) {
      metadataRequest.abort();
      metadataRequest = null;
    }
    clearPlaybackTimeout();
    testVideo.pause();
    testVideo.removeAttribute('src');
    testVideo.load();
    element('playback').hidden = true;
    log('Reproductor cerrado.');
    focus(playbackOriginId);
  }
  function togglePlayback() {
    if (!testVideo.getAttribute('src')) {
      return;
    }
    if (testVideo.paused) {
      armPlaybackTimeout();
      playVideo();
    } else {
      testVideo.pause();
    }
  }
  testVideo.addEventListener('playing', function () {
    if (!playbackOpen) {
      return;
    }
    text('playback-status', 'Reproduccion iniciada');
    text('toggle-video', 'Pausar');
  });
  testVideo.addEventListener('timeupdate', function () {
    if (!playbackOpen || testVideo.paused) {
      return;
    }
    text('playback-detail', 'Video ' + testVideo.videoWidth + 'x' + testVideo.videoHeight + ' / ' + Math.floor(testVideo.currentTime) + ' s');
    armPlaybackTimeout();
  });
  testVideo.addEventListener('pause', function () {
    if (!playbackOpen) {
      return;
    }
    clearPlaybackTimeout();
    text('playback-status', 'Pausado');
    text('toggle-video', 'Reproducir');
  });
  testVideo.addEventListener('waiting', function () {
    if (!playbackOpen) {
      return;
    }
    text('playback-status', 'Cargando video...');
    armPlaybackTimeout();
  });
  testVideo.addEventListener('error', function () {
    if (!playbackOpen || !testVideo.error) {
      return;
    }
    clearPlaybackTimeout();
    var messages = {
      1: 'Carga cancelada',
      2: 'Error de red o TLS',
      3: 'Error de decodificacion',
      4: 'Formato o URL no soportados'
    };
    var code = testVideo.error.code;
    text('playback-status', 'Error ' + code + ': ' + (messages[code] || 'Error desconocido'));
    text('playback-detail', (playbackMode === 'kick' ? 'Kick en vivo' : 'HLS de referencia') + ' / video HTML5. Reintentar o volver al diagnostico.');
    log('Video: error ' + code);
  });
  testVideo.addEventListener('ended', function () {
    if (!playbackOpen) {
      return;
    }
    clearPlaybackTimeout();
    text('playback-status', 'Video finalizado');
    text('toggle-video', 'Reproducir');
  });
  function moveFocus(direction) {
    var ids = modalOpen ? dialogIds : playbackOpen ? playbackIds : actionIds;
    var current = ids.indexOf(document.activeElement.id);
    var next = current < 0 ? 0 : (current + direction + ids.length) % ids.length;
    focus(ids[next]);
  }
  element('open-tv').onclick = function () {
    window.location.href = 'tv.html';
  };
  element('check').onclick = checkEnvironment;
  element('test-hls').onclick = startPlayback;
  element('kick-720').onclick = function () {
    startKickPlayback(720);
  };
  element('kick-1080').onclick = function () {
    startKickPlayback(1080);
  };
  element('toggle-video').onclick = togglePlayback;
  element('retry-video').onclick = retryPlayback;
  element('stop-video').onclick = stopPlayback;
  element('clear').onclick = function () {
    element('log').textContent = '';
    text('last-key', 'Sin eventos');
  };
  element('reload').onclick = function () {
    window.location.reload();
  };
  element('local').onclick = function () {
    if (window.location.hostname === '192.168.0.220' || window.location.hostname === 'localhost') {
      log('Ya estas en el servidor local.');
      return;
    }
    window.location.href = 'http://192.168.0.220:5173/app/index.html';
  };
  element('cancel').onclick = function () {
    setModal(false);
  };
  element('exit').onclick = function () {
    if (window.tizen && window.tizen.application) {
      try {
        window.tizen.application.getCurrentApplication().exit();
      } catch (error) {
        log('No se pudo salir: ' + error.name);
        setModal(false);
      }
    } else {
      setModal(false);
      log('Salida simulada. El navegador sigue abierto.');
    }
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
      var allowed = modalOpen ? dialogIds : playbackOpen ? playbackIds : actionIds;
      if (allowed.indexOf(active.id) >= 0) {
        active.click();
      }
    } else if (code === 10009 || code === 27 || code === 8) {
      event.preventDefault();
      if (playbackOpen) {
        stopPlayback();
        return;
      }
      if (!modalOpen) {
        lastAction = actionIds.indexOf(document.activeElement.id) >= 0 ? document.activeElement.id : 'check';
      }
      setModal(!modalOpen);
    } else if (playbackOpen && (code === 10252 || code === 415 || code === 19 || code === 413)) {
      event.preventDefault();
      if (code === 413) {
        stopPlayback();
      } else if (code === 415) {
        armPlaybackTimeout();
        playVideo();
      } else if (code === 19) {
        testVideo.pause();
      } else {
        togglePlayback();
      }
    } else if (specialKeys.length && keyNames[code]) {
      event.preventDefault();
    }
  });
  document.addEventListener('focusin', function (event) {
    if (modalOpen && dialogIds.indexOf(event.target.id) < 0) {
      focus('cancel');
    } else if (playbackOpen && playbackIds.indexOf(event.target.id) < 0) {
      focus('stop-video');
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playbackOpen) {
      stopPlayback();
    }
  });
  checkEnvironment();
  element('check').focus();
})();
