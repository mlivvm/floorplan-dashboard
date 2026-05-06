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
      loginEmailNotificationsEnabled: false,
      pollInterval: 30000,
      offlineCacheVersion: 'fd-v1.8.85',
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
    let customersLoading = false;
    const AppModes = FD.ModeService.MODES;
    const appMode = FD.ModeService.createModeController(AppModes.LOGIN);
    let statusSync = null;

    function setDocumentAppMode(mode) {
      document.documentElement.dataset.appMode = mode;
      document.body.dataset.appMode = mode;
    }

    function isEditModeActive() {
      return appMode.is(AppModes.EDIT);
    }

    setDocumentAppMode(appMode.current);
    appMode.onTransition(({ to }) => setDocumentAppMode(to));

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
    const appContainer = document.getElementById('app-container');
    const topbarEl = document.querySelector('.topbar');
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
    const connectionIndicator = document.getElementById('connection-indicator');
    const connectionLabel = document.getElementById('connection-label');
    const syncIndicator = document.getElementById('sync-indicator');
    const syncLabel = document.getElementById('sync-label');
    const topbarMenu = document.getElementById('topbar-menu');
    const btnTopbarMenu = document.getElementById('btn-menu');
    const btnMenuLabels = document.getElementById('btn-menu-labels');
    const topbarMenuController = FD.UIShellService.createTopbarMenu({
      toggleButtonEl: btnTopbarMenu,
      menuEl: topbarMenu,
      documentEl: document,
    });

    function hideTopbarMenu() {
      topbarMenuController.hide();
    }

    // ============================================================
    // SHARED UI HELPERS
    // ============================================================

    function setEmptyState(subtitle, hint) {
      FD.UIShellService.renderEmptyState(loadingEl, { subtitle, hint });
    }

    function setLoadingState() {
      FD.UIShellService.renderLoadingState(loadingEl);
    }

    // ============================================================
    // LAYOUT — measure topbar, handle resize/orientation
    // ============================================================

    function updateViewportMetrics() {
      FD.UIShellService.updateViewportHeightProperty({
        rootEl: document.documentElement,
        visualViewport: window.visualViewport,
        fallbackHeight: window.innerHeight,
      });
    }

    function updateTopbarHeight() {
      FD.UIShellService.updateTopbarHeightProperty({
        rootEl: document.documentElement,
        topbarEl,
      });
    }

    function handleResize() {
      updateViewportMetrics();
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
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }
    updateViewportMetrics();

    // Warn before closing with unsaved edit mode changes
    window.addEventListener('beforeunload', (e) => {
      if (isEditModeActive() || appMode.isBusy()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // ============================================================
    // TOAST NOTIFICATIONS
    // ============================================================

    const toastEl = document.getElementById('toast');
    const toastController = FD.UIShellService.createToastController(toastEl);

    function showToast(message, type) {
      toastController.show(message, type);
    }

    function updateConnectionIndicator() {
      const isOnline = navigator.onLine;
      FD.UIShellService.renderConnectionIndicator({
        indicatorEl: connectionIndicator,
        labelEl: connectionLabel,
        isOnline,
      });
      requestAnimationFrame(updateTopbarHeight);
    }

    function updateStatusSyncIndicator() {
      const count = statusSync ? statusSync.getQueueCount() : 0;
      FD.UIShellService.renderStatusSyncIndicator({
        indicatorEl: syncIndicator,
        labelEl: syncLabel,
        count,
      });
      requestAnimationFrame(updateTopbarHeight);
    }

    window.addEventListener('online', () => {
      updateConnectionIndicator();
      showToast('Je bent weer online', 'success');
      if (statusSync) statusSync.markNetworkAvailable();
      flushStatusSyncQueue();
      scheduleFloorplanCacheWarmup();
    });

    window.addEventListener('offline', () => {
      updateConnectionIndicator();
      cancelFloorplanCacheWarmup();
      showToast('Offline modus', 'error');
    });

    // ============================================================
    // DATA LOADING
    // ============================================================

    const CUSTOMERS_CACHE_KEY = 'fd_customers_cache';
    const JOTFORM_RETURN_CONTEXT_KEY = 'fd_jotform_return_context';

    function getGitHubToken() {
      return FD.Repository.getToken();
    }

    function readCachedCustomers() {
      try {
        const cached = JSON.parse(localStorage.getItem(CUSTOMERS_CACHE_KEY) || '[]');
        return Array.isArray(cached) ? cached : [];
      } catch {
        return [];
      }
    }

    function cacheCustomers() {
      try {
        localStorage.setItem(CUSTOMERS_CACHE_KEY, JSON.stringify(customers));
      } catch (err) {
        console.warn('Klanten cache kon niet worden opgeslagen:', err);
      }
    }

    function getFloorplanApiUrl(fp) {
      return FD.FloorplanCacheService.getFloorplanApiUrl(fp, CONFIG);
    }

    function currentJotFormReturnContext() {
      const { customer, floorplan } = getSelectedFloorplan();
      return FD.DoorActionService.createReturnContext({
        customer: customer || currentCustomer,
        floorplan: floorplan || currentFloorplan,
        doorId: selectedDoor,
      });
    }

    function saveJotFormReturnContext() {
      const context = currentJotFormReturnContext();
      if (!context) return;
      const saved = FD.DoorActionService.saveReturnContext(
        localStorage,
        JOTFORM_RETURN_CONTEXT_KEY,
        context
      );
      if (!saved) console.warn('JotForm terugkeercontext kon niet worden opgeslagen.');
    }

    function readJotFormReturnContext() {
      return FD.DoorActionService.readReturnContext(localStorage, JOTFORM_RETURN_CONTEXT_KEY);
    }

    function clearJotFormReturnContext() {
      localStorage.removeItem(JOTFORM_RETURN_CONTEXT_KEY);
    }

    function findCustomerIndexForReturnContext(context) {
      if (!context) return -1;
      return customers.findIndex(customer => customer.customer === context.customerName);
    }

    async function restoreJotFormReturnIfNeeded() {
      if (!FD.DoorActionService.hasReturnParam(window.location)) return;

      const context = readJotFormReturnContext();
      FD.DoorActionService.clearReturnParam(window.history, window.location);
      clearJotFormReturnContext();

      if (!context) {
        showToast('Terug uit JotForm', 'success');
        return;
      }

      const customerIndex = findCustomerIndexForReturnContext(context);
      const customer = customers[customerIndex];
      const floorplanIndex = FD.DoorActionService.findFloorplanIndex(customer?.floorplans, context);

      if (customerIndex < 0 || floorplanIndex < 0) {
        showToast('Terug uit JotForm, vorige selectie niet gevonden', 'error');
        return;
      }

      customerSelect.value = String(customerIndex);
      populateFloorplanDropdown(customerIndex);
      floorplanSelect.value = String(floorplanIndex);
      updatePickerButtons();

      await loadFloorplan(customerIndex, floorplanIndex);

      if (FD.MarkerService.markerExists(svgContainer, context.doorId)) {
        selectDoor(context.doorId);
        showToast('Terug uit JotForm', 'success');
      } else {
        showToast('Terug uit JotForm, deur niet gevonden', 'error');
      }
    }

    const floorplanCache = FD.FloorplanCacheService.createWarmupController({
      config: CONFIG,
      getCustomers: () => customers,
      getToken: getGitHubToken,
      isOnline: () => navigator.onLine,
      logger: console,
    });

    function fetchGitHubSVGCacheFirst(fileUrl) {
      return FD.FloorplanCacheService.fetchSVGCacheFirst(fileUrl, {
        cacheVersion: CONFIG.offlineCacheVersion,
      });
    }

    function updateCachedSVGAfterSave(fileUrl, updateResult, svgText) {
      return FD.FloorplanCacheService.updateCachedSVGAfterSave(fileUrl, updateResult, svgText, {
        cacheVersion: CONFIG.offlineCacheVersion,
      });
    }

    function cancelFloorplanCacheWarmup() {
      floorplanCache.cancel();
    }

    function scheduleFloorplanCacheWarmup() {
      floorplanCache.schedule();
    }

    async function loadCustomers() {
      customersLoading = true;
      customerSelect.disabled = true;
      floorplanSelect.disabled = true;
      updatePickerButtons();
      try {
        customers = await FD.DataService.loadCustomers(CONFIG);
        cacheCustomers();
        customerSelect.disabled = false;
        populateCustomerDropdown();
        if (selectionController.isOpen('customer')) renderSelectSheetItems();
        scheduleFloorplanCacheWarmup();
      } catch (err) {
        const cachedCustomers = readCachedCustomers();
        if (cachedCustomers.length > 0) {
          console.warn('Kon klanten niet online laden, lokale cache gebruikt:', err);
          customers = cachedCustomers;
          customerSelect.disabled = false;
          populateCustomerDropdown();
          if (selectionController.isOpen('customer')) renderSelectSheetItems();
          setEmptyState('Offline klantgegevens geladen.<br>Kies een klant en plattegrond.', 'Controleer later online of alles actueel is');
        } else {
          console.error('Kon klanten niet laden:', err);
          loadingEl.textContent = 'Fout bij laden van klantgegevens.';
        }
      } finally {
        customersLoading = false;
        customerSelect.disabled = customers.length === 0;
        updatePickerButtons();
        if (selectionController.isOpen('customer')) renderSelectSheetItems();
      }
    }

    async function loadStatus() {
      const result = await statusSync.loadStatusLocalFirst({
        onCachedStatus: (cachedStatus) => {
          doorStatus = cachedStatus;
          updateStatusBar();
        },
      });

      if (result.error) {
        console.error('Kon status niet laden:', result.error);
      }
      doorStatus = result.status || {};
      updateStatusBar();
    }

    function populateCustomerDropdown() {
      FD.SelectSheetService.renderCustomerOptions(customerSelect, customers);
      updatePickerButtons();
    }

    function populateFloorplanDropdown(customerIndex) {
      const c = customers[customerIndex];
      FD.SelectSheetService.renderFloorplanOptions(floorplanSelect, c.floorplans);
      updatePickerButtons();
    }

    function resetFloorplanDropdown(disabled = true) {
      FD.SelectSheetService.resetFloorplanOptions(floorplanSelect, { disabled });
      updatePickerButtons();
    }

    function getSelectedFloorplan() {
      return FD.SelectSheetService.getSelectedFloorplan(customers, customerSelect, floorplanSelect);
    }

    const customerPickerBtn = document.getElementById('customer-picker-btn');
    const floorplanPickerBtn = document.getElementById('floorplan-picker-btn');
    const customerPickerValue = document.getElementById('customer-picker-value');
    const floorplanPickerValue = document.getElementById('floorplan-picker-value');
    const selectSheetOverlay = document.getElementById('select-sheet-overlay');
    const selectSheet = document.getElementById('select-sheet');
    const selectSheetEyebrow = document.getElementById('select-sheet-eyebrow');
    const selectSheetTitle = document.getElementById('select-sheet-title');
    const selectSheetSearch = document.getElementById('select-sheet-search');
    const selectSheetList = document.getElementById('select-sheet-list');
    const selectSheetClose = document.getElementById('select-sheet-close');

    function getSelectSheetItems(type) {
      if (type === 'customer') {
        return customers.map((c, index) => ({ index, label: c.customer }));
      }
      const ci = FD.SelectSheetService.selectedIndex(customerSelect);
      if (ci === null || !customers[ci]) return [];
      return customers[ci].floorplans.map((fp, index) => ({ index, label: fp.name }));
    }

    const selectionController = FD.SelectSheetService.createSelectionController({
      elements: {
        customerSelect,
        floorplanSelect,
        customerPickerBtn,
        floorplanPickerBtn,
        customerPickerValue,
        floorplanPickerValue,
        overlay: selectSheetOverlay,
        sheet: selectSheet,
        eyebrow: selectSheetEyebrow,
        title: selectSheetTitle,
        search: selectSheetSearch,
        list: selectSheetList,
        closeButton: selectSheetClose,
      },
      getState: () => ({ customersLoading }),
      getItems: getSelectSheetItems,
      onCustomerChange: ({ value }) => {
        if (isEditModeActive()) exitEditMode();
        resetFloorplanUI();
        currentCustomer = null;
        currentFloorplan = null;
        updateDeleteButton();
        updatePickerButtons();

        if (value === '') {
          resetFloorplanDropdown(true);
          setEmptyState('Kies een klant en plattegrond<br>om te beginnen.', 'Gebruik de dropdowns bovenaan');
          loadingEl.classList.remove('hidden');
          return;
        }
        setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
        loadingEl.classList.remove('hidden');
        populateFloorplanDropdown(parseInt(value, 10));
      },
      onFloorplanChange: () => {
        updatePickerButtons();
        const { customerIndex, floorplanIndex, floorplan } = getSelectedFloorplan();
        if (customerIndex === null || floorplanIndex === null || !floorplan) {
          if (isEditModeActive()) exitEditMode();
          resetFloorplanUI();
          currentCustomer = null;
          currentFloorplan = null;
          setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
          loadingEl.classList.remove('hidden');
          updateDeleteButton();
          return;
        }
        loadFloorplan(customerIndex, floorplanIndex);
      },
    });

    function updatePickerButtons() {
      selectionController.updatePickerButtons();
    }

    function renderSelectSheetItems() {
      selectionController.renderItems();
    }

    function closeSelectSheet() {
      selectionController.close();
    }

    const sidePanelController = FD.SidePanelService.createController({
      elements: {
        panelEl: sidePanel,
        listEl: sidePanelList,
        headerEl: sidePanelHeader,
      },
      getDoorIds: () => FD.MarkerService.allMarkers(svgContainer).map(marker => marker.dataset.doorId),
      getSelectedDoor: () => selectedDoor,
      getDoorStatus,
      colors: { done: COLORS.done, todo: COLORS.todo },
      onSelect: selectDoor,
      setShellOpen: (open) => FD.UIShellService.setSidePanelOpen({
        sidePanelEl: sidePanel,
        toggleButtonEl: btnPanelToggle,
        appContainerEl: appContainer,
        open,
      }),
    });

    const doorActionController = FD.DoorActionService.createController({
      elements: {
        doorNameEl,
        doorStatusEl,
        btnJotform,
        btnClose,
        btnDone,
      },
      config: {
        baseUrl: CONFIG.jotformBaseUrl,
        formId: CONFIG.jotformFormId,
      },
      colors: { done: COLORS.done, todo: COLORS.todo },
      getState: () => ({
        selectedDoor,
        currentCustomer,
        currentFloorplan,
        online: navigator.onLine,
      }),
      setSelectedDoor: (doorId) => { selectedDoor = doorId; },
      getDoorStatus,
      refreshAllDoorColors,
      scrollToDoor: (doorId) => sidePanelController.scrollToDoor(doorId),
      showToast,
      openWindow: (url, target) => window.open(url, target),
      onBeforeOpenJotForm: saveJotFormReturnContext,
    });

    const floorplanLoadController = FD.FloorplanViewService.createLoadController({
      elements: {
        svgContainer,
        loadingEl,
      },
      getSelection: () => ({
        customerIndex: customerSelect.value,
        floorplanIndex: floorplanSelect.value,
      }),
      fetchSvg: ({ floorplan }, options) => fetchGitHubSVGCacheFirst(getFloorplanApiUrl(floorplan), options),
      setLoadingState,
      onBeforeLoad: () => {
        stopPolling();
        deselectDoor();
        btnReset.style.display = 'none';
        infoPanel.style.display = 'none';
        btnPanelToggle.style.display = 'none';
        btnEdit.style.display = 'none';
        closeSidePanel();
        sidePanelController.clear();
        loadingEl.classList.add('hidden');
      },
      onSvgReady: ({ svgEl }) => {
        initDoorMarkers(svgEl);
        deselectDoor();
        updateStatusBar();
        if (showLabels) updateEditLabels();
        infoPanel.style.display = 'flex';
        btnPanelToggle.style.display = 'block';
        btnReset.style.display = 'inline-block';
        btnEdit.style.display = 'inline-block';
        populateSidePanel();
        updateDeleteButton();
        startPolling();
      },
      onBeforeReveal: ({ size }) => fitToScreen(size.width, size.height),
      onRevalidated: () => showToast('Plattegrond bijgewerkt', 'success'),
      onError: (err) => {
        loadingEl.textContent = 'Fout: ' + err.message;
      },
    });

    function closeSidePanel() {
      sidePanelController.close();
    }

    function resetFloorplanUI() {
      floorplanLoadController.cancel();
      stopPolling();
      deselectDoor();
      floorplanLoadController.clearContent();
      statusCount.textContent = '';
      btnReset.style.display = 'none';
      infoPanel.style.display = 'none';
      btnPanelToggle.style.display = 'none';
      btnEdit.style.display = 'none';
      closeSidePanel();
      sidePanelController.clear();
    }

    function resetAppToStartScreen() {
      cancelFloorplanCacheWarmup();
      if (isEditModeActive()) exitEditMode();
      closeSelectSheet();
      customers = [];
      doorStatus = {};
      currentCustomer = null;
      currentFloorplan = null;
      pendingDoor = null;
      customerSelect.disabled = false;
      FD.SelectSheetService.renderCustomerOptions(customerSelect, []);
      resetFloorplanDropdown(true);
      resetFloorplanUI();
      statusCount.textContent = '';
      hideTopbarMenu();
      updatePickerButtons();
      updateDeleteButton();
      setEmptyState('Kies een klant en plattegrond<br>om te beginnen.', 'Gebruik de dropdowns bovenaan');
      loadingEl.classList.remove('hidden');
    }

    // ============================================================
    // SVG LOADING & DOOR DETECTION
    // ============================================================

    async function loadFloorplan(customerIndex, floorplanIndex) {
      const c = customers[customerIndex];
      const fp = c.floorplans[floorplanIndex];
      currentCustomer = c.customer;
      currentFloorplan = fp.name;
      return floorplanLoadController.load({ customerIndex, floorplanIndex, customer: c, floorplan: fp });
    }

    function getDoorId(el) {
      return FD.MarkerService.getDoorId(el);
    }

    function initDoorMarkers(svgEl) {
      const markers = svgEl.querySelectorAll('ellipse, circle');
      markers.forEach(marker => {
        const doorId = getDoorId(marker);
        if (FD.MarkerService.isIgnoredDoorId(doorId)) return;

        FD.MarkerService.prepareInteractiveMarker(marker, doorId);

        const isDone = getDoorStatus(doorId);
        applyDoorColor(marker, isDone);

        // Track door target on pointerdown (read from dataset so renames are picked up)
        marker.addEventListener('pointerdown', (e) => {
          pendingDoor = e.currentTarget.dataset.doorId;
        });
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
      return FD.StatusService.isDoorDone(doorStatus, currentCustomer, currentFloorplan, doorId);
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
      doorActionController.selectDoor(doorId);
    }

    function deselectDoor() {
      doorActionController.deselectDoor();
    }

    // ============================================================
    // JOTFORM LINK
    // ============================================================

    function openJotForm() {
      doorActionController.openJotForm();
    }

    // ============================================================
    // EDIT MODE
    // ============================================================

    let editChanges = [];
    let editMarkerSize = 15;
    let qrScannerController = null;
    let markerSizeSliderController = null;

    let movingMarker = null;    // { marker, doorId, origCx, origCy, dragOffsetX, dragOffsetY }
    let isDraggingMove = false;
    let autoNumbering = false;
    let autoPrefix = '';
    let autoPadding = 3;
    const LABELS_STORAGE_KEY = 'fd_show_labels';
    let showLabels = localStorage.getItem(LABELS_STORAGE_KEY) === '1';
    let editLabelElements = [];

    const topbar = document.querySelector('.topbar');
    const editBar = document.getElementById('edit-bar');
    const btnEdit = document.getElementById('btn-edit');
    const editPopup = document.getElementById('edit-popup');
    const editOverlay = document.getElementById('edit-overlay');
    const editPopupTitle = document.getElementById('edit-popup-title');
    const editPopupInput = document.getElementById('edit-popup-input');
    const editPopupCustom = document.getElementById('edit-popup-custom');
    const editPopupButtons = document.getElementById('edit-popup-buttons');
    const editPopupInputRow = document.getElementById('edit-popup-input-row');
    const editPopupError = document.getElementById('edit-popup-error');
    const btnScanQr = document.getElementById('btn-scan-qr');
    const editPopupController = FD.EditUIService.createEditPopupController({
      elements: {
        popupEl: editPopup,
        overlayEl: editOverlay,
        titleEl: editPopupTitle,
        inputEl: editPopupInput,
        inputRowEl: editPopupInputRow,
        customEl: editPopupCustom,
        buttonsEl: editPopupButtons,
        errorEl: editPopupError,
      },
      onBeforeHide: () => {
        if (resizingMarker) cancelResize();
        if (qrScannerController?.isActive()) qrScannerController.stop();
      },
    });

    function getSliderRange() {
      const svgEl = svgContainer.querySelector('svg');
      return FD.MarkerService.sliderRange(svgEl);
    }

    function getMarkerRadius(marker) {
      return FD.MarkerService.markerRadius(marker, editMarkerSize || 10);
    }

    function getSvgPointFromClient(clientX, clientY) {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return null;
      const vb = svgEl.viewBox.baseVal;
      const containerRect = svgContainer.getBoundingClientRect();
      return FD.ViewportService.clientToSvgPoint({
        clientX,
        clientY,
        containerLeft: containerRect.left,
        containerTop: containerRect.top,
        panX,
        panY,
        scale,
        viewBoxX: vb.x || 0,
        viewBoxY: vb.y || 0,
      });
    }

    function getEditableBounds() {
      const svgEl = svgContainer.querySelector('svg');
      return FD.MarkerService.editableBounds(svgEl);
    }

    function clampMarkerPosition(svgX, svgY, radius) {
      const bounds = getEditableBounds();
      return FD.MarkerService.clampPosition(svgX, svgY, radius, bounds);
    }

    function isPointInsideEditableBounds(svgX, svgY) {
      const bounds = getEditableBounds();
      return FD.MarkerService.pointInsideBounds(svgX, svgY, bounds);
    }

    function getMaxRadiusAtPosition(marker) {
      const bounds = getEditableBounds();
      return FD.MarkerService.maxRadiusAtPosition(marker, bounds);
    }

    function enterEditMode() {
      if (!currentFloorplan) return;
      if (appMode.is(AppModes.EDIT)) return;
      if (!appMode.isInteractiveView()) {
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      appMode.enter(AppModes.EDIT);
      editChanges = [];
      movingMarker = null;
      isDraggingMove = false;
      topbar.classList.add('edit-mode');
      editBar.style.display = 'flex';
      infoPanel.style.display = 'none';
      deselectDoor();
      document.getElementById('btn-edit-save').disabled = false;
      document.getElementById('btn-edit-save').textContent = 'Opslaan';
      const range = getSliderRange();
      markerSizeSliderController.setRange({ max: range.max, value: range.def });
      document.getElementById('btn-auto-number').classList.remove('active');
      document.getElementById('auto-number-row').style.display = 'none';
      document.getElementById('auto-prefix-input').value = '';
      document.getElementById('auto-next-preview').textContent = '→ (voer prefix in)';
      autoNumbering = false;
      autoPrefix = '';
      autoPadding = parseInt(document.getElementById('auto-padding-select').value, 10);
      btnEdit.style.display = 'none';
      btnReset.style.display = 'none';
      customerSelect.disabled = true;
      floorplanSelect.disabled = true;
      updatePickerButtons();
      requestAnimationFrame(updateTopbarHeight);
    }

    function exitEditMode() {
      if (resizingMarker) applyResize();
      if (movingMarker) cancelMoveMode();
      appMode.enter(AppModes.VIEW);
      topbar.classList.remove('edit-mode');
      editBar.style.display = 'none';
      autoNumbering = false;
      autoPrefix = '';
      document.getElementById('btn-auto-number').classList.remove('active');
      document.getElementById('auto-number-row').style.display = 'none';
      if (showLabels) updateEditLabels(); else removeEditLabels();
      infoPanel.style.display = 'flex';
      btnEdit.style.display = 'inline-block';
      btnReset.style.display = 'inline-block';
      customerSelect.disabled = false;
      floorplanSelect.disabled = false;
      updatePickerButtons();
      closeEditPopup();
      requestAnimationFrame(updateTopbarHeight);
    }

    function cancelEditMode() {
      if (resizingMarker) cancelResize();
      if (movingMarker) cancelMoveMode();
      FD.MarkerService.revertEditChanges(editChanges, svgContainer, { initMarker: initSingleMarker });
      exitEditMode();
      populateSidePanel();
    }

    async function saveEditMode() {
      if (resizingMarker) applyResize();
      if (movingMarker) cancelMoveMode();

      if (editChanges.length === 0) {
        exitEditMode();
        return;
      }

      const svgEl = svgContainer.querySelector('svg');
      const svgText = FD.MarkerService.serializeCleanSVG(svgEl);

      // Upload to GitHub
      const btnSave = document.getElementById('btn-edit-save');
      btnSave.textContent = 'Opslaan...';
      btnSave.disabled = true;

      try {
        const { floorplan: fp } = getSelectedFloorplan();
        if (!fp) throw new Error('Geen plattegrond geselecteerd');
        const fileUrl = getFloorplanApiUrl(fp);

        const updateResult = await FD.DataService.saveFloorplanSVG(fileUrl, svgText, {
          message: 'Markers bijgewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
          fetchErrorMessage: 'Kon bestand niet ophalen',
          saveErrorMessage: 'Kon niet opslaan',
        });
        await updateCachedSVGAfterSave(fileUrl, updateResult, svgText);

        exitEditMode();
        editChanges = [];
        refreshAllDoorColors();
        populateSidePanel();
        showToast('Opgeslagen', 'success');

      } catch (err) {
        showToast('Opslaan mislukt: ' + err.message, 'error');
        btnSave.textContent = 'Opslaan';
        btnSave.disabled = false;
      }
    }

    function showEditPopup(title, defaultValue, buttons) {
      editPopupController.show(title, defaultValue, buttons);
    }

    function closeEditPopup() {
      editPopupController.hide();
    }

    function initSingleMarker(marker, doorId) {
      FD.MarkerService.prepareInteractiveMarker(marker, doorId);
      const isDone = getDoorStatus(doorId);
      applyDoorColor(marker, isDone);
      marker.addEventListener('pointerdown', (e) => { pendingDoor = e.currentTarget.dataset.doorId; });
    }

    function addMarkerAtPosition(svgX, svgY, doorId) {
      const svgEl = svgContainer.querySelector('svg');
      const pos = clampMarkerPosition(svgX, svgY, editMarkerSize);
      const ellipse = FD.MarkerService.createEllipseMarker({
        doorId,
        x: pos.x,
        y: pos.y,
        radius: editMarkerSize,
      });

      svgEl.appendChild(ellipse);
      initSingleMarker(ellipse, doorId);

      editChanges.push(FD.MarkerService.addChange(doorId));
      populateSidePanel();
      if (showLabels) updateEditLabels();
    }

    function deleteMarker(doorId) {
      const marker = FD.MarkerService.findMarkerByDoorId(svgContainer, doorId);
      if (!marker) return;
      editChanges.push(FD.MarkerService.deleteChange(marker, doorId));
      marker.remove();
      deselectDoor();
      populateSidePanel();
      if (showLabels) updateEditLabels();
    }

    function renameMarker(doorId, newId) {
      const marker = FD.MarkerService.findMarkerByDoorId(svgContainer, doorId);
      if (!marker) return;
      FD.MarkerService.setMarkerCode(marker, newId);
      editChanges.push(FD.MarkerService.renameChange(doorId, newId));
      populateSidePanel();
      if (showLabels) updateEditLabels();
    }

    let resizingMarker = null;
    let resizingOldRx = null;

    function startResizeMode(marker, doorId, currentRx) {
      resizingMarker = { marker, doorId };
      resizingOldRx = currentRx;

      // Set slider to current size, expand max if needed
      const range = getSliderRange();
      markerSizeSliderController.setRange({
        max: Math.max(range.max, Math.ceil(currentRx)),
        value: Math.round(currentRx),
      });

      // Highlight the marker with uniform glow
      marker.style.opacity = '1';
      marker.style.filter = 'drop-shadow(0 0 4px #e67700) drop-shadow(0 0 2px #e67700)';

      // Change edit bar label
      document.querySelector('.edit-label').textContent = doorId;
      showResizePopup(marker, doorId);
    }

    function positionEditPopupAwayFromMarker(marker) {
      const margin = 14;
      const horizontalMargin = 28;
      const markerRect = marker.getBoundingClientRect();
      const popupRect = editPopup.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const centerX = markerRect.left + markerRect.width / 2;
      const centerY = markerRect.top + markerRect.height / 2;

      const candidates = [
        {
          fits: viewportW - markerRect.right >= popupRect.width + horizontalMargin,
          left: markerRect.right + horizontalMargin,
          top: clamp(centerY - popupRect.height / 2, margin, viewportH - popupRect.height - margin)
        },
        {
          fits: markerRect.left >= popupRect.width + horizontalMargin,
          left: markerRect.left - popupRect.width - horizontalMargin,
          top: clamp(centerY - popupRect.height / 2, margin, viewportH - popupRect.height - margin)
        },
        {
          fits: viewportH - markerRect.bottom >= popupRect.height + margin,
          left: clamp(centerX - popupRect.width / 2, margin, viewportW - popupRect.width - margin),
          top: markerRect.bottom + margin
        },
        {
          fits: markerRect.top >= popupRect.height + margin,
          left: clamp(centerX - popupRect.width / 2, margin, viewportW - popupRect.width - margin),
          top: markerRect.top - popupRect.height - margin
        }
      ];

      const rooms = [
        viewportW - markerRect.right,
        markerRect.left,
        viewportH - markerRect.bottom,
        markerRect.top
      ];
      const fallbackIndex = rooms.indexOf(Math.max(...rooms));
      const chosen = candidates.find(c => c.fits) || candidates[fallbackIndex];

      editPopup.style.transform = 'none';
      editPopup.style.left = Math.round(chosen.left) + 'px';
      editPopup.style.top = Math.round(chosen.top) + 'px';
    }

    function showResizePopup(marker, doorId) {
      const slider = document.getElementById('edit-marker-size');
      const currentValue = parseInt(slider.value, 10);

      editPopupTitle.textContent = 'Grootte aanpassen';
      editPopupError.textContent = '';
      editPopupInputRow.style.display = 'none';
      editPopupCustom.innerHTML = '';
      editPopupCustom.style.display = 'block';
      editPopupButtons.innerHTML = '';

      const control = document.createElement('div');
      control.className = 'resize-popup-control';

      const label = document.createElement('label');
      label.textContent = doorId;
      const valueEl = document.createElement('span');
      valueEl.textContent = currentValue.toString();
      label.appendChild(valueEl);

      const popupSlider = document.createElement('input');
      popupSlider.id = 'resize-popup-slider';
      label.htmlFor = popupSlider.id;
      popupSlider.type = 'range';
      popupSlider.min = slider.min;
      popupSlider.max = slider.max;
      popupSlider.value = currentValue.toString();
      popupSlider.addEventListener('input', () => {
        const value = parseInt(popupSlider.value, 10);
        updateSliderValue(value);
        popupSlider.value = marker.getAttribute('rx') || value.toString();
        valueEl.textContent = popupSlider.value;
        if (showLabels) updateEditLabels();
      });

      control.appendChild(label);
      control.appendChild(popupSlider);
      editPopupCustom.appendChild(control);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Annuleren';
      cancelBtn.style.background = '#e0e0e0';
      cancelBtn.style.color = '#333';
      cancelBtn.addEventListener('click', () => {
        cancelResize();
        closeEditPopup();
      });

      const doneBtn = document.createElement('button');
      doneBtn.textContent = 'Klaar';
      doneBtn.style.background = '#34a853';
      doneBtn.style.color = 'white';
      doneBtn.addEventListener('click', () => {
        applyResize();
        closeEditPopup();
      });

      editPopupButtons.appendChild(cancelBtn);
      editPopupButtons.appendChild(doneBtn);
      editPopup.style.display = 'block';
      editOverlay.style.display = 'block';
      requestAnimationFrame(() => positionEditPopupAwayFromMarker(marker));
    }

    function clearResizeHighlight(marker) {
      marker.style.stroke = 'transparent';
      marker.style.strokeWidth = '20';
      marker.style.filter = '';
    }

    function applyResize() {
      if (!resizingMarker) return;
      editChanges.push(FD.MarkerService.resizeChange(resizingMarker.doorId, resizingOldRx));
      clearResizeHighlight(resizingMarker.marker);
      resizingMarker = null;
      resizingOldRx = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
      if (showLabels) updateEditLabels();
    }

    function cancelResize() {
      if (!resizingMarker) return;
      FD.MarkerService.setMarkerRadius(resizingMarker.marker, resizingOldRx);
      clearResizeHighlight(resizingMarker.marker);
      resizingMarker = null;
      resizingOldRx = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
      if (showLabels) updateEditLabels();
    }

    // ============================================================
    // MOVE MODE
    // ============================================================

    function startMoveMode(marker, doorId, origCx, origCy) {
      movingMarker = { marker, doorId, origCx, origCy, dragOffsetX: 0, dragOffsetY: 0 };
      marker.style.opacity = '1';
      marker.style.filter = 'drop-shadow(0 0 6px #7b1fa2) drop-shadow(0 0 3px #7b1fa2)';
      document.querySelector('.edit-label').textContent = doorId;
    }

    function clearMoveHighlight(marker) {
      marker.style.filter = '';
    }

    function confirmMove() {
      if (!movingMarker) return;
      editChanges.push(FD.MarkerService.moveChange(movingMarker.doorId, movingMarker.origCx, movingMarker.origCy));
      clearMoveHighlight(movingMarker.marker);
      movingMarker = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
      if (showLabels) updateEditLabels();
    }

    function cancelMoveMode() {
      if (!movingMarker) return;
      FD.MarkerService.setMarkerPosition(movingMarker.marker, movingMarker.origCx, movingMarker.origCy);
      clearMoveHighlight(movingMarker.marker);
      movingMarker = null;
      isDraggingMove = false;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
    }

    // ============================================================
    // AUTO-NUMBERING
    // ============================================================

    function getNextAutoCode() {
      return FD.MarkerService.nextAutoCode(
        svgContainer.querySelectorAll('[data-door-id]'),
        autoPrefix,
        autoPadding
      );
    }

    function updateAutoPreview() {
      const preview = document.getElementById('auto-next-preview');
      if (!autoPrefix) { preview.textContent = '→ (voer prefix in)'; return; }
      preview.textContent = '→ ' + getNextAutoCode();
    }

    function toggleAutoNumbering() {
      autoNumbering = !autoNumbering;
      document.getElementById('btn-auto-number').classList.toggle('active', autoNumbering);
      const row = document.getElementById('auto-number-row');
      row.style.display = autoNumbering ? 'flex' : 'none';
      if (autoNumbering) {
        document.getElementById('auto-prefix-input').focus();
        updateAutoPreview();
      }
      requestAnimationFrame(updateTopbarHeight);
    }

    // ============================================================
    // EDIT LABELS
    // ============================================================

    function updateEditLabels() {
      removeEditLabels();
      if (!showLabels) return;
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;
      const ns = 'http://www.w3.org/2000/svg';
      const activeDoorId = movingMarker?.doorId || resizingMarker?.doorId || selectedDoor;
      const labels = FD.MarkerService.labelPlacements(svgContainer.querySelectorAll('[data-door-id]'), {
        scale,
        activeDoorId,
        bounds: FD.MarkerService.labelBounds(svgEl),
      });
      labels.forEach(label => {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', label.x.toString());
        text.setAttribute('y', label.y.toString());
        text.setAttribute('font-size', label.fontSize.toString());
        text.setAttribute('fill', '#222');
        text.setAttribute('stroke', '#fff');
        text.setAttribute('stroke-width', label.strokeWidth.toString());
        text.setAttribute('paint-order', 'stroke');
        text.setAttribute('text-anchor', label.anchor);
        text.setAttribute('data-fd-label', '1');
        text.setAttribute('pointer-events', 'none');
        text.style.userSelect = 'none';
        text.textContent = label.text;
        svgEl.appendChild(text);
        editLabelElements.push(text);
      });
    }

    function removeEditLabels() {
      editLabelElements.forEach(el => el.remove());
      editLabelElements = [];
    }

    function toggleLabels() {
      showLabels = !showLabels;
      localStorage.setItem(LABELS_STORAGE_KEY, showLabels ? '1' : '0');
      updateLabelsMenuButton();
      if (showLabels) updateEditLabels(); else removeEditLabels();
      hideTopbarMenu();
    }

    function updateLabelsMenuButton() {
      FD.UIShellService.updateLabelsButton(btnMenuLabels, showLabels);
    }

    function handleEditTapOnEmpty(e) {
      if (!isEditModeActive()) return;
      if (movingMarker) { cancelMoveMode(); return; }
      if (resizingMarker) { applyResize(); return; }
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;

      const svgPoint = getSvgPointFromClient(e.clientX, e.clientY);
      if (!svgPoint || !isPointInsideEditableBounds(svgPoint.x, svgPoint.y)) return;

      if (autoNumbering) {
        const code = getNextAutoCode();
        if (!code) { showToast('Voer eerst een prefix in', 'error'); return; }
        if (FD.MarkerService.markerExists(svgContainer, code)) {
          showToast('Code ' + code + ' bestaat al', 'error'); return;
        }
        addMarkerAtPosition(svgPoint.x, svgPoint.y, code);
        updateAutoPreview();
        return;
      }

      showEditPopup('Nieuwe deur', '', [
        {
          text: 'Toevoegen', color: '#34a853',
          action: () => {
            const code = editPopupInput.value.trim().toUpperCase();
            if (!code) return;
            if (FD.MarkerService.markerExists(svgContainer, code)) {
              editPopupError.textContent = 'Deze code bestaat al op deze plattegrond.';
              return;
            }
            addMarkerAtPosition(svgPoint.x, svgPoint.y, code);
            closeEditPopup();
          }
        },
        { text: 'Annuleren', color: '#e0e0e0', textColor: '#333', action: closeEditPopup }
      ]);
    }

    function handleEditTapOnDoor(doorId) {
      if (!isEditModeActive()) return;
      if (movingMarker) { cancelMoveMode(); return; }
      if (resizingMarker) { applyResize(); return; }
      const marker = FD.MarkerService.findMarkerByDoorId(svgContainer, doorId);
      if (!marker) return;
      showEditPopup('Deur: ' + doorId, null, [
        {
          text: 'Verplaatsen', color: '#7b1fa2',
          action: () => {
            closeEditPopup();
            const origCx = parseFloat(marker.getAttribute('cx')) || 0;
            const origCy = parseFloat(marker.getAttribute('cy')) || 0;
            startMoveMode(marker, doorId, origCx, origCy);
          }
        },
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
                  if (FD.MarkerService.markerExists(svgContainer, newCode)) {
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

    statusSync = FD.StatusSyncService.create(CONFIG, {
      setStatus: (nextStatus) => { doorStatus = nextStatus || {}; },
      isOnline: () => navigator.onLine,
      onQueueChange: () => updateStatusSyncIndicator(),
      onSynced: () => {
        refreshAllDoorColors();
        updateDoneButton();
        showToast('Status gesynchroniseerd', 'success');
      },
      onNetworkUnavailable: () => {},
      onSyncError: (err) => console.error('Status sync queue mislukt:', err),
    });

    const statusController = FD.StatusSyncService.createController({
      sync: statusSync,
      intervalMs: CONFIG.pollInterval,
      getStatus: () => doorStatus,
      setStatus: (nextStatus) => { doorStatus = nextStatus || {}; },
      getState: () => ({
        selectedDoor,
        currentCustomer,
        currentFloorplan,
        isEditMode: isEditModeActive(),
        online: navigator.onLine,
      }),
      onStatusChanged: refreshAllDoorColors,
      updateDoneButton,
      showToast,
      logger: console,
    });

    async function flushStatusSyncQueue() {
      return statusController.flush();
    }

    async function toggleDoorStatus() {
      return statusController.toggleDoorStatus();
    }

    function updateDoneButton() {
      doorActionController.updateDoneButton();
    }

    // ============================================================
    // PAN & ZOOM
    // ============================================================

    function fitToScreen(svgWidth, svgHeight) {
      const containerRect = svgContainer.getBoundingClientRect();
      // Account for info panel overlay by measuring actual height (0 when hidden)
      const infoPanelHeight = infoPanel.offsetHeight;
      const fit = FD.ViewportService.fitToBounds({
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
        overlayHeight: infoPanelHeight,
        contentWidth: svgWidth,
        contentHeight: svgHeight,
      });
      scale = fit.scale;
      panX = fit.panX;
      panY = fit.panY;
      // Save initial view for reset
      savedScale = scale;
      savedPanX = panX;
      savedPanY = panY;
      applyTransform();
      if (showLabels) updateEditLabels();
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

    function clampPanToVisibleMap() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;
      const vb = svgEl.viewBox.baseVal;
      if (!vb.width || !vb.height) return;

      const containerRect = svgContainer.getBoundingClientRect();
      const infoPanelHeight = infoPanel.offsetHeight || 0;
      const clamped = FD.ViewportService.clampPan({
        panX,
        panY,
        scale,
        contentWidth: vb.width,
        contentHeight: vb.height,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
        overlayHeight: infoPanelHeight,
      });
      panX = clamped.panX;
      panY = clamped.panY;
    }

    function applyTransform() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;
      clampPanToVisibleMap();
      svgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    }

    function getTouchDist(touches) {
      return FD.ViewportService.touchDistance(touches);
    }

    function getTouchCenter(touches) {
      return FD.ViewportService.touchCenter(touches);
    }

    // Pan via pointer events
    svgContainer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && e.isPrimary === false) return;

      if (movingMarker && pendingDoor === movingMarker.doorId) {
        const svgPoint = getSvgPointFromClient(e.clientX, e.clientY);
        if (svgPoint) {
          const cx = parseFloat(movingMarker.marker.getAttribute('cx')) || 0;
          const cy = parseFloat(movingMarker.marker.getAttribute('cy')) || 0;
          movingMarker.dragOffsetX = cx - svgPoint.x;
          movingMarker.dragOffsetY = cy - svgPoint.y;
        }
        isDraggingMove = true;
        isPanning = false;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        svgContainer.setPointerCapture(e.pointerId);
        return;
      }

      isPanning = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      lastPanX = panX;
      lastPanY = panY;
      svgContainer.setPointerCapture(e.pointerId);
    });

    svgContainer.addEventListener('pointermove', (e) => {
      if (isDraggingMove) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!hasMoved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        hasMoved = true;
        const svgPoint = getSvgPointFromClient(e.clientX, e.clientY);
        if (!svgPoint) return;
        const pos = clampMarkerPosition(
          svgPoint.x + movingMarker.dragOffsetX,
          svgPoint.y + movingMarker.dragOffsetY,
          getMarkerRadius(movingMarker.marker)
        );
        FD.MarkerService.setMarkerPosition(movingMarker.marker, pos.x, pos.y);
        return;
      }
      if (!isPanning) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
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
        if (movingMarker) cancelMoveMode();
        pendingDoor = null;
        return;
      }

      if (isDraggingMove) {
        isDraggingMove = false;
        if (hasMoved) {
          confirmMove();
        } else {
          cancelMoveMode();
        }
        pendingDoor = null;
        return;
      }

      if (!hasMoved && pendingDoor) {
        if (isEditModeActive()) {
          handleEditTapOnDoor(pendingDoor);
        } else {
          selectDoor(pendingDoor);
        }
      } else if (!hasMoved && !pendingDoor && isEditModeActive()) {
        handleEditTapOnEmpty(e);
      }
      pendingDoor = null;
    });

    svgContainer.addEventListener('pointercancel', () => {
      isPanning = false;
      if (movingMarker) cancelMoveMode(); else isDraggingMove = false;
      hasMoved = false;
      pendingDoor = null;
    });

    svgContainer.addEventListener('lostpointercapture', () => {
      isPanning = false;
      if (movingMarker) cancelMoveMode(); else isDraggingMove = false;
      hasMoved = false;
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
        const nextView = FD.ViewportService.zoomAtPoint({
          pointX: cx,
          pointY: cy,
          panX,
          panY,
          scale,
          nextScale: clampedScale,
        });
        panX = nextView.panX;
        panY = nextView.panY;
        scale = nextView.scale;

        applyTransform();
        if (showLabels) updateEditLabels();
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

      const nextView = FD.ViewportService.zoomAtPoint({
        pointX: cx,
        pointY: cy,
        panX,
        panY,
        scale,
        nextScale: newScale,
      });
      panX = nextView.panX;
      panY = nextView.panY;
      scale = nextView.scale;

      applyTransform();
      if (showLabels) updateEditLabels();
    }, { passive: false });

    // ============================================================
    // STATUS POLLING
    // ============================================================

    function startPolling() {
      statusController.startPolling();
    }

    function stopPolling() {
      statusController.stopPolling();
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
      sidePanelController.toggle();
    }

    function populateSidePanel() {
      sidePanelController.render();
    }

    function refreshSidePanel() {
      sidePanelController.refresh();
    }

    // ============================================================
    // UPLOAD FLOORPLAN
    // ============================================================

    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const uploadController = FD.UploadService.createUploadController({
      elements: {
        imageState: { dataUrl: null, width: 0, height: 0 },
        stepChoose: document.getElementById('upload-step-choose'),
        stepPreview: document.getElementById('upload-step-preview'),
        stepForm: document.getElementById('upload-step-form'),
        previewImg: document.getElementById('upload-preview-img'),
        previewTitle: document.querySelector('#upload-step-preview h3'),
        previewRetakeBtn: document.querySelector('#upload-step-preview .upload-btn-grey'),
        previewAcceptBtn: document.querySelector('#upload-step-preview .upload-btn-green'),
        customerSelect: document.getElementById('upload-customer-select'),
        newCustomerWrapper: document.getElementById('upload-new-customer-wrapper'),
        newCustomerInput: document.getElementById('upload-new-customer'),
        floorplanNameInput: document.getElementById('upload-floorplan-name'),
        errorEl: document.getElementById('upload-error'),
      },
      controls: {
        overlay: document.getElementById('upload-overlay'),
        popup: document.getElementById('upload-popup'),
        pdfInput: document.getElementById('upload-pdf-input'),
        photoInput: document.getElementById('upload-photo-input'),
        openButton: document.getElementById('btn-upload'),
        pdfButton: document.getElementById('btn-upload-pdf'),
        photoButton: document.getElementById('btn-upload-photo'),
        cancelChooseButton: document.getElementById('btn-upload-cancel-1'),
        retakeButton: document.getElementById('btn-upload-retake'),
        acceptButton: document.getElementById('btn-upload-accept'),
        saveButton: document.getElementById('btn-upload-save'),
        cancelFormButton: document.getElementById('btn-upload-cancel-3'),
        backToSelectButton: document.getElementById('btn-back-to-select'),
        fullscreenImage: document.getElementById('img-fullscreen-img'),
        fullscreenOverlay: document.getElementById('img-fullscreen-overlay'),
        fullscreenCloseButton: document.getElementById('img-fullscreen-close'),
      },
      getCustomers: () => customers,
      modeController: appMode,
      modes: AppModes,
      isEditMode: isEditModeActive,
      hideTopbarMenu,
      showToast,
      getPdfJsLib: () => window.pdfjsLib,
      onSave: async ({ form, fileName, svgText }) => {
        const { customers: currentCustomers } = await FD.DataService.addUploadedFloorplan(CONFIG, {
          customerName: form.customerName,
          floorplanName: form.floorplanName,
          fileName,
          svgText,
          isNewCustomer: form.isNewCustomer,
        });

        customers = currentCustomers;
        cacheCustomers();
        populateCustomerDropdown();
        return { customers: currentCustomers };
      },
      onSaved: ({ result, form }) => {
        const currentCustomers = result.customers;
        const newCi = currentCustomers.findIndex(c => c.customer === form.customerName);
        if (newCi < 0) return;
        customerSelect.value = newCi;
        populateFloorplanDropdown(newCi);
        const newFi = currentCustomers[newCi].floorplans.length - 1;
        floorplanSelect.value = newFi;
        updatePickerButtons();
        loadFloorplan(newCi, newFi);
      },
    });

    appMode.setHooks(AppModes.UPLOAD, {
      enter({ from }) {
        if (from === AppModes.UPLOAD_SAVING) return;
        uploadController.enterModeUI();
      },
      exit({ to }) {
        if (to === AppModes.UPLOAD_SAVING) return;
        uploadController.exitModeUI();
      },
    });

    appMode.setHooks(AppModes.UPLOAD_SAVING, {
      exit({ to }) {
        if (to === AppModes.UPLOAD) return;
        uploadController.exitModeUI();
      },
    });

    uploadController.bind();

    // ============================================================
    // DELETE UPLOADED FLOORPLAN
    // ============================================================

    const btnEditImage = document.getElementById('btn-edit-image');
    const uploadActionsController = FD.UploadService.createUploadedFloorplanActionsController({
      controls: {
        deleteButton: document.getElementById('btn-delete-fp'),
        editImageButton: btnEditImage,
        deleteOverlay: document.getElementById('delete-fp-overlay'),
        deletePopup: document.getElementById('delete-fp-popup'),
        deleteMessage: document.getElementById('delete-fp-message'),
        deleteConfirmButton: document.getElementById('delete-fp-confirm'),
        deleteCancelButton: document.getElementById('delete-fp-cancel'),
      },
      getSelectedFloorplan,
      modeController: appMode,
      isEditMode: isEditModeActive,
      hideTopbarMenu,
      showToast,
      requestTopbarUpdate: () => requestAnimationFrame(updateTopbarHeight),
      onDelete: async ({ customer, floorplan: fp }) => {
        const customerName = customer.customer;
        floorplanLoadController.cancel();
        stopPolling();
        const { customers: currentCustomers } = await FD.DataService.deleteUploadedFloorplan(CONFIG, {
          customerName,
          floorplan: fp,
        });

        // Reload
        customers = currentCustomers;
        cacheCustomers();
        populateCustomerDropdown();

        // Clear stale state
        currentFloorplan = null;
        currentCustomer = null;
        resetFloorplanUI();

        // Stay on same customer if still exists
        const remainingCi = currentCustomers.findIndex(c => c.customer === customerName);
        if (remainingCi >= 0) {
          customerSelect.value = remainingCi;
          populateFloorplanDropdown(remainingCi);
          floorplanSelect.value = '';
          updatePickerButtons();
          setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
          loadingEl.classList.remove('hidden');
        } else {
          customerSelect.value = '';
          customerSelect.dispatchEvent(new Event('change'));
        }
      },
    });

    function updateDeleteButton() {
      uploadActionsController.updateButtons();
    }

    uploadActionsController.bind();

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    selectionController.bind();

    btnJotform.addEventListener('click', openJotForm);
    btnDone.addEventListener('click', toggleDoorStatus);
    btnClose.addEventListener('click', deselectDoor);
    btnReset.addEventListener('click', resetZoom);
    btnPanelToggle.addEventListener('click', toggleSidePanel);
    btnEdit.addEventListener('click', enterEditMode);
    document.getElementById('btn-edit-save').addEventListener('click', saveEditMode);
    document.getElementById('btn-auto-number').addEventListener('click', toggleAutoNumbering);
    document.getElementById('auto-prefix-input').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
      autoPrefix = e.target.value.trim();
      updateAutoPreview();
    });
    document.getElementById('auto-padding-select').addEventListener('change', (e) => {
      autoPadding = parseInt(e.target.value, 10);
      updateAutoPreview();
    });

    FD.EditUIService.createCancelEditController({
      openButtonEl: document.getElementById('btn-edit-cancel'),
      overlayEl: document.getElementById('cancel-edit-overlay'),
      popupEl: document.getElementById('cancel-edit-popup'),
      confirmButtonEl: document.getElementById('cancel-edit-confirm'),
      cancelButtonEl: document.getElementById('cancel-edit-back'),
      hasPendingChanges: () => editChanges.length > 0 || resizingMarker || movingMarker,
      onCancel: cancelEditMode,
    }).bind();

    editOverlay.addEventListener('click', closeEditPopup);
    const markerSlider = document.getElementById('edit-marker-size');
    markerSizeSliderController = FD.EditUIService.createMarkerSizeSliderController({
      sliderEl: markerSlider,
      labelEl: document.getElementById('edit-size-label'),
      getMaxValue: () => resizingMarker ? getMaxRadiusAtPosition(resizingMarker.marker) : Infinity,
      onChange: (value) => {
        editMarkerSize = value;
        if (resizingMarker) {
          FD.MarkerService.setMarkerRadius(resizingMarker.marker, value);
        }
      },
    });

    function updateSliderValue(value) {
      markerSizeSliderController.setValue(value);
    }

    markerSizeSliderController.bind();

    // ============================================================
    // QR CODE SCANNER
    // ============================================================

    qrScannerController = FD.EditUIService.createQrScannerController({
      scanButtonEl: btnScanQr,
      closeButtonEl: document.getElementById('btn-qr-close'),
      overlayEl: document.getElementById('qr-overlay'),
      statusEl: document.getElementById('qr-status'),
      readerId: 'qr-reader',
      onScan: (decodedText) => {
        editPopupInput.value = decodedText.trim().toUpperCase();
        editPopupInput.focus();
      },
    });
    qrScannerController.bind();

    // ============================================================
    // LOGIN
    // ============================================================

    // Encrypted GitHub token (AES-256-GCM, key derived from password)
    const ENCRYPTED_TOKEN = {
      iv: 'V1BeyMFSJuUhGC9Q',
      tag: 'I+8b6Ih0dVsiQgDfip5xGQ==',
      data: 'vWek2PmH1d2ddAsF1rAMWhRAQN5WSrQgcGYhpcmLTKV8w0eIRfDLOw==',
    };

    const LOGIN_CONFIG = {
      passwordHash: '0123940987a658e40d82d640ba2084a0f11828593a9a3be547e3e764d45f5ed7',
      maxAttempts: 3,
      lockoutMinutes: 10,
      tokenKey: 'fd_auth_token',
      tokenTimeKey: 'fd_auth_time',
      lockoutKey: 'fd_lockout',
      attemptsKey: 'fd_attempts',
    };

    function showApp() {
      appMode.enter(AppModes.VIEW);
      document.getElementById('login-screen').style.display = 'none';
      appContainer.style.display = 'block';
      updateConnectionIndicator();
      updateStatusSyncIndicator();
      requestAnimationFrame(updateTopbarHeight);
      init();
    }

    // Menu toggle
    topbarMenuController.bind();
    btnMenuLabels.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLabels();
    });

    const authController = FD.AuthService.createAuthController({
      loginConfig: LOGIN_CONFIG,
      appConfig: CONFIG,
      encryptedToken: ENCRYPTED_TOKEN,
      elements: {
        splashScreen: document.getElementById('splash-screen'),
        loginScreen: document.getElementById('login-screen'),
        appContainer,
        passwordInput: document.getElementById('login-password'),
        rememberCheckbox: document.getElementById('login-remember'),
        loginButton: document.getElementById('login-btn'),
        errorEl: document.getElementById('login-error'),
      },
      logoutControls: {
        openButton: document.getElementById('btn-logout'),
        overlay: document.getElementById('logout-overlay'),
        popup: document.getElementById('logout-popup'),
        confirmButton: document.getElementById('logout-confirm'),
        cancelButton: document.getElementById('logout-cancel'),
      },
      modeController: appMode,
      modes: AppModes,
      emailConfig: {
        enabled: CONFIG.loginEmailNotificationsEnabled,
        publicKey: '3DTmVGOU0h5-m-l12',
        serviceId: 'service_in7o99q',
        templateId: 'template_j7na4ug',
      },
      hideTopbarMenu,
      showToast,
      onShowApp: showApp,
      onLogout: () => {
        resetAppToStartScreen();
        stopPolling();
      },
      onSessionExpired: () => {
        resetAppToStartScreen();
      },
    });

    authController.bind();

    // ============================================================
    // INIT
    // ============================================================

    async function init() {
      updateLabelsMenuButton();
      await Promise.all([loadCustomers(), loadStatus()]);
      await restoreJotFormReturnIfNeeded();
    }

    authController.start();

    // ============================================================
    // IMAGE EDITOR
    // ============================================================

    let editorCanvas, editorCtx, editorStage, editorScale = 1, editorBaseScale = 1, editorSavedScale = 1, editorSavedPanX = 0, editorSavedPanY = 0;
    let editorPanX = 0, editorPanY = 0, editorStartPanX = 0, editorStartPanY = 0, editorStartX = 0, editorStartY = 0;
    let editorTool = 'pan';
    let editorUndoStack = [];
    let cropRect = null, activeCropHandle = null;
    let editorSnapshot = null;
    let editorRafId = null;
    let eraseBrushSize = 30;
    let erasePointerDown = false, eraseLastPt = null;
    let editorSaving = false;
    let editorIsPanning = false, editorDragMode = null;
    let activeEditorPointers = new Map(), editorIsPinching = false, editorPinchDist = null, editorPinchMidX = 0, editorPinchMidY = 0;
    let editorCropper = null;
    let editorCropContext = null;
    let pendingCropSave = null;

    function getCurrentFloorplanObj() {
      return getSelectedFloorplan().floorplan;
    }

    function startCropperWhenEditorLayoutIsReady(cropImage, attempt = 0) {
      if (!editorCropContext) return;
      const overlay = document.getElementById('img-editor-overlay');
      const wrap = document.getElementById('img-editor-canvas-wrap');
      if (!overlay || !wrap || overlay.style.display === 'none') return;

      const layoutReady = wrap.clientWidth > 0 && wrap.clientHeight > 0 && cropImage.naturalWidth > 0 && cropImage.naturalHeight > 0;
      if (!layoutReady && attempt < 30) {
        requestAnimationFrame(() => startCropperWhenEditorLayoutIsReady(cropImage, attempt + 1));
        return;
      }
      if (!layoutReady) {
        showToast('Crop-tool kon de plattegrond niet openen', 'error');
        return;
      }

      if (editorCropper) {
        editorCropper.destroy();
        editorCropper = null;
      }
      editorCropper = new Cropper(cropImage, {
        viewMode: 1,
        autoCropArea: 1,
        dragMode: 'move',
        background: false,
        movable: true,
        zoomable: true,
        scalable: false,
        rotatable: false,
        responsive: true,
        restore: false,
        guides: true,
        ready() {
          if (!editorCropper || !editorCropContext) return;
          const imageData = editorCropper.getImageData();
          const naturalWidth = imageData.naturalWidth || cropImage.naturalWidth;
          const naturalHeight = imageData.naturalHeight || cropImage.naturalHeight;
          if (!naturalWidth || !naturalHeight) return;
          editorCropper.setData({
            x: 0,
            y: 0,
            width: naturalWidth,
            height: naturalHeight,
          });
        },
      });
    }

    function openImageEditor() {
      if (isEditModeActive()) { showToast('Sluit eerst de bewerkingsmodus', 'error'); return; }
      if (!appMode.isInteractiveView()) { showToast('Sluit eerst het huidige scherm', 'error'); return; }
      if (typeof Cropper === 'undefined') { showToast('Crop-tool kon niet worden geladen', 'error'); return; }
      if (document.getElementById('img-editor-overlay').style.display !== 'none') return;
      hideTopbarMenu();

      const svgEl = svgContainer.querySelector('svg');
      const svgImgEl = svgEl?.querySelector('image');
      if (!svgImgEl) { showToast('Geen afbeelding gevonden in plattegrond', 'error'); return; }
      const vb = svgEl?.viewBox?.baseVal;
      if (!vb || !vb.width || !vb.height) {
        showToast('Plattegrond heeft geen geldige afmetingen', 'error'); return;
      }
      const imageHref = svgImgEl.getAttribute('href') || svgImgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!imageHref || !imageHref.startsWith('data:image')) {
        showToast('Afbeelding kan niet worden geladen', 'error'); return;
      }
      editorStage = document.getElementById('img-editor-stage');
      editorCanvas = document.getElementById('img-editor-canvas');
      editorCtx = editorCanvas.getContext('2d');
      editorUndoStack = [];
      editorSaving = false;
      pendingCropSave = null;
      document.getElementById('img-editor-save').disabled = false;
      document.getElementById('img-editor-save').textContent = '\uD83D\uDCBE Opslaan';

      editorCropContext = {
        svgEl,
        svgImgEl,
        imageHref,
        vb: { x: vb.x || 0, y: vb.y || 0, width: vb.width, height: vb.height },
        imgX: parseFloat(svgImgEl.getAttribute('x') || '0') || 0,
        imgY: parseFloat(svgImgEl.getAttribute('y') || '0') || 0,
        imgW: parseFloat(svgImgEl.getAttribute('width') || String(vb.width)) || vb.width,
        imgH: parseFloat(svgImgEl.getAttribute('height') || String(vb.height)) || vb.height,
      };

      appMode.enter(AppModes.IMAGE_EDITOR, { imageHref });
    }

    function enterImageEditorModeUI(imageHref) {
      if (editorCropper) { editorCropper.destroy(); editorCropper = null; }
      const cropImage = document.getElementById('img-editor-crop-image');
      cropImage.onload = null;
      cropImage.onerror = null;
      cropImage.removeAttribute('src');
      cropImage.style.display = 'block';
      cropImage.onload = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => startCropperWhenEditorLayoutIsReady(cropImage));
        });
      };
      cropImage.onerror = () => showToast('Afbeelding laden mislukt', 'error');
      document.getElementById('img-editor-overlay').style.display = 'flex';
      cropImage.src = imageHref;
    }

    function waitForEditorLayoutAndFit(attempt = 0) {
      const wrap = document.getElementById('img-editor-canvas-wrap');
      if (!wrap || !editorCanvas || !editorCanvas.width || !editorCanvas.height) return;
      if ((!wrap.clientWidth || !wrap.clientHeight) && attempt < 20) {
        requestAnimationFrame(() => waitForEditorLayoutAndFit(attempt + 1));
        return;
      }
      fitEditorToScreen();
      setEditorTool('pan');
      if (attempt === 0) {
        requestAnimationFrame(() => {
          if (document.getElementById('img-editor-overlay').style.display !== 'none') {
            fitEditorToScreen();
          }
        });
        setTimeout(() => {
          if (document.getElementById('img-editor-overlay').style.display !== 'none') {
            fitEditorToScreen();
          }
        }, 120);
      }
    }

    function fitEditorToScreen() {
      const wrap = document.getElementById('img-editor-canvas-wrap');
      const wW = wrap.clientWidth, wH = wrap.clientHeight;
      if (!wW || !wH || !editorCanvas.width || !editorCanvas.height) return;
      editorBaseScale = Math.min(wW / editorCanvas.width, wH / editorCanvas.height) * 0.92;
      editorScale = editorBaseScale;
      editorPanX = (wW - editorCanvas.width * editorScale) / 2;
      editorPanY = (wH - editorCanvas.height * editorScale) / 2;
      editorSavedScale = editorScale;
      editorSavedPanX = editorPanX;
      editorSavedPanY = editorPanY;
      applyEditorViewport();
    }

    function updateEditorScale() {
      fitEditorToScreen();
    }

    function applyEditorViewport() {
      editorCanvas.style.width = editorCanvas.width + 'px';
      editorCanvas.style.height = editorCanvas.height + 'px';
      editorStage.style.width = editorCanvas.width + 'px';
      editorStage.style.height = editorCanvas.height + 'px';
      editorStage.style.transform = `translate(${editorPanX}px, ${editorPanY}px) scale(${editorScale})`;
      editorCanvas.classList.toggle('is-dragging', editorIsPanning && editorTool === 'pan');
      if (editorTool === 'pan') {
        editorCanvas.style.cursor = editorIsPanning ? 'grabbing' : 'grab';
      } else {
        editorCanvas.style.cursor = 'crosshair';
      }
    }

    function restoreEditorSnapshotToCanvas() {
      if (!editorSnapshot || !editorCanvas || !editorCtx) return false;
      if (editorSnapshot.width !== editorCanvas.width || editorSnapshot.height !== editorCanvas.height) return false;
      editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
      editorCtx.drawImage(editorSnapshot, 0, 0);
      return true;
    }

    function stopCropPreview({ restoreCanvas = true, clearSnapshot = false } = {}) {
      if (editorRafId) { cancelAnimationFrame(editorRafId); editorRafId = null; }
      if (restoreCanvas) restoreEditorSnapshotToCanvas();
      if (clearSnapshot) {
        editorSnapshot = null;
        cropRect = null;
        activeCropHandle = null;
      }
    }

    function exitImageEditorModeUI() {
      stopCropPreview({ restoreCanvas: false, clearSnapshot: true });
      if (editorCropper) { editorCropper.destroy(); editorCropper = null; }
      const cropImage = document.getElementById('img-editor-crop-image');
      if (cropImage) {
        cropImage.onload = null;
        cropImage.onerror = null;
        cropImage.removeAttribute('src');
      }
      document.getElementById('img-editor-overlay').style.display = 'none';
      editorUndoStack = [];
      cropRect = null; activeCropHandle = null;
      editorSaving = false;
      editorCropContext = null;
      pendingCropSave = null;
      editorTool = 'pan';
      if (editorCanvas) editorCanvas.dataset.tool = 'pan';
      editorIsPanning = false; editorDragMode = null;
      activeEditorPointers.clear(); editorIsPinching = false; editorPinchDist = null;
      hideCropOutsideConfirm();
    }

    appMode.setHooks(AppModes.IMAGE_EDITOR, {
      enter({ from, context }) {
        if (from === AppModes.IMAGE_EDITOR_SAVING) return;
        enterImageEditorModeUI(context.imageHref);
      },
      exit({ to }) {
        if (to === AppModes.IMAGE_EDITOR_SAVING) return;
        exitImageEditorModeUI();
      },
    });

    appMode.setHooks(AppModes.IMAGE_EDITOR_SAVING, {
      exit({ to }) {
        if (to === AppModes.IMAGE_EDITOR) return;
        exitImageEditorModeUI();
      },
    });

    function closeImageEditor() {
      if (appMode.isAny([AppModes.IMAGE_EDITOR, AppModes.IMAGE_EDITOR_SAVING])) appMode.enter(AppModes.VIEW);
      else exitImageEditorModeUI();
    }

    function setEditorTool(tool) {
      if (editorCropper) return;
      editorTool = tool;

      document.getElementById('img-editor-tool-pan').classList.toggle('active', tool === 'pan');
      document.getElementById('img-editor-tool-crop').classList.toggle('active', tool === 'crop');
      document.getElementById('img-editor-tool-erase').classList.toggle('active', tool === 'erase');
      document.getElementById('img-editor-brush-row').style.display = tool === 'erase' ? 'flex' : 'none';
      document.getElementById('img-editor-apply-crop').style.display = tool === 'crop' ? '' : 'none';
      stopCropPreview({ restoreCanvas: true, clearSnapshot: true });
      erasePointerDown = false; eraseLastPt = null;
      editorIsPanning = false; editorDragMode = null;
      editorCanvas.dataset.tool = tool;
      applyEditorViewport();

      if (tool === 'crop') {
        editorSnapshot = document.createElement('canvas');
        editorSnapshot.width  = editorCanvas.width;
        editorSnapshot.height = editorCanvas.height;
        editorSnapshot.getContext('2d').drawImage(editorCanvas, 0, 0);
        cropRect = { x: 0, y: 0, w: editorCanvas.width, h: editorCanvas.height };
        activeCropHandle = null;
        editorRafId = requestAnimationFrame(renderEditorFrame);
      }
    }

    function renderEditorFrame() {
      if (editorTool !== 'crop' || !editorSnapshot || !cropRect) {
        editorRafId = null;
        return;
      }
      if (!editorBaseScale) {
        fitEditorToScreen();
        editorRafId = requestAnimationFrame(renderEditorFrame);
        return;
      }
      editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
      editorCtx.drawImage(editorSnapshot, 0, 0);

      const { x, y, w, h } = cropRect;
      const lw = Math.max(1, 1.5 / editorScale);
      const hs = Math.max(12, 22 / editorScale); // corner bracket arm length

      // dim outside crop area
      editorCtx.fillStyle = 'rgba(0,0,0,0.45)';
      editorCtx.fillRect(0, 0, editorCanvas.width, y);
      editorCtx.fillRect(0, y + h, editorCanvas.width, editorCanvas.height - y - h);
      editorCtx.fillRect(0, y, x, h);
      editorCtx.fillRect(x + w, y, editorCanvas.width - x - w, h);

      editorCtx.save();
      editorCtx.shadowColor = 'rgba(0,0,0,0.85)';
      editorCtx.shadowBlur = Math.max(3, 6 / editorScale);

      // thin border
      editorCtx.strokeStyle = 'rgba(255,140,0,0.9)';
      editorCtx.lineWidth = lw;
      editorCtx.strokeRect(x, y, w, h);

      // corner brackets
      editorCtx.strokeStyle = '#ff8c00';
      editorCtx.lineWidth = Math.max(2, 3.5 / editorScale);
      editorCtx.lineCap = 'square';
      const corners = [
        [x,     y,     hs,  0,  0,  hs],
        [x + w, y,    -hs,  0,  0,  hs],
        [x,     y + h, hs,  0,  0, -hs],
        [x + w, y + h,-hs,  0,  0, -hs],
      ];
      corners.forEach(([cx, cy, dx1, dy1, dx2, dy2]) => {
        editorCtx.beginPath();
        editorCtx.moveTo(cx + dx1, cy + dy1);
        editorCtx.lineTo(cx, cy);
        editorCtx.lineTo(cx + dx2, cy + dy2);
        editorCtx.stroke();
      });

      // edge handles (small filled squares)
      const es = Math.max(5, 8 / editorScale);
      editorCtx.fillStyle = '#ff8c00';
      [[x + w/2, y], [x + w/2, y + h], [x, y + h/2], [x + w, y + h/2]].forEach(([hx, hy]) => {
        editorCtx.fillRect(hx - es/2, hy - es/2, es, es);
      });

      editorCtx.restore();
      editorRafId = requestAnimationFrame(renderEditorFrame);
    }

    function zoomEditorAt(clientX, clientY, factor) {
      if (!editorBaseScale || !editorScale) return;
      const wrap = document.getElementById('img-editor-canvas-wrap');
      const rect = wrap.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const newScale = Math.max(0.02, Math.min(10, editorScale * factor));
      editorPanX = cx - (cx - editorPanX) * (newScale / editorScale);
      editorPanY = cy - (cy - editorPanY) * (newScale / editorScale);
      editorScale = newScale;
      applyEditorViewport();
    }

    function startEditorPan(e) {
      editorIsPanning = true;
      editorStartX = e.clientX;
      editorStartY = e.clientY;
      editorStartPanX = editorPanX;
      editorStartPanY = editorPanY;
      applyEditorViewport();
    }

    function editorClientToCanvas(e) {
      const rect = editorCanvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      const sx = rect.width  > 0 ? editorCanvas.width  / rect.width  : 1;
      const sy = rect.height > 0 ? editorCanvas.height / rect.height : 1;
      return {
        x: Math.round((src.clientX - rect.left) * sx),
        y: Math.round((src.clientY - rect.top)  * sy),
      };
    }

    function getCropHandle(pt) {
      const { x, y, w, h } = cropRect;
      const r = Math.max(18, 28 / editorScale);
      const hits = {
        tl: [x,     y    ], tr: [x + w, y    ],
        bl: [x,     y + h], br: [x + w, y + h],
        tm: [x+w/2, y    ], bm: [x+w/2, y + h],
        lm: [x,     y+h/2], rm: [x + w, y+h/2],
      };
      for (const [name, [hx, hy]] of Object.entries(hits)) {
        if (Math.abs(pt.x - hx) < r && Math.abs(pt.y - hy) < r) return name;
      }
      return null;
    }

    function moveCropHandle(handle, pt) {
      const MIN = 20;
      let { x, y, w, h } = cropRect;
      const cW = editorCanvas.width, cH = editorCanvas.height;
      if (handle === 'tl' || handle === 'lm' || handle === 'bl') {
        const nx = Math.max(0, Math.min(pt.x, x + w - MIN));
        w += x - nx; x = nx;
      }
      if (handle === 'tr' || handle === 'rm' || handle === 'br') {
        w = Math.max(MIN, Math.min(pt.x - x, cW - x));
      }
      if (handle === 'tl' || handle === 'tm' || handle === 'tr') {
        const ny = Math.max(0, Math.min(pt.y, y + h - MIN));
        h += y - ny; y = ny;
      }
      if (handle === 'bl' || handle === 'bm' || handle === 'br') {
        h = Math.max(MIN, Math.min(pt.y - y, cH - y));
      }
      cropRect = { x, y, w, h };
    }

    function eraseAt(from, to) {
      editorCtx.save();
      editorCtx.strokeStyle = 'white';
      editorCtx.lineWidth = eraseBrushSize;
      editorCtx.lineCap = 'round';
      editorCtx.lineJoin = 'round';
      editorCtx.beginPath();
      editorCtx.moveTo(from.x, from.y);
      editorCtx.lineTo(to.x, to.y);
      editorCtx.stroke();
      editorCtx.restore();
    }

    function editorPointerDown(e) {
      if (editorCropper) return;
      e.preventDefault();
      editorCanvas.setPointerCapture(e.pointerId);
      activeEditorPointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

      if (activeEditorPointers.size >= 2) {
        // entering pinch mode — cancel any active tool operation
        editorIsPinching = true;
        erasePointerDown = false; eraseLastPt = null;
        activeCropHandle = null;
        const pts = [...activeEditorPointers.values()];
        const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
        editorPinchDist = Math.sqrt(dx * dx + dy * dy);
        editorPinchMidX = (pts[0].x + pts[1].x) / 2;
        editorPinchMidY = (pts[0].y + pts[1].y) / 2;
        return;
      }

      if (editorIsPinching) return;

      const pt = editorClientToCanvas(e);
      editorDragMode = null;

      if (editorTool === 'crop') {
        activeCropHandle = getCropHandle(pt);
        if (activeCropHandle) {
          editorDragMode = 'crop';
        } else {
          startEditorPan(e);
          editorDragMode = 'pan';
        }

      } else if (editorTool === 'erase') {
        erasePointerDown = true;
        editorPushUndo();
        eraseLastPt = pt;
        eraseAt(pt, pt);
        editorDragMode = 'erase';

      } else {
        startEditorPan(e);
        editorDragMode = 'pan';
      }
    }

    function editorPointerMove(e) {
      if (editorCropper) return;
      e.preventDefault();
      activeEditorPointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

      if (activeEditorPointers.size >= 2 && editorIsPinching) {
        const pts = [...activeEditorPointers.values()];
        const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        if (editorPinchDist > 0) {
          zoomEditorAt(midX, midY, dist / editorPinchDist);
        }
        editorPinchDist = dist;
        editorPinchMidX = midX;
        editorPinchMidY = midY;
        return;
      }

      if (editorIsPinching) return;

      if (editorDragMode === 'crop' && activeCropHandle) {
        const pt = editorClientToCanvas(e);
        moveCropHandle(activeCropHandle, pt);

      } else if (editorDragMode === 'erase' && erasePointerDown) {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
          const pt = editorClientToCanvas(ev);
          eraseAt(eraseLastPt, pt);
          eraseLastPt = pt;
        }

      } else if (editorDragMode === 'pan' && editorIsPanning) {
        editorPanX = editorStartPanX + (e.clientX - editorStartX);
        editorPanY = editorStartPanY + (e.clientY - editorStartY);
        applyEditorViewport();
      }
    }

    function editorPointerUp(e) {
      if (editorCropper) return;
      if (e && editorCanvas.hasPointerCapture(e.pointerId)) {
        editorCanvas.releasePointerCapture(e.pointerId);
      }
      activeEditorPointers.delete(e.pointerId);

      if (editorIsPinching) {
        if (activeEditorPointers.size === 0) {
          editorIsPinching = false;
          editorPinchDist = null;
        }
        return;
      }

      if (editorDragMode === 'crop') {
        activeCropHandle = null;

      } else if (editorDragMode === 'erase' && erasePointerDown) {
        erasePointerDown = false;
        eraseLastPt = null;

      }
      editorIsPanning = false;
      editorDragMode = null;
      applyEditorViewport();
    }

    function editorPushUndo() {
      const sourceCanvas = editorSnapshot || editorCanvas;
      editorUndoStack.push(sourceCanvas.toDataURL('image/jpeg', 0.8));
      if (editorUndoStack.length > 10) editorUndoStack.shift();
      document.getElementById('img-editor-undo').disabled = false;
    }

    function rotateCanvas90(direction) {
      if (editorCropper) return;
      stopCropPreview({ restoreCanvas: true, clearSnapshot: true });
      editorPushUndo();
      const w = editorCanvas.width, h = editorCanvas.height;
      const tmp = document.createElement('canvas');
      tmp.width = h; tmp.height = w;
      const tctx = tmp.getContext('2d');
      tctx.translate(h / 2, w / 2);
      tctx.rotate(direction * Math.PI / 2);
      tctx.drawImage(editorCanvas, -w / 2, -h / 2);
      editorCanvas.width = h; editorCanvas.height = w;
      editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
      editorCtx.drawImage(tmp, 0, 0);
      fitEditorToScreen();
      if (editorTool === 'crop') setEditorTool('crop');
    }

    function editorUndo() {
      if (editorCropper) return;
      if (!editorUndoStack.length) return;
      stopCropPreview({ restoreCanvas: false, clearSnapshot: true });
      erasePointerDown = false;
      eraseLastPt = null;
      const dataUrl = editorUndoStack.pop();
      const img = new Image();
      img.onload = () => {
        editorCanvas.width  = img.naturalWidth;
        editorCanvas.height = img.naturalHeight;
        editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
        editorCtx.drawImage(img, 0, 0);
        fitEditorToScreen();
        if (editorTool === 'crop') setEditorTool('crop');
      };
      img.src = dataUrl;
      document.getElementById('img-editor-undo').disabled = editorUndoStack.length === 0;
    }

    function applyEditorCrop() {
      if (editorCropper) return;
      if (!cropRect) return;
      const { x, y, w, h } = cropRect;
      if (w < 10 || h < 10) return;

      editorPushUndo();

      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d').drawImage(editorSnapshot, x, y, w, h, 0, 0, w, h);

      editorCanvas.width  = w;
      editorCanvas.height = h;
      editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
      editorCtx.drawImage(tmp, 0, 0);
      fitEditorToScreen();
      document.getElementById('img-editor-apply-crop').style.display = 'none';
      setEditorTool('pan');
      showToast('Uitsnede toegepast', 'success');
    }

    function getCropSavePlan() {
      if (!editorCropper || !editorCropContext) return null;
      const cropData = editorCropper.getData(true);
      const imageData = editorCropper.getImageData();
      const naturalWidth = imageData.naturalWidth || document.getElementById('img-editor-crop-image').naturalWidth;
      const naturalHeight = imageData.naturalHeight || document.getElementById('img-editor-crop-image').naturalHeight;
      return FD.ImageEditorService.buildCropSavePlan({
        cropData,
        naturalWidth,
        naturalHeight,
        cropContext: editorCropContext,
        markers: svgContainer.querySelectorAll('[data-door-id]'),
      });
    }

    function showCropOutsideConfirm(codes, onConfirm) {
      pendingCropSave = onConfirm;
      document.getElementById('crop-outside-codes').textContent = codes.join(', ');
      document.getElementById('crop-outside-overlay').style.display = 'block';
      document.getElementById('crop-outside-popup').style.display = 'block';
    }

    function hideCropOutsideConfirm() {
      const overlay = document.getElementById('crop-outside-overlay');
      const popup = document.getElementById('crop-outside-popup');
      if (overlay) overlay.style.display = 'none';
      if (popup) popup.style.display = 'none';
      pendingCropSave = null;
    }

    async function saveEditorChanges({ confirmedOutsideDoors = false } = {}) {
      if (editorSaving) return;
      const fp = getCurrentFloorplanObj();
      if (!fp) { showToast('Geen plattegrond geselecteerd', 'error'); return; }
      const plan = getCropSavePlan();
      if (!plan) { showToast('Geen geldige uitsnede', 'error'); return; }
      if (plan.outsideDoorCodes.length && !confirmedOutsideDoors) {
        showCropOutsideConfirm(plan.outsideDoorCodes, () => saveEditorChanges({ confirmedOutsideDoors: true }));
        return;
      }

      const btnSave = document.getElementById('img-editor-save');
      btnSave.disabled = true;
      btnSave.textContent = 'Opslaan...';
      editorSaving = true;
      appMode.enter(AppModes.IMAGE_EDITOR_SAVING);

      try {
        const outputCanvas = editorCropper.getCroppedCanvas({
          width: Math.max(1, Math.round(plan.cropW)),
          height: Math.max(1, Math.round(plan.cropH)),
          fillColor: '#fff',
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        });
        const newDataUrl = FD.ImageEditorService.canvasToLimitedJPEG(outputCanvas);
        const svgText = FD.ImageEditorService.buildCroppedSVGText({
          svgEl: editorCropContext.svgEl,
          imageDataUrl: newDataUrl,
          plan,
          markerService: FD.MarkerService,
        });
        const fileUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fp.file);
        await FD.DataService.saveFloorplanSVG(fileUrl, svgText, {
          message: 'Afbeelding bewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
          fetchErrorMessage: 'Kon bestand niet ophalen ({status})',
          saveErrorMessage: 'Opslaan mislukt ({status})',
        });

        closeImageEditor();
        showToast('Afbeelding opgeslagen', 'success');
        const { customerIndex, floorplanIndex, floorplan } = getSelectedFloorplan();
        if (customerIndex !== null && floorplanIndex !== null && floorplan) {
          loadFloorplan(customerIndex, floorplanIndex);
        }

      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        editorSaving = false;
        if (appMode.is(AppModes.IMAGE_EDITOR_SAVING)) appMode.enter(AppModes.IMAGE_EDITOR);
        btnSave.disabled = false;
        btnSave.textContent = '\uD83D\uDCBE Opslaan';
      }
    }

    // Editor cancel confirmation popup
    const editorCancelOverlay = document.getElementById('editor-cancel-overlay');
    const editorCancelPopup   = document.getElementById('editor-cancel-popup');

    function showEditorCancelConfirm() {
      editorCancelOverlay.style.display = 'block';
      editorCancelPopup.style.display   = 'block';
    }
    function hideEditorCancelConfirm() {
      editorCancelOverlay.style.display = 'none';
      editorCancelPopup.style.display   = 'none';
    }

    // Event wiring — editor
    btnEditImage.addEventListener('click', openImageEditor);

    document.getElementById('img-editor-cancel').addEventListener('click', () => {
      if (editorUndoStack.length > 0) {
        showEditorCancelConfirm();
      } else {
        closeImageEditor();
      }
    });

    document.getElementById('editor-cancel-confirm').addEventListener('click', () => {
      hideEditorCancelConfirm();
      closeImageEditor();
    });
    document.getElementById('editor-cancel-back').addEventListener('click', hideEditorCancelConfirm);
    editorCancelOverlay.addEventListener('click', hideEditorCancelConfirm);
    document.getElementById('crop-outside-cancel').addEventListener('click', hideCropOutsideConfirm);
    document.getElementById('crop-outside-overlay').addEventListener('click', hideCropOutsideConfirm);
    document.getElementById('crop-outside-confirm').addEventListener('click', () => {
      const next = pendingCropSave;
      hideCropOutsideConfirm();
      if (next) next();
    });

    document.getElementById('img-editor-undo').addEventListener('click', editorUndo);
    document.getElementById('img-editor-tool-pan').addEventListener('click', () => setEditorTool('pan'));
    document.getElementById('img-editor-tool-crop').addEventListener('click', () => showToast('Sleep de hoeken om de uitsnede aan te passen', 'success'));
    document.getElementById('img-editor-tool-erase').addEventListener('click', () => setEditorTool('erase'));
    document.getElementById('img-editor-tool-rotate-left').addEventListener('click', () => rotateCanvas90(-1));
    document.getElementById('img-editor-tool-rotate-right').addEventListener('click', () => rotateCanvas90(1));
    document.getElementById('img-editor-apply-crop').addEventListener('click', applyEditorCrop);
    document.getElementById('img-editor-save').addEventListener('click', saveEditorChanges);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (document.getElementById('img-editor-overlay').style.display !== 'none') {
          e.preventDefault();
          editorUndo();
        }
      }
    });

    document.getElementById('img-editor-brush-slider').addEventListener('input', (e) => {
      eraseBrushSize = parseInt(e.target.value, 10);
      document.getElementById('img-editor-brush-val').textContent = eraseBrushSize;
    });

    editorStage = document.getElementById('img-editor-stage');
    editorCanvas = document.getElementById('img-editor-canvas');
    editorCanvas.addEventListener('pointerdown',   editorPointerDown,  { passive: false });
    editorCanvas.addEventListener('pointermove',   editorPointerMove,  { passive: false });
    editorCanvas.addEventListener('pointerup',     editorPointerUp);
    editorCanvas.addEventListener('pointercancel', editorPointerUp);
    editorCanvas.addEventListener('lostpointercapture', () => {
      editorIsPanning = false;
      editorDragMode = null;
      erasePointerDown = false;
      eraseLastPt = null;
      activeCropHandle = null;
      applyEditorViewport();
    });

    document.getElementById('img-editor-canvas-wrap').addEventListener('wheel', (e) => {
      if (editorCropper) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomEditorAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    window.addEventListener('resize', () => {
      if (document.getElementById('img-editor-overlay').style.display !== 'none') {
        if (editorCropper) return;
        fitEditorToScreen();
      }
    });

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
