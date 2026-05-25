    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {
      svgBaseUrl: 'fd-floorplan://gallery/',
      svgUploadsUrl: 'fd-floorplan://uploads/',
      workerApiBaseUrl: 'https://floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev',
      workerReadProxyFlagKey: 'fd_use_worker_read_proxy',
      workerReadProxyEnabled: true,
      workerSessionAuthFlagKey: 'fd_use_worker_auth',
      workerSessionTokenKey: 'fd_worker_session_token',
      workerSessionExpiresKey: 'fd_worker_session_expires_at',
      workerSessionUserKey: 'fd_worker_session_user',
      workerStatusWriteFlagKey: 'fd_use_worker_status_write',
      workerStatusWriteEnabled: true,
      workerFloorplanWriteFlagKey: 'fd_use_worker_floorplan_write',
      workerFloorplanWriteEnabled: true,
      workerUploadWriteFlagKey: 'fd_use_worker_upload_write',
      workerUploadWriteEnabled: true,
      workerStatusWriteTestCustomer: '--- TEST ---',
      jotformBaseUrl: 'https://eu.jotform.com/',
      jotformFormId: '250122093908351',
      loginEmailNotificationsEnabled: true,
      appTimeZone: 'Europe/Amsterdam',
      pollInterval: 30000,
      sessionHeartbeatInterval: 60000,
      adminActiveUsersPollInterval: 60000,
      jotformReturnRefreshInterval: 2000,
      jotformReturnRefreshMaxDuration: 90000,
      versionCheckUrl: 'version.json',
      versionCheckInterval: 15 * 60 * 1000,
      offlineCacheVersion: 'fd-v1.8.155',
    };

    const COLORS = {
      todo: '#1a73e8',
      done: '#34a853',
      attention: '#d93025',
      checking: '#b8c0cc',
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
    let currentUser = null;
    let customersLoading = false;
    const AppModes = FD.ModeService.MODES;
    const appMode = FD.ModeService.createModeController(AppModes.LOGIN);
    let statusSync = null;
    let jotformReturnRefreshTimer = null;
    let jotformSubmissionLookupRetryTimer = null;
    let sessionHeartbeatTimer = null;
    let sessionHeartbeatInFlight = false;
    let adminActiveUsersPollTimer = null;
    let adminActiveUsersInFlight = false;
    let jotformFocusRefreshDoorId = null;
    let jotformFocusRefreshUntil = 0;
    let jotformFocusBaselineSubmission = null;
    const jotformManualNewFormHints = new Map();
    let serviceWorkerRegistration = null;
    let updateCheckTimer = null;
    let pendingAppUpdate = null;
    let doorActionController = null;
    let jotformSubmissionCache = {
      key: '',
      ready: false,
      loading: false,
      submissions: {},
      checkedDoors: {},
      allChecked: false,
      requestId: 0,
      pending: null,
    };
    let doorCodeIndexState = {
      ready: false,
      loading: false,
      entries: [],
      byCode: new Map(),
      requestId: 0,
      pending: null,
      error: null,
    };
    let adminDashboardState = {
      visible: false,
      loading: false,
      data: null,
      selectedKey: '',
      selectedCustomer: '',
      searchQuery: '',
      doorQuery: '',
      doorOrder: 'asc',
      doorCustomerFilter: '',
      doorFloorplanFilter: '',
      activeTab: 'overview',
      selectedDoorKey: '',
      activity: [],
      activityLoading: false,
      activityError: '',
      activityUnavailable: false,
      previewKey: '',
      previewRequestId: 0,
      metadataRecord: null,
    };

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
    let topbarFloorplanActionsLocked = false;

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
    const accountIndicator = document.getElementById('account-indicator');
    const accountLabel = document.getElementById('account-label');
    const syncIndicator = document.getElementById('sync-indicator');
    const syncLabel = document.getElementById('sync-label');
    const appUpdateButton = document.getElementById('btn-app-update');
    const appUpdateOverlay = document.getElementById('app-update-overlay');
    const appUpdatePopup = document.getElementById('app-update-popup');
    const appUpdateMessage = document.getElementById('app-update-message');
    const appUpdateConfirmButton = document.getElementById('app-update-confirm');
    const appUpdateLaterButton = document.getElementById('app-update-later');
    const busyOverlayEl = document.getElementById('busy-overlay');
    const btnDashboard = document.getElementById('btn-dashboard');
    const btnTopbarMetadata = document.getElementById('btn-topbar-metadata');
    const adminDashboardEl = document.getElementById('admin-dashboard');
    const adminDashboardRefresh = document.getElementById('admin-dashboard-refresh');
    const adminDashboardTabs = Array.from(document.querySelectorAll('[data-admin-tab]'));
    const adminDashboardTabPanels = Array.from(document.querySelectorAll('[data-admin-panel]'));
    const adminOverviewAttention = document.getElementById('admin-overview-attention');
    const adminOverviewOpen = document.getElementById('admin-overview-open');
    const adminActivityList = document.getElementById('admin-activity-list');
    const adminDashboardSearch = document.getElementById('admin-dashboard-search');
    const adminCustomerFilters = document.getElementById('admin-customer-filters');
    const adminDoorSearch = document.getElementById('admin-door-search');
    const adminDoorGroup = document.getElementById('admin-door-group');
    const adminDoorCustomerFilter = document.getElementById('admin-door-customer-filter');
    const adminDoorFloorplanFilter = document.getElementById('admin-door-floorplan-filter');
    const adminDoorResults = document.getElementById('admin-door-results');
    const adminMetadataDialogOverlay = document.getElementById('admin-metadata-dialog-overlay');
    const adminMetadataDialog = document.getElementById('admin-metadata-dialog');
    const adminMetadataDialogContext = document.getElementById('admin-metadata-dialog-context');
    const adminDetailCancel = document.getElementById('admin-detail-cancel');
    const adminFloorplanList = document.getElementById('admin-floorplan-list');
    const adminFloorplanCount = document.getElementById('admin-floorplan-count');
    const adminDetailEmpty = document.getElementById('admin-detail-empty');
    const adminDetailContent = document.getElementById('admin-detail-content');
    const adminDetailPreview = document.getElementById('admin-detail-preview');
    const adminDetailTitle = document.getElementById('admin-detail-title');
    const adminDetailMeta = document.getElementById('admin-detail-meta');
    const adminDetailOpen = document.getElementById('admin-detail-open');
    const adminDetailStats = document.getElementById('admin-detail-stats');
    const adminDetailCustomer = document.getElementById('admin-detail-customer');
    const adminDetailBuilding = document.getElementById('admin-detail-building');
    const adminDetailFloorLabel = document.getElementById('admin-detail-floor-label');
    const adminDetailError = document.getElementById('admin-detail-error');
    const adminDetailSave = document.getElementById('admin-detail-save');
    const adminDetailDelete = document.getElementById('admin-detail-delete');
    const adminDoorDetailCard = document.getElementById('admin-door-detail-card');
    const adminDoorDetailDot = document.getElementById('admin-door-detail-dot');
    const adminDoorDetailCode = document.getElementById('admin-door-detail-code');
    const adminDoorDetailStatus = document.getElementById('admin-door-detail-status');
    const adminDoorDetailMeta = document.getElementById('admin-door-detail-meta');
    const adminDoorDetailOpen = document.getElementById('admin-door-detail-open');
    const adminKpiEls = {
      customers: document.getElementById('admin-kpi-customers'),
      floorplans: document.getElementById('admin-kpi-floorplans'),
      doors: document.getElementById('admin-kpi-doors'),
      open: document.getElementById('admin-kpi-open'),
      done: document.getElementById('admin-kpi-done'),
      attention: document.getElementById('admin-kpi-attention'),
    };
    const adminOnlineEls = {
      admin: document.getElementById('admin-online-admin'),
      monteur: document.getElementById('admin-online-monteur'),
      viewer: document.getElementById('admin-online-viewer'),
    };
    const topbarMenu = document.getElementById('topbar-menu');
    const btnTopbarMenu = document.getElementById('btn-menu');
    const btnMenuLabels = document.getElementById('btn-menu-labels');
    const btnReportProblem = document.getElementById('btn-report-problem');
    const reportProblemOverlay = document.getElementById('report-problem-overlay');
    const reportProblemPopup = document.getElementById('report-problem-popup');
    const reportProblemCategory = document.getElementById('report-problem-category');
    const reportProblemText = document.getElementById('report-problem-text');
    const reportProblemError = document.getElementById('report-problem-error');
    const reportProblemSubmit = document.getElementById('report-problem-submit');
    const reportProblemCancel = document.getElementById('report-problem-cancel');
    const topbarMenuController = FD.UIShellService.createTopbarMenu({
      toggleButtonEl: btnTopbarMenu,
      menuEl: topbarMenu,
      documentEl: document,
    });
    const appUpdateDialog = FD.UIShellService.createPopupPair({
      overlayEl: appUpdateOverlay,
      popupEl: appUpdatePopup,
    });
    const busyOverlay = FD.UIShellService.createBusyOverlayController({
      overlayEl: busyOverlayEl,
    });
    const reportProblemDialog = FD.UIShellService.createPopupPair({
      overlayEl: reportProblemOverlay,
      popupEl: reportProblemPopup,
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
        applyTransform();
        if (showLabels) updateEditLabels();
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
    let lastToast = null;

    function showToast(message, type) {
      lastToast = { message: String(message || ''), type: String(type || ''), at: new Date().toISOString() };
      toastController.show(message, type);
    }

    function normalizeRemoteVersion(data) {
      const version = String(data?.version || '').trim();
      const cache = String(data?.cache || '').trim();
      const normalizedCache = cache || (version ? `fd-v${version}` : '');
      const normalizedVersion = version || normalizedCache.replace(/^fd-v/, '');
      if (!normalizedCache || !normalizedVersion) return null;
      return {
        version: normalizedVersion,
        cache: normalizedCache,
      };
    }

    function setAppUpdateAvailable(update) {
      pendingAppUpdate = update || null;
      if (!appUpdateButton) return;
      appUpdateButton.hidden = !pendingAppUpdate;
      appUpdateButton.title = pendingAppUpdate
        ? `Nieuwe versie ${pendingAppUpdate.version} beschikbaar`
        : '';
      requestAnimationFrame(updateTopbarHeight);
    }

    function appUpdateCheckUrl() {
      const url = new URL(CONFIG.versionCheckUrl, window.location.href);
      url.searchParams.set('_', String(Date.now()));
      return url.toString();
    }

    async function checkForAppUpdate() {
      if (navigator.onLine === false) return false;
      try {
        const response = await fetch(appUpdateCheckUrl(), {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) return false;
        const remote = normalizeRemoteVersion(await response.json());
        const available = Boolean(remote && remote.cache !== CONFIG.offlineCacheVersion);
        setAppUpdateAvailable(available ? remote : null);
        return available;
      } catch (err) {
        return false;
      }
    }

    function showAppUpdateDialog() {
      if (!pendingAppUpdate) return;
      if (!appMode.isInteractiveView()) {
        showToast('Rond eerst je bewerking af voordat je bijwerkt', 'error');
        return;
      }
      if (appUpdateMessage) {
        appUpdateMessage.textContent = `Versie ${pendingAppUpdate.version} is beschikbaar. Bijwerken duurt een paar seconden.`;
      }
      appUpdateDialog.show();
    }

    function hideAppUpdateDialog() {
      appUpdateDialog.hide();
      if (appUpdateConfirmButton) {
        appUpdateConfirmButton.disabled = false;
        appUpdateConfirmButton.textContent = 'Bijwerken';
      }
    }

    async function applyAppUpdate() {
      if (!pendingAppUpdate) return;
      if (!appMode.isInteractiveView()) {
        hideAppUpdateDialog();
        showToast('Rond eerst je bewerking af voordat je bijwerkt', 'error');
        return;
      }

      if (appUpdateConfirmButton) {
        appUpdateConfirmButton.disabled = true;
        appUpdateConfirmButton.textContent = 'Bijwerken...';
      }

      setAppUpdateAvailable(null);
      try {
        if (serviceWorkerRegistration?.update) {
          await serviceWorkerRegistration.update();
        }
      } catch (err) {
        console.warn('Service worker update-check mislukt:', err);
      }

      try {
        if (window.caches?.keys) {
          const keys = await window.caches.keys();
          await Promise.all(keys
            .filter(key => /^fd-v\d+\.\d+\.\d+$/.test(key))
            .map(key => window.caches.delete(key)));
        }
      } catch (err) {
        console.warn('App cache legen mislukt:', err);
      }

      try {
        if (navigator.serviceWorker?.getRegistrations) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
        }
      } catch (err) {
        console.warn('Service worker reset mislukt:', err);
      }

      const reloadUrl = new URL(window.location.href);
      reloadUrl.searchParams.set('fd_update', String(Date.now()));
      window.location.replace(reloadUrl.toString());
    }

    function startAppUpdateChecks() {
      checkForAppUpdate();
      if (updateCheckTimer) clearInterval(updateCheckTimer);
      updateCheckTimer = setInterval(checkForAppUpdate, CONFIG.versionCheckInterval);
    }

    function getDiagnosticsContext() {
      const selection = getSelectedFloorplan();
      const floorplan = selection.floorplan || {};
      const selectedDoorStatus = selectedDoor ? (getDoorStatus(selectedDoor) ? 'done' : 'todo') : '';
      return {
        customer: currentCustomer || selection.customer?.customer || '',
        floorplan: currentFloorplan || floorplan.name || '',
        doorId: selectedDoor || '',
        appMode: appMode.current,
        syncQueueCount: statusSync ? statusSync.getQueueCount() : 0,
        lastToast: lastToast ? `${lastToast.type}: ${lastToast.message}` : '',
        details: {
          floorplanFile: floorplan.file || '',
          floorplanRepo: floorplan.repo || 'gallery',
          selectedDoorStatus,
          locationPath: window.location.pathname,
          locationQueryKeys: Array.from(new URLSearchParams(window.location.search).keys()),
          serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
          },
        },
      };
    }

    const diagnostics = FD.DiagnosticsService.create(CONFIG, {
      getContext: getDiagnosticsContext,
      logger: console,
    });

    let reportProblemSubmitting = false;

    function reportProblemMessage() {
      return String(reportProblemText?.value || '').trim();
    }

    function updateReportProblemSubmitState() {
      if (!reportProblemSubmit) return;
      reportProblemSubmit.disabled = reportProblemSubmitting || !reportProblemMessage();
    }

    function resetReportProblemForm() {
      reportProblemSubmitting = false;
      if (reportProblemText) reportProblemText.value = '';
      if (reportProblemCategory) reportProblemCategory.value = 'Anders';
      if (reportProblemError) reportProblemError.textContent = '';
      if (reportProblemSubmit) {
        reportProblemSubmit.textContent = 'Versturen';
        reportProblemSubmit.disabled = true;
      }
      if (reportProblemCancel) reportProblemCancel.disabled = false;
    }

    function showReportProblemDialog() {
      hideTopbarMenu();
      resetReportProblemForm();
      reportProblemDialog.show();
      setTimeout(() => reportProblemText?.focus(), 0);
    }

    function hideReportProblemDialog() {
      if (reportProblemSubmitting) return;
      reportProblemDialog.hide();
      resetReportProblemForm();
    }

    async function submitReportProblem() {
      if (reportProblemSubmitting) return;
      const message = reportProblemMessage();
      if (!message) {
        if (reportProblemError) reportProblemError.textContent = 'Beschrijf kort wat er misgaat.';
        updateReportProblemSubmitState();
        return;
      }

      reportProblemSubmitting = true;
      if (reportProblemError) reportProblemError.textContent = '';
      if (reportProblemSubmit) {
        reportProblemSubmit.disabled = true;
        reportProblemSubmit.textContent = 'Versturen...';
      }
      if (reportProblemCancel) reportProblemCancel.disabled = true;

      try {
        const result = await diagnostics.reportManual({
          message,
          category: reportProblemCategory?.value || 'Anders',
        });
        reportProblemDialog.hide();
        resetReportProblemForm();
        if (result?.sent) {
          showToast('Probleemmelding verstuurd', 'success');
        } else {
          showToast('Probleemmelding bewaard voor later', 'error');
        }
      } catch (err) {
        reportProblemSubmitting = false;
        if (reportProblemSubmit) reportProblemSubmit.textContent = 'Versturen';
        if (reportProblemCancel) reportProblemCancel.disabled = false;
        updateReportProblemSubmitState();
        if (reportProblemError) reportProblemError.textContent = 'Versturen mislukt. Probeer het opnieuw.';
        console.warn('Probleemmelding versturen mislukt:', err);
      }
    }

    btnReportProblem.addEventListener('click', showReportProblemDialog);
    reportProblemText?.addEventListener('input', updateReportProblemSubmitState);
    reportProblemSubmit?.addEventListener('click', submitReportProblem);
    reportProblemCancel?.addEventListener('click', hideReportProblemDialog);
    reportProblemOverlay?.addEventListener('click', hideReportProblemDialog);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && reportProblemPopup?.style.display !== 'none') {
        hideReportProblemDialog();
      }
    });

    appUpdateButton?.addEventListener('click', showAppUpdateDialog);
    appUpdateLaterButton?.addEventListener('click', hideAppUpdateDialog);
    appUpdateConfirmButton?.addEventListener('click', applyAppUpdate);
    appUpdateOverlay?.addEventListener('click', hideAppUpdateDialog);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForAppUpdate();
        startSessionHeartbeat();
        runSessionHeartbeat();
        startAdminActiveUsersPolling({ refreshNow: true });
      } else {
        stopSessionHeartbeat();
        stopAdminActiveUsersPolling();
      }
    });

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
      checkForAppUpdate();
      startSessionHeartbeat();
      runSessionHeartbeat();
      startAdminActiveUsersPolling({ refreshNow: true });
    });

    window.addEventListener('offline', () => {
      updateConnectionIndicator();
      cancelFloorplanCacheWarmup();
      stopSessionHeartbeat();
      stopAdminActiveUsersPolling();
      showToast('Offline modus', 'error');
    });

    // ============================================================
    // DATA LOADING
    // ============================================================

    const CUSTOMERS_CACHE_KEY = 'fd_customers_cache';
    const JOTFORM_RETURN_CONTEXT_KEY = 'fd_jotform_return_context';

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

    function currentJotFormLookupTarget() {
      const { customer, floorplan } = getSelectedFloorplan();
      const customerName = customer?.customer || currentCustomer || '';
      const floorplanName = floorplan?.name || currentFloorplan || '';
      const file = floorplan?.file || '';
      if (!customerName || !floorplanName || !file) return null;
      return {
        customer: customerName,
        floorplan: floorplanName,
        repo: floorplan?.repo === 'uploads' ? 'uploads' : 'gallery',
        file,
      };
    }

    function currentFloorplanDoneStatusFingerprint(target = currentJotFormLookupTarget()) {
      if (!target) return '';
      const bucket = doorStatus?.[target.customer]?.[target.floorplan];
      if (!bucket || typeof bucket !== 'object') return '';
      return Object.entries(bucket)
        .filter(([, value]) => FD.StatusService.isDoneStatusValue(value))
        .map(([doorId, value]) => `${doorId}=${String(value)}`)
        .sort()
        .join('&');
    }

    function jotformSubmissionCacheKey(target = currentJotFormLookupTarget()) {
      if (!target) return '';
      return [
        target.customer,
        target.floorplan,
        target.repo,
        target.file,
        currentFloorplanDoneStatusFingerprint(target),
      ].join('\u001f');
    }

    function jotformDoorIdentityKey(doorId, target = currentJotFormLookupTarget()) {
      if (!target || !doorId) return '';
      return [
        target.customer,
        target.floorplan,
        target.repo,
        target.file,
        doorId,
      ].join('\u001f');
    }

    function rememberManualNewFormHint(doorId) {
      const key = jotformDoorIdentityKey(doorId);
      if (!key) return;
      jotformManualNewFormHints.set(key, Date.now() + 2 * 60 * 1000);
    }

    function clearManualNewFormHint(doorId) {
      const key = jotformDoorIdentityKey(doorId);
      if (key) jotformManualNewFormHints.delete(key);
    }

    function hasManualNewFormHint(doorId) {
      const key = jotformDoorIdentityKey(doorId);
      if (!key) return false;
      const expiresAt = jotformManualNewFormHints.get(key) || 0;
      if (expiresAt > Date.now()) return true;
      jotformManualNewFormHints.delete(key);
      return false;
    }

    function resetJotFormSubmissionCache() {
      clearJotFormSubmissionLookupRetry();
      jotformSubmissionCache.requestId += 1;
      jotformSubmissionCache = {
        key: '',
        ready: false,
        loading: false,
        submissions: {},
        checkedDoors: {},
        allChecked: false,
        requestId: jotformSubmissionCache.requestId,
        pending: null,
      };
      if (typeof doorActionController !== 'undefined' && doorActionController?.updateJotFormButton) {
        doorActionController.updateJotFormButton();
        applyDoorActionPermissions();
      }
    }

    function normalizeJotFormSubmissionMap(response) {
      const source = response?.submissions && typeof response.submissions === 'object'
        ? response.submissions
        : {};
      return Object.fromEntries(Object.entries(source)
        .filter(([doorId, item]) => doorId && item?.editUrl)
        .map(([doorId, item]) => [doorId, {
          editUrl: String(item.editUrl),
          statusDoneAt: String(item.statusDoneAt || ''),
          lastSeenAt: String(item.lastSeenAt || ''),
          doorCondition: ['ok', 'attention', 'unknown'].includes(item.doorCondition) ? item.doorCondition : 'unknown',
          doorConditionLabel: String(item.doorConditionLabel || ''),
        }]));
    }

    function getCachedJotFormSubmission(doorId) {
      const key = jotformSubmissionCacheKey();
      if (!doorId || !key || jotformSubmissionCache.key !== key) return null;
      return jotformSubmissionCache.submissions?.[doorId] || null;
    }

    function isJotFormConditionChecking(doorId) {
      if (!doorId || !getDoorStatus(doorId)) return false;
      if (navigator.onLine === false || !canWriteCurrentFloorplan()) return false;
      if (hasManualNewFormHint(doorId)) return false;

      const target = currentJotFormLookupTarget();
      const key = jotformSubmissionCacheKey(target);
      if (!key) return false;
      if (jotformSubmissionCache.key !== key) return true;
      if (jotformSubmissionCache.loading || jotformSubmissionCache.pending) return true;
      return false;
    }

    function getDoorCondition(doorId) {
      if (!doorId || !getDoorStatus(doorId)) return 'unknown';
      const submission = getCachedJotFormSubmission(doorId);
      if (submission?.doorCondition === 'attention') return 'attention';
      if (isJotFormConditionChecking(doorId)) return 'checking';
      return 'unknown';
    }

    function getJotFormButtonStateForDoor({ selectedDoor: doorId, isDone } = {}) {
      if (!doorId || !isDone) return { action: 'new' };
      const key = jotformSubmissionCacheKey();
      const cached = key && jotformSubmissionCache.key === key
        ? jotformSubmissionCache.submissions?.[doorId]
        : null;
      if (cached?.editUrl) return { action: 'edit', editUrl: cached.editUrl };
      if (hasManualNewFormHint(doorId)) return { action: 'new' };
      if (!key || jotformSubmissionCache.key !== key) return { action: 'open', loading: true };
      if (jotformSubmissionCache.loading || !jotformSubmissionCache.ready) return { action: 'open', loading: true };
      if (jotformSubmissionCache.allChecked || jotformSubmissionCache.checkedDoors?.[doorId]) {
        return { action: 'new' };
      }
      return { action: 'open', loading: true };
    }

    async function refreshSelectedJotFormSubmission(target, key) {
      const doorId = selectedDoor;
      if (!doorId || !getDoorStatus(doorId)) {
        resetJotFormSubmissionCache();
        return null;
      }

      const requestId = jotformSubmissionCache.requestId + 1;
      const previousSubmissions = jotformSubmissionCache.key === key
        ? { ...(jotformSubmissionCache.submissions || {}) }
        : {};
      const previousCheckedDoors = jotformSubmissionCache.key === key
        ? { ...(jotformSubmissionCache.checkedDoors || {}) }
        : {};

      jotformSubmissionCache = {
        key,
        ready: false,
        loading: true,
        submissions: previousSubmissions,
        checkedDoors: previousCheckedDoors,
        allChecked: false,
        requestId,
        pending: null,
      };
      if (doorActionController?.updateJotFormButton) {
        doorActionController.updateJotFormButton();
        applyDoorActionPermissions();
      }

      const pending = FD.DataService.findJotFormSubmission(CONFIG, {
        ...target,
        doorId,
      }, {
        diagnostics: {
          purpose: 'jotform_submission_selected_lookup',
          background: true,
        },
      }).then(response => {
        if (jotformSubmissionCache.requestId !== requestId || jotformSubmissionCache.key !== key) return null;
        const submissions = {
          ...(jotformSubmissionCache.submissions || {}),
        };
        const checkedDoors = {
          ...(jotformSubmissionCache.checkedDoors || {}),
        };
        if (response?.found && response.editUrl) {
          clearJotFormSubmissionLookupRetry();
          checkedDoors[doorId] = true;
          submissions[doorId] = {
            editUrl: String(response.editUrl),
            statusDoneAt: String(response.statusDoneAt || ''),
            lastSeenAt: String(response.lastSeenAt || ''),
            doorCondition: ['ok', 'attention', 'unknown'].includes(response.doorCondition) ? response.doorCondition : 'unknown',
            doorConditionLabel: String(response.doorConditionLabel || ''),
          };
        } else {
          if (doorId === jotformFocusRefreshDoorId && Date.now() <= jotformFocusRefreshUntil) {
            scheduleJotFormSubmissionLookupRetry(doorId);
          } else {
            checkedDoors[doorId] = true;
          }
          delete submissions[doorId];
        }
        jotformSubmissionCache = {
          key,
          ready: true,
          loading: false,
          submissions,
          checkedDoors,
          allChecked: false,
          requestId,
          pending: null,
        };
        if (doorActionController?.updateJotFormButton) {
          doorActionController.updateJotFormButton();
          applyDoorActionPermissions();
        }
        refreshAllDoorColors();
        updateDoneButton();
        return jotformSubmissionCache.submissions;
      }).catch(err => {
        if (jotformSubmissionCache.requestId === requestId && jotformSubmissionCache.key === key) {
          jotformSubmissionCache = {
            key,
            ready: false,
            loading: false,
            submissions: previousSubmissions,
            checkedDoors: previousCheckedDoors,
            allChecked: false,
            requestId,
            pending: null,
          };
          if (doorActionController?.updateJotFormButton) {
            doorActionController.updateJotFormButton();
            applyDoorActionPermissions();
          }
          refreshAllDoorColors();
          updateDoneButton();
        }
        console.warn('JotForm editlink voor geselecteerde deur laden mislukt:', err);
        return null;
      });
      jotformSubmissionCache.pending = pending;
      return pending;
    }

    async function refreshJotFormSubmissionCache({ force = false } = {}) {
      const target = currentJotFormLookupTarget();
      const key = jotformSubmissionCacheKey(target);
      if (!target || !key || navigator.onLine === false || !canWriteCurrentFloorplan()) {
        resetJotFormSubmissionCache();
        return null;
      }

      if (!force && jotformSubmissionCache.key === key) {
        if (jotformSubmissionCache.ready) return jotformSubmissionCache.submissions;
        if (jotformSubmissionCache.pending) return jotformSubmissionCache.pending;
      }

      const supportsBatchLookup = await FD.DataService.supportsJotFormSubmissionBatch(CONFIG);
      if (!supportsBatchLookup) {
        return refreshSelectedJotFormSubmission(target, key);
      }

      const requestId = jotformSubmissionCache.requestId + 1;
      const previousSubmissions = jotformSubmissionCache.key === key
        ? { ...(jotformSubmissionCache.submissions || {}) }
        : {};
      const previousCheckedDoors = jotformSubmissionCache.key === key
        ? { ...(jotformSubmissionCache.checkedDoors || {}) }
        : {};
      jotformSubmissionCache = {
        key,
        ready: false,
        loading: true,
        submissions: previousSubmissions,
        checkedDoors: previousCheckedDoors,
        allChecked: false,
        requestId,
        pending: null,
      };
      if (doorActionController?.updateJotFormButton) {
        doorActionController.updateJotFormButton();
        applyDoorActionPermissions();
      }

      const pending = FD.DataService.findJotFormSubmissions(CONFIG, target, {
        diagnostics: {
          purpose: 'jotform_submission_batch_lookup',
          background: true,
        },
      }).then(response => {
        if (jotformSubmissionCache.requestId !== requestId || jotformSubmissionCache.key !== key) return null;
        jotformSubmissionCache = {
          key,
          ready: true,
          loading: false,
          submissions: normalizeJotFormSubmissionMap(response),
          checkedDoors: {},
          allChecked: true,
          requestId,
          pending: null,
        };
        if (doorActionController?.updateJotFormButton) {
          doorActionController.updateJotFormButton();
          applyDoorActionPermissions();
        }
        refreshAllDoorColors();
        updateDoneButton();
        return jotformSubmissionCache.submissions;
      }).catch(err => {
        if (jotformSubmissionCache.requestId === requestId && jotformSubmissionCache.key === key) {
          jotformSubmissionCache = {
            key,
            ready: false,
            loading: false,
            submissions: {},
            checkedDoors: {},
            allChecked: false,
            requestId,
            pending: null,
          };
          if (doorActionController?.updateJotFormButton) {
            doorActionController.updateJotFormButton();
            applyDoorActionPermissions();
          }
          refreshAllDoorColors();
          updateDoneButton();
        }
        console.warn('JotForm editlinks vooraf laden mislukt:', err);
        return null;
      });
      jotformSubmissionCache.pending = pending;
      return pending;
    }

    function markJotFormExternalOpen(context) {
      jotformFocusRefreshDoorId = context?.doorId || null;
      jotformFocusRefreshUntil = context?.doorId
        ? Date.now() + CONFIG.jotformReturnRefreshMaxDuration
        : 0;
      jotformFocusBaselineSubmission = context?.doorId
        ? getCachedJotFormSubmission(context.doorId)
        : null;
    }

    function saveJotFormReturnContext() {
      const context = currentJotFormReturnContext();
      if (!context) return;
      const saved = FD.DoorActionService.saveReturnContext(
        localStorage,
        JOTFORM_RETURN_CONTEXT_KEY,
        context
      );
      markJotFormExternalOpen(context);
      if (!saved) console.warn('JotForm terugkeercontext kon niet worden opgeslagen.');
    }

    function readJotFormReturnContext() {
      return FD.DoorActionService.readReturnContext(localStorage, JOTFORM_RETURN_CONTEXT_KEY);
    }

    function isJotFormReturnContextForCurrentOrigin(context) {
      return Boolean(context?.appOrigin && context.appOrigin === window.location.origin);
    }

    function clearJotFormReturnContext() {
      localStorage.removeItem(JOTFORM_RETURN_CONTEXT_KEY);
    }

    function findCustomerIndexForReturnContext(context) {
      if (!context) return -1;
      return customers.findIndex(customer => customer.customer === context.customerName);
    }

    function stopJotFormReturnFastRefreshTimer() {
      if (!jotformReturnRefreshTimer) return;
      clearTimeout(jotformReturnRefreshTimer);
      jotformReturnRefreshTimer = null;
    }

    function clearJotFormReturnFastRefresh() {
      stopJotFormReturnFastRefreshTimer();
      jotformFocusBaselineSubmission = null;
    }

    function clearJotFormSubmissionLookupRetry() {
      if (!jotformSubmissionLookupRetryTimer) return;
      clearTimeout(jotformSubmissionLookupRetryTimer);
      jotformSubmissionLookupRetryTimer = null;
    }

    function scheduleJotFormSubmissionLookupRetry(doorId) {
      clearJotFormSubmissionLookupRetry();
      if (!doorId || doorId !== jotformFocusRefreshDoorId || Date.now() > jotformFocusRefreshUntil) return;
      jotformSubmissionLookupRetryTimer = setTimeout(() => {
        jotformSubmissionLookupRetryTimer = null;
        if (selectedDoor === doorId && getDoorStatus(doorId)) {
          refreshJotFormSubmissionCache({ force: true });
        }
      }, CONFIG.jotformReturnRefreshInterval);
    }

    function refreshAfterJotFormFocus() {
      if (!jotformFocusRefreshDoorId || Date.now() > jotformFocusRefreshUntil) {
        jotformFocusRefreshDoorId = null;
        jotformFocusRefreshUntil = 0;
        jotformFocusBaselineSubmission = null;
        return;
      }
      if (selectedDoor !== jotformFocusRefreshDoorId || navigator.onLine === false) return;
      startJotFormReturnFastRefresh(jotformFocusRefreshDoorId);
    }

    function startJotFormReturnFastRefresh(doorId) {
      stopJotFormReturnFastRefreshTimer();
      if (!doorId || navigator.onLine === false || typeof statusController?.poll !== 'function') return;

      const deadline = Date.now() + CONFIG.jotformReturnRefreshMaxDuration;
      const baselineSubmission = jotformFocusBaselineSubmission;

      function submissionChangedAfterExternalOpen() {
        const current = getCachedJotFormSubmission(doorId);
        if (!baselineSubmission) return Boolean(current?.editUrl);
        if (!current?.editUrl) return false;
        if (current.editUrl !== baselineSubmission.editUrl) return true;
        if (current.doorCondition !== baselineSubmission.doorCondition) return true;
        if (current.doorConditionLabel !== baselineSubmission.doorConditionLabel) return true;
        const currentSeen = Date.parse(current.lastSeenAt || '');
        const baselineSeen = Date.parse(baselineSubmission.lastSeenAt || '');
        return Number.isFinite(currentSeen) &&
          (!Number.isFinite(baselineSeen) || currentSeen > baselineSeen);
      }

      const run = async () => {
        if (selectedDoor !== doorId || !currentFloorplan || navigator.onLine === false || isEditModeActive()) {
          clearJotFormReturnFastRefresh();
          return;
        }

        try {
          await statusController.poll();
          if (getDoorStatus(doorId)) {
            await refreshJotFormSubmissionCache({ force: true });
          }
        } catch (err) {
          console.warn('JotForm status-refresh mislukt:', err);
        }

        if ((getDoorStatus(doorId) && submissionChangedAfterExternalOpen()) || Date.now() >= deadline) {
          clearJotFormReturnFastRefresh();
          return;
        }

        jotformReturnRefreshTimer = setTimeout(run, CONFIG.jotformReturnRefreshInterval);
      };

      run();
    }

    async function restoreJotFormReturnIfNeeded() {
      if (!FD.DoorActionService.hasReturnParam(window.location)) {
        clearJotFormReturnContext();
        return false;
      }

      const context = readJotFormReturnContext();
      FD.DoorActionService.clearReturnParam(window.history, window.location);
      clearJotFormReturnContext();

      if (!context) {
        showToast('Terug uit JotForm, vorige selectie niet gevonden', 'error');
        return false;
      }

      if (!isJotFormReturnContextForCurrentOrigin(context)) {
        showToast('Terug uit JotForm, vorige selectie niet gevonden', 'error');
        return false;
      }

      const customerIndex = findCustomerIndexForReturnContext(context);
      const customer = customers[customerIndex];
      const floorplanIndex = FD.DoorActionService.findFloorplanIndex(customer?.floorplans, context);

      if (customerIndex < 0 || floorplanIndex < 0) {
        showToast('Terug uit JotForm, vorige selectie niet gevonden', 'error');
        return false;
      }

      customerSelect.value = String(customerIndex);
      populateFloorplanDropdown(customerIndex);
      floorplanSelect.value = String(floorplanIndex);
      updatePickerButtons();

      await loadFloorplan(customerIndex, floorplanIndex);

      if (FD.MarkerService.markerExists(svgContainer, context.doorId)) {
        selectDoor(context.doorId);
        startJotFormReturnFastRefresh(context.doorId);
        showToast('Terug uit JotForm', 'success');
      } else {
        showToast('Terug uit JotForm, deur niet gevonden', 'error');
      }
      return true;
    }

    window.addEventListener('focus', refreshAfterJotFormFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshAfterJotFormFocus();
    });

    const floorplanCache = FD.FloorplanCacheService.createWarmupController({
      config: CONFIG,
      getCustomers: () => customers,
      isOnline: () => navigator.onLine,
      logger: console,
    });

    function fetchFloorplanSVGCacheFirst(fileUrl) {
      return FD.FloorplanCacheService.fetchSVGCacheFirst(fileUrl, {
        cacheVersion: CONFIG.offlineCacheVersion,
        config: CONFIG,
      });
    }

    function updateCachedSVGAfterSave(fileUrl, updateResult, svgText) {
      return FD.FloorplanCacheService.updateCachedSVGAfterSave(fileUrl, updateResult, svgText, {
        cacheVersion: CONFIG.offlineCacheVersion,
        config: CONFIG,
      });
    }

    function cancelFloorplanCacheWarmup() {
      floorplanCache.cancel();
    }

    function scheduleFloorplanCacheWarmup() {
      floorplanCache.schedule();
    }

    function loadCachedCustomersOffline() {
      const cachedCustomers = readCachedCustomers();
      if (!cachedCustomers.length) return false;
      customers = cachedCustomers;
      customerSelect.disabled = false;
      populateCustomerDropdown();
      if (selectionController.isOpen('customer')) renderSelectSheetItems();
      setEmptyState('Offline klantgegevens geladen.<br>Kies een klant en plattegrond.', 'Controleer later online of alles actueel is');
      return true;
    }

    async function loadCustomers() {
      customersLoading = true;
      customerSelect.disabled = true;
      floorplanSelect.disabled = true;
      updatePickerButtons();
      try {
        if (navigator.onLine === false && loadCachedCustomersOffline()) return;
        customers = await FD.DataService.loadCustomers(CONFIG);
        cacheCustomers();
        customerSelect.disabled = false;
        populateCustomerDropdown();
        if (selectionController.isOpen('customer')) renderSelectSheetItems();
        scheduleFloorplanCacheWarmup();
      } catch (err) {
        if (loadCachedCustomersOffline()) {
          console.warn('Kon klanten niet online laden, lokale cache gebruikt:', err);
        } else {
          console.warn('Kon klanten niet laden:', err);
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
        console.warn('Kon status niet laden:', result.error);
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
      FD.SelectSheetService.renderFloorplanOptions(floorplanSelect, c.floorplans, {
        labelForItem: floorplan => floorplanPickerLabel(c, floorplan),
      });
      updatePickerButtons();
    }

    function resetFloorplanDropdown(disabled = true) {
      FD.SelectSheetService.resetFloorplanOptions(floorplanSelect, { disabled });
      updatePickerButtons();
    }

    function getSelectedFloorplan() {
      return FD.SelectSheetService.getSelectedFloorplan(customers, customerSelect, floorplanSelect);
    }

    function updateAccountIndicator() {
      if (!accountIndicator || !accountLabel) return;
      const role = String(currentUser?.role || '').toLowerCase();
      const label = ['admin', 'monteur', 'viewer'].includes(role) ? role : '';
      accountLabel.textContent = label;
      accountIndicator.hidden = !label;
      accountIndicator.title = label ? `Ingelogd als ${label}` : 'Ingelogd account';
      accountIndicator.dataset.role = label;
    }

    function refreshCurrentUser() {
      currentUser = FD.DataService.getWorkerSessionUser(CONFIG);
      updateAccountIndicator();
      return currentUser;
    }

    function refreshCurrentUserFromWorker() {
      refreshCurrentUser();
      if (navigator.onLine === false || typeof FD.DataService.refreshWorkerSessionUser !== 'function') return;

      FD.DataService.refreshWorkerSessionUser(CONFIG, {
        diagnostics: {
          level: 'warn',
          purpose: 'refresh session user metadata',
          background: true,
        },
      }).then(() => {
        refreshCurrentUser();
        updateRoleActionButtons();
        if (selectionController.isOpen('floorplan')) renderSelectSheetItems();
      }).catch(err => {
        console.warn('Worker gebruiker/rechten verversen mislukt:', err);
      });
    }

    function isPageVisibleAndOnline() {
      return document.visibilityState !== 'hidden' && navigator.onLine !== false;
    }

    function shouldRunSessionHeartbeat() {
      if (!isPageVisibleAndOnline()) return false;
      if (appMode.is(AppModes.LOGIN)) return false;
      if (typeof FD.DataService.refreshWorkerSessionUser !== 'function') return false;
      if (!currentUser) refreshCurrentUser();
      return Boolean(currentUser);
    }

    async function runSessionHeartbeat() {
      if (!shouldRunSessionHeartbeat() || sessionHeartbeatInFlight) return;
      sessionHeartbeatInFlight = true;
      try {
        await FD.DataService.refreshWorkerSessionUser(CONFIG, {
          diagnostics: {
            suppress: true,
            background: true,
            purpose: 'session_heartbeat',
          },
        });
        refreshCurrentUser();
        updateRoleActionButtons();
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) {
          stopSessionHeartbeat();
          return;
        }
        if (navigator.onLine !== false) {
          console.warn('Sessie heartbeat mislukt:', err);
        }
      } finally {
        sessionHeartbeatInFlight = false;
      }
    }

    function sessionHeartbeatTick() {
      return runSessionHeartbeat();
    }

    function startSessionHeartbeat() {
      if (sessionHeartbeatTimer || !shouldRunSessionHeartbeat()) return;
      sessionHeartbeatTimer = window.setInterval(sessionHeartbeatTick, CONFIG.sessionHeartbeatInterval);
    }

    function stopSessionHeartbeat() {
      if (!sessionHeartbeatTimer) return;
      window.clearInterval(sessionHeartbeatTimer);
      sessionHeartbeatTimer = null;
    }

    function canManageUploads() {
      return FD.DataService.canManageUploads(CONFIG);
    }

    function isAdminUser() {
      return currentUser?.role === 'admin';
    }

    function canWriteFloorplanByName(customer, floorplan) {
      return FD.DataService.canWriteFloorplan(CONFIG, customer, floorplan);
    }

    function canWriteCurrentFloorplan() {
      const selection = getSelectedFloorplan();
      const customerName = selection.customer?.customer || currentCustomer;
      const floorplanName = selection.floorplan?.name || currentFloorplan;
      return canWriteFloorplanByName(customerName, floorplanName);
    }

    function isViewerReadOnlyFloorplan(customer, floorplan) {
      return FD.DataService.isViewerReadOnlyFloorplan(CONFIG, customer, floorplan);
    }

    function floorplanPickerLabel(customer, floorplan) {
      if (!floorplan) return '';
      const displayName = FD.SelectSheetService.floorplanDisplayName(floorplan);
      if (isViewerReadOnlyFloorplan(customer?.customer || customer, floorplan.name)) {
        return displayName + ' · alleen kijken';
      }
      if (currentUser?.role === 'viewer') {
        return displayName + ' · testen toegestaan';
      }
      return displayName;
    }

    function getSelectedTopbarFloorplanRecord() {
      const { customer, floorplan } = getSelectedFloorplan();
      if (!customer || !floorplan) return null;
      return {
        customer: customer.customer,
        name: floorplan.name,
        displayName: FD.SelectSheetService.floorplanDisplayName(floorplan),
        building: floorplan.building || '',
        floorLabel: floorplan.floorLabel || '',
        repo: floorplan.repo === 'uploads' ? 'uploads' : 'gallery',
        file: floorplan.file || '',
        uploaded: Boolean(floorplan.uploaded || floorplan.repo === 'uploads'),
      };
    }

    function updateTopbarMetadataButton() {
      if (!btnTopbarMetadata) return;
      const selected = getSelectedTopbarFloorplanRecord();
      const visible = isAdminUser();
      btnTopbarMetadata.hidden = !visible;
      btnTopbarMetadata.disabled = !visible || !selected;
      btnTopbarMetadata.title = selected
        ? `Gegevens aanpassen van ${selected.displayName || selected.name}`
        : 'Kies eerst een plattegrond';
    }

    function applyDoorActionPermissions() {
      if (!selectedDoor) return;
      const allowed = canWriteCurrentFloorplan();
      btnDone.classList.toggle('disabled', !allowed);
      btnDone.title = allowed ? '' : 'Alleen kijken op deze plattegrond';

      const jotformPending = btnJotform.dataset.jotformPending === '1';
      btnJotform.classList.toggle('disabled', !allowed || jotformPending);
      btnJotform.title = !allowed
        ? 'Alleen kijken op deze plattegrond'
        : (jotformPending ? 'Formulierstatus controleren...' : '');
    }

    function hasCurrentFloorplanView() {
      return Boolean(currentCustomer && currentFloorplan && svgContainer.querySelector('svg'));
    }

    function restoreTopbarToCurrentFloorplan() {
      if (!currentCustomer || !currentFloorplan) return false;
      const customerIndex = customers.findIndex(customer => customer.customer === currentCustomer);
      if (customerIndex < 0) return false;
      const floorplanIndex = (customers[customerIndex].floorplans || [])
        .findIndex(floorplan => floorplan.name === currentFloorplan);
      if (floorplanIndex < 0) return false;

      customerSelect.value = String(customerIndex);
      populateFloorplanDropdown(customerIndex);
      floorplanSelect.value = String(floorplanIndex);
      updatePickerButtons();
      return true;
    }

    function updateRoleActionButtons() {
      const uploadButton = document.getElementById('btn-upload');
      if (uploadButton) uploadButton.style.display = canManageUploads() ? 'block' : 'none';
      if (btnDashboard) {
        btnDashboard.style.display = isAdminUser() ? 'inline-block' : 'none';
        btnDashboard.classList.toggle('active', adminDashboardState.visible);
        const canReturnToFloorplan = adminDashboardState.visible && hasCurrentFloorplanView();
        btnDashboard.textContent = canReturnToFloorplan ? 'Plattegrond' : 'Dashboard';
        btnDashboard.title = canReturnToFloorplan
          ? 'Terug naar geselecteerde plattegrond'
          : 'Dashboard openen';
        btnDashboard.setAttribute('aria-pressed', adminDashboardState.visible ? 'true' : 'false');
      }
      updateTopbarMetadataButton();

      const selected = getSelectedFloorplan();
      const hasFloorplan = Boolean(selected.floorplan || currentFloorplan);
      const canWrite = hasFloorplan && canWriteCurrentFloorplan();
      const editButton = document.getElementById('btn-edit');
      if (editButton) {
        editButton.style.display = hasFloorplan && canWrite ? 'inline-block' : 'none';
        editButton.title = canWrite ? '' : 'Alleen kijken op deze plattegrond';
      }
      applyDoorActionPermissions();
    }

    function duplicateDoorCodeMessage(err) {
      if (!(err?.status === 409 && (err?.code === 'duplicate_door_code' || err?.message === 'duplicate_door_code'))) {
        return '';
      }
      const conflict = Array.isArray(err?.details?.conflicts) ? err.details.conflicts[0] : null;
      const code = conflict?.code ? `Code ${conflict.code}` : 'Deze deurcode';
      if (conflict?.scope === 'floorplan') {
        return `${code} staat dubbel op deze plattegrond.`;
      }
      if (conflict?.customer && conflict?.floorplan) {
        const door = conflict.doorId ? `, deur ${conflict.doorId}` : '';
        return `${code} bestaat al bij ${conflict.customer} - ${conflict.floorplan}${door}.`;
      }
      return `${code} bestaat al ergens anders in KEYROL.`;
    }

    function normalizeDoorCodeForIndex(value) {
      return String(value || '').trim().toUpperCase();
    }

    function rebuildDoorCodeIndexMap(entries) {
      const byCode = new Map();
      (Array.isArray(entries) ? entries : []).forEach(entry => {
        const code = normalizeDoorCodeForIndex(entry?.code);
        if (!code) return;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push({
          code,
          customer: String(entry.customer || ''),
          floorplan: String(entry.floorplan || ''),
          repo: entry.repo === 'uploads' ? 'uploads' : 'gallery',
          file: String(entry.file || ''),
          doorId: String(entry.doorId || entry.door_id || ''),
        });
      });
      return byCode;
    }

    function resetDoorCodeIndexState() {
      doorCodeIndexState.requestId += 1;
      doorCodeIndexState = {
        ready: false,
        loading: false,
        entries: [],
        byCode: new Map(),
        requestId: doorCodeIndexState.requestId,
        pending: null,
        error: null,
      };
    }

    async function loadDoorCodeIndex({ force = false } = {}) {
      if (!canWriteCurrentFloorplan()) return null;
      if (!force) {
        if (doorCodeIndexState.ready) return doorCodeIndexState.entries;
        if (doorCodeIndexState.pending) return doorCodeIndexState.pending;
      }

      const requestId = doorCodeIndexState.requestId + 1;
      doorCodeIndexState = {
        ready: false,
        loading: true,
        entries: [],
        byCode: new Map(),
        requestId,
        pending: null,
        error: null,
      };

      const pending = FD.DataService.fetchDoorCodeIndex(CONFIG, {
        diagnostics: {
          purpose: 'door_code_index_lookup',
          background: true,
        },
      }).then(response => {
        if (doorCodeIndexState.requestId !== requestId) return null;
        const entries = Array.isArray(response?.entries) ? response.entries : [];
        doorCodeIndexState = {
          ready: true,
          loading: false,
          entries,
          byCode: rebuildDoorCodeIndexMap(entries),
          requestId,
          pending: null,
          error: null,
        };
        return entries;
      }).catch(err => {
        if (doorCodeIndexState.requestId === requestId) {
          doorCodeIndexState = {
            ready: false,
            loading: false,
            entries: [],
            byCode: new Map(),
            requestId,
            pending: null,
            error: err,
          };
        }
        console.warn('Globale deurcode-index laden mislukt:', err);
        return null;
      });

      doorCodeIndexState.pending = pending;
      return pending;
    }

    function findGlobalDoorCodeConflict(code) {
      const normalized = normalizeDoorCodeForIndex(code);
      if (!normalized || !doorCodeIndexState.ready) return null;
      const target = currentJotFormLookupTarget();
      if (!target) return null;
      return (doorCodeIndexState.byCode.get(normalized) || [])
        .find(entry => !(entry.repo === target.repo && entry.file === target.file)) || null;
    }

    function globalDoorCodeConflictMessage(conflict, code) {
      const normalized = normalizeDoorCodeForIndex(code || conflict?.code);
      const where = [conflict?.customer, conflict?.floorplan].filter(Boolean).join(' - ');
      const door = conflict?.doorId ? `, deur ${conflict.doorId}` : '';
      return where
        ? `Code ${normalized} is al in gebruik bij ${where}${door}.`
        : `Code ${normalized} is al ergens anders in KEYROL in gebruik.`;
    }

    function doorCodeIndexLoadingMessage() {
      if (doorCodeIndexState.loading) return 'Globale deurcodecontrole wordt nog geladen. Probeer het over een paar seconden opnieuw.';
      return '';
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
        return FD.SelectSheetService
          .sortedWithOriginalIndex(customers, customer => customer.customer)
          .map(({ index, label }) => ({ index, label }));
      }
      const ci = FD.SelectSheetService.selectedIndex(customerSelect);
      if (ci === null || !customers[ci]) return [];
      return FD.SelectSheetService
        .sortedWithOriginalIndex(customers[ci].floorplans, floorplan => FD.SelectSheetService.floorplanDisplayName(floorplan))
        .map(({ item: fp, index, label }) => {
          const readOnly = isViewerReadOnlyFloorplan(customers[ci].customer, fp.name);
          return {
            index,
            label,
            meta: readOnly ? 'Alleen kijken' : (currentUser?.role === 'viewer' ? 'Testen toegestaan' : ''),
            readOnly,
          };
        });
    }

    const ADMIN_COLLATOR = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

    function adminFloorplanKey(record) {
      return [
        record?.customer || '',
        record?.name || record?.floorplan || '',
        record?.repo === 'uploads' ? 'uploads' : 'gallery',
        record?.file || '',
      ].join('\n');
    }

    function adminDoorKey(door) {
      return [
        door?.customer || '',
        door?.floorplan || door?.name || '',
        door?.repo === 'uploads' ? 'uploads' : 'gallery',
        door?.file || '',
        door?.doorId || door?.door_id || door?.code || '',
      ].join('\n');
    }

    function adminStatusLabel(item) {
      if (item?.status === 'done' && item?.doorCondition === 'attention') return 'Aandacht nodig';
      if (item?.new_status === 'done' || item?.newStatus === 'done') return 'Afgerond';
      if (item?.status === 'done') return 'Afgerond';
      if (item?.new_status === 'todo' || item?.newStatus === 'todo' || item?.result === 'todo') return 'Open';
      return 'Open';
    }

    function adminFormatDateTime(value) {
      const date = new Date(value || '');
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('nl-NL', {
        timeZone: CONFIG.appTimeZone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }

    function adminNormalizeSearch(value) {
      return String(value || '').trim().toLowerCase();
    }

    function adminDoorColor(door) {
      if (door?.status === 'done' && door?.doorCondition === 'attention') return COLORS.attention;
      if (door?.status === 'done') return COLORS.done;
      return COLORS.todo;
    }

    function adminFloorplanSearchText(record) {
      return [
        record.customer,
        record.displayName,
        record.name,
        record.building,
        record.floorLabel,
        record.file,
      ].join(' ').toLowerCase();
    }

    function adminDoorCodeLabel(door) {
      return String(door?.code || door?.doorId || '').trim();
    }

    function adminDoorFloorplanLabel(door) {
      return String(door?.floorplanDisplayName || door?.floorplan || door?.name || '').trim();
    }

    function adminDoorFloorplanFilterKey(door) {
      return adminFloorplanKey(door);
    }

    function getAdminData() {
      return adminDashboardState.data || { summary: {}, customers: [], floorplans: [], doors: [] };
    }

    function findAdminFloorplanForActivity(item) {
      if (!item) return null;
      const exactKey = adminFloorplanKey(item);
      const floorplans = getAdminData().floorplans || [];
      return floorplans.find(record => adminFloorplanKey(record) === exactKey) ||
        floorplans.find(record => (
          record.customer === item.customer &&
          record.name === (item.floorplan || item.name)
        )) ||
        null;
    }

    function findAdminDoorForActivity(item) {
      if (!item) return null;
      const doors = getAdminData().doors || [];
      const exactKey = adminDoorKey(item);
      return doors.find(door => adminDoorKey(door) === exactKey) ||
        doors.find(door => (
          door.customer === item.customer &&
          door.floorplan === (item.floorplan || item.name) &&
          door.doorId === (item.doorId || item.door_id || item.code)
        )) ||
        null;
    }

    function getSelectedAdminDoor() {
      if (!adminDashboardState.selectedDoorKey) return null;
      return (getAdminData().doors || []).find(door => adminDoorKey(door) === adminDashboardState.selectedDoorKey) || null;
    }

    function setAdminTab(tabName) {
      const allowed = new Set(['overview', 'door-search', 'floorplans', 'details']);
      const nextTab = allowed.has(tabName) ? tabName : 'overview';
      adminDashboardState.activeTab = nextTab;
      adminDashboardTabs.forEach(button => {
        const active = button.dataset.adminTab === nextTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      adminDashboardTabPanels.forEach(panel => {
        const active = panel.dataset.adminPanel === nextTab;
        panel.hidden = !active;
        panel.classList.toggle('active', active);
      });
    }

    function getAdminCustomerNames() {
      const names = new Set();
      getAdminData().floorplans.forEach(record => {
        if (record.customer) names.add(record.customer);
      });
      (getAdminData().customers || customers || []).forEach(customer => {
        if (customer?.customer) names.add(customer.customer);
      });
      return Array.from(names).sort((a, b) => ADMIN_COLLATOR.compare(a, b));
    }

    function getFilteredAdminFloorplans() {
      const data = getAdminData();
      const query = adminNormalizeSearch(adminDashboardState.searchQuery);
      const selectedCustomer = adminDashboardState.selectedCustomer;
      return (Array.isArray(data.floorplans) ? data.floorplans : []).filter(record => {
        if (selectedCustomer && record.customer !== selectedCustomer) return false;
        if (query && !adminFloorplanSearchText(record).includes(query)) return false;
        return true;
      });
    }

    function getSelectedAdminFloorplan(filtered = null, { allowFallback = false } = {}) {
      if (adminDashboardState.selectedKey) {
        const selectedFromAll = (getAdminData().floorplans || [])
          .find(record => adminFloorplanKey(record) === adminDashboardState.selectedKey);
        if (selectedFromAll) return selectedFromAll;
      }
      if (!allowFallback) return null;
      const list = filtered || getFilteredAdminFloorplans();
      if (!list.length) return null;
      const selected = list.find(record => adminFloorplanKey(record) === adminDashboardState.selectedKey);
      return selected || list[0];
    }

    function setAdminDashboardLoading(loading) {
      adminDashboardState.loading = loading;
      if (adminDashboardRefresh) {
        adminDashboardRefresh.disabled = loading;
        adminDashboardRefresh.textContent = loading ? 'Laden...' : 'Vernieuwen';
      }
    }

    function renderAdminKpis() {
      const summary = getAdminData().summary || {};
      Object.entries(adminKpiEls).forEach(([key, el]) => {
        if (!el) return;
        el.textContent = String(Number(summary[key] || 0));
      });
    }

    function renderActiveUsers(counts) {
      Object.entries(adminOnlineEls).forEach(([role, el]) => {
        if (!el) return;
        const value = counts && Object.prototype.hasOwnProperty.call(counts, role)
          ? Number(counts[role] || 0)
          : null;
        el.textContent = value === null ? '—' : String(value);
      });
    }

    async function loadActiveUsers() {
      if (!isAdminUser() || adminActiveUsersInFlight) return;
      adminActiveUsersInFlight = true;
      try {
        const result = await FD.DataService.fetchActiveUsers(CONFIG, {
          diagnostics: {
            purpose: 'admin_active_users',
            background: true,
          },
        });
        renderActiveUsers(result.counts);
      } catch (err) {
        console.warn('Online gebruikers laden mislukt:', err);
        renderActiveUsers(null);
      } finally {
        adminActiveUsersInFlight = false;
      }
    }

    function shouldPollAdminActiveUsers() {
      return Boolean(adminDashboardState.visible && isAdminUser() && isPageVisibleAndOnline());
    }

    function adminActiveUsersPollTick() {
      if (!shouldPollAdminActiveUsers()) {
        stopAdminActiveUsersPolling();
        return;
      }
      return loadActiveUsers();
    }

    function startAdminActiveUsersPolling({ refreshNow = false } = {}) {
      if (!shouldPollAdminActiveUsers()) return;
      if (refreshNow) loadActiveUsers();
      if (adminActiveUsersPollTimer) return;
      adminActiveUsersPollTimer = window.setInterval(
        adminActiveUsersPollTick,
        CONFIG.adminActiveUsersPollInterval,
      );
    }

    function stopAdminActiveUsersPolling() {
      if (!adminActiveUsersPollTimer) return;
      window.clearInterval(adminActiveUsersPollTimer);
      adminActiveUsersPollTimer = null;
    }

    function renderAdminOverviewList(container, items, emptyText, badgeFn) {
      if (!container) return;
      container.innerHTML = '';
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }

      items.forEach(record => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-overview-item';
        const main = document.createElement('div');
        main.className = 'admin-overview-item-main';
        const title = document.createElement('span');
        title.textContent = record.displayName || record.name || 'Plattegrond';
        const badge = document.createElement('span');
        badge.className = 'admin-overview-badge';
        badge.textContent = badgeFn(record);
        main.append(title, badge);
        const meta = document.createElement('div');
        meta.className = 'admin-overview-item-meta';
        meta.textContent = record.customer || 'Onbekende klant';
        button.append(main, meta);
        button.addEventListener('click', () => {
          adminDashboardState.selectedKey = adminFloorplanKey(record);
          adminDashboardState.selectedDoorKey = '';
          setAdminTab('details');
          renderAdminDashboard();
        });
        container.appendChild(button);
      });
    }

    function renderAdminOverview() {
      const floorplans = getAdminData().floorplans || [];
      const attention = floorplans
        .filter(record => Number(record.attention || 0) > 0)
        .sort((left, right) => Number(right.attention || 0) - Number(left.attention || 0))
        .slice(0, 6);
      const open = floorplans
        .filter(record => Number(record.open || 0) > 0)
        .sort((left, right) => Number(right.open || 0) - Number(left.open || 0))
        .slice(0, 6);

      renderAdminOverviewList(
        adminOverviewAttention,
        attention,
        adminDashboardState.loading ? 'Dashboard laden...' : 'Geen deuren die aandacht nodig hebben.',
        record => `${record.attention || 0} rood`
      );
      renderAdminOverviewList(
        adminOverviewOpen,
        open,
        adminDashboardState.loading ? 'Dashboard laden...' : 'Geen open deuren gevonden.',
        record => `${record.open || 0} open`
      );
    }

    function renderAdminActivity() {
      if (!adminActivityList) return;
      adminActivityList.innerHTML = '';
      if (adminDashboardState.activityLoading) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = 'Activiteit laden...';
        adminActivityList.appendChild(empty);
        return;
      }
      if (adminDashboardState.activityError) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = adminDashboardState.activityUnavailable
          ? 'Activiteit komt beschikbaar na Worker update.'
          : 'Activiteit laden mislukt.';
        adminActivityList.appendChild(empty);
        return;
      }
      if (!adminDashboardState.activity.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = 'Nog geen recente statusactiviteit.';
        adminActivityList.appendChild(empty);
        return;
      }

      adminDashboardState.activity.forEach(row => {
        const door = findAdminDoorForActivity(row);
        const floorplan = findAdminFloorplanForActivity(row);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-activity-item';

        const main = document.createElement('div');
        main.className = 'admin-activity-item-main';
        const label = document.createElement('span');
        label.className = 'admin-activity-label';
        const dot = document.createElement('span');
        dot.className = 'admin-status-dot';
        dot.style.background = adminDoorColor(door || {
          status: row.newStatus === 'done' || row.new_status === 'done' ? 'done' : 'todo',
          doorCondition: door?.doorCondition || 'unknown',
        });
        const code = row.doorId || row.door_id || door?.doorId || door?.code || 'Deur';
        label.append(dot, document.createTextNode(`${code} · ${adminStatusLabel(door || row)}`));
        const time = document.createElement('span');
        time.className = 'admin-activity-time';
        time.textContent = adminFormatDateTime(row.createdAt || row.created_at);
        main.append(label, time);

        const meta = document.createElement('div');
        meta.className = 'admin-activity-item-meta';
        meta.textContent = `${row.customer || door?.customer || '-'} · ${door?.floorplanDisplayName || floorplan?.displayName || row.floorplan || '-'}`;

        button.append(main, meta);
        button.addEventListener('click', () => {
          const targetFloorplan = floorplan || door || row;
          adminDashboardState.selectedCustomer = '';
          adminDashboardState.selectedKey = adminFloorplanKey(targetFloorplan);
          adminDashboardState.selectedDoorKey = door ? adminDoorKey(door) : adminDoorKey(row);
          setAdminTab('details');
          renderAdminDashboard();
        });
        adminActivityList.appendChild(button);
      });
    }

    async function loadAdminActivity() {
      if (!isAdminUser()) return;
      adminDashboardState.activityLoading = true;
      adminDashboardState.activityError = '';
      adminDashboardState.activityUnavailable = false;
      renderAdminActivity();
      try {
        const result = await FD.DataService.fetchAdminActivity(CONFIG, {
          diagnostics: {
            purpose: 'admin_activity',
          },
        });
        adminDashboardState.activity = result.activity;
      } catch (err) {
        const unavailable = err?.status === 404 || err?.status === 501 || err?.code === 'not_implemented' || err?.message === 'not_implemented';
        if (!unavailable) {
          console.warn('Admin activiteit laden mislukt:', err);
        }
        adminDashboardState.activity = [];
        adminDashboardState.activityError = err.message || 'activity_failed';
        adminDashboardState.activityUnavailable = unavailable;
      } finally {
        adminDashboardState.activityLoading = false;
        renderAdminActivity();
      }
    }

    function renderAdminCustomerFilters() {
      if (!adminCustomerFilters) return;
      adminCustomerFilters.innerHTML = '';
      const data = getAdminData();
      const counts = new Map();
      (data.floorplans || []).forEach(record => {
        counts.set(record.customer, (counts.get(record.customer) || 0) + 1);
      });

      const buttons = [
        { label: 'Alle klanten', value: '', count: data.floorplans?.length || 0 },
        ...getAdminCustomerNames().map(name => ({ label: name, value: name, count: counts.get(name) || 0 })),
      ];

      buttons.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-filter-button';
        button.classList.toggle('active', adminDashboardState.selectedCustomer === item.value);
        const label = document.createElement('span');
        label.textContent = item.label;
        const count = document.createElement('span');
        count.textContent = String(item.count);
        button.append(label, count);
        button.addEventListener('click', () => {
          adminDashboardState.selectedCustomer = item.value;
          adminDashboardState.selectedKey = '';
          adminDashboardState.selectedDoorKey = '';
          adminDashboardState.previewKey = '';
          renderAdminDashboard();
        });
        adminCustomerFilters.appendChild(button);
      });
    }

    function renderAdminFloorplanList() {
      if (!adminFloorplanList) return;
      const filtered = getFilteredAdminFloorplans();
      const selected = getSelectedAdminFloorplan(filtered);
      if (adminFloorplanCount) {
        adminFloorplanCount.textContent = `${filtered.length} gevonden`;
      }

      adminFloorplanList.innerHTML = '';
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = adminDashboardState.loading ? 'Dashboard laden...' : 'Geen plattegronden gevonden.';
        adminFloorplanList.appendChild(empty);
        return;
      }

      filtered.forEach(record => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'admin-floorplan-row';
        row.classList.toggle('active', adminFloorplanKey(record) === adminDashboardState.selectedKey);

        const main = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'admin-floorplan-name';
        name.textContent = record.displayName || record.name || 'Plattegrond';
        const customer = document.createElement('div');
        customer.className = 'admin-floorplan-customer';
        customer.textContent = record.customer || 'Onbekende klant';
        main.append(name, customer);

        const counts = document.createElement('div');
        counts.className = 'admin-floorplan-counts';
        const done = document.createElement('span');
        done.textContent = `${record.done || 0}/${record.doorsTotal || 0} klaar`;
        const attention = document.createElement('span');
        attention.textContent = `${record.attention || 0} aandacht`;
        if (record.attention) attention.style.color = COLORS.attention;
        counts.append(done, attention);

        row.append(main, counts);
        row.addEventListener('click', () => {
          adminDashboardState.selectedKey = adminFloorplanKey(record);
          adminDashboardState.selectedDoorKey = '';
          setAdminTab('details');
          renderAdminDashboard();
        });
        adminFloorplanList.appendChild(row);
      });
    }

    function setAdminSelectOptions(select, options, value) {
      if (!select) return;
      select.innerHTML = '';
      options.forEach(optionData => {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.label;
        select.appendChild(option);
      });
      select.value = options.some(option => option.value === value) ? value : '';
    }

    function renderAdminDoorFilterOptions(allDoors) {
      if (adminDoorGroup) adminDoorGroup.value = adminDashboardState.doorOrder === 'desc' ? 'desc' : '';

      const customerNames = Array.from(new Set(allDoors.map(door => door.customer).filter(Boolean)))
        .sort((a, b) => ADMIN_COLLATOR.compare(a, b));
      if (adminDashboardState.doorCustomerFilter && !customerNames.includes(adminDashboardState.doorCustomerFilter)) {
        adminDashboardState.doorCustomerFilter = '';
        adminDashboardState.doorFloorplanFilter = '';
      }
      setAdminSelectOptions(adminDoorCustomerFilter, [
        { value: '', label: 'Alle klanten' },
        ...customerNames.map(name => ({ value: name, label: name })),
      ], adminDashboardState.doorCustomerFilter);

      const floorplanOptions = [];
      const floorplanSeen = new Set();
      if (adminDashboardState.doorCustomerFilter) {
        allDoors
          .filter(door => door.customer === adminDashboardState.doorCustomerFilter)
          .forEach(door => {
            const key = adminDoorFloorplanFilterKey(door);
            if (!key || floorplanSeen.has(key)) return;
            floorplanSeen.add(key);
            floorplanOptions.push({
              value: key,
              label: adminDoorFloorplanLabel(door) || door.floorplan || 'Plattegrond',
            });
          });
      }
      floorplanOptions.sort((a, b) => ADMIN_COLLATOR.compare(a.label, b.label));
      if (!adminDashboardState.doorCustomerFilter || !floorplanSeen.has(adminDashboardState.doorFloorplanFilter)) {
        adminDashboardState.doorFloorplanFilter = '';
      }
      setAdminSelectOptions(adminDoorFloorplanFilter, [
        { value: '', label: adminDashboardState.doorCustomerFilter ? 'Alle plattegronden' : 'Kies eerst een klant' },
        ...floorplanOptions,
      ], adminDashboardState.doorFloorplanFilter);
      if (adminDoorFloorplanFilter) {
        adminDoorFloorplanFilter.disabled = !adminDashboardState.doorCustomerFilter;
      }
    }

    function compareAdminDoors(left, right) {
      const leftCode = adminDoorCodeLabel(left);
      const rightCode = adminDoorCodeLabel(right);
      const leftFloorplan = adminDoorFloorplanLabel(left);
      const rightFloorplan = adminDoorFloorplanLabel(right);
      const byCode = () => ADMIN_COLLATOR.compare(leftCode, rightCode);
      const byCustomer = () => ADMIN_COLLATOR.compare(left.customer || '', right.customer || '');
      const byFloorplan = () => ADMIN_COLLATOR.compare(leftFloorplan, rightFloorplan);

      const direction = adminDashboardState.doorOrder === 'desc' ? -1 : 1;
      return (byCode() * direction) || byCustomer() || byFloorplan();
    }

    function renderAdminDoorResults() {
      if (!adminDoorResults) return;
      const query = adminNormalizeSearch(adminDashboardState.doorQuery);
      adminDoorResults.innerHTML = '';
      const allDoors = (getAdminData().doors || [])
        .filter(door => adminDoorCodeLabel(door))
        .slice();
      renderAdminDoorFilterOptions(allDoors);
      allDoors.sort(compareAdminDoors);
      if (!allDoors.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = adminDashboardState.loading ? 'Dashboard laden...' : 'Geen deurcodes gevonden.';
        adminDoorResults.appendChild(empty);
        return;
      }

      const results = allDoors.filter(door => {
        if (adminDashboardState.doorCustomerFilter && door.customer !== adminDashboardState.doorCustomerFilter) return false;
        if (adminDashboardState.doorFloorplanFilter && adminDoorFloorplanFilterKey(door) !== adminDashboardState.doorFloorplanFilter) return false;
        if (query && !adminDoorCodeLabel(door).toLowerCase().includes(query)) return false;
        return true;
      });

      const summary = document.createElement('div');
      summary.className = 'admin-door-results-summary';
      const scope = adminDashboardState.doorFloorplanFilter
        ? 'op geselecteerde plattegrond'
        : (adminDashboardState.doorCustomerFilter ? `bij ${adminDashboardState.doorCustomerFilter}` : 'in alle klanten');
      summary.textContent = `${results.length} deurcode${results.length === 1 ? '' : 's'} ${scope}`;
      adminDoorResults.appendChild(summary);

      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = 'Geen deur gevonden.';
        adminDoorResults.appendChild(empty);
        return;
      }

      results.forEach(door => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'admin-door-result';
        const code = document.createElement('div');
        code.className = 'admin-door-code';
        const dot = document.createElement('span');
        dot.className = 'admin-status-dot';
        dot.style.background = adminDoorColor(door);
        const label = document.createElement('span');
        label.textContent = adminDoorCodeLabel(door);
        code.append(dot, label);
        const meta = document.createElement('div');
        meta.className = 'admin-row-meta';
        meta.textContent = `${door.customer} · ${door.floorplanDisplayName || door.floorplan}`;
        item.append(code, meta);
        item.addEventListener('click', () => {
          adminDashboardState.selectedCustomer = '';
          adminDashboardState.selectedKey = adminFloorplanKey(door);
          adminDashboardState.selectedDoorKey = adminDoorKey(door);
          setAdminTab('details');
          renderAdminDashboard();
        });
        adminDoorResults.appendChild(item);
      });
    }

    function renderAdminCustomerSelect(record) {
      if (!adminDetailCustomer) return;
      adminDetailCustomer.innerHTML = '';
      getAdminCustomerNames().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        adminDetailCustomer.appendChild(option);
      });
      adminDetailCustomer.value = record?.customer || '';
    }

    function resetAdminPreview(message = 'Preview laden na selectie') {
      adminDashboardState.previewRequestId += 1;
      adminDashboardState.previewKey = '';
      if (adminDetailPreview) {
        adminDetailPreview.textContent = message;
      }
    }

    function getActiveAdminMetadataRecord() {
      return adminDashboardState.metadataRecord || getSelectedAdminFloorplan();
    }

    function selectTopbarFloorplanRecord(record) {
      if (!record) {
        updatePickerButtons();
        return false;
      }
      const { customerIndex, floorplanIndex } = findFloorplanSelectionForAdminRecord(record);
      if (customerIndex < 0 || floorplanIndex < 0) {
        updatePickerButtons();
        return false;
      }
      customerSelect.value = String(customerIndex);
      populateFloorplanDropdown(customerIndex);
      floorplanSelect.value = String(floorplanIndex);
      updatePickerButtons();
      return true;
    }

    function renderAdminMetadataForm(record) {
      if (!record) return;
      renderAdminCustomerSelect(record);
      if (adminDetailBuilding) adminDetailBuilding.value = record.building || '';
      if (adminDetailFloorLabel) adminDetailFloorLabel.value = record.floorLabel || record.displayName || record.name || '';
      if (adminDetailError) adminDetailError.textContent = '';
      if (adminDetailDelete) {
        const canDelete = record.repo === 'uploads' || record.uploaded;
        adminDetailDelete.disabled = !canDelete;
        adminDetailDelete.textContent = canDelete ? 'Plattegrond verwijderen' : 'Gallery-plattegrond kan niet verwijderd worden';
      }
      if (adminMetadataDialogContext) {
        const repoLabel = record.repo === 'uploads' ? 'upload' : 'gallery';
        adminMetadataDialogContext.textContent = `${record.customer} · ${record.displayName || record.name} · ${repoLabel}`;
      }
    }

    function openAdminMetadataDialog(record) {
      if (!record || !isAdminUser()) return;
      adminDashboardState.metadataRecord = record;
      adminDashboardState.selectedKey = adminFloorplanKey(record);
      adminDashboardState.selectedDoorKey = '';
      renderAdminMetadataForm(record);
      if (adminMetadataDialogOverlay) adminMetadataDialogOverlay.hidden = false;
      if (adminMetadataDialog) adminMetadataDialog.hidden = false;
      requestAnimationFrame(() => adminDetailBuilding?.focus());
    }

    function hideAdminMetadataDialog() {
      if (adminMetadataDialogOverlay) adminMetadataDialogOverlay.hidden = true;
      if (adminMetadataDialog) adminMetadataDialog.hidden = true;
      if (adminDetailError) adminDetailError.textContent = '';
      adminDashboardState.metadataRecord = null;
    }

    function openSelectedTopbarMetadataDialog() {
      if (!isAdminUser()) return;
      const record = getSelectedTopbarFloorplanRecord();
      if (!record) {
        showToast('Kies eerst een plattegrond', 'error');
        return;
      }
      openAdminMetadataDialog(record);
    }

    function renderAdminDetail() {
      const record = getSelectedAdminFloorplan();
      if (!record) {
        if (adminDetailEmpty) adminDetailEmpty.style.display = 'flex';
        if (adminDetailContent) adminDetailContent.style.display = 'none';
        if (adminDoorDetailCard) adminDoorDetailCard.hidden = true;
        resetAdminPreview();
        return;
      }

      if (adminDetailEmpty) adminDetailEmpty.style.display = 'none';
      if (adminDetailContent) adminDetailContent.style.display = 'block';
      const selectedDoor = getSelectedAdminDoor();
      if (adminDoorDetailCard) adminDoorDetailCard.hidden = !selectedDoor;
      if (selectedDoor) {
        if (adminDoorDetailDot) adminDoorDetailDot.style.background = adminDoorColor(selectedDoor);
        if (adminDoorDetailCode) adminDoorDetailCode.textContent = selectedDoor.code || selectedDoor.doorId || 'Deur';
        if (adminDoorDetailStatus) adminDoorDetailStatus.textContent = adminStatusLabel(selectedDoor);
        if (adminDoorDetailMeta) {
          adminDoorDetailMeta.textContent = `${selectedDoor.customer} · ${selectedDoor.floorplanDisplayName || selectedDoor.floorplan}`;
        }
      }
      if (adminDetailTitle) adminDetailTitle.textContent = record.displayName || record.name || 'Plattegrond';
      if (adminDetailMeta) {
        const repoLabel = record.repo === 'uploads' ? 'upload' : 'gallery';
        adminDetailMeta.textContent = `${record.customer} · ${repoLabel} · technisch: ${record.name}`;
      }
      if (adminDetailStats) {
        adminDetailStats.textContent = `${record.done || 0} van ${record.doorsTotal || 0} deuren afgerond · ${record.open || 0} openstaand · ${record.attention || 0} aandacht nodig`;
      }
      if (adminDashboardState.activeTab === 'details') loadAdminPreview(record);
    }

    function renderAdminDashboard() {
      setAdminTab(adminDashboardState.activeTab);
      renderAdminKpis();
      renderAdminOverview();
      renderAdminActivity();
      renderAdminCustomerFilters();
      renderAdminFloorplanList();
      renderAdminDoorResults();
      renderAdminDetail();
      updateRoleActionButtons();
    }

    async function loadAdminDashboard({ force = false } = {}) {
      if (!isAdminUser()) return;
      if (adminDashboardState.loading) return;
      if (!force && adminDashboardState.data) {
        renderAdminDashboard();
        loadActiveUsers();
        loadAdminActivity();
        return;
      }

      setAdminDashboardLoading(true);
      try {
        const data = await FD.DataService.fetchAdminOverview(CONFIG, {
          diagnostics: {
            purpose: 'admin_overview',
          },
        });
        adminDashboardState.data = data;
        if (Array.isArray(data.customers) && data.customers.length) {
          const previousSelection = getSelectedFloorplan();
          const previousCustomerIndex = FD.SelectSheetService.selectedIndex(customerSelect);
          const previousCustomerName = previousSelection.customer?.customer ||
            (previousCustomerIndex !== null ? customers[previousCustomerIndex]?.customer : '') ||
            currentCustomer ||
            '';
          const previousFloorplan = previousSelection.floorplan || null;
          const previousRepo = previousFloorplan?.repo === 'uploads' ? 'uploads' : 'gallery';
          customers = data.customers;
          cacheCustomers();
          populateCustomerDropdown();
          const selectedCustomerIndex = customers.findIndex(customer => customer.customer === previousCustomerName);
          if (selectedCustomerIndex >= 0) {
            customerSelect.value = String(selectedCustomerIndex);
            populateFloorplanDropdown(selectedCustomerIndex);
            if (previousFloorplan) {
              const selectedFloorplanIndex = (customers[selectedCustomerIndex].floorplans || []).findIndex(fp => (
                fp.name === previousFloorplan.name &&
                fp.file === previousFloorplan.file &&
                (fp.repo === 'uploads' ? 'uploads' : 'gallery') === previousRepo
              ));
              if (selectedFloorplanIndex >= 0) floorplanSelect.value = String(selectedFloorplanIndex);
            }
            updatePickerButtons();
          }
        }
        setAdminDashboardLoading(false);
        renderAdminDashboard();
      } catch (err) {
        console.warn('Admin dashboard laden mislukt:', err);
        if (adminFloorplanList) {
          adminFloorplanList.innerHTML = '<div class="admin-dashboard-empty">Dashboard laden mislukt.</div>';
        }
      } finally {
        setAdminDashboardLoading(false);
        loadActiveUsers();
        loadAdminActivity();
      }
    }

    function showAdminDashboard({ force = false } = {}) {
      if (!isAdminUser()) return;
      if (isEditModeActive()) {
        showToast('Sluit eerst de bewerkingsmodus', 'error');
        return;
      }
      adminDashboardState.visible = true;
      appContainer.classList.add('admin-dashboard-active');
      if (adminDashboardEl) adminDashboardEl.style.display = 'flex';
      loadingEl.classList.add('hidden');
      closeSidePanel();
      stopPolling();
      renderAdminDashboard();
      updateRoleActionButtons();
      startAdminActiveUsersPolling();
      loadAdminDashboard({ force });
    }

    function hideAdminDashboard() {
      adminDashboardState.visible = false;
      stopAdminActiveUsersPolling();
      appContainer.classList.remove('admin-dashboard-active');
      if (adminDashboardEl) adminDashboardEl.style.display = 'none';
      updateRoleActionButtons();
    }

    function returnToCurrentFloorplanFromDashboard() {
      if (!hasCurrentFloorplanView()) return false;
      restoreTopbarToCurrentFloorplan();
      hideAdminDashboard();
      refreshAllDoorColors();
      refreshJotFormSubmissionCache().catch(err => {
        console.warn('JotForm status na dashboard-terugkeer laden mislukt:', err);
      });
      statusController.poll().catch(err => {
        console.warn('Status na dashboard-terugkeer laden mislukt:', err);
      });
      startPolling();
      return true;
    }

    async function loadAdminPreview(record) {
      if (!adminDetailPreview || !record) return;
      const key = adminFloorplanKey(record);
      if (adminDashboardState.previewKey === key && adminDetailPreview.querySelector('svg')) return;
      const requestId = adminDashboardState.previewRequestId + 1;
      adminDashboardState.previewRequestId = requestId;
      adminDashboardState.previewKey = key;
      adminDetailPreview.textContent = 'Preview laden...';
      try {
        const result = await fetchFloorplanSVGCacheFirst(getFloorplanApiUrl(record));
        const svgText = typeof result === 'string' ? result : result?.svgText;
        if (!svgText) throw new Error('Preview SVG ontbreekt.');
        if (adminDashboardState.previewRequestId !== requestId || adminDashboardState.previewKey !== key) return;
        adminDetailPreview.innerHTML = FD.FloorplanViewService.sanitizeSVGText(svgText);
        const svg = adminDetailPreview.querySelector('svg');
        if (svg) {
          fitAdminPreviewSvg(svg);
        }
      } catch (err) {
        if (adminDashboardState.previewRequestId === requestId) {
          adminDetailPreview.textContent = 'Preview niet beschikbaar';
        }
      }
    }

    function parseSvgLength(value) {
      const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)/);
      const number = match ? Number(match[1]) : 0;
      return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function fitAdminPreviewSvg(svg) {
      const width = parseSvgLength(svg.getAttribute('width'));
      const height = parseSvgLength(svg.getAttribute('height'));
      const viewBox = svg.getAttribute('viewBox');
      if (!viewBox && width && height) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

      svg.removeAttribute('transform');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.position = 'static';
      svg.style.inset = 'auto';
      svg.style.top = 'auto';
      svg.style.right = 'auto';
      svg.style.bottom = 'auto';
      svg.style.left = 'auto';
      svg.style.transform = 'none';
      svg.style.transformOrigin = '50% 50%';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';
      svg.style.maxWidth = '100%';
      svg.style.maxHeight = '100%';

      requestAnimationFrame(() => {
        if (!svg.isConnected) return;
        const currentViewBox = svg.getAttribute('viewBox');
        if (currentViewBox && !/^0\s+0\s+0\s+0$/.test(currentViewBox.trim())) return;
        try {
          const box = svg.getBBox();
          if (box.width > 0 && box.height > 0) {
            svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
          }
        } catch {}
      });
    }

    function findFloorplanSelectionForAdminRecord(record) {
      const customerName = record?.customer || '';
      const floorplanName = record?.name || record?.floorplan || '';
      const repo = record?.repo === 'uploads' ? 'uploads' : 'gallery';
      const file = record?.file || '';
      const customerIndex = customers.findIndex(customer => customer.customer === customerName);
      if (customerIndex < 0) return { customerIndex: -1, floorplanIndex: -1 };
      const floorplanIndex = (customers[customerIndex].floorplans || []).findIndex(fp => (
        fp.name === floorplanName &&
        fp.file === file &&
        (fp.repo === 'uploads' ? 'uploads' : 'gallery') === repo
      ));
      return { customerIndex, floorplanIndex };
    }

    async function openAdminFloorplan(record, doorId = '') {
      if (!record) return;
      hideAdminDashboard();
      let { customerIndex, floorplanIndex } = findFloorplanSelectionForAdminRecord(record);
      if (customerIndex < 0 || floorplanIndex < 0) {
        await loadCustomers();
        ({ customerIndex, floorplanIndex } = findFloorplanSelectionForAdminRecord(record));
      }
      if (customerIndex < 0 || floorplanIndex < 0) {
        showToast('Plattegrond niet gevonden', 'error');
        showAdminDashboard();
        return;
      }
      customerSelect.value = String(customerIndex);
      populateFloorplanDropdown(customerIndex);
      floorplanSelect.value = String(floorplanIndex);
      updatePickerButtons();
      await loadFloorplan(customerIndex, floorplanIndex);
      if (doorId && FD.MarkerService.markerExists(svgContainer, doorId)) {
        selectDoor(doorId);
      }
    }

    async function saveAdminDetail() {
      const record = getActiveAdminMetadataRecord();
      if (!record) return;
      const nextCustomerName = adminDetailCustomer?.value || record.customer;
      const buildingName = adminDetailBuilding?.value.trim() || '';
      const floorLabel = adminDetailFloorLabel?.value.trim() || '';
      const editingCurrentFloorplan = currentCustomer === record.customer && currentFloorplan === record.name;
      if (!floorLabel) {
        if (adminDetailError) adminDetailError.textContent = 'Vul een verdieping of naam in.';
        return;
      }
      if (nextCustomerName !== record.customer) {
        const ok = window.confirm(`Plattegrond verplaatsen van ${record.customer} naar ${nextCustomerName}? Status en JotForm-koppelingen verhuizen mee.`);
        if (!ok) return;
      }

      if (adminDetailSave) {
        adminDetailSave.disabled = true;
        adminDetailSave.textContent = 'Opslaan...';
      }
      if (adminDetailError) adminDetailError.textContent = '';
      busyOverlay.show({
        title: 'Gegevens opslaan',
        subtitle: nextCustomerName !== record.customer ? 'Plattegrond wordt verplaatst...' : 'Plattegrondgegevens worden bijgewerkt...',
      });
      try {
        const result = await FD.DataService.updateFloorplanRecord(CONFIG, {
          customerName: record.customer,
          floorplanName: record.name,
          repo: record.repo,
          fileName: record.file,
          nextCustomerName,
          buildingName,
          floorLabel,
        });
        if (Array.isArray(result.customers)) {
          customers = result.customers;
          cacheCustomers();
          populateCustomerDropdown();
        }
        if (result.status) {
          doorStatus = result.status;
          FD.StatusService.cacheDoorStatus(doorStatus);
        }
        const nextRecord = result.record || {
          customer: nextCustomerName,
          name: record.name,
          displayName: buildingName ? `${buildingName} - ${floorLabel}` : floorLabel,
          building: buildingName,
          floorLabel,
          repo: record.repo,
          file: record.file,
          uploaded: record.uploaded,
        };
        if (editingCurrentFloorplan) {
          currentCustomer = nextCustomerName;
          updateStatusBar();
          refreshAllDoorColors();
        }
        selectTopbarFloorplanRecord(nextRecord);
        adminDashboardState.selectedCustomer = nextCustomerName;
        adminDashboardState.selectedKey = adminFloorplanKey(nextRecord);
        adminDashboardState.previewKey = '';
        await loadAdminDashboard({ force: true });
        hideAdminMetadataDialog();
        showToast('Plattegrondgegevens opgeslagen', 'success');
      } catch (err) {
        if (adminDetailError) {
          adminDetailError.textContent = err?.status === 409
            ? 'Deze klant heeft al een plattegrond met deze naam of dit bestand.'
            : 'Opslaan mislukt: ' + (err.message || 'onbekende fout');
        }
      } finally {
        if (adminDetailSave) {
          adminDetailSave.disabled = false;
          adminDetailSave.textContent = 'Gegevens opslaan';
        }
        busyOverlay.hide();
      }
    }

    function floorplanIdentityMatches(floorplan, target) {
      if (!floorplan || !target) return false;
      return floorplan.name === target.name &&
        floorplan.file === target.file &&
        (floorplan.repo === 'uploads' ? 'uploads' : 'gallery') === (target.repo === 'uploads' ? 'uploads' : 'gallery');
    }

    function adminRecordToUploadedFloorplanTarget(record) {
      const customer = customers.find(item => item.customer === record.customer) || {
        customer: record.customer,
        floorplans: [],
      };
      const floorplan = (customer.floorplans || []).find(fp => floorplanIdentityMatches(fp, record)) || {
        name: record.name,
        file: record.file,
        repo: record.repo === 'uploads' ? 'uploads' : 'gallery',
        uploaded: true,
        building: record.building || '',
        floorLabel: record.floorLabel || '',
      };
      return { customer, floorplan };
    }

    async function deleteAdminDetailFloorplan() {
      const record = getActiveAdminMetadataRecord();
      if (!record) return;
      if (!(record.repo === 'uploads' || record.uploaded)) {
        showToast('Gallery-plattegronden kunnen niet vanuit het dashboard verwijderd worden', 'error');
        return;
      }
      hideAdminMetadataDialog();
      uploadActionsController.showDeleteConfirm(adminRecordToUploadedFloorplanTarget(record));
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
        if (adminDashboardState.visible) {
          if (value === '') {
            resetFloorplanDropdown(true);
          } else {
            populateFloorplanDropdown(parseInt(value, 10));
          }
          updateRoleActionButtons();
          return;
        }
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
          updateRoleActionButtons();
          return;
        }
        if (adminDashboardState.visible) hideAdminDashboard();
        loadFloorplan(customerIndex, floorplanIndex);
      },
    });

    function updatePickerButtons() {
      selectionController.updatePickerButtons();
      updateTopbarMetadataButton();
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
      getDoorCondition,
      colors: { done: COLORS.done, todo: COLORS.todo, attention: COLORS.attention, checking: COLORS.checking },
      onSelect: selectDoor,
      setShellOpen: (open) => FD.UIShellService.setSidePanelOpen({
        sidePanelEl: sidePanel,
        toggleButtonEl: btnPanelToggle,
        appContainerEl: appContainer,
        open,
      }),
    });

    doorActionController = FD.DoorActionService.createController({
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
      colors: { done: COLORS.done, todo: COLORS.todo, attention: COLORS.attention, checking: COLORS.checking },
      getState: () => {
        const selection = getSelectedFloorplan();
        return {
          selectedDoor,
          currentCustomer: selection.customer || currentCustomer,
          currentFloorplan: selection.floorplan || currentFloorplan,
          online: navigator.onLine,
        };
      },
      setSelectedDoor: (doorId) => { selectedDoor = doorId; },
      getDoorStatus,
      getDoorCondition,
      refreshAllDoorColors,
      scrollToDoor: (doorId) => sidePanelController.scrollToDoor(doorId),
      showToast,
      openWindow: (url, target) => window.open(url, target),
      onBeforeOpenJotForm: saveJotFormReturnContext,
      getJotFormButtonState: getJotFormButtonStateForDoor,
      findJotFormSubmission: ({ selectedDoor, currentCustomer, currentFloorplan }) => {
        const cached = getCachedJotFormSubmission(selectedDoor);
        if (cached?.editUrl) {
          return Promise.resolve({ ok: true, found: true, editUrl: cached.editUrl });
        }
        const target = {
          customer: currentCustomer.customer || currentCustomer,
          floorplan: currentFloorplan.name || currentFloorplan,
          repo: currentFloorplan.repo === 'uploads' ? 'uploads' : 'gallery',
          file: currentFloorplan.file,
          doorId: selectedDoor,
        };
        return FD.DataService.findJotFormSubmission(CONFIG, target, {
          diagnostics: {
            purpose: 'jotform_submission_lookup',
          },
        });
      },
      prepareJotFormContext: ({ selectedDoor, currentCustomer, currentFloorplan }) => FD.DataService.createJotFormContext(CONFIG, {
        customer: currentCustomer.customer || currentCustomer,
        floorplan: currentFloorplan.name || currentFloorplan,
        repo: currentFloorplan.repo === 'uploads' ? 'uploads' : 'gallery',
        file: currentFloorplan.file,
        doorId: selectedDoor,
      }),
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
      fetchSvg: ({ floorplan }, options) => fetchFloorplanSVGCacheFirst(getFloorplanApiUrl(floorplan), options),
      setLoadingState,
      onBeforeLoad: () => {
        const keepTopbarActionsStable = Boolean(svgContainer.querySelector('svg'));
        topbarFloorplanActionsLocked = keepTopbarActionsStable;
        stopPolling();
        resetJotFormSubmissionCache();
        resetDoorCodeIndexState();
        deselectDoor();
        if (!keepTopbarActionsStable) {
          btnReset.style.display = 'none';
          btnEdit.style.display = 'none';
        }
        infoPanel.style.display = 'none';
        btnPanelToggle.style.display = 'none';
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
        topbarFloorplanActionsLocked = false;
        populateSidePanel();
        updateDeleteButton();
        updateRoleActionButtons();
        refreshJotFormSubmissionCache();
        startPolling();
      },
      onBeforeReveal: ({ size }) => fitToScreen(size.width, size.height),
      onRevalidated: () => showToast('Plattegrond bijgewerkt', 'success'),
      onError: (err) => {
        topbarFloorplanActionsLocked = false;
        btnReset.style.display = 'none';
        btnEdit.style.display = 'none';
        loadingEl.textContent = 'Fout: ' + err.message;
      },
    });

    function closeSidePanel() {
      sidePanelController.close();
    }

    function resetFloorplanUI() {
      floorplanLoadController.cancel();
      stopPolling();
      resetJotFormSubmissionCache();
      deselectDoor();
      floorplanLoadController.clearContent();
      statusCount.textContent = '';
      btnReset.style.display = 'none';
      infoPanel.style.display = 'none';
      btnPanelToggle.style.display = 'none';
      btnEdit.style.display = 'none';
      topbarFloorplanActionsLocked = false;
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
      refreshCurrentUser();
      pendingDoor = null;
      adminDashboardState.visible = false;
      adminDashboardState.data = null;
      adminDashboardState.selectedKey = '';
      adminDashboardState.selectedCustomer = '';
      adminDashboardState.searchQuery = '';
      adminDashboardState.doorQuery = '';
      adminDashboardState.doorOrder = 'asc';
      adminDashboardState.doorCustomerFilter = '';
      adminDashboardState.doorFloorplanFilter = '';
      adminDashboardState.activeTab = 'overview';
      adminDashboardState.selectedDoorKey = '';
      adminDashboardState.activity = [];
      adminDashboardState.activityLoading = false;
      adminDashboardState.activityError = '';
      adminDashboardState.activityUnavailable = false;
      adminDashboardState.previewKey = '';
      adminDashboardState.previewRequestId += 1;
      if (adminDashboardSearch) adminDashboardSearch.value = '';
      if (adminDoorSearch) adminDoorSearch.value = '';
      if (adminDoorGroup) adminDoorGroup.value = '';
      if (adminDoorCustomerFilter) adminDoorCustomerFilter.value = '';
      if (adminDoorFloorplanFilter) adminDoorFloorplanFilter.value = '';
      stopAdminActiveUsersPolling();
      renderActiveUsers(null);
      if (adminDashboardEl) adminDashboardEl.style.display = 'none';
      appContainer.classList.remove('admin-dashboard-active');
      customerSelect.disabled = false;
      FD.SelectSheetService.renderCustomerOptions(customerSelect, []);
      resetFloorplanDropdown(true);
      resetFloorplanUI();
      statusCount.textContent = '';
      hideTopbarMenu();
      updatePickerButtons();
      updateDeleteButton();
      updateRoleActionButtons();
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
      const condition = getDoorCondition(marker.dataset.doorId);

      if (isDone && condition === 'attention') {
        marker.style.fill = COLORS.attention;
      } else if (isDone && condition === 'checking') {
        marker.style.fill = COLORS.checking;
      } else if (isDone) {
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
      applyDoorActionPermissions();
      const key = jotformSubmissionCacheKey();
      refreshJotFormSubmissionCache({
        force: Boolean(key && jotformSubmissionCache.key === key && !jotformSubmissionCache.allChecked),
      });
    }

    function deselectDoor() {
      doorActionController.deselectDoor();
    }

    // ============================================================
    // JOTFORM LINK
    // ============================================================

    async function openJotForm() {
      if (btnJotform.classList.contains('disabled')) return;
      if (!canWriteCurrentFloorplan()) {
        showToast('Alleen kijken op deze plattegrond', 'error');
        return;
      }
      try {
        await doorActionController.openJotForm();
      } catch (err) {
        showToast(err?.status === 403 ? 'Geen rechten voor JotForm op deze plattegrond' : 'JotForm openen mislukt', 'error');
        console.warn('JotForm context aanmaken mislukt:', err);
      }
    }

    // ============================================================
    // EDIT MODE
    // ============================================================

    let editChanges = [];
    let editSaving = false;
    let editMarkerSize = 15;
    let qrScannerController = null;
    let markerSizeSliderController = null;

    let movingMarker = null;    // { marker, doorId, origCx, origCy, dragOffsetX, dragOffsetY }
    let isDraggingMove = false;
    let pendingAddMarker = null;
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
        clearPendingAddMarker();
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
      if (!canWriteCurrentFloorplan()) {
        showToast('Alleen kijken op deze plattegrond', 'error');
        return;
      }
      if (appMode.is(AppModes.EDIT)) return;
      if (!appMode.isInteractiveView()) {
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      appMode.enter(AppModes.EDIT);
      loadDoorCodeIndex({ force: true });
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
      btnEdit.style.display = canWriteCurrentFloorplan() ? 'inline-block' : 'none';
      btnReset.style.display = 'inline-block';
      customerSelect.disabled = false;
      floorplanSelect.disabled = false;
      updatePickerButtons();
      updateRoleActionButtons();
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
      if (editSaving) return;
      if (resizingMarker) applyResize();
      if (movingMarker) cancelMoveMode();

      if (editChanges.length === 0) {
        exitEditMode();
        return;
      }

      const svgEl = svgContainer.querySelector('svg');
      const svgText = FD.MarkerService.serializeCleanSVG(svgEl);

      // Save via Worker
      const btnSave = document.getElementById('btn-edit-save');
      btnSave.textContent = 'Opslaan...';
      btnSave.disabled = true;
      editSaving = true;
      busyOverlay.show({
        title: 'Plattegrond opslaan',
        subtitle: 'Wijzigingen worden opgeslagen...',
      });

      try {
        const { floorplan: fp } = getSelectedFloorplan();
        if (!fp) throw new Error('Geen plattegrond geselecteerd');
        const fileUrl = getFloorplanApiUrl(fp);

        const updateResult = await FD.DataService.saveFloorplanSVG(fileUrl, svgText, {
          config: CONFIG,
          customerName: currentCustomer,
          floorplanName: currentFloorplan,
          message: 'Markers bijgewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
          fetchErrorMessage: 'Kon bestand niet ophalen',
          saveErrorMessage: 'Kon niet opslaan',
        });
        await updateCachedSVGAfterSave(fileUrl, updateResult, svgText);
        resetDoorCodeIndexState();

        exitEditMode();
        editChanges = [];
        refreshAllDoorColors();
        populateSidePanel();
        showToast('Opgeslagen', 'success');

      } catch (err) {
        const duplicateMessage = duplicateDoorCodeMessage(err);
        showToast(duplicateMessage
          ? 'Opslaan mislukt: ' + duplicateMessage
          : 'Opslaan mislukt: ' + err.message, 'error');
        btnSave.textContent = 'Opslaan';
        btnSave.disabled = false;
      } finally {
        editSaving = false;
        busyOverlay.hide();
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

    function clearPendingAddMarker() {
      if (!pendingAddMarker) return;
      pendingAddMarker.remove();
      pendingAddMarker = null;
    }

    function showPendingAddMarker(svgX, svgY) {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return null;
      clearPendingAddMarker();

      const pos = clampMarkerPosition(svgX, svgY, editMarkerSize);
      const marker = FD.MarkerService.createEllipseMarker({
        doorId: '__fd_pending_marker',
        x: pos.x,
        y: pos.y,
        radius: editMarkerSize,
        fill: '#e67700',
        opacity: '0.95',
      });
      marker.removeAttribute('id');
      marker.removeAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label');
      marker.dataset.fdPendingMarker = '1';
      marker.style.pointerEvents = 'none';
      marker.style.stroke = '#fff';
      marker.style.strokeWidth = Math.max(2, editMarkerSize * 0.25).toString();
      marker.style.filter = 'drop-shadow(0 0 5px #e67700)';
      svgEl.appendChild(marker);
      pendingAddMarker = marker;
      return marker;
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
        const loadingMessage = doorCodeIndexLoadingMessage();
        if (loadingMessage) { showToast(loadingMessage, 'error'); return; }
        const conflict = findGlobalDoorCodeConflict(code);
        if (conflict) {
          showToast(globalDoorCodeConflictMessage(conflict, code), 'error');
          return;
        }
        addMarkerAtPosition(svgPoint.x, svgPoint.y, code);
        updateAutoPreview();
        return;
      }

      const previewMarker = showPendingAddMarker(svgPoint.x, svgPoint.y);
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
            const loadingMessage = doorCodeIndexLoadingMessage();
            if (loadingMessage) {
              editPopupError.textContent = loadingMessage;
              return;
            }
            const conflict = findGlobalDoorCodeConflict(code);
            if (conflict) {
              editPopupError.textContent = globalDoorCodeConflictMessage(conflict, code);
              return;
            }
            clearPendingAddMarker();
            addMarkerAtPosition(svgPoint.x, svgPoint.y, code);
            closeEditPopup();
          }
        },
        { text: 'Annuleren', color: '#e0e0e0', textColor: '#333', action: closeEditPopup }
      ]);
      if (previewMarker) requestAnimationFrame(() => positionEditPopupAwayFromMarker(previewMarker));
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
                  const loadingMessage = doorCodeIndexLoadingMessage();
                  if (loadingMessage) {
                    editPopupError.textContent = loadingMessage;
                    return;
                  }
                  const conflict = findGlobalDoorCodeConflict(newCode);
                  if (conflict) {
                    editPopupError.textContent = globalDoorCodeConflictMessage(conflict, newCode);
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
      onSynced: ({ syncedQueue = [] } = {}) => {
        syncedQueue.forEach(op => {
          if (!op || op.customer !== currentCustomer || op.floorplan !== currentFloorplan) return;
          if (op.status === 'done') rememberManualNewFormHint(op.doorId);
          if (op.status !== 'done') clearManualNewFormHint(op.doorId);
        });
        refreshAllDoorColors();
        updateDoneButton();
      },
      onNetworkUnavailable: () => {},
      onSyncError: (err) => console.error('Status sync queue mislukt:', err),
    });

    function handleStatusChanged(event = {}) {
      refreshAllDoorColors();
      if (event?.source === 'manual-toggle') {
        if (event.newStatus === 'done') rememberManualNewFormHint(event.doorId);
        if (event.newStatus !== 'done') clearManualNewFormHint(event.doorId);
        return;
      }
      if (
        event?.source === 'poll' &&
        jotformFocusRefreshDoorId &&
        selectedDoor === jotformFocusRefreshDoorId &&
        Date.now() <= jotformFocusRefreshUntil
      ) {
        return;
      }
      refreshJotFormSubmissionCache();
    }

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
      onStatusChanged: handleStatusChanged,
      updateDoneButton,
      showToast,
      logger: console,
    });

    async function flushStatusSyncQueue() {
      return statusController.flush();
    }

    async function toggleDoorStatus() {
      if (!canWriteCurrentFloorplan()) {
        showToast('Alleen kijken op deze plattegrond', 'error');
        return null;
      }
      return statusController.toggleDoorStatus();
    }

    function updateDoneButton() {
      doorActionController.updateDoneButton();
      if (selectedDoor) {
        const isDone = getDoorStatus(selectedDoor);
        const condition = getDoorCondition(selectedDoor);
        const needsAttention = isDone && condition === 'attention';
        const isChecking = isDone && condition === 'checking';
        doorStatusEl.textContent = needsAttention ? '(aandacht nodig)' : (isChecking ? '(controleren...)' : (isDone ? '(afgerond)' : '(nog te doen)'));
        doorStatusEl.style.color = needsAttention ? COLORS.attention : (isChecking ? COLORS.checking : (isDone ? COLORS.done : COLORS.todo));
      }
      applyDoorActionPermissions();
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
      clearJotFormReturnFastRefresh();
      statusController.stopPolling();
    }

    function updateStatusBar() {
      const markers = svgContainer.querySelectorAll('[data-door-id]');
      if (markers.length === 0) {
        statusCount.textContent = '';
        return;
      }
      let done = 0;
      let attention = 0;
      markers.forEach(m => {
        const isDone = getDoorStatus(m.dataset.doorId);
        if (isDone) done++;
        if (isDone && getDoorCondition(m.dataset.doorId) === 'attention') attention++;
      });
      statusCount.textContent = `${done} / ${markers.length} deuren afgerond${attention ? `, ${attention} aandacht nodig` : ''}`;
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
        stepPdf: document.getElementById('upload-step-pdf'),
        previewImg: document.getElementById('upload-preview-img'),
        previewTitle: document.querySelector('#upload-step-preview h3'),
        previewRetakeBtn: document.querySelector('#upload-step-preview .upload-btn-grey'),
        previewAcceptBtn: document.querySelector('#upload-step-preview .upload-btn-green'),
        customerSelect: document.getElementById('upload-customer-select'),
        newCustomerWrapper: document.getElementById('upload-new-customer-wrapper'),
        newCustomerInput: document.getElementById('upload-new-customer'),
        buildingNameInput: document.getElementById('upload-building-name'),
        floorplanNameInput: document.getElementById('upload-floorplan-name'),
        errorEl: document.getElementById('upload-error'),
        pdfState: { pages: [] },
        pdfTitle: document.getElementById('upload-pdf-title'),
        pdfSummary: document.getElementById('upload-pdf-summary'),
        pdfProcessing: document.getElementById('upload-pdf-processing'),
        pdfOverview: document.getElementById('upload-pdf-overview'),
        pdfEditor: document.getElementById('upload-pdf-editor'),
        pdfForm: document.getElementById('upload-pdf-form'),
        pdfPages: document.getElementById('upload-pdf-pages'),
        pdfCount: document.getElementById('upload-pdf-count'),
        pdfNextButton: document.getElementById('btn-upload-pdf-next'),
        pdfEditorTitle: document.getElementById('upload-pdf-editor-title'),
        pdfEditorImg: document.getElementById('upload-pdf-editor-img'),
        pdfEditorLoading: document.getElementById('upload-pdf-editor-loading'),
        pdfEditorSaveButton: document.getElementById('btn-upload-pdf-editor-save'),
        pdfZoomOutButton: document.getElementById('btn-upload-pdf-zoom-out'),
        pdfZoomFitButton: document.getElementById('btn-upload-pdf-zoom-fit'),
        pdfZoomInButton: document.getElementById('btn-upload-pdf-zoom-in'),
        pdfCustomerSelect: document.getElementById('upload-pdf-customer-select'),
        pdfBuildingNameInput: document.getElementById('upload-pdf-building-name'),
        pdfNewCustomerWrapper: document.getElementById('upload-pdf-new-customer-wrapper'),
        pdfNewCustomerInput: document.getElementById('upload-pdf-new-customer'),
        pdfNamesList: document.getElementById('upload-pdf-names-list'),
        pdfProgress: document.getElementById('upload-pdf-progress'),
        pdfProgressBar: document.getElementById('upload-pdf-progress-bar'),
        pdfProgressText: document.getElementById('upload-pdf-progress-text'),
        pdfErrorEl: document.getElementById('upload-pdf-error'),
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
        pdfCloseButton: document.getElementById('btn-upload-pdf-close'),
        pdfRetakeButton: document.getElementById('btn-upload-pdf-retake'),
        pdfSelectAllButton: document.getElementById('btn-upload-pdf-select-all'),
        pdfSelectNoneButton: document.getElementById('btn-upload-pdf-select-none'),
        pdfNextButton: document.getElementById('btn-upload-pdf-next'),
        pdfFormBackButton: document.getElementById('btn-upload-pdf-form-back'),
        pdfEditorBackButton: document.getElementById('btn-upload-pdf-editor-back'),
        pdfEditorCancelButton: document.getElementById('btn-upload-pdf-editor-cancel'),
        pdfEditorSaveButton: document.getElementById('btn-upload-pdf-editor-save'),
        pdfZoomOutButton: document.getElementById('btn-upload-pdf-zoom-out'),
        pdfZoomFitButton: document.getElementById('btn-upload-pdf-zoom-fit'),
        pdfZoomInButton: document.getElementById('btn-upload-pdf-zoom-in'),
        pdfRotateLeftButton: document.getElementById('btn-upload-pdf-rotate-left'),
        pdfRotateRightButton: document.getElementById('btn-upload-pdf-rotate-right'),
        pdfBackToSelectButton: document.getElementById('btn-upload-pdf-back-to-select'),
        pdfSaveButton: document.getElementById('btn-upload-pdf-save'),
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
          buildingName: form.buildingName,
          floorLabel: form.floorLabel,
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
        if (adminDashboardState.visible) hideAdminDashboard();
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
    const btnEditMetadata = document.getElementById('btn-edit-fp-metadata');
    const metadataFpOverlay = document.getElementById('metadata-fp-overlay');
    const metadataFpPopup = document.getElementById('metadata-fp-popup');
    const metadataFpContext = document.getElementById('metadata-fp-context');
    const metadataBuildingInput = document.getElementById('metadata-building-name');
    const metadataFloorLabelInput = document.getElementById('metadata-floor-label');
    const metadataFpError = document.getElementById('metadata-fp-error');
    const metadataFpSave = document.getElementById('metadata-fp-save');
    const metadataFpCancel = document.getElementById('metadata-fp-cancel');
    const metadataDialog = FD.UIShellService.createPopupPair({
      overlayEl: metadataFpOverlay,
      popupEl: metadataFpPopup,
    });

    function selectDeletedFloorplanCustomer(customerName, currentCustomers) {
      const remainingCi = currentCustomers.findIndex(customer => customer.customer === customerName);
      if (remainingCi >= 0) {
        customerSelect.value = String(remainingCi);
        populateFloorplanDropdown(remainingCi);
        floorplanSelect.value = '';
        updatePickerButtons();
        setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
        loadingEl.classList.remove('hidden');
        return;
      }

      customerSelect.value = '';
      resetFloorplanDropdown(true);
      updatePickerButtons();
      setEmptyState('Kies een klant en plattegrond<br>om te beginnen.', 'Gebruik de dropdowns bovenaan');
      loadingEl.classList.remove('hidden');
    }

    function restoreTopbarSelectionAfterCustomerRefresh(selection) {
      if (!selection?.customer || !selection?.floorplan) return;
      selectTopbarFloorplanRecord({
        customer: selection.customer.customer,
        name: selection.floorplan.name,
        repo: selection.floorplan.repo === 'uploads' ? 'uploads' : 'gallery',
        file: selection.floorplan.file || '',
      });
    }

    async function deleteUploadedFloorplanAndReset({ customer, floorplan: fp }) {
      const customerName = customer.customer;
      const selectedBeforeDelete = getSelectedFloorplan();
      const deletingCurrentFloorplan = selectedBeforeDelete.customer?.customer === customerName &&
        floorplanIdentityMatches(selectedBeforeDelete.floorplan, fp);

      busyOverlay.show({
        title: 'Plattegrond verwijderen',
        subtitle: 'Uploadbestand en klantkoppeling worden verwijderd...',
      });
      try {
        floorplanLoadController.cancel();
        stopPolling();
        const { customers: currentCustomers } = await FD.DataService.deleteUploadedFloorplan(CONFIG, {
          customerName,
          floorplan: fp,
        });

        customers = currentCustomers;
        cacheCustomers();
        populateCustomerDropdown();

        if (deletingCurrentFloorplan) {
          currentFloorplan = null;
          currentCustomer = null;
          resetFloorplanUI();
          selectDeletedFloorplanCustomer(customerName, currentCustomers);
        } else {
          restoreTopbarSelectionAfterCustomerRefresh(selectedBeforeDelete);
        }

        if (adminDashboardState.visible || adminDashboardState.data) {
          adminDashboardState.selectedKey = '';
          adminDashboardState.selectedDoorKey = '';
          adminDashboardState.previewKey = '';
          await loadAdminDashboard({ force: true });
        }
      } finally {
        busyOverlay.hide();
      }
    }

    const uploadActionsController = FD.UploadService.createUploadedFloorplanActionsController({
      controls: {
        deleteButton: document.getElementById('btn-delete-fp'),
        editImageButton: btnEditImage,
        metadataButton: btnEditMetadata,
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
      onDelete: deleteUploadedFloorplanAndReset,
    });

    function showMetadataDialog() {
      if (isEditModeActive()) {
        showToast('Sluit eerst de bewerkingsmodus', 'error');
        return;
      }
      if (!appMode.isInteractiveView()) {
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      if (!canManageUploads()) {
        showToast('Geen rechten om plattegrondgegevens te bewerken', 'error');
        return;
      }
      hideTopbarMenu();
      const { customer, floorplan } = getSelectedFloorplan();
      if (!customer || !floorplan || !(floorplan.uploaded || floorplan.repo === 'uploads')) return;
      const parts = FD.SelectSheetService.floorplanDisplayParts(floorplan);
      metadataBuildingInput.value = parts.building;
      metadataFloorLabelInput.value = parts.floorLabel || floorplan.name || '';
      metadataFpError.textContent = '';
      metadataFpContext.textContent = `${customer.customer} · technisch: ${floorplan.name}`;
      metadataFpSave.disabled = false;
      metadataFpSave.textContent = 'Opslaan';
      metadataDialog.show();
      setTimeout(() => metadataBuildingInput.focus(), 0);
    }

    function hideMetadataDialog() {
      metadataDialog.hide();
    }

    async function saveMetadataDialog() {
      const { customer, floorplan } = getSelectedFloorplan();
      if (!customer || !floorplan) return;
      const floorLabel = metadataFloorLabelInput.value.trim();
      const buildingName = metadataBuildingInput.value.trim();
      if (!floorLabel) {
        metadataFpError.textContent = 'Vul een verdieping of naam in.';
        return;
      }

      metadataFpSave.disabled = true;
      metadataFpSave.textContent = 'Opslaan...';
      metadataFpError.textContent = '';
      busyOverlay.show({
        title: 'Gegevens opslaan',
        subtitle: 'Plattegrondnaam wordt bijgewerkt...',
      });
      try {
        const { customers: currentCustomers } = await FD.DataService.updateUploadedFloorplanMetadata(CONFIG, {
          customerName: customer.customer,
          floorplan,
          buildingName,
          floorLabel,
        });
        customers = currentCustomers;
        cacheCustomers();

        const nextCustomerIndex = customers.findIndex(item => item.customer === customer.customer);
        populateCustomerDropdown();
        if (nextCustomerIndex >= 0) {
          customerSelect.value = String(nextCustomerIndex);
          populateFloorplanDropdown(nextCustomerIndex);
          const previousRepo = floorplan.repo === 'uploads' ? 'uploads' : 'gallery';
          const nextFloorplanIndex = customers[nextCustomerIndex].floorplans.findIndex(fp => (
            fp.name === floorplan.name &&
            fp.file === floorplan.file &&
            (fp.repo === 'uploads' ? 'uploads' : 'gallery') === previousRepo
          ));
          if (nextFloorplanIndex >= 0) floorplanSelect.value = String(nextFloorplanIndex);
        }
        updatePickerButtons();
        updateDeleteButton();
        hideMetadataDialog();
        showToast('Plattegrondgegevens opgeslagen', 'success');
      } catch (err) {
        metadataFpError.textContent = err?.status === 409
          ? 'Deze zichtbare naam bestaat al bij deze klant.'
          : 'Opslaan mislukt: ' + (err.message || 'onbekende fout');
      } finally {
        metadataFpSave.disabled = false;
        metadataFpSave.textContent = 'Opslaan';
        busyOverlay.hide();
      }
    }

    function updateDeleteButton() {
      uploadActionsController.updateButtons();
      const deleteButton = document.getElementById('btn-delete-fp');
      const editImageButton = document.getElementById('btn-edit-image');
      const metadataButton = document.getElementById('btn-edit-fp-metadata');
      if (deleteButton && !canManageUploads()) deleteButton.style.display = 'none';
      if (editImageButton && !canWriteCurrentFloorplan()) editImageButton.style.display = 'none';
      if (metadataButton && !canManageUploads()) metadataButton.style.display = 'none';
    }

    uploadActionsController.bind();
    btnEditMetadata?.addEventListener('click', showMetadataDialog);
    metadataFpSave?.addEventListener('click', saveMetadataDialog);
    metadataFpCancel?.addEventListener('click', hideMetadataDialog);
    metadataFpOverlay?.addEventListener('click', hideMetadataDialog);

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    selectionController.bind();

    btnJotform.addEventListener('click', openJotForm);
    btnDone.addEventListener('click', toggleDoorStatus);
    btnClose.addEventListener('click', deselectDoor);
    btnReset.addEventListener('click', () => {
      if (topbarFloorplanActionsLocked) return;
      resetZoom();
    });
    btnPanelToggle.addEventListener('click', toggleSidePanel);
    btnEdit.addEventListener('click', () => {
      if (topbarFloorplanActionsLocked) return;
      enterEditMode();
    });
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

    const LOGIN_CONFIG = {
      lockoutMinutes: 10,
      tokenKey: 'fd_auth_token',
      tokenTimeKey: 'fd_auth_time',
      lockoutKey: 'fd_lockout',
      attemptsKey: 'fd_attempts',
    };

    function showApp() {
      refreshCurrentUserFromWorker();
      appMode.enter(AppModes.VIEW);
      document.getElementById('login-screen').style.display = 'none';
      appContainer.style.display = 'block';
      updateConnectionIndicator();
      updateStatusSyncIndicator();
      startSessionHeartbeat();
      requestAnimationFrame(updateTopbarHeight);
      init();
    }

    // Menu toggle
    topbarMenuController.bind();
    btnDashboard?.addEventListener('click', () => {
      if (adminDashboardState.visible) {
        if (!returnToCurrentFloorplanFromDashboard()) {
          loadAdminDashboard({ force: true });
        }
      } else {
        showAdminDashboard();
      }
    });
    adminDashboardTabs.forEach(button => {
      button.addEventListener('click', () => {
        setAdminTab(button.dataset.adminTab || 'overview');
        renderAdminDashboard();
      });
    });
    adminDashboardRefresh?.addEventListener('click', () => loadAdminDashboard({ force: true }));
    adminDashboardSearch?.addEventListener('input', () => {
      adminDashboardState.searchQuery = adminDashboardSearch.value;
      adminDashboardState.selectedKey = '';
      renderAdminDashboard();
    });
    adminDoorSearch?.addEventListener('input', () => {
      adminDashboardState.doorQuery = adminDoorSearch.value;
      renderAdminDoorResults();
    });
    adminDoorGroup?.addEventListener('change', () => {
      adminDashboardState.doorOrder = adminDoorGroup.value === 'desc' ? 'desc' : 'asc';
      renderAdminDoorResults();
    });
    adminDoorCustomerFilter?.addEventListener('change', () => {
      adminDashboardState.doorCustomerFilter = adminDoorCustomerFilter.value || '';
      adminDashboardState.doorFloorplanFilter = '';
      renderAdminDoorResults();
    });
    adminDoorFloorplanFilter?.addEventListener('change', () => {
      adminDashboardState.doorFloorplanFilter = adminDoorFloorplanFilter.value || '';
      renderAdminDoorResults();
    });
    adminDetailOpen?.addEventListener('click', () => openAdminFloorplan(getSelectedAdminFloorplan()));
    adminDoorDetailOpen?.addEventListener('click', () => {
      const selectedDoor = getSelectedAdminDoor();
      openAdminFloorplan(getSelectedAdminFloorplan(), selectedDoor?.doorId || selectedDoor?.code || '');
    });
    btnTopbarMetadata?.addEventListener('click', openSelectedTopbarMetadataDialog);
    adminDetailSave?.addEventListener('click', saveAdminDetail);
    adminDetailDelete?.addEventListener('click', deleteAdminDetailFloorplan);
    adminDetailCancel?.addEventListener('click', hideAdminMetadataDialog);
    adminMetadataDialogOverlay?.addEventListener('click', hideAdminMetadataDialog);
    btnMenuLabels.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLabels();
    });

    const authController = FD.AuthService.createAuthController({
      loginConfig: LOGIN_CONFIG,
      appConfig: CONFIG,
      elements: {
        splashScreen: document.getElementById('splash-screen'),
        loginScreen: document.getElementById('login-screen'),
        appContainer,
        usernameInput: document.getElementById('login-username'),
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
        stopSessionHeartbeat();
        stopAdminActiveUsersPolling();
        resetAppToStartScreen();
        stopPolling();
      },
      onSessionExpired: () => {
        stopSessionHeartbeat();
        stopAdminActiveUsersPolling();
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
      const restored = await restoreJotFormReturnIfNeeded();
      if (!restored && isAdminUser()) {
        showAdminDashboard();
      }
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
    let editorCropRotation = 0;
    let pendingCropSave = null;

    function normalizeEditorRotation(value) {
      return ((Math.round(Number(value || 0) / 90) * 90) % 360 + 360) % 360;
    }

    function getCurrentFloorplanObj() {
      return getSelectedFloorplan().floorplan;
    }

    function prepareEditorCropperForFullFit() {
      if (!editorCropper?.getContainerData || !editorCropper?.setCropBoxData) return;
      const containerData = editorCropper.getContainerData();
      if (!containerData.width || !containerData.height) return;
      const width = Math.max(24, Math.min(96, containerData.width * 0.2));
      const height = Math.max(24, Math.min(96, containerData.height * 0.2));
      editorCropper.setCropBoxData({
        left: (containerData.width - width) / 2,
        top: (containerData.height - height) / 2,
        width,
        height,
      });
    }

    function fitEditorCropperCanvasToFullImage() {
      if (!editorCropper?.getContainerData || !editorCropper?.getCanvasData || !editorCropper?.setCanvasData || !editorCropper?.getImageData) return;
      const containerData = editorCropper.getContainerData();
      const canvasData = editorCropper.getCanvasData();
      const imageData = editorCropper.getImageData();
      const naturalWidth = canvasData.naturalWidth || imageData.naturalWidth || canvasData.width || 1;
      const naturalHeight = canvasData.naturalHeight || imageData.naturalHeight || canvasData.height || 1;
      if (!containerData.width || !containerData.height || !naturalWidth || !naturalHeight) return;

      const safeSpace = window.matchMedia?.('(pointer: coarse)')?.matches ? 72 : 56;
      const maxWidth = Math.max(1, containerData.width - safeSpace);
      const maxHeight = Math.max(1, containerData.height - safeSpace);
      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      editorCropper.setCanvasData({
        left: (containerData.width - width) / 2,
        top: (containerData.height - height) / 2,
        width,
        height,
      });
    }

    function fitEditorCropperToFullImage() {
      if (!editorCropper) return;
      prepareEditorCropperForFullFit();
      fitEditorCropperCanvasToFullImage();
      if (typeof editorCropper.setCropBoxData === 'function') {
        const canvasData = editorCropper.getCanvasData();
        editorCropper.setCropBoxData({
          left: canvasData.left,
          top: canvasData.top,
          width: canvasData.width,
          height: canvasData.height,
        });
      }
    }

    function resetEditorCropperToRotation() {
      if (!editorCropper) return;
      const rotation = normalizeEditorRotation(editorCropRotation);
      editorCropper.reset();
      if (typeof editorCropper.rotateTo === 'function') {
        editorCropper.rotateTo(rotation);
      } else if (rotation && typeof editorCropper.rotate === 'function') {
        editorCropper.rotate(rotation);
      }

      requestAnimationFrame(() => {
        if (!editorCropper) return;
        fitEditorCropperToFullImage();
        requestAnimationFrame(() => {
          if (!editorCropper) return;
          fitEditorCropperToFullImage();
          setTimeout(() => {
            if (editorCropper) fitEditorCropperToFullImage();
          }, 140);
        });
      });
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
        rotatable: true,
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
          requestAnimationFrame(() => {
            if (editorCropper && editorCropContext) fitEditorCropperToFullImage();
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
      editorCropRotation = 0;
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
      editorCropRotation = 0;
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
      editorCropRotation = 0;
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

    function rotateEditorImage90(direction) {
      if (editorCropper) {
        editorCropRotation = (editorCropRotation + direction * 90 + 360) % 360;
        resetEditorCropperToRotation();
        return;
      }
      rotateCanvas90(direction);
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

    function rotatedEditorPoint(relX, relY, rotation) {
      const width = editorCropContext.imgW;
      const height = editorCropContext.imgH;
      if (rotation === 90) return { x: height - relY, y: relX };
      if (rotation === 180) return { x: width - relX, y: height - relY };
      if (rotation === 270) return { x: relY, y: width - relX };
      return { x: relX, y: relY };
    }

    function markerRadii(marker, rotation) {
      const r = parseFloat(marker.getAttribute('r'));
      const rxAttr = parseFloat(marker.getAttribute('rx'));
      const ryAttr = parseFloat(marker.getAttribute('ry'));
      let rx = Number.isFinite(rxAttr) ? rxAttr : (Number.isFinite(r) ? r : 0);
      let ry = Number.isFinite(ryAttr) ? ryAttr : (Number.isFinite(r) ? r : rx);
      if (rotation === 90 || rotation === 270) [rx, ry] = [ry, rx];
      return { rx, ry };
    }

    function rotatedEditorMarkerPlacement(marker, plan) {
      const position = FD.MarkerService.markerPosition(marker);
      if (!position) return null;
      const relX = position.x - editorCropContext.imgX;
      const relY = position.y - editorCropContext.imgY;
      const rotated = rotatedEditorPoint(relX, relY, plan.rotation);
      const radii = markerRadii(marker, plan.rotation);
      return {
        x: rotated.x,
        y: rotated.y,
        rx: radii.rx,
        ry: radii.ry,
      };
    }

    function markerFitsRotatedPlan(marker, plan) {
      const placement = rotatedEditorMarkerPlacement(marker, plan);
      if (!placement) return false;
      return placement.x - placement.rx >= plan.cropX &&
             placement.x + placement.rx <= plan.cropX + plan.cropW &&
             placement.y - placement.ry >= plan.cropY &&
             placement.y + placement.ry <= plan.cropY + plan.cropH;
    }

    function getRotatedCropSavePlan() {
      if (!editorCropper || !editorCropContext) return null;
      const cropData = editorCropper.getData(true);
      const rotation = normalizeEditorRotation(cropData.rotate || editorCropRotation);
      if (!rotation) return null;
      const imageData = editorCropper.getImageData();
      const naturalWidth = imageData.naturalWidth || document.getElementById('img-editor-crop-image').naturalWidth;
      const naturalHeight = imageData.naturalHeight || document.getElementById('img-editor-crop-image').naturalHeight;
      if (!naturalWidth || !naturalHeight || cropData.width < 10 || cropData.height < 10) return null;

      const rotatedNaturalWidth = rotation === 90 || rotation === 270 ? naturalHeight : naturalWidth;
      const rotatedNaturalHeight = rotation === 90 || rotation === 270 ? naturalWidth : naturalHeight;
      const rotatedSvgWidth = rotation === 90 || rotation === 270 ? editorCropContext.imgH : editorCropContext.imgW;
      const rotatedSvgHeight = rotation === 90 || rotation === 270 ? editorCropContext.imgW : editorCropContext.imgH;
      const scaleX = rotatedSvgWidth / rotatedNaturalWidth;
      const scaleY = rotatedSvgHeight / rotatedNaturalHeight;
      const cropX = cropData.x * scaleX;
      const cropY = cropData.y * scaleY;
      const cropW = cropData.width * scaleX;
      const cropH = cropData.height * scaleY;
      const plan = { cropData, rotation, cropX, cropY, cropW, cropH, outsideDoorCodes: [] };

      Array.from(svgContainer.querySelectorAll('[data-door-id]')).forEach(marker => {
        if (!markerFitsRotatedPlan(marker, plan)) {
          plan.outsideDoorCodes.push(FD.ImageEditorService.markerDoorCode(marker));
        }
      });
      return plan;
    }

    function buildRotatedEditorSVGText({ imageDataUrl, plan }) {
      if (!editorCropContext?.svgEl || !imageDataUrl || !plan) {
        throw new Error('Rotatie-save data is incompleet.');
      }
      const width = Math.max(1, Math.round(plan.cropW));
      const height = Math.max(1, Math.round(plan.cropH));
      const svgClone = editorCropContext.svgEl.cloneNode(true);
      svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svgClone.setAttribute('width', width.toString());
      svgClone.setAttribute('height', height.toString());

      const cloneImage = svgClone.querySelector('image');
      if (!cloneImage) throw new Error('Afbeelding ontbreekt in plattegrond.');
      cloneImage.setAttribute('href', imageDataUrl);
      cloneImage.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      cloneImage.setAttribute('x', '0');
      cloneImage.setAttribute('y', '0');
      cloneImage.setAttribute('width', width.toString());
      cloneImage.setAttribute('height', height.toString());

      svgClone.querySelectorAll('[data-fd-label]').forEach(el => el.remove());
      svgClone.querySelectorAll('[data-door-id]').forEach(marker => {
        const placement = rotatedEditorMarkerPlacement(marker, plan);
        if (!placement || !markerFitsRotatedPlan(marker, plan)) {
          marker.remove();
          return;
        }
        FD.MarkerService.setMarkerPosition(marker, placement.x - plan.cropX, placement.y - plan.cropY);
        if ((plan.rotation === 90 || plan.rotation === 270) && marker.hasAttribute('rx') && marker.hasAttribute('ry')) {
          const oldRx = marker.getAttribute('rx');
          marker.setAttribute('rx', marker.getAttribute('ry'));
          marker.setAttribute('ry', oldRx);
        }
        FD.MarkerService.clearRuntimeMarkerState(marker);
      });

      return new XMLSerializer().serializeToString(svgClone);
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
      const rotatedPlan = normalizeEditorRotation(editorCropRotation) ? getRotatedCropSavePlan() : null;
      const plan = rotatedPlan || getCropSavePlan();
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
      busyOverlay.show({
        title: 'Afbeelding opslaan',
        subtitle: 'Bewerkte plattegrond wordt opgeslagen...',
      });

      try {
        const outputCanvas = editorCropper.getCroppedCanvas({
          width: Math.max(1, Math.round(plan.cropW)),
          height: Math.max(1, Math.round(plan.cropH)),
          fillColor: '#fff',
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        });
        const newDataUrl = FD.ImageEditorService.canvasToLimitedJPEG(outputCanvas);
        const svgText = rotatedPlan ? buildRotatedEditorSVGText({
          imageDataUrl: newDataUrl,
          plan: rotatedPlan,
        }) : FD.ImageEditorService.buildCroppedSVGText({
          svgEl: editorCropContext.svgEl,
          imageDataUrl: newDataUrl,
          plan,
          markerService: FD.MarkerService,
        });
        const fileUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fp.file);
        const updateResult = await FD.DataService.saveFloorplanSVG(fileUrl, svgText, {
          config: CONFIG,
          customerName: currentCustomer,
          floorplanName: currentFloorplan,
          message: 'Afbeelding bewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
          fetchErrorMessage: 'Kon bestand niet ophalen ({status})',
          saveErrorMessage: 'Opslaan mislukt ({status})',
        });
        await updateCachedSVGAfterSave(fileUrl, updateResult, svgText);

        btnSave.textContent = 'Bijwerken...';
        busyOverlay.update({
          title: 'Plattegrond bijwerken',
          subtitle: 'Nieuwe versie wordt geladen...',
        });
        const { customerIndex, floorplanIndex, floorplan } = getSelectedFloorplan();
        if (customerIndex !== null && floorplanIndex !== null && floorplan) {
          await loadFloorplan(customerIndex, floorplanIndex);
        }
        closeImageEditor();
        showToast('Afbeelding opgeslagen', 'success');

      } catch (err) {
        const duplicateMessage = duplicateDoorCodeMessage(err);
        showToast(duplicateMessage
          ? 'Opslaan mislukt: ' + duplicateMessage
          : 'Fout: ' + err.message, 'error');
        editorSaving = false;
        if (appMode.is(AppModes.IMAGE_EDITOR_SAVING)) appMode.enter(AppModes.IMAGE_EDITOR);
        btnSave.disabled = false;
        btnSave.textContent = '\uD83D\uDCBE Opslaan';
      } finally {
        if (!editorSaving || !appMode.is(AppModes.IMAGE_EDITOR_SAVING)) {
          busyOverlay.hide();
        }
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
    document.getElementById('img-editor-tool-rotate-left').addEventListener('click', () => rotateEditorImage90(-1));
    document.getElementById('img-editor-tool-rotate-right').addEventListener('click', () => rotateEditorImage90(1));
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

    startAppUpdateChecks();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(reg => {
          serviceWorkerRegistration = reg;
          reg.onupdatefound = () => {
            const installing = reg.installing;
            installing.onstatechange = () => {
              if (installing.state === 'activated' && navigator.serviceWorker.controller) checkForAppUpdate();
            };
          };
        })
        .catch(err => console.warn('SW registration failed:', err));
    }
