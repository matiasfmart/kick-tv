(function () {
  'use strict';

  var hub = window.StreamHub;
  var favoriteKey = 'kick-tv-favorites';
  var qualityKey = 'kick-tv-default-quality';
  var proxyKey = 'kick-tv-api-base';
  var tab = 'favorites';
  var favorites = [];
  var channels = Object.create(null);
  var searchResults = [];
  var query = '';
  var searchSequence = 0;
  var searchRequest = null;
  var refreshSequence = 0;
  var refreshing = false;
  var defaultQuality = 'auto';
  var proxyURL = 'https://kick-tv-phi.vercel.app/api';
  var storageOK = true;
  var modalOpen = false;
  var modalReturn = '';
  var playerOpen = false;
  var playerChannel = null;
  var playerQuality = null;
  var playerRequest = null;
  var playerSequence = 0;
  var mediaSequence = 0;
  var playerReturn = '';
  var playerState = 'idle';
  var overlayTimer = null;
  var watchdog = null;
  var noticeTimer = null;
  var lastVideoTime = -1;
  var video = element('player-video');

  function element(id) { return document.getElementById(id); }
  function text(id, value) { element(id).textContent = value; }
  function show(id, visible) { element(id).hidden = !visible; }
  function icon(name) { return window.KickTVIcons[name] || ''; }

  function fillIcons(root) {
    var nodes = root.querySelectorAll('[data-icon]');
    for (var index = 0; index < nodes.length; index++) { nodes[index].innerHTML = icon(nodes[index].getAttribute('data-icon')); }
  }

  function notice(message) {
    window.clearTimeout(noticeTimer);
    element('notice').className = 'notice' + (playerOpen ? ' above-player' : '');
    text('notice', message);
    show('notice', true);
    noticeTimer = window.setTimeout(function () { show('notice', false); }, 5000);
  }

  function readStorage(key) {
    try { return window.localStorage.getItem(key); }
    catch (error) { storageOK = false; return null; }
  }

  function saveStorage(key, value) {
    try {
      if (key === favoriteKey) { hub.favorites.replaceSource('kick', JSON.parse(value)); }
      else { window.localStorage.setItem(key, value); }
    }
    catch (error) { storageOK = false; notice('No se pudo guardar. Los cambios se perderan al cerrar la app.'); }
    text('storage-info', storageOK ? 'Almacenamiento disponible' : 'Almacenamiento no disponible');
  }

  function validSlug(slug) { return typeof slug === 'string' && /^[a-z0-9_-]{1,50}$/i.test(slug); }
  function isFavorite(slug) { return favorites.indexOf(slug) >= 0; }

  function focus(id) {
    var target = element(id);
    if (!target || target.disabled || !target.getBoundingClientRect().height) { return; }
    target.focus();
    var rect = target.getBoundingClientRect();
    if (rect.top < 20 || rect.bottom > window.innerHeight - 20) { target.scrollIntoView(rect.top < 20); }
  }

  function button(label, action, name) {
    var node = document.createElement('button');
    node.type = 'button';
    node.setAttribute('data-action', action);
    if (name) {
      var glyph = document.createElement('span');
      glyph.setAttribute('data-icon', name);
      glyph.innerHTML = icon(name);
      node.appendChild(glyph);
    }
    if (label) { node.appendChild(document.createTextNode(label)); }
    return node;
  }

  function channelCard(channel, prefix) {
    var card = document.createElement('article');
    card.className = 'channel';
    card.setAttribute('data-slug', channel.slug);
    var watch = button('', 'watch');
    watch.id = prefix + '-watch-' + channel.slug;
    watch.className = 'channel-play';
    watch.setAttribute('data-slug', channel.slug);
    watch.setAttribute('aria-label', (channel.name || channel.slug) + ', ' + (channel.live === true ? 'en vivo' : channel.live === false ? 'offline' : 'sin datos'));
    var avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = (channel.name || channel.slug).substring(0, 2).toUpperCase();
    if (/^https:\/\//i.test(channel.avatar || '')) {
      var image = document.createElement('img');
      image.alt = '';
      image.src = channel.avatar;
      image.onerror = function () { this.hidden = true; };
      avatar.appendChild(image);
    }
    watch.appendChild(avatar);
    var status = document.createElement('span');
    status.className = 'channel-status' + (channel.live === true ? ' live' : '');
    status.textContent = channel.error ? 'SIN DATOS' : channel.live === true ? 'EN VIVO' : channel.live === false ? 'OFFLINE' : 'ACTUALIZANDO';
    watch.appendChild(status);
    var name = document.createElement('span');
    name.className = 'channel-name'; name.textContent = channel.name || channel.slug; watch.appendChild(name);
    var title = document.createElement('span');
    title.className = 'channel-title'; title.textContent = channel.error || channel.title || (channel.live === false ? 'Sin transmision activa' : ''); watch.appendChild(title);
    var category = document.createElement('span');
    category.className = 'channel-category'; category.textContent = (channel.category || '') + (channel.live === true && channel.viewers ? ' / ' + channel.viewers + ' espectadores' : ''); watch.appendChild(category);
    card.appendChild(watch);
    var saved = isFavorite(channel.slug);
    var favorite = button('', 'favorite', saved ? 'star-off' : 'star');
    favorite.id = prefix + '-favorite-' + channel.slug;
    favorite.className = 'channel-favorite' + (saved ? ' saved' : '');
    favorite.setAttribute('data-slug', channel.slug);
    favorite.setAttribute('aria-label', (saved ? 'Quitar ' : 'Agregar ') + (channel.name || channel.slug) + (saved ? ' de favoritos' : ' a favoritos'));
    favorite.title = favorite.getAttribute('aria-label');
    favorite.setAttribute('aria-pressed', String(saved));
    card.appendChild(favorite);
    return card;
  }

  function favoriteChannels() {
    return favorites.map(function (slug) { return channels[slug] || { slug: slug, name: slug, live: null }; }).sort(function (first, second) {
      var liveOrder = (second.live === true ? 1 : 0) - (first.live === true ? 1 : 0);
      return liveOrder || first.slug.localeCompare(second.slug);
    });
  }

  function renderFavorites() {
    var active = document.activeElement.id;
    var list = favoriteChannels();
    var grid = element('favorites-grid');
    grid.textContent = '';
    var live = 0;
    for (var index = 0; index < list.length; index++) {
      grid.appendChild(channelCard(list[index], 'favorites'));
      if (list[index].live === true) { live++; }
    }
    show('favorites-empty', !list.length);
    if (tab === 'favorites') { text('view-summary', list.length + ' favoritos / ' + live + ' en vivo' + (refreshing ? ' / actualizando' : '')); }
    if (!playerOpen && !modalOpen && active.indexOf('favorites-') === 0) {
      if (element(active)) { focus(active); }
      else { focus(list.length ? 'favorites-watch-' + list[0].slug : 'empty-search'); }
    }
    hub.refreshHome();
  }

  function refreshFavorites() {
    if (refreshing) { return; }
    refreshing = true;
    var sequence = ++refreshSequence;
    var queue = favorites.slice();
    var pending = 0;
    var errors = [];
    show('library-error', false);
    renderFavorites();
    function next() {
      if (sequence !== refreshSequence) { return; }
      if (!queue.length && !pending) {
        refreshing = false;
        renderFavorites();
        if (errors.length) { text('library-error', errors[0]); show('library-error', true); }
        return;
      }
      while (queue.length && pending < 2) {
        var slug = queue.shift();
        pending++;
        update(slug);
      }
    }
    function update(slug) {
      hub.status(slug, function (error, channel) {
        if (sequence !== refreshSequence) { return; }
        pending--;
        if (error || !channel || typeof channel.live !== 'boolean') {
          var previous = channels[slug] || { slug: slug, name: slug };
          previous.error = error ? error.message : 'Respuesta de canal invalida.';
          previous.live = null;
          channels[slug] = previous;
          errors.push(previous.error);
        } else { channels[slug] = channel; }
        renderFavorites();
        next();
      });
    }
    next();
  }

  function renderSearch() {
    var active = document.activeElement.id;
    var grid = element('search-grid'); grid.textContent = '';
    for (var index = 0; index < searchResults.length; index++) { grid.appendChild(channelCard(searchResults[index], 'search')); }
    if (!playerOpen && !modalOpen && active.indexOf('search-') === 0 && element(active)) { focus(active); }
  }

  function updateQuery(value) {
    query = value.substring(0, 50);
    element('search-input').value = query;
    searchSequence++;
    if (searchRequest) { searchRequest.abort(); searchRequest = null; }
  }

  function runSearch() {
    if (!query.trim()) { text('search-status', 'Ingresar un nombre de canal.'); return; }
    if (searchRequest) { searchRequest.abort(); }
    var sequence = ++searchSequence;
    text('search-status', 'Buscando...');
    searchRequest = hub.search(query.trim(), function (error, result) {
      if (sequence !== searchSequence) { return; }
      searchRequest = null;
      if (!error && (!result || !Array.isArray(result.channels))) { error = { message: 'El proxy devolvio resultados de busqueda invalidos.' }; }
      searchResults = !error && result && Array.isArray(result.channels) ? result.channels : [];
      for (var index = 0; index < searchResults.length; index++) { channels[searchResults[index].slug] = searchResults[index]; }
      text('search-status', error ? error.message : searchResults.length ? searchResults.length + ' canales' : 'Sin resultados');
      renderSearch();
    });
  }

  function toggleFavorite(slug) {
    if (!validSlug(slug)) { return; }
    var index = favorites.indexOf(slug);
    if (index >= 0) { favorites.splice(index, 1); }
    else {
      if (favorites.length >= 50) { notice('Maximo de 50 favoritos para este dispositivo.'); return; }
      favorites.push(slug);
    }
    saveStorage(favoriteKey, JSON.stringify(favorites));
    renderFavorites(); renderSearch(); updatePlayerFavorite();
    notice(index >= 0 ? slug + ' eliminado de favoritos' : slug + ' agregado a favoritos');
    if (index < 0) { refreshFavorites(); }
  }

  function setTab(nextTab) { hub.navigateLegacy(nextTab); }

  function setKickTab(nextTab) {
    favorites = hub.favorites.list('kick').map(function (ref) { return ref.itemId; });
    tab = nextTab;
    var tabs = ['favorites', 'search', 'settings'];
    for (var index = 0; index < tabs.length; index++) {
      var active = tabs[index] === tab;
      show('view-' + tabs[index], active);
      element('tab-' + tabs[index]).className = 'tab' + (active ? ' active' : '');
      if (active) { element('tab-' + tabs[index]).setAttribute('aria-current', 'page'); }
      else { element('tab-' + tabs[index]).removeAttribute('aria-current'); }
    }
    text('view-title', tab === 'favorites' ? 'Favoritos' : tab === 'search' ? 'Buscar canales' : 'Ajustes');
    show('refresh', tab === 'favorites');
    text('view-summary', tab === 'search' ? 'Canales de Kick' : tab === 'settings' ? 'Reproduccion y conexion' : '');
    if (tab === 'favorites') { renderFavorites(); focus(favorites.length ? 'favorites-watch-' + favoriteChannels()[0].slug : 'empty-search'); }
    else if (tab === 'search') { focus('search-input'); }
    else { element('proxy-url').value = proxyURL; focus('default-quality'); }
  }

  function openModal(title, options) {
    modalReturn = document.activeElement.id;
    modalOpen = true;
    text('modal-title', title);
    var container = element('modal-options'); container.textContent = '';
    var selected = 0;
    function append(option, index) {
      var item = button(option.label, 'modal-option', option.selected ? 'check' : '');
      item.id = 'modal-option-' + index;
      item.className = 'menu-option' + (option.selected ? ' selected' : '');
      item.setAttribute('aria-pressed', String(Boolean(option.selected)));
      item.onclick = option.action;
      container.appendChild(item);
      if (option.selected) { selected = index; }
    }
    for (var index = 0; index < options.length; index++) { append(options[index], index); }
    show('modal', true); showControls(); focus('modal-option-' + selected);
  }

  function closeModal() {
    modalOpen = false; show('modal', false); focus(modalReturn); showControls();
  }

  function qualityLabel(value) { return value === 'auto' ? 'Auto' : value + 'p'; }

  function chooseDefaultQuality() {
    var values = ['auto', '2160', '1440', '1080', '720', '480', '360'];
    openModal('Calidad predeterminada', values.map(function (value) {
      return { label: qualityLabel(value), selected: defaultQuality === value, action: function () {
        defaultQuality = value; saveStorage(qualityKey, value); text('default-quality-label', qualityLabel(value)); closeModal();
      } };
    }));
  }

  function preferredQuality(qualities) {
    if (defaultQuality === 'auto') { return qualities[0]; }
    var height = Number(defaultQuality);
    var best = null;
    for (var index = 0; index < qualities.length; index++) {
      var candidate = qualities[index];
      if (candidate.height > 0 && candidate.height <= height && (!best || candidate.height > best.height || (candidate.height === best.height && candidate.fps > best.fps))) { best = candidate; }
    }
    return best || qualities[0];
  }

  function clearWatchdog() { window.clearTimeout(watchdog); watchdog = null; }

  function armWatchdog() {
    clearWatchdog();
    watchdog = window.setTimeout(function () {
      if (playerOpen && playerState !== 'paused') { playerError('El video no avanza. Reintentar o elegir otra calidad.'); }
    }, 25000);
  }

  function showControls() {
    if (!playerOpen) { return; }
    window.clearTimeout(overlayTimer);
    element('player-overlay').className = 'player-overlay';
    if (playerState === 'playing' && !modalOpen) {
      overlayTimer = window.setTimeout(function () { element('player-overlay').className = 'player-overlay hidden-controls'; }, 5000);
    }
  }

  function playerError(message) {
    playerState = 'error'; clearWatchdog(); text('player-message', message); show('player-message', true); showControls();
  }

  function playVideo() {
    if (!video.getAttribute('src')) { return; }
    var sequence = mediaSequence;
    hub.playback.play(function (error) {
      if (playerOpen && sequence === mediaSequence) { playerError(error.message); }
    });
  }

  function attachQuality(quality) {
    mediaSequence++;
    clearWatchdog();
    playerQuality = quality;
    playerState = 'loading';
    text('current-quality', quality.label || 'Auto');
    text('player-message', 'Cargando video...'); show('player-message', true);
    text('player-resolution', '');
    lastVideoTime = -1;
    try { hub.playback.select(quality); armWatchdog(); playVideo(); showControls(); }
    catch (error) { playerError(error.message); }
  }

  function updatePlayerFavorite() {
    var saved = playerChannel && isFavorite(playerChannel.slug);
    var target = element('player-favorite');
    target.innerHTML = '<span data-icon="' + (saved ? 'star-off' : 'star') + '">' + icon(saved ? 'star-off' : 'star') + '</span>';
    target.setAttribute('aria-label', saved ? 'Quitar de favoritos' : 'Agregar a favoritos');
    target.title = target.getAttribute('aria-label');
    target.setAttribute('aria-pressed', String(Boolean(saved)));
  }

  function openChannel(slug) {
    if (!validSlug(slug)) { return; }
    hub.openMedia({ sourceId: 'kick', itemId: slug }, function () {
      favorites = hub.favorites.list('kick').map(function (ref) { return ref.itemId; });
      renderFavorites(); renderSearch();
    });
  }

  function closePlayer() {
    playerOpen = false; playerState = 'idle'; playerSequence++; mediaSequence++;
    if (playerRequest) { playerRequest.abort(); playerRequest = null; }
    clearWatchdog(); window.clearTimeout(overlayTimer);
    hub.playback.stop();
    show('player', false); show('library', true); renderFavorites(); renderSearch();
    if (element(playerReturn) && element(playerReturn).getBoundingClientRect().height) { focus(playerReturn); }
    else { focus('tab-' + tab); }
  }

  function changeChannel(direction) {
    if (!playerOpen) { return; }
    var live = favoriteChannels().filter(function (channel) { return channel.live === true; });
    if (!live.length || (live.length === 1 && playerChannel && live[0].slug === playerChannel.slug)) { notice('No hay otros favoritos en vivo.'); showControls(); return; }
    var next = hub.zapping.next(playerChannel ? { sourceId: 'kick', itemId: playerChannel.slug } : null, live.map(function (channel) { return { sourceId: 'kick', itemId: channel.slug }; }), direction);
    if (next) { openChannel(next.itemId); }
  }

  function choosePlayerQuality() {
    if (!playerChannel || !playerChannel.qualities || !playerChannel.qualities.length) { notice('Las calidades todavia no estan disponibles.'); return; }
    openModal('Calidad de video', playerChannel.qualities.map(function (quality) {
      return { label: quality.label, selected: Boolean(playerQuality && playerQuality.id === quality.id), action: function () {
        defaultQuality = quality.height ? String(quality.height) : 'auto'; saveStorage(qualityKey, defaultQuality); text('default-quality-label', qualityLabel(defaultQuality));
        closeModal(); attachQuality(quality);
      } };
    }));
  }

  function toggleVideo() {
    if (!video.getAttribute('src')) { return; }
    if (video.paused) { armWatchdog(); playVideo(); }
    else { hub.playback.pause(); }
    showControls();
  }

  function exitApp() {
    closeModal();
    try {
      if (window.tizen && window.tizen.application) { window.tizen.application.getCurrentApplication().exit(); return; }
    } catch (error) { notice('La API de salida no esta disponible.'); }
    if (window.history.length > 1) { window.history.back(); }
    else { notice('No se puede cerrar esta pagina desde JavaScript. Salir con Home del control.'); }
  }

  function back() {
    if (modalOpen) { closeModal(); }
    else if (playerOpen) { closePlayer(); }
    else if (!hub.isHome()) { hub.backFromSection(); }
    else { openModal('Salir del hub?', [{ label: 'Continuar', action: closeModal }, { label: 'Salir', action: exitApp }]); }
  }

  function action(target) {
    var name = target.getAttribute('data-action');
    var slug = target.getAttribute('data-slug');
    if (name === 'tab') { setTab(target.getAttribute('data-tab')); }
    else if (name === 'watch') { openChannel(slug); }
    else if (name === 'favorite') { toggleFavorite(slug); }
    else if (name === 'refresh') { refreshFavorites(); }
    else if (name === 'key') { updateQuery(query + target.getAttribute('data-value')); }
    else if (name === 'space') { updateQuery(query + ' '); }
    else if (name === 'delete') { updateQuery(query.slice(0, -1)); }
    else if (name === 'clear-query') { updateQuery(''); }
    else if (name === 'search') { runSearch(); }
    else if (name === 'default-quality') { chooseDefaultQuality(); }
    else if (name === 'diagnostic') { window.location.href = 'index.html'; }
    else if (name === 'close-modal') { closeModal(); }
    else if (name === 'close-player') { closePlayer(); }
    else if (name === 'toggle') { toggleVideo(); }
    else if (name === 'quality') { choosePlayerQuality(); }
    else if (name === 'player-favorite' && playerChannel) { toggleFavorite(playerChannel.slug); }
    else if (name === 'retry' && playerChannel) { openChannel(playerChannel.slug); }
    else if (name === 'next') { changeChannel(1); }
    else if (name === 'previous') { changeChannel(-1); }
  }

  function scope() { return modalOpen ? element('modal') : playerOpen ? element('player') : hub.focusRoot(); }

  function spatial(code) {
    var root = scope();
    var current = document.activeElement;
    var origin = current.getBoundingClientRect();
    var nodes = root.querySelectorAll('button, input, a');
    var best = null; var bestScore = Infinity; var bestAligned = false;
    for (var index = 0; index < nodes.length; index++) {
      var node = nodes[index];
      var rect = node.getBoundingClientRect();
      if (node === current || node.disabled || !rect.width || !rect.height) { continue; }
      var horizontal = code === 37 || code === 39;
      var deltaX = rect.left + rect.width / 2 - origin.left - origin.width / 2;
      var deltaY = rect.top + rect.height / 2 - origin.top - origin.height / 2;
      var primary = horizontal ? deltaX * (code === 37 ? -1 : 1) : deltaY * (code === 38 ? -1 : 1);
      if (primary <= 2) { continue; }
      var secondary = Math.abs(horizontal ? deltaY : deltaX);
      var overlap = horizontal
        ? Math.min(rect.bottom, origin.bottom) - Math.max(rect.top, origin.top)
        : Math.min(rect.right, origin.right) - Math.max(rect.left, origin.left);
      var aligned = overlap > 0;
      var score = primary + secondary * 2.5;
      if ((aligned && !bestAligned) || (aligned === bestAligned && score < bestScore)) { best = node; bestScore = score; bestAligned = aligned; }
    }
    if (best) { best.focus(); var bestRect = best.getBoundingClientRect(); if (bestRect.top < 20 || bestRect.bottom > window.innerHeight - 20) { best.scrollIntoView(bestRect.top < 20); } }
  }

  function focusedSlug() {
    var node = document.activeElement;
    while (node && node !== document.body) {
      var slug = node.getAttribute('data-slug');
      if (slug) { return slug; }
      node = node.parentElement;
    }
    return null;
  }

  document.addEventListener('click', function (event) {
    if (!hub.isKickViewActive() && !playerOpen && !modalOpen) { return; }
    var node = event.target;
    while (node && node !== document.body && !node.getAttribute('data-action')) { node = node.parentElement; }
    if (node && node.getAttribute('data-action')) { action(node); }
    if (playerOpen) { showControls(); }
  });

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (!hub.isKickViewActive() && !playerOpen && !modalOpen && code !== 10009 && code !== 27 && code !== 8) { return; }
    var target = event.target;
    if (target.tagName === 'INPUT' && !target.readOnly) {
      if (code === 13 || code === 27 || code === 10009) { event.preventDefault(); target.blur(); focus('save-proxy'); }
      return;
    }
    var active = document.activeElement;
    if (code === 13 && active.tagName === 'BUTTON' && scope().contains(active)) {
      event.preventDefault();
      if (playerOpen && !modalOpen && element('player-overlay').className.indexOf('hidden-controls') >= 0) { showControls(); focus('player-toggle'); }
      else { active.click(); }
      return;
    }
    if (code === 10009 || code === 27 || (code === 8 && (tab !== 'search' || playerOpen || modalOpen))) { event.preventDefault(); back(); return; }
    if (modalOpen) {
      if (code >= 37 && code <= 40) { event.preventDefault(); spatial(code); }
      return;
    }
    if (playerOpen) {
      var hidden = element('player-overlay').className.indexOf('hidden-controls') >= 0;
      showControls();
      if (code === 427 || code === 38) { event.preventDefault(); changeChannel(1); }
      else if (code === 428 || code === 40) { event.preventDefault(); changeChannel(-1); }
      else if (code === 37 || code === 39) { event.preventDefault(); if (hidden) { focus('player-toggle'); } else { spatial(code); } }
      else if (code === 13 && hidden) { event.preventDefault(); focus('player-toggle'); }
      else if (code === 10252 || code === 415 || code === 19 || code === 413) {
        event.preventDefault();
        if (code === 413) { closePlayer(); }
        else if (code === 415) { armWatchdog(); playVideo(); }
        else if (code === 19) { hub.playback.pause(); }
        else { toggleVideo(); }
      } else if (code === 405) { event.preventDefault(); choosePlayerQuality(); }
      else if (code === 403 && playerChannel) { event.preventDefault(); toggleFavorite(playerChannel.slug); }
      return;
    }
    if (code >= 37 && code <= 40) { event.preventDefault(); spatial(code); }
    else if (code === 13 && target.id === 'search-input') { event.preventDefault(); runSearch(); }
    else if (code === 8 && tab === 'search') { event.preventDefault(); updateQuery(query.slice(0, -1)); }
    else if (code === 404) { event.preventDefault(); setTab('search'); }
    else if (code === 405) { event.preventDefault(); setTab('settings'); }
    else if (code === 406) { event.preventDefault(); refreshFavorites(); }
    else if (code === 403) { var slug = focusedSlug(); if (slug) { event.preventDefault(); toggleFavorite(slug); } }
    else if (tab === 'search' && !event.ctrlKey && !event.metaKey && !event.altKey && event.key && event.key.length === 1) { event.preventDefault(); updateQuery(query + event.key); }
  });

  document.addEventListener('focusin', function (event) {
    if (modalOpen) {
      if (!element('modal').contains(event.target)) { focus('modal-close'); }
      return;
    }
    if (playerOpen && !element('player').contains(event.target)) { focus('player-toggle'); }
    if (playerOpen) { showControls(); }
  });

  element('proxy-form').onsubmit = function (event) {
    event.preventDefault();
    var value = element('proxy-url').value.trim().replace(/\/$/, '');
    var anchor = document.createElement('a'); anchor.href = value;
    if (!/^https?:\/\//i.test(value) || !anchor.hostname || anchor.username || anchor.password || anchor.search || anchor.hash) { notice('Ingresar una URL HTTP o HTTPS del proxy, sin credenciales ni parametros.'); return; }
    proxyURL = value; hub.setBaseURL(value); saveStorage(proxyKey, value); refreshSequence++; refreshing = false; refreshFavorites(); notice('URL del proxy guardada.');
  };

  video.addEventListener('playing', function () {
    if (!playerOpen || !video.getAttribute('src')) { return; }
    playerState = 'playing'; show('player-message', false); element('player-toggle').setAttribute('aria-label', 'Pausar'); element('player-toggle').title = 'Pausar';
    element('player-toggle').innerHTML = '<span data-icon="pause">' + icon('pause') + '</span>'; showControls(); armWatchdog();
  });
  video.addEventListener('timeupdate', function () {
    if (!playerOpen || video.paused) { return; }
    text('player-resolution', video.videoWidth + 'x' + video.videoHeight);
    if (video.currentTime > lastVideoTime) { lastVideoTime = video.currentTime; armWatchdog(); }
    if (video.currentTime > 0) { hub.playback.confirmPlayback(); }
  });
  video.addEventListener('pause', function () {
    if (!playerOpen || !video.getAttribute('src')) { return; }
    playerState = 'paused'; clearWatchdog(); element('player-toggle').setAttribute('aria-label', 'Reproducir'); element('player-toggle').title = 'Reproducir';
    element('player-toggle').innerHTML = '<span data-icon="play">' + icon('play') + '</span>'; showControls();
  });
  video.addEventListener('waiting', function () {
    if (!playerOpen || !video.getAttribute('src')) { return; }
    playerState = 'loading'; text('player-message', 'Cargando video...'); show('player-message', true); showControls(); armWatchdog();
  });
  video.addEventListener('error', function () {
    if (!playerOpen || !video.error || !video.getAttribute('src')) { return; }
    var errors = { 1: 'Carga cancelada.', 2: 'Error de red o TLS. Reintentar para renovar la URL.', 3: 'Error de decodificacion. Elegir otra calidad.', 4: 'Formato o URL no soportados. Reintentar o elegir otra calidad.' };
    playerError('Error ' + video.error.code + ': ' + (errors[video.error.code] || 'No se pudo reproducir.'));
  });
  video.addEventListener('ended', function () { if (playerOpen) { playerError('La transmision finalizo. Reintentar para consultar el estado del canal.'); } });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playerOpen) { closePlayer(); }
    else if (!document.hidden) { refreshFavorites(); }
  });

  fillIcons(document);
  favorites = hub.favorites.list('kick').map(function (ref) { return ref.itemId; });
  var savedQuality = readStorage(qualityKey);
  if (savedQuality === 'auto' || /^[0-9]{3,4}$/.test(savedQuality || '')) { defaultQuality = savedQuality; }
  var config = window.KICK_TV_CONFIG || {};
  proxyURL = config.apiBaseUrl || readStorage(proxyKey) || proxyURL;
  text('default-quality-label', qualityLabel(defaultQuality));
  element('proxy-url').value = proxyURL;
  text('storage-info', storageOK ? 'Almacenamiento disponible' : 'Almacenamiento no disponible');
  text('device-info', /SMART-TV|SMARTTV|Tizen/i.test(navigator.userAgent) ? 'Samsung TV / reproductor HTML5' : 'Navegador / reproductor HTML5');
  var keys = 'qwertyuiopasdfghjkl_zxcvbnm-0123456789';
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    var key = button(keys.charAt(keyIndex).toUpperCase(), 'key');
    key.id = 'key-' + keyIndex; key.setAttribute('data-value', keys.charAt(keyIndex)); element('keyboard').appendChild(key);
  }
  if (window.tizen && window.tizen.tvinputdevice) {
    var special = ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop'];
    for (var specialIndex = 0; specialIndex < special.length; specialIndex++) {
      try { window.tizen.tvinputdevice.registerKey(special[specialIndex]); }
      catch (error) { }
    }
  }
  hub.bindKickUI({ activate: setKickTab, watch: openChannel, describe: function (slug) { return channels[slug] || null; } });
  hub.start(); refreshFavorites();
  window.setInterval(function () { if (!document.hidden) { refreshFavorites(); } }, 90000);
}());