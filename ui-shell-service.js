(function (global) {
  const FD = global.FD = global.FD || {};

  function setVisible(el, visible, display = 'block') {
    if (el) el.style.display = visible ? display : 'none';
  }

  function isVisible(el) {
    return Boolean(el && el.style.display !== 'none');
  }

  const BUILDING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><rect x="8" y="32" width="74" height="50" rx="5" fill="#e8f0fe" stroke="#1a73e8" stroke-width="2.5"/><rect x="18" y="44" width="16" height="16" rx="3" fill="#1a73e8" opacity="0.45"/><rect x="56" y="44" width="16" height="16" rx="3" fill="#1a73e8" opacity="0.45"/><rect x="37" y="50" width="16" height="32" rx="3" fill="#1a73e8" opacity="0.65"/><polygon points="45,6 6,32 84,32" fill="#1a73e8" opacity="0.75"/></svg>`;

  function createTopbarMenu({ toggleButtonEl, menuEl, documentEl = document }) {
    function show() {
      setVisible(menuEl, true);
    }

    function hide() {
      setVisible(menuEl, false);
    }

    function toggle() {
      setVisible(menuEl, !isVisible(menuEl));
    }

    function bind() {
      toggleButtonEl.addEventListener('click', (event) => {
        event.stopPropagation();
        toggle();
      });
      menuEl.addEventListener('click', (event) => event.stopPropagation());
      documentEl.addEventListener('click', hide);
    }

    return { bind, hide, show, toggle };
  }

  function createPopupPair({ overlayEl, popupEl, display = 'block' }) {
    function show() {
      setVisible(overlayEl, true, display);
      setVisible(popupEl, true, display);
    }

    function hide() {
      setVisible(overlayEl, false);
      setVisible(popupEl, false);
    }

    return { hide, show };
  }

  function createToastController(toastEl, { duration = 4000 } = {}) {
    let timer = null;

    function hide() {
      if (!toastEl) return;
      toastEl.style.display = 'none';
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function show(message, type) {
      if (!toastEl) return;
      if (timer) clearTimeout(timer);
      toastEl.textContent = message;
      toastEl.style.background = type === 'error' ? '#d93025' : '#34a853';
      toastEl.style.color = 'white';
      toastEl.style.display = 'block';
      timer = setTimeout(hide, duration);
    }

    if (toastEl) toastEl.addEventListener('click', hide);

    return { hide, show };
  }

  function renderEmptyState(targetEl, { subtitle, hint, title = 'Plattegrond Dashboard' }) {
    if (!targetEl) return;
    targetEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">${BUILDING_SVG}</div>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-sub">${subtitle}</div>
      ${hint ? `<div class="empty-state-hint">${hint}</div>` : ''}
    </div>`;
  }

  function renderLoadingState(targetEl) {
    if (!targetEl) return;
    targetEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon loading-scan-container">${BUILDING_SVG}<div class="loading-scan-line"></div></div>
      <div class="empty-state-title" style="color:#555; font-size:18px; font-weight:600;">Plattegrond laden</div>
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>`;
  }

  function updateViewportHeightProperty({ rootEl, visualViewport, fallbackHeight, property = '--app-height' }) {
    if (!rootEl?.style) return;
    const height = visualViewport ? visualViewport.height : fallbackHeight;
    rootEl.style.setProperty(property, Math.round(height) + 'px');
  }

  function updateTopbarHeightProperty({ rootEl, topbarEl, property = '--topbar-h' }) {
    if (!rootEl?.style || !topbarEl) return;
    rootEl.style.setProperty(property, topbarEl.offsetHeight + 'px');
  }

  function renderConnectionIndicator({ indicatorEl, labelEl, isOnline }) {
    if (indicatorEl) {
      indicatorEl.classList.toggle('offline', !isOnline);
      indicatorEl.title = isOnline ? 'Online' : 'Offline';
    }
    if (labelEl) labelEl.textContent = isOnline ? 'Online' : 'Offline';
  }

  function renderStatusSyncIndicator({ indicatorEl, labelEl, count }) {
    const safeCount = Number.isFinite(count) ? count : 0;
    if (indicatorEl) {
      indicatorEl.style.display = safeCount > 0 ? 'inline-flex' : 'none';
      indicatorEl.title = safeCount === 1 ? '1 statuswijziging wacht op sync' : safeCount + ' statuswijzigingen wachten op sync';
    }
    if (labelEl) labelEl.textContent = 'Sync ' + safeCount;
  }

  function setSidePanelOpen({ sidePanelEl, toggleButtonEl, appContainerEl, open }) {
    if (sidePanelEl) sidePanelEl.classList.toggle('open', open);
    if (toggleButtonEl) toggleButtonEl.classList.toggle('panel-open', open);
    if (appContainerEl) appContainerEl.classList.toggle('side-panel-open', open);
  }

  function updateLabelsButton(buttonEl, labelsVisible) {
    if (!buttonEl) return;
    buttonEl.textContent = labelsVisible ? 'Labels verbergen' : 'Labels tonen';
    buttonEl.classList.toggle('active', labelsVisible);
  }

  function updateUploadActionButtons({ deleteButtonEl, editImageButtonEl, floorplan }) {
    const isUpload = Boolean(floorplan && (floorplan.uploaded || floorplan.repo === 'uploads'));
    setVisible(deleteButtonEl, isUpload);
    setVisible(editImageButtonEl, isUpload);
    return isUpload;
  }

  FD.UIShellService = {
    createPopupPair,
    createToastController,
    createTopbarMenu,
    renderConnectionIndicator,
    renderEmptyState,
    renderLoadingState,
    renderStatusSyncIndicator,
    setVisible,
    setSidePanelOpen,
    updateLabelsButton,
    updateTopbarHeightProperty,
    updateUploadActionButtons,
    updateViewportHeightProperty,
  };
})(window);
