    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {
      customersUrl: 'https://api.github.com/repos/mlivvm/floorplan-dashboard-data/contents/customers.json',
      statusUrl: 'https://api.github.com/repos/mlivvm/floorplan-dashboard-data/contents/status.json',
      svgBaseUrl: 'https://api.github.com/repos/mlivvm/gallery/contents/',
      svgUploadsUrl: 'https://api.github.com/repos/mlivvm/floorplan-uploads/contents/',
      jotformBaseUrl: 'https://eu.jotform.com/',
      jotformFormId: '250122093908351',
      pollInterval: 30000,
    };

    const COLORS = {
      todo: '#1a73e8',
      done: '#34a853',
    };

    const OPACITY = {
      normal: '0.7',
      dimmed: '0.25',
      selected: '1.0',
    };

    // ============================================================
    // STATE
    // ============================================================

    let customers = [];
    let doorStatus = {};
    let currentCustomer = null;
    let currentFloorplan = null;
    let selectedDoor = null;
    let pollTimer = null;

    // Floorplan load generation counter (guards against race conditions)
    let loadGeneration = 0;
    let pendingDoor = null;

    // Pan & zoom
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let hasMoved = false;
    let startX = 0;
    let startY = 0;
    let lastPanX = 0;
    let lastPanY = 0;
    let initialPinchDist = 0;
    let initialScale = 1;
    let savedScale = 1;
    let savedPanX = 0;
    let savedPanY = 0;

    // ============================================================
    // DOM REFERENCES
    // ============================================================

    const customerSelect = document.getElementById('customer-select');
    const floorplanSelect = document.getElementById('floorplan-select');
    const svgContainer = document.getElementById('svg-container');
    const loadingEl = document.getElementById('loading');
    const infoPanel = document.getElementById('info-panel');
    const doorNameEl = document.getElementById('door-name');
    const doorStatusEl = document.getElementById('door-status');
    const btnJotform = document.getElementById('btn-jotform');
    const btnDone = document.getElementById('btn-done');
    const btnClose = document.getElementById('btn-close');
    const btnReset = document.getElementById('btn-reset');
    const statusCount = document.getElementById('status-count');
    const btnPanelToggle = document.getElementById('btn-panel-toggle');
    const sidePanel = document.getElementById('side-panel');
    const sidePanelList = document.getElementById('side-panel-list');
    const sidePanelHeader = document.getElementById('side-panel-header');

    // ============================================================
    // LAYOUT — measure topbar, handle resize/orientation
    // ============================================================

    function updateTopbarHeight() {
      const topbar = document.querySelector('.topbar');
      if (!topbar) return;
      const h = topbar.offsetHeight;
      document.documentElement.style.setProperty('--topbar-h', h + 'px');
    }

    function handleResize() {
      updateTopbarHeight();
      const svgEl = svgContainer.querySelector('svg');
      if (svgEl) {
        const vb = svgEl.viewBox.baseVal;
        if (vb.width && vb.height) {
          fitToScreen(vb.width, vb.height);
        }
      }
    }

    window.addEventListener('resize', handleResize);

    // Warn before closing with unsaved edit mode changes
    window.addEventListener('beforeunload', (e) => {
      if (isEditMode) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // ============================================================
    // TOAST NOTIFICATIONS
    // ============================================================

    const toastEl = document.getElementById('toast');
    let toastTimer = null;

    function showToast(message, type) {
      if (toastTimer) clearTimeout(toastTimer);
      toastEl.textContent = message;
      toastEl.style.background = type === 'error' ? '#d93025' : '#34a853';
      toastEl.style.color = 'white';
      toastEl.style.display = 'block';
      toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 4000);
    }

    toastEl.addEventListener('click', () => {
      toastEl.style.display = 'none';
      if (toastTimer) clearTimeout(toastTimer);
    });

    // ============================================================
    // DATA LOADING
    // ============================================================

    function getGitHubToken() {
      return sessionStorage.getItem('fd_github_token') || '';
    }

    function ghHeaders(accept) {
      return {
        'Authorization': 'token ' + getGitHubToken(),
        'Accept': accept || 'application/vnd.github.v3+json',
      };
    }

    function decodeBase64UTF8(base64) {
      const binary = atob(base64.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }

    async function fetchGitHubJSON(url) {
      const response = await fetch(url, { headers: ghHeaders(), cache: 'no-store' });
      if (!response.ok) throw new Error('GitHub fetch failed: ' + response.status);
      const data = await response.json();
      return JSON.parse(decodeBase64UTF8(data.content));
    }

    async function fetchGitHubSVG(fileUrl) {
      // Step 1: get file metadata (sha)
      const metaResp = await fetch(fileUrl, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!metaResp.ok) throw new Error('Bestand niet gevonden');
      const meta = await metaResp.json();

      // Step 2: fetch blob by SHA (works for any file size, stays on api.github.com)
      const repoMatch = fileUrl.match(/repos\/([^/]+\/[^/]+)\//);
      const repo = repoMatch ? repoMatch[1] : 'mlivvm/gallery';
      const blobUrl = `https://api.github.com/repos/${repo}/git/blobs/${meta.sha}`;
      const blobResp = await fetch(blobUrl, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!blobResp.ok) throw new Error('Kon blob niet laden');
      const blob = await blobResp.json();

      // Step 3: decode base64 to UTF-8 text
      return decodeBase64UTF8(blob.content);
    }

    async function loadCustomers() {
      try {
        customers = await fetchGitHubJSON(CONFIG.customersUrl);
        populateCustomerDropdown();
      } catch (err) {
        console.error('Kon klanten niet laden:', err);
        loadingEl.textContent = 'Fout bij laden van klantgegevens.';
      }
    }

    async function loadStatus() {
      try {
        doorStatus = await fetchGitHubJSON(CONFIG.statusUrl);
      } catch (err) {
        console.error('Kon status niet laden:', err);
        doorStatus = {};
      }
      updateStatusBar();
    }

    function populateCustomerDropdown() {
      customerSelect.innerHTML = '<option value="">-- Kies klant --</option>';
      customers.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = c.customer;
        customerSelect.appendChild(opt);
      });
    }

    function populateFloorplanDropdown(customerIndex) {
      const c = customers[customerIndex];
      floorplanSelect.innerHTML = '<option value="">-- Kies plattegrond --</option>';
      floorplanSelect.disabled = false;
      c.floorplans.forEach((fp, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = fp.name;
        floorplanSelect.appendChild(opt);
      });
    }

    // ============================================================
    // SVG LOADING & DOOR DETECTION
    // ============================================================

    async function loadFloorplan(customerIndex, floorplanIndex) {
      const c = customers[customerIndex];
      const fp = c.floorplans[floorplanIndex];
      currentCustomer = c.customer;
      currentFloorplan = fp.name;

      const thisGeneration = ++loadGeneration;

      loadingEl.textContent = 'Plattegrond laden...';
      loadingEl.classList.remove('hidden');
      svgContainer.style.display = 'none';
      btnReset.style.display = 'none';

      try {
        const baseUrl = fp.repo === 'uploads' ? CONFIG.svgUploadsUrl : CONFIG.svgBaseUrl;
        const svgUrl = baseUrl + encodeURIComponent(fp.file);
        const svgText = await fetchGitHubSVG(svgUrl);

        // Another floorplan was requested while we were loading — abort
        if (thisGeneration !== loadGeneration) return;

        svgContainer.innerHTML = svgText;
        const svgEl = svgContainer.querySelector('svg');
        if (!svgEl) throw new Error('Geen geldig SVG bestand.');

        // Show container so it has dimensions
        loadingEl.classList.add('hidden');
        svgContainer.style.display = 'block';
        btnReset.style.display = 'inline-block';

        await new Promise(r => requestAnimationFrame(r));

        // Set SVG to viewBox pixel dimensions
        const vb = svgEl.viewBox.baseVal;
        if (!vb.width || !vb.height) throw new Error('SVG heeft geen geldige viewBox.');
        svgEl.setAttribute('width', vb.width);
        svgEl.setAttribute('height', vb.height);
        svgEl.style.width = vb.width + 'px';
        svgEl.style.height = vb.height + 'px';

        // Find and style all door markers
        initDoorMarkers(svgEl);
        deselectDoor();
        updateStatusBar();
        infoPanel.style.display = 'flex';
        btnPanelToggle.style.display = 'block';
        btnEdit.style.display = 'inline-block';
        populateSidePanel();
        updateDeleteButton();
        startPolling();

        // Fit SVG after info panel is rendered so offsetHeight is accurate
        await new Promise(r => requestAnimationFrame(r));
        fitToScreen(vb.width, vb.height);

      } catch (err) {
        if (thisGeneration !== loadGeneration) return;
        svgContainer.style.display = 'none';
        svgContainer.innerHTML = '';
        loadingEl.classList.remove('hidden');
        loadingEl.textContent = 'Fout: ' + err.message;
      }
    }

    function getDoorId(el) {
      const id = el.getAttribute('id') || '';
      const label = el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label') || '';
      // Use label if id is generic
      if (/^(ellipse|circle)\d+$/i.test(id) && label) {
        return label;
      }
      return id || label;
    }

    function initDoorMarkers(svgEl) {
      const markers = svgEl.querySelectorAll('ellipse, circle');
      markers.forEach(marker => {
        const doorId = getDoorId(marker);
        if (!doorId) return;
        if (/^(defs|namedview|image)\d*$/i.test(doorId)) return;

        marker.dataset.doorId = doorId;

        const isDone = getDoorStatus(doorId);
        applyDoorColor(marker, isDone);

        marker.style.cursor = 'pointer';
        marker.style.pointerEvents = 'all';
        marker.style.transition = 'opacity 0.2s';

        // Track door target on pointerdown (read from dataset so renames are picked up)
        marker.addEventListener('pointerdown', (e) => {
          pendingDoor = e.currentTarget.dataset.doorId;
        });

        // Larger touch target, override any inline stroke styles
        marker.style.stroke = 'transparent';
        marker.style.strokeWidth = '20';
      });
    }

    function applyDoorColor(marker, isDone) {
      const isSelected = marker.dataset.doorId === selectedDoor;
      const hasSelection = selectedDoor !== null;

      if (isDone) {
        marker.style.fill = COLORS.done;
      } else {
        marker.style.fill = COLORS.todo;
      }

      if (isSelected) {
        marker.style.opacity = OPACITY.selected;
      } else if (hasSelection) {
        marker.style.opacity = OPACITY.dimmed;
      } else {
        marker.style.opacity = OPACITY.normal;
      }
    }

    function getDoorStatus(doorId) {
      if (!currentCustomer || !currentFloorplan) return false;
      const cs = doorStatus[currentCustomer];
      if (!cs) return false;
      const fps = cs[currentFloorplan];
      if (!fps) return false;
      return fps[doorId] === 'done';
    }

    function refreshAllDoorColors() {
      const markers = svgContainer.querySelectorAll('[data-door-id]');
      markers.forEach(marker => {
        applyDoorColor(marker, getDoorStatus(marker.dataset.doorId));
      });
      updateStatusBar();
      refreshSidePanel();
    }

    // ============================================================
    // DOOR SELECTION
    // ============================================================

    function selectDoor(doorId) {
      // If same door clicked again, deselect
      if (selectedDoor === doorId) {
        deselectDoor();
        return;
      }

      selectedDoor = doorId;

      // Update all markers (dim non-selected, highlight selected)
      refreshAllDoorColors();

      // Show door info
      const isDone = getDoorStatus(doorId);
      doorNameEl.textContent = doorId;
      doorStatusEl.textContent = isDone ? '(afgerond)' : '(nog te doen)';
      doorStatusEl.style.color = isDone ? COLORS.done : COLORS.todo;
      btnJotform.classList.remove('disabled');
      btnClose.classList.remove('disabled');
      updateDoneButton();

      // Scroll side panel to selected door
      const panelItem = sidePanelList.querySelector(`.side-panel-item[data-door-id="${doorId}"]`);
      if (panelItem) {
        panelItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function deselectDoor() {
      selectedDoor = null;
      refreshAllDoorColors();
      doorNameEl.textContent = '—';
      doorStatusEl.textContent = '';
      btnJotform.classList.add('disabled');
      btnClose.classList.add('disabled');
      updateDoneButton();
    }

    // ============================================================
    // JOTFORM LINK
    // ============================================================

    function openJotForm() {
      if (!selectedDoor) return;

      const params = new URLSearchParams();
      params.set('klant', currentCustomer);       // ID 82: Klant - Locatie
      params.set('deurNummer', selectedDoor);      // ID 3: Deur nummer

      const url = `${CONFIG.jotformBaseUrl}${CONFIG.jotformFormId}?${params.toString()}`;
      window.open(url, '_blank');
    }

    // ============================================================
    // EDIT MODE
    // ============================================================

    let isEditMode = false;
    let editChanges = []; // track changes for undo on cancel
    let editMarkerSize = 15;
    let qrScanner = null;

    const topbar = document.querySelector('.topbar');
    const editBar = document.getElementById('edit-bar');
    const btnEdit = document.getElementById('btn-edit');
    const editPopup = document.getElementById('edit-popup');
    const editOverlay = document.getElementById('edit-overlay');
    const editPopupTitle = document.getElementById('edit-popup-title');
    const editPopupInput = document.getElementById('edit-popup-input');
    const editPopupButtons = document.getElementById('edit-popup-buttons');

    function getSliderRange() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return { max: 30, def: 15 };
      const vb = svgEl.viewBox.baseVal;
      const shortest = Math.min(vb.width || 1000, vb.height || 1000);
      const max = Math.max(20, Math.min(150, Math.round(shortest * 0.03)));
      const def = Math.round(max / 3);
      return { max, def };
    }

    function enterEditMode() {
      if (!currentFloorplan) return;
      isEditMode = true;
      editChanges = [];
      topbar.classList.add('edit-mode');
      editBar.style.display = 'flex';
      infoPanel.style.display = 'none';
      deselectDoor();
      // Reset save button and slider state
      document.getElementById('btn-edit-save').disabled = false;
      document.getElementById('btn-edit-save').textContent = 'Opslaan';
      const range = getSliderRange();
      const slider = document.getElementById('edit-marker-size');
      slider.max = range.max;
      slider.value = range.def;
      editMarkerSize = range.def;
      document.getElementById('edit-size-label').textContent = range.def;
      // Hide normal UI, disable dropdowns
      btnEdit.style.display = 'none';
      btnReset.style.display = 'none';
      customerSelect.disabled = true;
      floorplanSelect.disabled = true;
    }

    function exitEditMode() {
      if (resizingMarker) applyResize();
      isEditMode = false;
      topbar.classList.remove('edit-mode');
      editBar.style.display = 'none';
      infoPanel.style.display = 'flex';
      btnEdit.style.display = 'inline-block';
      btnReset.style.display = 'inline-block';
      customerSelect.disabled = false;
      floorplanSelect.disabled = false;
      closeEditPopup();
    }

    function cancelEditMode() {
      // Cancel any active resize
      if (resizingMarker) cancelResize();
      // Revert all changes
      editChanges.reverse().forEach(change => {
        if (change.type === 'add') {
          // Remove added marker
          const marker = svgContainer.querySelector(`[data-door-id="${change.doorId}"]`);
          if (marker) marker.remove();
        } else if (change.type === 'delete') {
          // Re-add deleted marker
          const svgEl = svgContainer.querySelector('svg');
          svgEl.appendChild(change.element);
          initSingleMarker(change.element, change.doorId);
        } else if (change.type === 'rename') {
          // Restore old ID
          const marker = svgContainer.querySelector(`[data-door-id="${change.newId}"]`);
          if (marker) {
            marker.setAttribute('id', change.oldId);
            marker.setAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label', change.oldId);
            marker.dataset.doorId = change.oldId;
          }
        } else if (change.type === 'resize') {
          const marker = svgContainer.querySelector(`[data-door-id="${change.doorId}"]`);
          if (marker) {
            marker.setAttribute('rx', change.oldRx.toString());
            marker.setAttribute('ry', change.oldRx.toString());
          }
        }
      });
      exitEditMode();
      populateSidePanel();
    }

    async function saveEditMode() {
      // Finish any active resize first
      if (resizingMarker) applyResize();

      if (editChanges.length === 0) {
        exitEditMode();
        return;
      }

      // Serialize a clean clone (keep original intact in case save fails)
      const svgEl = svgContainer.querySelector('svg');
      const svgClone = svgEl.cloneNode(true);
      const cloneMarkers = svgClone.querySelectorAll('[data-door-id]');
      cloneMarkers.forEach(m => {
        m.style.fill = '';
        m.style.opacity = '';
        m.style.cursor = '';
        m.style.pointerEvents = '';
        m.style.transition = '';
        m.style.stroke = '';
        m.style.strokeWidth = '';
        m.style.filter = '';
        m.removeAttribute('data-door-id');
      });

      const svgText = new XMLSerializer().serializeToString(svgClone);

      // Upload to GitHub
      const btnSave = document.getElementById('btn-edit-save');
      btnSave.textContent = 'Opslaan...';
      btnSave.disabled = true;

      try {
        const fp = customers[parseInt(customerSelect.value, 10)].floorplans[parseInt(floorplanSelect.value, 10)];
        const editBaseUrl = fp.repo === 'uploads' ? CONFIG.svgUploadsUrl : CONFIG.svgBaseUrl;
        const fileUrl = editBaseUrl + encodeURIComponent(fp.file);

        // Get current SHA
        const metaResp = await fetch(fileUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!metaResp.ok) throw new Error('Kon bestand niet ophalen');
        const meta = await metaResp.json();

        // Upload updated SVG
        const content = btoa(unescape(encodeURIComponent(svgText)));
        const updateResp = await fetch(fileUrl, {
          method: 'PUT',
          headers: ghHeaders(),
          body: JSON.stringify({
            message: 'Markers bijgewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
            content: content,
            sha: meta.sha,
          }),
        });
        if (!updateResp.ok) throw new Error('Kon niet opslaan');

        exitEditMode();
        showToast('Opgeslagen', 'success');
        // Reload to get clean state
        loadFloorplan(parseInt(customerSelect.value, 10), parseInt(floorplanSelect.value, 10));

      } catch (err) {
        showToast('Opslaan mislukt: ' + err.message, 'error');
        btnSave.textContent = 'Opslaan';
        btnSave.disabled = false;
      }
    }

    const editPopupInputRow = document.getElementById('edit-popup-input-row');
    const editPopupError = document.getElementById('edit-popup-error');
    const btnScanQr = document.getElementById('btn-scan-qr');

    function showEditPopup(title, defaultValue, buttons) {
      editPopupTitle.textContent = title;
      editPopupError.textContent = '';
      editPopupButtons.innerHTML = '';
      const primaryAction = buttons.length > 0 ? buttons[0].action : null;
      buttons.forEach(btn => {
        const el = document.createElement('button');
        el.textContent = btn.text;
        el.style.background = btn.color || '#1a73e8';
        el.style.color = btn.textColor || 'white';
        el.addEventListener('click', btn.action);
        editPopupButtons.appendChild(el);
      });
      editPopup.style.display = 'block';
      editOverlay.style.display = 'block';
      if (defaultValue === null) {
        editPopupInputRow.style.display = 'none';
      } else {
        editPopupInputRow.style.display = 'flex';
        editPopupInput.value = defaultValue || '';
        editPopupInput.focus();
      }
      editPopupInput.onkeydown = (e) => {
        if (e.key === 'Enter' && primaryAction) primaryAction();
      };
    }

    function closeEditPopup() {
      editPopup.style.display = 'none';
      editOverlay.style.display = 'none';
      if (qrScanner) stopQrScanner();
    }

    function initSingleMarker(marker, doorId) {
      marker.dataset.doorId = doorId;
      const isDone = getDoorStatus(doorId);
      applyDoorColor(marker, isDone);
      marker.style.cursor = 'pointer';
      marker.style.pointerEvents = 'all';
      marker.style.transition = 'opacity 0.2s';
      marker.style.stroke = 'transparent';
      marker.style.strokeWidth = '20';
      marker.addEventListener('pointerdown', (e) => { pendingDoor = e.currentTarget.dataset.doorId; });
    }

    function addMarkerAtPosition(svgX, svgY, doorId) {
      const svgEl = svgContainer.querySelector('svg');
      const ns = 'http://www.w3.org/2000/svg';
      const inkNs = 'http://www.inkscape.org/namespaces/inkscape';

      const ellipse = document.createElementNS(ns, 'ellipse');
      ellipse.setAttribute('id', doorId);
      ellipse.setAttributeNS(inkNs, 'inkscape:label', doorId);
      ellipse.setAttribute('cx', Math.round(svgX));
      ellipse.setAttribute('cy', Math.round(svgY));
      ellipse.setAttribute('rx', editMarkerSize.toString());
      ellipse.setAttribute('ry', editMarkerSize.toString());
      ellipse.style.fill = '#1a73e8';
      ellipse.style.opacity = '0.7';

      svgEl.appendChild(ellipse);
      initSingleMarker(ellipse, doorId);

      editChanges.push({ type: 'add', doorId: doorId });
      populateSidePanel();
    }

    function deleteMarker(doorId) {
      const marker = svgContainer.querySelector(`[data-door-id="${doorId}"]`);
      if (!marker) return;
      editChanges.push({ type: 'delete', doorId: doorId, element: marker });
      marker.remove();
      deselectDoor();
      populateSidePanel();
    }

    function renameMarker(doorId, newId) {
      const marker = svgContainer.querySelector(`[data-door-id="${doorId}"]`);
      if (!marker) return;
      marker.setAttribute('id', newId);
      marker.setAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label', newId);
      marker.dataset.doorId = newId;
      editChanges.push({ type: 'rename', oldId: doorId, newId: newId });
      populateSidePanel();
    }

    let resizingMarker = null;
    let resizingOldRx = null;

    function startResizeMode(marker, doorId, currentRx) {
      resizingMarker = { marker, doorId };
      resizingOldRx = currentRx;

      // Set slider to current size, expand max if needed
      const slider = document.getElementById('edit-marker-size');
      const range = getSliderRange();
      slider.max = Math.max(range.max, Math.ceil(currentRx));
      slider.value = Math.round(currentRx);
      editMarkerSize = Math.round(currentRx);
      document.getElementById('edit-size-label').textContent = Math.round(currentRx);

      // Highlight the marker with uniform glow
      marker.style.opacity = '1';
      marker.style.filter = 'drop-shadow(0 0 4px #e67700) drop-shadow(0 0 2px #e67700)';

      // Change edit bar label
      document.querySelector('.edit-label').textContent = doorId;
    }

    function clearResizeHighlight(marker) {
      marker.style.stroke = 'transparent';
      marker.style.strokeWidth = '20';
      marker.style.filter = '';
    }

    function applyResize() {
      if (!resizingMarker) return;
      editChanges.push({ type: 'resize', doorId: resizingMarker.doorId, oldRx: resizingOldRx });
      clearResizeHighlight(resizingMarker.marker);
      resizingMarker = null;
      resizingOldRx = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
    }

    function cancelResize() {
      if (!resizingMarker) return;
      resizingMarker.marker.setAttribute('rx', resizingOldRx.toString());
      resizingMarker.marker.setAttribute('ry', resizingOldRx.toString());
      clearResizeHighlight(resizingMarker.marker);
      resizingMarker = null;
      resizingOldRx = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
    }

    function handleEditTapOnEmpty(e) {
      if (!isEditMode) return;
      if (resizingMarker) { applyResize(); return; }
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;

      // Convert screen coordinates to SVG coordinates
      const containerRect = svgContainer.getBoundingClientRect();
      const screenX = e.clientX - containerRect.left;
      const screenY = e.clientY - containerRect.top;
      const svgX = (screenX - panX) / scale;
      const svgY = (screenY - panY) / scale;

      // Check if tap is within SVG viewBox bounds
      const vb = svgEl.viewBox.baseVal;
      if (svgX < 0 || svgY < 0 || svgX > vb.width || svgY > vb.height) return;

      showEditPopup('Nieuwe deur', '', [
        {
          text: 'Toevoegen', color: '#34a853',
          action: () => {
            const code = editPopupInput.value.trim().toUpperCase();
            if (!code) return;
            // Check for duplicate
            if (svgContainer.querySelector(`[data-door-id="${code}"]`)) {
              editPopupError.textContent = 'Deze code bestaat al op deze plattegrond.';
              return;
            }
            addMarkerAtPosition(svgX, svgY, code);
            closeEditPopup();
          }
        },
        { text: 'Annuleren', color: '#e0e0e0', textColor: '#333', action: closeEditPopup }
      ]);
    }

    function handleEditTapOnDoor(doorId) {
      if (!isEditMode) return;
      if (resizingMarker) { applyResize(); return; }
      const marker = svgContainer.querySelector(`[data-door-id="${doorId}"]`);
      showEditPopup('Deur: ' + doorId, null, [
        {
          text: 'Grootte aanpassen', color: '#e67700',
          action: () => {
            closeEditPopup();
            const currentRx = parseFloat(marker.getAttribute('rx')) || 10;
            startResizeMode(marker, doorId, currentRx);
          }
        },
        {
          text: 'Code wijzigen', color: '#1a73e8',
          action: () => {
            closeEditPopup();
            showEditPopup('Code wijzigen', doorId, [
              {
                text: 'Opslaan', color: '#34a853',
                action: () => {
                  const newCode = editPopupInput.value.trim().toUpperCase();
                  if (!newCode) return;
                  if (newCode === doorId) { closeEditPopup(); return; }
                  if (svgContainer.querySelector(`[data-door-id="${newCode}"]`)) {
                    editPopupError.textContent = 'Deze code bestaat al op deze plattegrond.';
                    return;
                  }
                  renameMarker(doorId, newCode);
                  closeEditPopup();
                }
              },
              { text: 'Annuleren', color: '#e0e0e0', textColor: '#333', action: closeEditPopup }
            ]);
          }
        },
        {
          text: 'Verwijderen', color: '#d93025',
          action: () => {
            closeEditPopup();
            showEditPopup('Weet je zeker dat je deur ' + doorId + ' wilt verwijderen?', null, [
              { text: 'Ja, verwijderen', color: '#d93025', action: () => { deleteMarker(doorId); closeEditPopup(); } },
              { text: 'Nee', color: '#e0e0e0', textColor: '#333', action: closeEditPopup }
            ]);
          }
        },
        { text: 'Sluiten', color: '#e0e0e0', textColor: '#333', action: closeEditPopup }
      ]);
    }

    // ============================================================
    // DOOR STATUS UPDATE
    // ============================================================

    async function saveStatusToGitHub() {
      // Get current file SHA (needed for update)
      const metaResp = await fetch(CONFIG.statusUrl, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!metaResp.ok) throw new Error('Kon status.json niet ophalen');
      const meta = await metaResp.json();

      // Encode updated status as base64
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(doorStatus, null, 2))));

      // Update file on GitHub
      const updateResp = await fetch(CONFIG.statusUrl, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
          message: 'Status update: ' + currentCustomer,
          content: content,
          sha: meta.sha,
        }),
      });
      if (!updateResp.ok) throw new Error('Kon status niet opslaan');
    }

    async function toggleDoorStatus() {
      if (!selectedDoor || !currentCustomer || !currentFloorplan) return;

      const isDone = getDoorStatus(selectedDoor);
      const newStatus = isDone ? 'todo' : 'done';

      // Update local state
      if (!doorStatus[currentCustomer]) doorStatus[currentCustomer] = {};
      if (!doorStatus[currentCustomer][currentFloorplan]) doorStatus[currentCustomer][currentFloorplan] = {};

      if (newStatus === 'done') {
        doorStatus[currentCustomer][currentFloorplan][selectedDoor] = 'done';
      } else {
        delete doorStatus[currentCustomer][currentFloorplan][selectedDoor];
      }

      // Update UI immediately
      refreshAllDoorColors();
      updateDoneButton();

      // Save to GitHub in background
      try {
        await saveStatusToGitHub();
        showToast(newStatus === 'done' ? 'Deur afgerond' : 'Deur teruggezet', 'success');
      } catch (err) {
        console.error('Opslaan mislukt:', err);
        showToast('Status kon niet worden opgeslagen. Controleer je internetverbinding.', 'error');
        // Revert local state
        if (newStatus === 'done') {
          delete doorStatus[currentCustomer][currentFloorplan][selectedDoor];
        } else {
          doorStatus[currentCustomer][currentFloorplan][selectedDoor] = 'done';
        }
        refreshAllDoorColors();
        updateDoneButton();
      }
    }

    function updateDoneButton() {
      if (!selectedDoor) {
        btnDone.classList.add('disabled');
        btnDone.textContent = 'Gedaan';
        btnDone.className = 'btn btn-done disabled';
        return;
      }
      const isDone = getDoorStatus(selectedDoor);
      btnDone.classList.remove('disabled');
      if (isDone) {
        btnDone.textContent = 'Terugzetten';
        btnDone.className = 'btn btn-undo';
      } else {
        btnDone.textContent = 'Gedaan';
        btnDone.className = 'btn btn-done';
      }
    }

    // ============================================================
    // PAN & ZOOM
    // ============================================================

    function fitToScreen(svgWidth, svgHeight) {
      const containerRect = svgContainer.getBoundingClientRect();
      // Account for info panel overlay by measuring actual height (0 when hidden)
      const infoPanelHeight = infoPanel.offsetHeight;
      const availableWidth = containerRect.width;
      const availableHeight = containerRect.height - infoPanelHeight;
      const scaleX = availableWidth / svgWidth;
      const scaleY = availableHeight / svgHeight;
      scale = Math.min(scaleX, scaleY) * 0.92;
      panX = (availableWidth - svgWidth * scale) / 2;
      panY = infoPanelHeight + (availableHeight - svgHeight * scale) / 2;
      // Save initial view for reset
      savedScale = scale;
      savedPanX = panX;
      savedPanY = panY;
      applyTransform();
    }

    function resetZoom() {
      const svgEl = svgContainer.querySelector('svg');
      if (svgEl) {
        const vb = svgEl.viewBox.baseVal;
        if (vb.width && vb.height) {
          fitToScreen(vb.width, vb.height);
          return;
        }
      }
      scale = savedScale;
      panX = savedPanX;
      panY = savedPanY;
      applyTransform();
    }

    function applyTransform() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;
      svgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    }

    function getTouchDist(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(touches) {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    }

    // Pan via pointer events
    svgContainer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      isPanning = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      lastPanX = panX;
      lastPanY = panY;
      svgContainer.setPointerCapture(e.pointerId);
    });

    svgContainer.addEventListener('pointermove', (e) => {
      if (!isPanning) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Only start panning after moving more than 5px (prevents accidental pan on tap)
      if (!hasMoved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      hasMoved = true;
      panX = lastPanX + dx;
      panY = lastPanY + dy;
      applyTransform();
    });

    let wasMultiTouch = false;
    let multiTouchTimer = null;

    svgContainer.addEventListener('pointerup', (e) => {
      isPanning = false;
      if (wasMultiTouch) {
        pendingDoor = null;
        return;
      }
      if (!hasMoved && pendingDoor) {
        if (isEditMode) {
          handleEditTapOnDoor(pendingDoor);
        } else {
          selectDoor(pendingDoor);
        }
      } else if (!hasMoved && !pendingDoor && isEditMode) {
        handleEditTapOnEmpty(e);
      }
      pendingDoor = null;
    });

    // Pinch-to-zoom
    svgContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        isPanning = false;
        wasMultiTouch = true;
        if (multiTouchTimer) { clearTimeout(multiTouchTimer); multiTouchTimer = null; }
        initialPinchDist = getTouchDist(e.touches);
        initialScale = scale;
      }
    }, { passive: false });

    svgContainer.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches);
        const center = getTouchCenter(e.touches);
        const containerRect = svgContainer.getBoundingClientRect();

        const newScale = initialScale * (dist / initialPinchDist);
        const clampedScale = Math.max(0.02, Math.min(10, newScale));

        const cx = center.x - containerRect.left;
        const cy = center.y - containerRect.top;
        panX = cx - (cx - panX) * (clampedScale / scale);
        panY = cy - (cy - panY) * (clampedScale / scale);
        scale = clampedScale;

        applyTransform();
      }
    }, { passive: false });

    svgContainer.addEventListener('touchend', (e) => {
      if (e.touches.length === 0 && wasMultiTouch) {
        if (multiTouchTimer) clearTimeout(multiTouchTimer);
        multiTouchTimer = setTimeout(() => { wasMultiTouch = false; }, 400);
      }
    });

    // Mouse wheel zoom
    svgContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const containerRect = svgContainer.getBoundingClientRect();
      const cx = e.clientX - containerRect.left;
      const cy = e.clientY - containerRect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.02, Math.min(10, scale * zoomFactor));

      panX = cx - (cx - panX) * (newScale / scale);
      panY = cy - (cy - panY) * (newScale / scale);
      scale = newScale;

      applyTransform();
    }, { passive: false });

    // ============================================================
    // STATUS POLLING
    // ============================================================

    async function pollStatus() {
      if (!currentFloorplan || isEditMode) return;
      try {
        doorStatus = await fetchGitHubJSON(CONFIG.statusUrl);
        refreshAllDoorColors();
      } catch (err) {
        console.error('Sync fout:', err);
      }
    }

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollStatus, CONFIG.pollInterval);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function updateStatusBar() {
      const markers = svgContainer.querySelectorAll('[data-door-id]');
      if (markers.length === 0) {
        statusCount.textContent = '';
        return;
      }
      let done = 0;
      markers.forEach(m => {
        if (getDoorStatus(m.dataset.doorId)) done++;
      });
      statusCount.textContent = `${done} / ${markers.length} deuren afgerond`;
    }

    // ============================================================
    // SIDE PANEL
    // ============================================================

    function toggleSidePanel() {
      sidePanel.classList.toggle('open');
      btnPanelToggle.classList.toggle('panel-open');
    }

    function populateSidePanel() {
      sidePanelList.innerHTML = '';
      const markers = svgContainer.querySelectorAll('[data-door-id]');
      // Sort alphabetically
      const doorIds = Array.from(markers).map(m => m.dataset.doorId).sort();

      doorIds.forEach(doorId => {
        const item = document.createElement('div');
        item.className = 'side-panel-item';
        item.dataset.doorId = doorId;

        const dot = document.createElement('span');
        dot.className = 'side-panel-dot';
        const isDone = getDoorStatus(doorId);
        dot.style.background = isDone ? COLORS.done : COLORS.todo;

        const label = document.createElement('span');
        label.textContent = doorId;

        item.appendChild(dot);
        item.appendChild(label);

        item.addEventListener('click', () => selectDoor(doorId));

        sidePanelList.appendChild(item);
      });

      sidePanelHeader.textContent = `Deuren (${doorIds.length})`;
    }

    function refreshSidePanel() {
      const items = sidePanelList.querySelectorAll('.side-panel-item');
      items.forEach(item => {
        const doorId = item.dataset.doorId;
        const isDone = getDoorStatus(doorId);
        const dot = item.querySelector('.side-panel-dot');
        dot.style.background = isDone ? COLORS.done : COLORS.todo;

        if (doorId === selectedDoor) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
    }

    // ============================================================
    // UPLOAD FLOORPLAN
    // ============================================================

    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    let uploadImageDataUrl = null;
    let uploadImageWidth = 0;
    let uploadImageHeight = 0;

    const uploadOverlay = document.getElementById('upload-overlay');
    const uploadPopup = document.getElementById('upload-popup');
    const uploadStepChoose = document.getElementById('upload-step-choose');
    const uploadStepPreview = document.getElementById('upload-step-preview');
    const uploadStepForm = document.getElementById('upload-step-form');
    const uploadPreviewImg = document.getElementById('upload-preview-img');
    const uploadPdfInput = document.getElementById('upload-pdf-input');
    const uploadPhotoInput = document.getElementById('upload-photo-input');
    const uploadCustomerSelect = document.getElementById('upload-customer-select');
    const uploadNewCustomer = document.getElementById('upload-new-customer');
    const uploadFloorplanName = document.getElementById('upload-floorplan-name');
    const uploadError = document.getElementById('upload-error');

    function showUploadPopup() {
      if (isEditMode) { showToast('Sluit eerst de bewerkingsmodus', 'error'); return; }
      topbarMenu.style.display = 'none';
      uploadImageDataUrl = null;
      uploadStepChoose.style.display = 'block';
      uploadStepPreview.style.display = 'none';
      uploadStepForm.style.display = 'none';
      uploadError.textContent = '';
      uploadOverlay.style.display = 'block';
      uploadPopup.style.display = 'block';
    }

    let uploadSaving = false;

    function hideUploadPopup() {
      if (uploadSaving) return;
      uploadOverlay.style.display = 'none';
      uploadPopup.style.display = 'none';
      uploadPdfInput.value = '';
      uploadPhotoInput.value = '';
      uploadImageDataUrl = null;
      uploadImageWidth = 0;
      uploadImageHeight = 0;
      uploadPreviewImg.src = '';
    }

    function showUploadPreview(dataUrl, width, height) {
      uploadImageDataUrl = dataUrl;
      uploadImageWidth = width;
      uploadImageHeight = height;
      uploadPreviewImg.src = dataUrl;
      uploadStepChoose.style.display = 'none';
      uploadStepPreview.style.display = 'block';
    }

    function showUploadForm() {
      uploadCustomerSelect.innerHTML = '<option value="">-- Kies klant --</option>';
      const newOpt = document.createElement('option');
      newOpt.value = '__new__';
      newOpt.textContent = '➕ Nieuwe klant toevoegen';
      uploadCustomerSelect.appendChild(newOpt);
      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '──────────────────';
      uploadCustomerSelect.appendChild(sep);
      customers.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = c.customer;
        uploadCustomerSelect.appendChild(opt);
      });

      uploadNewCustomer.style.display = 'none';
      uploadNewCustomer.value = '';
      uploadFloorplanName.value = '';
      uploadError.textContent = '';

      uploadStepPreview.style.display = 'none';
      uploadStepForm.style.display = 'block';
    }

    function resizeImageToCanvas(img, maxSize) {
      const canvas = document.createElement('canvas');
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      if (w > maxSize || h > maxSize) {
        if (w > h) {
          h = Math.round(h * maxSize / w);
          w = maxSize;
        } else {
          w = Math.round(w * maxSize / h);
          h = maxSize;
        }
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      return { canvas, width: w, height: h };
    }

    // Photo handling
    uploadPhotoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        const result = resizeImageToCanvas(img, 2000);
        const dataUrl = result.canvas.toDataURL('image/jpeg', 0.8);
        showUploadPreview(dataUrl, result.width, result.height);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });

    // PDF handling
    uploadPdfInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!window.pdfjsLib) {
        showToast('PDF library niet geladen. Gebruik een foto.', 'error');
        return;
      }
      // Show loading state
      uploadStepChoose.style.display = 'none';
      uploadStepPreview.style.display = 'block';
      uploadPreviewImg.style.display = 'none';
      document.querySelector('#upload-step-preview h3').textContent = 'PDF verwerken...';
      document.querySelector('#upload-step-preview .upload-btn-grey').style.display = 'none';
      document.querySelector('#upload-step-preview .upload-btn-green').style.display = 'none';
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        uploadPreviewImg.style.display = '';
        document.querySelector('#upload-step-preview h3').textContent = 'Voorbeeld';
        document.querySelector('#upload-step-preview .upload-btn-grey').style.display = '';
        document.querySelector('#upload-step-preview .upload-btn-green').style.display = '';
        showUploadPreview(dataUrl, viewport.width, viewport.height);
      } catch (err) {
        uploadStepPreview.style.display = 'none';
        uploadStepChoose.style.display = 'block';
        showToast('PDF kon niet worden geladen', 'error');
      }
    });

    // Upload customer select
    uploadCustomerSelect.addEventListener('change', () => {
      uploadNewCustomer.style.display = uploadCustomerSelect.value === '__new__' ? 'block' : 'none';
    });

    function sanitizeFilename(name) {
      const slug = name.toLowerCase()
        .replace(/[^a-z0-9\-_ ]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60);
      const ts = Date.now();
      return slug ? ts + '-' + slug : String(ts);
    }

    async function saveUpload() {
      const customerIdx = uploadCustomerSelect.value;
      let customerName;
      let isNewCustomer = false;

      if (customerIdx === '') {
        uploadError.textContent = 'Kies een klant.';
        return;
      } else if (customerIdx === '__new__') {
        customerName = uploadNewCustomer.value.trim();
        if (!customerName) {
          uploadError.textContent = 'Vul een klantnaam in.';
          return;
        }
        const existingMatch = customers.find(c => c.customer.toLowerCase() === customerName.toLowerCase());
        if (existingMatch) {
          uploadError.textContent = 'Deze klant bestaat al. Selecteer "' + existingMatch.customer + '" uit de lijst.';
          return;
        }
        isNewCustomer = true;
      } else {
        customerName = customers[parseInt(customerIdx, 10)].customer;
      }

      const floorplanName = uploadFloorplanName.value.trim();
      if (!floorplanName) {
        uploadError.textContent = 'Vul een naam in voor de plattegrond.';
        return;
      }

      // Check for duplicate floorplan name
      if (!isNewCustomer) {
        const ci = parseInt(customerIdx, 10);
        const existing = customers[ci].floorplans.find(f => f.name === floorplanName);
        if (existing) {
          uploadError.textContent = 'Deze plattegrondnaam bestaat al bij deze klant.';
          return;
        }
      }

      const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${uploadImageWidth} ${uploadImageHeight}">\n  <image href="${uploadImageDataUrl}" width="${uploadImageWidth}" height="${uploadImageHeight}"/>\n</svg>`;

      const fileName = sanitizeFilename(customerName + ' ' + floorplanName) + '.svg';

      const btnSave = document.getElementById('btn-upload-save');
      btnSave.textContent = 'Opslaan...';
      btnSave.disabled = true;
      uploadSaving = true;
      uploadError.textContent = '';

      try {
        // Step 1: Upload SVG to floorplan-uploads repo
        const svgContent = btoa(unescape(encodeURIComponent(svgText)));
        const uploadUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fileName);

        // Check if file already exists
        let sha = null;
        try {
          const existResp = await fetch(uploadUrl, { headers: ghHeaders(), cache: 'no-store' });
          if (existResp.ok) {
            const existData = await existResp.json();
            sha = existData.sha;
          }
        } catch (e) {}

        const uploadBody = {
          message: 'Upload: ' + customerName + ' - ' + floorplanName,
          content: svgContent,
        };
        if (sha) uploadBody.sha = sha;

        const uploadResp = await fetch(uploadUrl, {
          method: 'PUT',
          headers: ghHeaders(),
          cache: 'no-store',
          body: JSON.stringify(uploadBody),
        });
        if (!uploadResp.ok) throw new Error('SVG upload mislukt');

        // Step 2: Update customers.json
        const customersResp = await fetch(CONFIG.customersUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!customersResp.ok) throw new Error('Kon customers.json niet ophalen');
        const customersMeta = await customersResp.json();
        const currentCustomers = JSON.parse(decodeBase64UTF8(customersMeta.content));

        const newEntry = { name: floorplanName, file: fileName, repo: 'uploads', uploaded: true };

        if (isNewCustomer) {
          currentCustomers.push({ customer: customerName, floorplans: [newEntry] });
        } else {
          const freshCi = currentCustomers.findIndex(c => c.customer === customerName);
          if (freshCi < 0) throw new Error('Klant niet gevonden in customers.json');
          currentCustomers[freshCi].floorplans.push(newEntry);
        }

        const customersContent = btoa(unescape(encodeURIComponent(JSON.stringify(currentCustomers, null, 2))));
        const customersUpdateResp = await fetch(CONFIG.customersUrl, {
          method: 'PUT',
          headers: ghHeaders(),
          cache: 'no-store',
          body: JSON.stringify({
            message: 'Plattegrond toegevoegd: ' + customerName + ' - ' + floorplanName,
            content: customersContent,
            sha: customersMeta.sha,
          }),
        });
        if (!customersUpdateResp.ok) throw new Error('Kon customers.json niet bijwerken');

        // Reload and select new floorplan
        customers = currentCustomers;
        populateCustomerDropdown();
        uploadSaving = false;
        hideUploadPopup();
        showToast('Plattegrond toegevoegd', 'success');

        const newCi = currentCustomers.findIndex(c => c.customer === customerName);
        if (newCi >= 0) {
          customerSelect.value = newCi;
          populateFloorplanDropdown(newCi);
          const newFi = currentCustomers[newCi].floorplans.length - 1;
          floorplanSelect.value = newFi;
          loadFloorplan(newCi, newFi);
        }

      } catch (err) {
        uploadError.textContent = 'Fout: ' + err.message;
      } finally {
        btnSave.textContent = 'Opslaan';
        btnSave.disabled = false;
        uploadSaving = false;
      }
    }

    // Fullscreen preview
    uploadPreviewImg.style.cursor = 'zoom-in';
    uploadPreviewImg.addEventListener('click', () => {
      if (!uploadPreviewImg.src) return;
      document.getElementById('img-fullscreen-img').src = uploadPreviewImg.src;
      document.getElementById('img-fullscreen-overlay').style.display = 'block';
    });
    document.getElementById('img-fullscreen-close').addEventListener('click', () => {
      document.getElementById('img-fullscreen-overlay').style.display = 'none';
    });

    // Upload button handlers
    document.getElementById('btn-upload').addEventListener('click', showUploadPopup);
    document.getElementById('btn-upload-pdf').addEventListener('click', () => { uploadPdfInput.click(); });
    document.getElementById('btn-upload-photo').addEventListener('click', () => { uploadPhotoInput.click(); });
    document.getElementById('btn-upload-cancel-1').addEventListener('click', hideUploadPopup);
    document.getElementById('btn-upload-retake').addEventListener('click', () => {
      uploadStepPreview.style.display = 'none';
      uploadStepChoose.style.display = 'block';
      uploadPdfInput.value = '';
      uploadPhotoInput.value = '';
    });
    document.getElementById('btn-upload-accept').addEventListener('click', showUploadForm);
    document.getElementById('btn-upload-save').addEventListener('click', saveUpload);
    document.getElementById('btn-upload-cancel-3').addEventListener('click', hideUploadPopup);
    uploadOverlay.addEventListener('click', hideUploadPopup);

    // ============================================================
    // DELETE UPLOADED FLOORPLAN
    // ============================================================

    const btnDeleteFp = document.getElementById('btn-delete-fp');
    const deleteFpOverlay = document.getElementById('delete-fp-overlay');
    const deleteFpPopup = document.getElementById('delete-fp-popup');
    const deleteFpMessage = document.getElementById('delete-fp-message');

    function updateDeleteButton() {
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      if (!isNaN(ci) && !isNaN(fi) && customers[ci] && customers[ci].floorplans[fi]) {
        const fp = customers[ci].floorplans[fi];
        btnDeleteFp.style.display = (fp.uploaded || fp.repo === 'uploads') ? 'block' : 'none';
      } else {
        btnDeleteFp.style.display = 'none';
      }
    }

    function showDeleteConfirm() {
      if (isEditMode) { showToast('Sluit eerst de bewerkingsmodus', 'error'); return; }
      topbarMenu.style.display = 'none';
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      if (isNaN(ci) || isNaN(fi)) return;
      const fp = customers[ci].floorplans[fi];
      deleteFpMessage.textContent = 'Weet je zeker dat je "' + fp.name + '" wilt verwijderen?';
      deleteFpOverlay.style.display = 'block';
      deleteFpPopup.style.display = 'block';
    }

    function hideDeleteConfirm() {
      deleteFpOverlay.style.display = 'none';
      deleteFpPopup.style.display = 'none';
    }

    async function deleteUploadedFloorplan() {
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      const fp = customers[ci].floorplans[fi];
      const customerName = customers[ci].customer;

      hideDeleteConfirm();

      try {
        // Step 1: Delete SVG from uploads repo
        const fileUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fp.file);
        const metaResp = await fetch(fileUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!metaResp.ok) throw new Error('Kon bestand niet vinden');
        const meta = await metaResp.json();
        const deleteResp = await fetch(fileUrl, {
          method: 'DELETE',
          headers: ghHeaders(),
          cache: 'no-store',
          body: JSON.stringify({
            message: 'Verwijderd: ' + customerName + ' - ' + fp.name,
            sha: meta.sha,
          }),
        });
        if (!deleteResp.ok) throw new Error('Kon bestand niet verwijderen');

        // Step 2: Update customers.json (resolve by name, not stale index)
        const customersResp = await fetch(CONFIG.customersUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!customersResp.ok) throw new Error('Kon customers.json niet ophalen');
        const customersMeta = await customersResp.json();
        const currentCustomers = JSON.parse(decodeBase64UTF8(customersMeta.content));

        const freshCi = currentCustomers.findIndex(c => c.customer === customerName);
        if (freshCi >= 0) {
          const freshFi = currentCustomers[freshCi].floorplans.findIndex(f => f.file === fp.file);
          if (freshFi >= 0) currentCustomers[freshCi].floorplans.splice(freshFi, 1);
          if (currentCustomers[freshCi].floorplans.length === 0) currentCustomers.splice(freshCi, 1);
        }

        const customersContent = btoa(unescape(encodeURIComponent(JSON.stringify(currentCustomers, null, 2))));
        const updateResp = await fetch(CONFIG.customersUrl, {
          method: 'PUT',
          headers: ghHeaders(),
          cache: 'no-store',
          body: JSON.stringify({
            message: 'Plattegrond verwijderd: ' + customerName + ' - ' + fp.name,
            content: customersContent,
            sha: customersMeta.sha,
          }),
        });
        if (!updateResp.ok) throw new Error('Kon customers.json niet bijwerken');

        // Reload
        customers = currentCustomers;
        populateCustomerDropdown();

        // Clear stale state
        currentFloorplan = null;
        currentCustomer = null;
        stopPolling();

        // Stay on same customer if still exists
        const remainingCi = currentCustomers.findIndex(c => c.customer === customerName);
        if (remainingCi >= 0) {
          customerSelect.value = remainingCi;
          populateFloorplanDropdown(remainingCi);
          floorplanSelect.value = '';
          svgContainer.style.display = 'none';
          svgContainer.innerHTML = '';
          infoPanel.style.display = 'none';
          btnPanelToggle.style.display = 'none';
          btnEdit.style.display = 'none';
          btnReset.style.display = 'none';
          loadingEl.textContent = 'Kies een plattegrond.';
          loadingEl.classList.remove('hidden');
        } else {
          customerSelect.value = '';
          customerSelect.dispatchEvent(new Event('change'));
        }
        updateDeleteButton();
        showToast('Plattegrond verwijderd', 'success');

      } catch (err) {
        showToast('Verwijderen mislukt: ' + err.message, 'error');
      }
    }

    btnDeleteFp.addEventListener('click', showDeleteConfirm);
    document.getElementById('delete-fp-confirm').addEventListener('click', deleteUploadedFloorplan);
    document.getElementById('delete-fp-cancel').addEventListener('click', hideDeleteConfirm);
    deleteFpOverlay.addEventListener('click', hideDeleteConfirm);

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    customerSelect.addEventListener('change', () => {
      // Always clear current floorplan when customer changes
      svgContainer.style.display = 'none';
      svgContainer.innerHTML = '';
      btnReset.style.display = 'none';
      infoPanel.style.display = 'none';
      btnPanelToggle.style.display = 'none';
      btnEdit.style.display = 'none';
      if (isEditMode) exitEditMode();
      sidePanel.classList.remove('open');
      btnPanelToggle.classList.remove('panel-open');
      deselectDoor();
      currentCustomer = null;
      currentFloorplan = null;
      stopPolling();
      updateDeleteButton();

      const idx = customerSelect.value;
      if (idx === '') {
        floorplanSelect.innerHTML = '<option value="">-- Kies plattegrond --</option>';
        floorplanSelect.disabled = true;
        loadingEl.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><rect x="8" y="32" width="74" height="50" rx="5" fill="#e8f0fe" stroke="#1a73e8" stroke-width="2.5"/><rect x="18" y="44" width="16" height="16" rx="3" fill="#1a73e8" opacity="0.45"/><rect x="56" y="44" width="16" height="16" rx="3" fill="#1a73e8" opacity="0.45"/><rect x="37" y="50" width="16" height="32" rx="3" fill="#1a73e8" opacity="0.65"/><polygon points="45,6 6,32 84,32" fill="#1a73e8" opacity="0.75"/></svg></div>
          <div class="empty-state-title">Plattegrond Dashboard</div>
          <div class="empty-state-sub">Kies een klant en plattegrond<br>om te beginnen.</div>
          <div class="empty-state-hint">Gebruik de dropdowns bovenaan</div>
        </div>`;
        loadingEl.classList.remove('hidden');
        return;
      }
      loadingEl.textContent = 'Kies een plattegrond.';
      loadingEl.classList.remove('hidden');
      populateFloorplanDropdown(parseInt(idx, 10));
    });

    floorplanSelect.addEventListener('change', () => {
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      if (isNaN(ci) || isNaN(fi)) {
        updateDeleteButton();
        return;
      }
      loadFloorplan(ci, fi);
    });

    btnJotform.addEventListener('click', openJotForm);
    btnDone.addEventListener('click', toggleDoorStatus);
    btnClose.addEventListener('click', deselectDoor);
    btnReset.addEventListener('click', resetZoom);
    btnPanelToggle.addEventListener('click', toggleSidePanel);
    btnEdit.addEventListener('click', enterEditMode);
    document.getElementById('btn-edit-save').addEventListener('click', saveEditMode);
    document.getElementById('btn-edit-cancel').addEventListener('click', () => {
      if (editChanges.length === 0 && !resizingMarker) { cancelEditMode(); return; }
      // Show confirmation using logout popup pattern
      const overlay = document.getElementById('cancel-edit-overlay');
      const popup = document.getElementById('cancel-edit-popup');
      overlay.style.display = 'block';
      popup.style.display = 'block';
    });

    // Cancel edit confirmation handlers
    function hideCancelEditPopup() {
      document.getElementById('cancel-edit-overlay').style.display = 'none';
      document.getElementById('cancel-edit-popup').style.display = 'none';
    }
    document.getElementById('cancel-edit-confirm').addEventListener('click', () => { hideCancelEditPopup(); cancelEditMode(); });
    document.getElementById('cancel-edit-back').addEventListener('click', hideCancelEditPopup);
    document.getElementById('cancel-edit-overlay').addEventListener('click', hideCancelEditPopup);

    editOverlay.addEventListener('click', closeEditPopup);
    const markerSlider = document.getElementById('edit-marker-size');

    function updateSliderValue(value) {
      editMarkerSize = value;
      markerSlider.value = value;
      document.getElementById('edit-size-label').textContent = value;
      if (resizingMarker) {
        resizingMarker.marker.setAttribute('rx', value.toString());
        resizingMarker.marker.setAttribute('ry', value.toString());
      }
    }

    function sliderValueFromTouch(e) {
      const rect = markerSlider.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const min = parseInt(markerSlider.min, 10);
      const max = parseInt(markerSlider.max, 10);
      return Math.round(min + ratio * (max - min));
    }

    markerSlider.addEventListener('input', (e) => {
      updateSliderValue(parseInt(e.target.value, 10));
    });

    // Jump to tap position on track + drag from anywhere
    markerSlider.addEventListener('touchstart', (e) => {
      e.preventDefault();
      updateSliderValue(sliderValueFromTouch(e));
    }, { passive: false });
    markerSlider.addEventListener('touchmove', (e) => {
      e.preventDefault();
      updateSliderValue(sliderValueFromTouch(e));
    }, { passive: false });

    // ============================================================
    // QR CODE SCANNER
    // ============================================================

    const qrOverlay = document.getElementById('qr-overlay');
    const qrStatus = document.getElementById('qr-status');

    async function startQrScanner() {
      qrOverlay.style.display = 'flex';
      qrStatus.textContent = 'Camera starten...';

      try {
        qrScanner = new Html5Qrcode('qr-reader');
        await qrScanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            editPopupInput.value = decodedText.trim().toUpperCase();
            editPopupInput.focus();
            stopQrScanner();
          },
          () => {}
        );
        qrStatus.textContent = 'Richt de camera op een QR code';
      } catch (err) {
        console.error('Camera fout:', err);
        qrStatus.textContent = 'Camera niet beschikbaar. Controleer de permissies.';
      }
    }

    async function stopQrScanner() {
      if (qrScanner) {
        try {
          await qrScanner.stop();
          qrScanner.clear();
        } catch (e) {}
        qrScanner = null;
      }
      qrOverlay.style.display = 'none';
    }

    btnScanQr.addEventListener('click', startQrScanner);
    document.getElementById('btn-qr-close').addEventListener('click', stopQrScanner);

    // ============================================================
    // LOGIN
    // ============================================================

    // Encrypted GitHub token (AES-256-GCM, key derived from password)
    const ENCRYPTED_TOKEN = {
      iv: 'V1BeyMFSJuUhGC9Q',
      tag: 'I+8b6Ih0dVsiQgDfip5xGQ==',
      data: 'vWek2PmH1d2ddAsF1rAMWhRAQN5WSrQgcGYhpcmLTKV8w0eIRfDLOw==',
    };

    async function decryptToken(password) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode('fd_salt'), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
      const iv = Uint8Array.from(atob(ENCRYPTED_TOKEN.iv), c => c.charCodeAt(0));
      const data = Uint8Array.from(atob(ENCRYPTED_TOKEN.data), c => c.charCodeAt(0));
      const tag = Uint8Array.from(atob(ENCRYPTED_TOKEN.tag), c => c.charCodeAt(0));
      const combined = new Uint8Array(data.length + tag.length);
      combined.set(data);
      combined.set(tag, data.length);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, combined);
      return new TextDecoder().decode(decrypted);
    }

    // EmailJS setup
    emailjs.init('3DTmVGOU0h5-m-l12');

    async function sendLoginNotification(type, attempts) {
      let location = '-';
      try {
        const resp = await fetch('https://api.ipify.org?format=json');
        const ipData = await resp.json();
        const geoResp = await fetch(`https://ipapi.co/${ipData.ip}/json/`);
        const data = await geoResp.json();
        location = `${data.city}, ${data.country_name} (${data.ip})`;
      } catch (err) {
        console.error('Locatie ophalen mislukt:', err);
      }
      emailjs.send('service_in7o99q', 'template_j7na4ug', {
        type: type,
        time: new Date().toLocaleString('nl-NL'),
        attempts: attempts || '-',
        location: location,
      }).catch(err => console.error('Email notificatie mislukt:', err));
    }

    const LOGIN_CONFIG = {
      passwordHash: '0123940987a658e40d82d640ba2084a0f11828593a9a3be547e3e764d45f5ed7',
      maxAttempts: 3,
      lockoutMinutes: 10,
      tokenKey: 'fd_auth_token',
      tokenTimeKey: 'fd_auth_time',
      lockoutKey: 'fd_lockout',
      attemptsKey: 'fd_attempts',
    };

    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.getElementById('app-container');
    const loginPassword = document.getElementById('login-password');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');

    async function hashPassword(password) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function isLockedOut() {
      const lockout = localStorage.getItem(LOGIN_CONFIG.lockoutKey);
      if (!lockout) return false;
      const lockoutTime = parseInt(lockout, 10);
      const remaining = lockoutTime - Date.now();
      if (remaining <= 0) {
        localStorage.removeItem(LOGIN_CONFIG.lockoutKey);
        localStorage.removeItem(LOGIN_CONFIG.attemptsKey);
        return false;
      }
      return true;
    }

    function getLockoutMinutes() {
      const lockout = localStorage.getItem(LOGIN_CONFIG.lockoutKey);
      if (!lockout) return 0;
      const remaining = parseInt(lockout, 10) - Date.now();
      return Math.ceil(remaining / 60000);
    }

    function getAttempts() {
      return parseInt(localStorage.getItem(LOGIN_CONFIG.attemptsKey) || '0', 10);
    }

    async function handleLogin() {
      if (isLockedOut()) {
        loginError.textContent = `Geblokkeerd. Probeer opnieuw over ${getLockoutMinutes()} minuten.`;
        return;
      }

      const password = loginPassword.value;
      if (!password) {
        loginError.textContent = 'Vul het wachtwoord in.';
        return;
      }

      const hash = await hashPassword(password);

      if (hash === LOGIN_CONFIG.passwordHash) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Controleren...';

        // Decrypt GitHub token with password
        let token;
        try {
          token = await decryptToken(password);
        } catch {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Inloggen';
          loginError.textContent = 'Kon token niet ontsleutelen.';
          return;
        }

        // Validate token against GitHub API
        try {
          const testResp = await fetch(CONFIG.customersUrl, {
            headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
            cache: 'no-store',
          });
          if (!testResp.ok) throw new Error();
        } catch {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Inloggen';
          loginError.textContent = 'GitHub token is ongeldig of verlopen.';
          return;
        }

        sessionStorage.setItem(LOGIN_CONFIG.tokenKey, 'authenticated');
        sessionStorage.setItem(LOGIN_CONFIG.tokenTimeKey, Date.now().toString());
        sessionStorage.setItem('fd_github_token', token);

        // Read attempts before clearing
        const priorAttempts = getAttempts();
        localStorage.removeItem(LOGIN_CONFIG.attemptsKey);
        localStorage.removeItem(LOGIN_CONFIG.lockoutKey);

        // Remember password if checkbox is checked
        if (document.getElementById('login-remember').checked) {
          localStorage.setItem('fd_saved_password', password);
        } else {
          localStorage.removeItem('fd_saved_password');
        }

        loginBtn.textContent = 'Inloggen';
        sendLoginNotification('Succesvol ingelogd', priorAttempts > 0 ? priorAttempts + ' foute pogingen vooraf' : '0');
        showApp();
      } else {
        const attempts = getAttempts() + 1;
        localStorage.setItem(LOGIN_CONFIG.attemptsKey, attempts.toString());

        if (attempts >= LOGIN_CONFIG.maxAttempts) {
          sendLoginNotification('Geblokkeerd na ' + attempts + ' foute pogingen', attempts);
          const lockoutUntil = Date.now() + (LOGIN_CONFIG.lockoutMinutes * 60000);
          localStorage.setItem(LOGIN_CONFIG.lockoutKey, lockoutUntil.toString());
          loginError.textContent = `Te veel pogingen. Geblokkeerd voor ${LOGIN_CONFIG.lockoutMinutes} minuten.`;
          loginBtn.disabled = true;
          loginPassword.disabled = true;
        } else {
          const remaining = LOGIN_CONFIG.maxAttempts - attempts;
          loginError.textContent = `Onjuist wachtwoord. Nog ${remaining} poging${remaining === 1 ? '' : 'en'}.`;
          sendLoginNotification('Fout wachtwoord (poging ' + attempts + '/' + LOGIN_CONFIG.maxAttempts + ')', attempts);
        }
        loginPassword.value = '';
      }
    }

    function showApp() {
      loginScreen.style.display = 'none';
      appContainer.style.display = 'block';
      requestAnimationFrame(updateTopbarHeight);
      init();
    }

    function checkLockoutState() {
      if (isLockedOut()) {
        loginError.textContent = `Geblokkeerd. Probeer opnieuw over ${getLockoutMinutes()} minuten.`;
        loginBtn.disabled = true;
        loginPassword.disabled = true;
        // Re-check every 30 seconds
        setTimeout(() => {
          if (!isLockedOut()) {
            loginBtn.disabled = false;
            loginPassword.disabled = false;
            loginError.textContent = '';
          } else {
            checkLockoutState();
          }
        }, 30000);
      }
    }

    function logout() {
      sessionStorage.removeItem(LOGIN_CONFIG.tokenKey);
      sessionStorage.removeItem(LOGIN_CONFIG.tokenTimeKey);
      sessionStorage.removeItem('fd_github_token');
      appContainer.style.display = 'none';
      loginScreen.style.display = 'flex';
      loginPassword.value = '';
      loginError.textContent = '';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Inloggen';
      loginPassword.disabled = false;
      stopPolling();
      restoreSavedPassword();
    }

    // Menu toggle
    const topbarMenu = document.getElementById('topbar-menu');
    document.getElementById('btn-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      topbarMenu.style.display = topbarMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { topbarMenu.style.display = 'none'; });

    // Logout with confirmation popup
    const logoutOverlay = document.getElementById('logout-overlay');
    const logoutPopup = document.getElementById('logout-popup');

    function showLogoutConfirm() {
      topbarMenu.style.display = 'none';
      logoutOverlay.style.display = 'block';
      logoutPopup.style.display = 'block';
    }
    function hideLogoutConfirm() {
      logoutOverlay.style.display = 'none';
      logoutPopup.style.display = 'none';
    }

    document.getElementById('btn-logout').addEventListener('click', showLogoutConfirm);
    document.getElementById('logout-confirm').addEventListener('click', () => { hideLogoutConfirm(); logout(); });
    document.getElementById('logout-cancel').addEventListener('click', hideLogoutConfirm);
    logoutOverlay.addEventListener('click', hideLogoutConfirm);
    loginBtn.addEventListener('click', handleLogin);
    loginPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    // ============================================================
    // INIT
    // ============================================================

    async function init() {
      await Promise.all([loadCustomers(), loadStatus()]);
    }

    // Check if already logged in and session not expired
    function isSessionValid() {
      const token = sessionStorage.getItem(LOGIN_CONFIG.tokenKey);
      const time = sessionStorage.getItem(LOGIN_CONFIG.tokenTimeKey);
      if (token !== 'authenticated' || !time) return false;
      return true;
    }

    function restoreSavedPassword() {
      const saved = localStorage.getItem('fd_saved_password');
      if (saved) {
        loginPassword.value = saved;
        document.getElementById('login-remember').checked = true;
      }
    }

    restoreSavedPassword();

    if (isSessionValid()) {
      // Validate token still works before showing app
      fetch(CONFIG.customersUrl, {
        headers: { 'Authorization': 'token ' + getGitHubToken(), 'Accept': 'application/vnd.github.v3+json' },
        cache: 'no-store',
      }).then(resp => {
        if (resp.ok) {
          showApp();
        } else {
          sessionStorage.clear();
          loginError.textContent = 'Sessie verlopen. Log opnieuw in.';
          checkLockoutState();
        }
      }).catch(() => {
        sessionStorage.clear();
        loginError.textContent = 'Kon verbinding niet controleren. Log opnieuw in.';
        checkLockoutState();
      });
    } else {
      checkLockoutState();
    }

    // ============================================================
    // SERVICE WORKER REGISTRATION
    // ============================================================

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(reg => {
          reg.onupdatefound = () => {
            const installing = reg.installing;
            installing.onstatechange = () => {
              if (installing.state === 'activated' && navigator.serviceWorker.controller) {
                showToast('Nieuwe versie beschikbaar — herlaad de pagina', 'success');
              }
            };
          };
        })
        .catch(err => console.warn('SW registration failed:', err));
    }
