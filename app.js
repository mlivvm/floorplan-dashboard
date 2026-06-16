    // ============================================================
    // CONFIGURATION
    // ============================================================

    const APP_VERSION = '1.9.32';
    const ENV_CONFIG = window.FD?.Env?.config || window.FD_ENV_CONFIG || {};
    const DEFAULT_JOTFORM_FORM_ID = '250122093908351';
    const DEFAULT_JOTFORM_FORMS = {
      maintenance: { label: 'Onderhoud', formId: DEFAULT_JOTFORM_FORM_ID, disabled: false },
      inspection: { label: 'Opname', formId: '243196137549364', disabled: false },
    };
    const envStorageKey = (key) => (
      typeof ENV_CONFIG.storageKey === 'function'
        ? ENV_CONFIG.storageKey(key)
        : key
    );
    const envCacheNameForVersion = (version) => (
      typeof ENV_CONFIG.cacheNameForVersion === 'function'
        ? ENV_CONFIG.cacheNameForVersion(version)
        : `fd-v${version}`
    );
    const cacheVersionToVersion = (cacheName) => (
      typeof ENV_CONFIG.cacheVersionToVersion === 'function'
        ? ENV_CONFIG.cacheVersionToVersion(cacheName)
        : String(cacheName || '').replace(/^fd(?:-[a-z0-9-]+)?-v/i, '')
    );
    function normalizeConfiguredJotFormForms(envForms, fallbackFormId) {
      const source = envForms && typeof envForms === 'object' ? envForms : {};
      const forms = {};
      Object.entries(DEFAULT_JOTFORM_FORMS).forEach(([type, defaults]) => {
        const override = source[type] && typeof source[type] === 'object' ? source[type] : {};
        forms[type] = {
          label: String(override.label || defaults.label),
          formId: String(override.formId || (type === 'maintenance' ? fallbackFormId : '') || defaults.formId || '').trim(),
          disabled: Object.prototype.hasOwnProperty.call(override, 'disabled')
            ? Boolean(override.disabled)
            : Boolean(defaults.disabled),
        };
      });
      return forms;
    }
    const CONFIGURED_JOTFORM_FORMS = normalizeConfiguredJotFormForms(
      ENV_CONFIG.jotformForms,
      ENV_CONFIG.jotformFormId || DEFAULT_JOTFORM_FORM_ID
    );

    const CONFIG = {
      environment: ENV_CONFIG.environment || 'live',
      storagePrefix: ENV_CONFIG.storagePrefix || '',
      svgBaseUrl: 'fd-floorplan://gallery/',
      svgUploadsUrl: 'fd-floorplan://uploads/',
      workerApiBaseUrl: ENV_CONFIG.workerApiBaseUrl || 'https://floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev',
      workerReadProxyFlagKey: envStorageKey('fd_use_worker_read_proxy'),
      workerReadProxyEnabled: true,
      workerSessionAuthFlagKey: envStorageKey('fd_use_worker_auth'),
      workerSessionTokenKey: envStorageKey('fd_worker_session_token'),
      workerSessionExpiresKey: envStorageKey('fd_worker_session_expires_at'),
      workerSessionUserKey: envStorageKey('fd_worker_session_user'),
      workerStatusWriteFlagKey: envStorageKey('fd_use_worker_status_write'),
      workerStatusWriteEnabled: true,
      workerFloorplanWriteFlagKey: envStorageKey('fd_use_worker_floorplan_write'),
      workerFloorplanWriteEnabled: true,
      workerUploadWriteFlagKey: envStorageKey('fd_use_worker_upload_write'),
      workerUploadWriteEnabled: true,
      workerStatusWriteTestCustomer: '--- TEST ---',
      jotformBaseUrl: 'https://eu.jotform.com/',
      jotformFormId: CONFIGURED_JOTFORM_FORMS.maintenance.formId,
      jotformForms: CONFIGURED_JOTFORM_FORMS,
      jotformMode: ENV_CONFIG.jotformMode || 'live',
      loginEmailNotificationsEnabled: ENV_CONFIG.loginEmailNotificationsEnabled !== false,
      appTimeZone: 'Europe/Amsterdam',
      pollInterval: 30000,
      sessionHeartbeatInterval: 60000,
      adminActiveUsersPollInterval: 60000,
      jotformReturnRefreshInterval: 2000,
      jotformReturnRefreshMaxDuration: 90000,
      versionCheckUrl: 'version.json',
      versionCheckInterval: 15 * 60 * 1000,
      offlineCacheVersion: envCacheNameForVersion(APP_VERSION),
    };

    const APP_UPDATE_EXPECTED_CACHE_KEY = envStorageKey('fd_app_update_expected_cache');
    const APP_UPDATE_EXPECTED_VERSION_KEY = envStorageKey('fd_app_update_expected_version');
    const RECENT_FLOORPLANS_STORAGE_KEY = envStorageKey('fd_recent_floorplans');
    const RECENT_FLOORPLAN_LIMIT = 4;
    const RECENT_FLOORPLAN_MIN_COUNT = 10;
    const APP_UPDATE_MESSAGE = 'FD_SKIP_WAITING';
    const APP_SHELL_STYLES = [
      'app.css',
      'admin-dashboard-tokens.css',
    ];
    const APP_SHELL_SCRIPTS = [
      'data-service.js',
      'diagnostics-service.js',
      'floorplan-cache-service.js',
      'floorplan-view-service.js',
      'auth-service.js',
      'status-service.js',
      'status-sync-service.js',
      'mode-service.js',
      'image-editor-service.js',
      'viewport-service.js',
      'marker-service.js',
      'door-action-service.js',
      'ui-shell-service.js',
      'edit-ui-service.js',
      'pdf-import-service.js',
      'upload-service.js',
      'select-sheet-service.js',
      'side-panel-service.js',
      'app.js',
    ];

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
    let jotformFocusRefreshFormType = 'maintenance';
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
    let topbarFloorplanGroupFilter = '';
    let topbarFloorplanLocationFilter = '';
    let adminDashboardState = {
      visible: false,
      loading: false,
      data: null,
      selectedKey: '',
      selectedCustomer: '',
      selectedGroup: '',
      selectedLocation: '',
      searchQuery: '',
      doorQuery: '',
      doorOrder: 'asc',
      doorCustomerFilter: '',
      doorFloorplanFilter: '',
      activeTab: 'overview',
      selectedDoorKey: '',
      overviewMetric: 'attention',
      activity: [],
      activityLoading: false,
      activityError: '',
      activityUnavailable: false,
      activeUsers: null,
      previewKey: '',
      previewRequestId: 0,
      metadataRecord: null,
      bulkMode: false,
      bulkSelectedKeys: new Set(),
      lastUpdatedAt: '',
      loadError: '',
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
    const locationAddressBar = document.getElementById('location-address-bar');
    const locationAddressName = document.getElementById('location-address-name');
    const locationAddressText = document.getElementById('location-address-text');
    const locationAddressNote = document.getElementById('location-address-note');
    const doorNameEl = document.getElementById('door-name');
    const doorStatusEl = document.getElementById('door-status');
    const btnJotformInspection = document.getElementById('btn-jotform-inspection');
    const btnJotformMaintenance = document.getElementById('btn-jotform-maintenance');
    const btnJotforms = {
      inspection: btnJotformInspection,
      maintenance: btnJotformMaintenance,
    };
    const btnJotform = btnJotformMaintenance;
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
    const environmentBadges = [
      document.getElementById('login-environment-badge'),
      document.getElementById('topbar-environment-badge'),
    ].filter(Boolean);
    const busyOverlayEl = document.getElementById('busy-overlay');
    const btnDashboard = document.getElementById('btn-dashboard');
    const btnTopbarMetadata = document.getElementById('btn-topbar-metadata');
    const adminDashboardEl = document.getElementById('admin-dashboard');
    const adminDashboardRefresh = document.getElementById('admin-dashboard-refresh');
    const adminDashboardFreshness = document.getElementById('admin-dashboard-freshness');
    const adminDashboardTabs = Array.from(document.querySelectorAll('[data-admin-tab]'));
    const adminDashboardTabPanels = Array.from(document.querySelectorAll('[data-admin-panel]'));
    const adminOverviewAttention = document.getElementById('admin-overview-attention');
    const adminOverviewOpen = document.getElementById('admin-overview-open');
    const adminOverviewKpiTitle = document.getElementById('admin-overview-kpi-title');
    const adminOverviewKpiSubtitle = document.getElementById('admin-overview-kpi-subtitle');
    const adminActivityList = document.getElementById('admin-activity-list');
    const adminDashboardSearch = document.getElementById('admin-dashboard-search');
    const adminCustomerFilters = document.getElementById('admin-customer-filters');
    const adminGroupFilterHeading = document.getElementById('admin-group-filter-heading');
    const adminGroupFilters = document.getElementById('admin-group-filters');
    const adminLocationFilterHeading = document.getElementById('admin-location-filter-heading');
    const adminLocationFilters = document.getElementById('admin-location-filters');
    const adminBulkToggle = document.getElementById('admin-bulk-toggle');
    const adminBulkSelectVisible = document.getElementById('admin-bulk-select-visible');
    const adminBulkClear = document.getElementById('admin-bulk-clear');
    const adminBulkGroup = document.getElementById('admin-bulk-group');
    const adminBulkCancel = document.getElementById('admin-bulk-cancel');
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
    const adminDetailLocationGroup = document.getElementById('admin-detail-location-group');
    const adminDetailBuilding = document.getElementById('admin-detail-building');
    const adminDetailFloorLabel = document.getElementById('admin-detail-floor-label');
    const adminDetailLocationAddress = document.getElementById('admin-detail-location-address');
    const adminDetailLocationNote = document.getElementById('admin-detail-location-note');
    const adminDetailError = document.getElementById('admin-detail-error');
    const adminDetailSave = document.getElementById('admin-detail-save');
    const adminDetailDelete = document.getElementById('admin-detail-delete');
    const adminDoorDetailCard = document.getElementById('admin-door-detail-card');
    const adminDoorDetailDot = document.getElementById('admin-door-detail-dot');
    const adminDoorDetailCode = document.getElementById('admin-door-detail-code');
    const adminDoorDetailStatus = document.getElementById('admin-door-detail-status');
    const adminDoorDetailMeta = document.getElementById('admin-door-detail-meta');
    const adminDoorDetailOpen = document.getElementById('admin-door-detail-open');
    const adminBulkGroupDialogOverlay = document.getElementById('admin-bulk-group-dialog-overlay');
    const adminBulkGroupDialog = document.getElementById('admin-bulk-group-dialog');
    const adminBulkGroupDialogContext = document.getElementById('admin-bulk-group-dialog-context');
    const adminBulkGroupInput = document.getElementById('admin-bulk-group-input');
    const adminBulkGroupError = document.getElementById('admin-bulk-group-error');
    const adminBulkGroupSave = document.getElementById('admin-bulk-group-save');
    const adminBulkGroupCancel = document.getElementById('admin-bulk-group-cancel');
    const adminBulkGroupClose = document.getElementById('admin-bulk-group-close');
    const adminKpiEls = {
      customers: document.getElementById('admin-kpi-customers'),
      floorplans: document.getElementById('admin-kpi-floorplans'),
      doors: document.getElementById('admin-kpi-doors'),
      open: document.getElementById('admin-kpi-open'),
      done: document.getElementById('admin-kpi-done'),
      attention: document.getElementById('admin-kpi-attention'),
    };
    const adminKpiButtons = Array.from(document.querySelectorAll('[data-admin-kpi]'));
    const adminOnlinePanel = document.getElementById('admin-online-panel');
    const adminOnlineEls = {
      admin: document.getElementById('admin-online-admin'),
      monteur: document.getElementById('admin-online-monteur'),
      viewer: document.getElementById('admin-online-viewer'),
    };
    const adminSessionsOverlay = document.getElementById('admin-sessions-overlay');
    const adminSessionsPopup = document.getElementById('admin-sessions-popup');
    const adminSessionsClose = document.getElementById('admin-sessions-close');
    const adminSessionsSummary = document.getElementById('admin-sessions-summary');
    const adminSessionsList = document.getElementById('admin-sessions-list');
    const topbarMenu = document.getElementById('topbar-menu');
    const btnTopbarMenu = document.getElementById('btn-menu');
    const btnMenuLabels = document.getElementById('btn-menu-labels');
    const btnMenuMarkerOutline = document.getElementById('btn-menu-marker-outline');
    const btnPrintFloorplan = document.getElementById('btn-print-floorplan');
    const btnExportExcel = document.getElementById('btn-export-excel');
    const btnReportProblem = document.getElementById('btn-report-problem');
    const reportProblemOverlay = document.getElementById('report-problem-overlay');
    const reportProblemPopup = document.getElementById('report-problem-popup');
    const reportProblemCategory = document.getElementById('report-problem-category');
    const reportProblemText = document.getElementById('report-problem-text');
    const reportProblemError = document.getElementById('report-problem-error');
    const reportProblemSubmit = document.getElementById('report-problem-submit');
    const reportProblemCancel = document.getElementById('report-problem-cancel');
    const exportExcelOverlay = document.getElementById('export-excel-overlay');
    const exportExcelPopup = document.getElementById('export-excel-popup');
    const exportExcelContext = document.getElementById('export-excel-context');
    const exportExcelClose = document.getElementById('export-excel-close');
    const exportExcelCurrent = document.getElementById('export-excel-current');
    const exportExcelSelect = document.getElementById('export-excel-select');
	    const exportExcelSelection = document.getElementById('export-excel-selection');
	    const exportExcelList = document.getElementById('export-excel-list');
	    const exportExcelConfirm = document.getElementById('export-excel-confirm');
	    const exportExcelError = document.getElementById('export-excel-error');
	    const imageEditorSaveErrorOverlay = document.getElementById('image-editor-save-error-overlay');
	    const imageEditorSaveErrorPopup = document.getElementById('image-editor-save-error-popup');
	    const imageEditorSaveErrorMessage = document.getElementById('image-editor-save-error-message');
	    const imageEditorSaveErrorDetails = document.getElementById('image-editor-save-error-details');
	    const imageEditorSaveErrorCopy = document.getElementById('image-editor-save-error-copy');
	    const imageEditorSaveErrorClose = document.getElementById('image-editor-save-error-close');
	    const topbarMenuController = FD.UIShellService.createTopbarMenu({
      toggleButtonEl: btnTopbarMenu,
      menuEl: topbarMenu,
      documentEl: document,
    });

    function renderEnvironmentBadges() {
      const isStaging = CONFIG.environment === 'staging';
      environmentBadges.forEach(badge => {
        badge.hidden = !isStaging;
        if (isStaging) badge.textContent = 'STAGING';
      });
    }

    renderEnvironmentBadges();
    const appUpdateDialog = FD.UIShellService.createPopupPair({
      overlayEl: appUpdateOverlay,
      popupEl: appUpdatePopup,
    });
    const adminSessionsDialog = FD.UIShellService.createPopupPair({
      overlayEl: adminSessionsOverlay,
      popupEl: adminSessionsPopup,
    });
    const busyOverlay = FD.UIShellService.createBusyOverlayController({
      overlayEl: busyOverlayEl,
    });
    const reportProblemDialog = FD.UIShellService.createPopupPair({
      overlayEl: reportProblemOverlay,
      popupEl: reportProblemPopup,
    });
	    const exportExcelDialog = FD.UIShellService.createPopupPair({
	      overlayEl: exportExcelOverlay,
	      popupEl: exportExcelPopup,
	    });
	    const imageEditorSaveErrorDialog = FD.UIShellService.createPopupPair({
	      overlayEl: imageEditorSaveErrorOverlay,
	      popupEl: imageEditorSaveErrorPopup,
	    });
    let exportExcelBaseRecord = null;

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
      const normalizedVersion = version || cacheVersionToVersion(cache);
      const normalizedCache = normalizedVersion ? envCacheNameForVersion(normalizedVersion) : cache;
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

    function appVersionPattern(version) {
      const escapedVersion = String(version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`APP_VERSION\\s*=\\s*['"]${escapedVersion}['"]`);
    }

    function cacheVersionPattern(name, version) {
      const escapedVersion = String(version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`${name}\\s*(?::|=)\\s*['"]fd(?:-[a-z0-9-]+)?-v${escapedVersion}['"]`, 'i');
    }

    function assetVersionReady(source, cacheName, version) {
      return appVersionPattern(version).test(source || '') ||
        cacheVersionPattern(cacheName, version).test(source || '');
    }

    function appAssetCheckUrl(path, version) {
      const url = new URL(path, window.location.href);
      if (version && path !== 'index.html' && path !== 'sw.js') {
        url.searchParams.set('v', version);
      }
      url.searchParams.set('_', String(Date.now()));
      return url.toString();
    }

    function indexHtmlReady(indexText, version) {
      if (!indexText || !version) return false;
      if (!indexText.includes(`v${version}`)) return false;
      if (!indexText.includes(`app.css?v=${version}`)) return false;
      return APP_SHELL_SCRIPTS.every(script => indexText.includes(`${script}?v=${version}`));
    }

    function appCssReady(cssText, version) {
      return Boolean(cssText && version && cssText.includes(`admin-dashboard-tokens.css?v=${version}`));
    }

    async function remoteDeploymentReady(remote) {
      if (!remote?.cache || !remote?.version) return false;
      try {
        const assets = [
          'index.html',
          ...APP_SHELL_STYLES,
          ...APP_SHELL_SCRIPTS,
          'sw.js',
        ];
        const responses = await Promise.all(assets.map(asset =>
          fetch(appAssetCheckUrl(asset, remote.version), {
            cache: 'no-store',
            credentials: 'same-origin',
          })
        ));
        if (responses.some(response => !response.ok)) return false;
        const texts = await Promise.all(responses.map(response => response.text()));
        const textByAsset = new Map(assets.map((asset, index) => [asset, texts[index]]));

        return indexHtmlReady(textByAsset.get('index.html'), remote.version) &&
          appCssReady(textByAsset.get('app.css'), remote.version) &&
          assetVersionReady(textByAsset.get('app.js'), 'offlineCacheVersion', remote.version) &&
          assetVersionReady(textByAsset.get('sw.js'), 'CACHE_NAME', remote.version);
      } catch (err) {
        return false;
      }
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
        const ready = available ? await remoteDeploymentReady(remote) : false;
        setAppUpdateAvailable(ready ? remote : null);
        return ready;
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

    function rememberExpectedAppUpdate(update) {
      try {
        sessionStorage.setItem(APP_UPDATE_EXPECTED_CACHE_KEY, update.cache);
        sessionStorage.setItem(APP_UPDATE_EXPECTED_VERSION_KEY, update.version);
      } catch (err) {
        console.warn('Updateverwachting opslaan mislukt:', err);
      }
    }

    function clearExpectedAppUpdate() {
      try {
        sessionStorage.removeItem(APP_UPDATE_EXPECTED_CACHE_KEY);
        sessionStorage.removeItem(APP_UPDATE_EXPECTED_VERSION_KEY);
      } catch (err) {
        console.warn('Updateverwachting wissen mislukt:', err);
      }
    }

    function getExpectedAppUpdate() {
      try {
        const cache = sessionStorage.getItem(APP_UPDATE_EXPECTED_CACHE_KEY) || '';
        const version = sessionStorage.getItem(APP_UPDATE_EXPECTED_VERSION_KEY) || cacheVersionToVersion(cache);
        return cache ? { cache, version } : null;
      } catch (err) {
        return null;
      }
    }

    function removeAppUpdateReloadMarker() {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('fd_update')) return;
      url.searchParams.delete('fd_update');
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }

    function verifyExpectedAppUpdateAfterReload() {
      const expected = getExpectedAppUpdate();
      if (!expected) return;

      if (expected.cache === CONFIG.offlineCacheVersion) {
        clearExpectedAppUpdate();
        removeAppUpdateReloadMarker();
        return;
      }

      setAppUpdateAvailable(expected);
      showToast('Update niet afgerond. Herlaad de pagina handmatig als deze knop blijft staan.', 'error');
    }

    function waitForTimeout(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function waitForServiceWorkerState(worker, states, timeoutMs) {
      if (!worker) return Promise.resolve('');
      const desiredStates = new Set(states);
      if (desiredStates.has(worker.state)) return Promise.resolve(worker.state);

      return new Promise(resolve => {
        let settled = false;
        let timer = null;
        const done = state => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          worker.removeEventListener('statechange', onStateChange);
          resolve(state || worker.state || '');
        };
        const onStateChange = () => {
          if (desiredStates.has(worker.state)) done(worker.state);
        };
        timer = setTimeout(() => done(worker.state), timeoutMs);
        worker.addEventListener('statechange', onStateChange);
      });
    }

    function waitForServiceWorkerControllerChange(timeoutMs) {
      if (!navigator.serviceWorker?.controller) return Promise.resolve(false);
      return new Promise(resolve => {
        let settled = false;
        let timer = null;
        const done = changed => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          resolve(Boolean(changed));
        };
        const onControllerChange = () => done(true);
        timer = setTimeout(() => done(false), timeoutMs);
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      });
    }

    function requestWaitingServiceWorkerActivation(registration) {
      const waiting = registration?.waiting;
      if (!waiting) return false;
      waiting.postMessage({ type: APP_UPDATE_MESSAGE });
      return true;
    }

    async function activateUpdatedServiceWorker() {
      if (!navigator.serviceWorker) return false;

      const controllerChange = waitForServiceWorkerControllerChange(12000);
      let registration = serviceWorkerRegistration || await navigator.serviceWorker.getRegistration();
      try {
        if (registration?.update) {
          await registration.update();
        }
      } catch (err) {
        console.warn('Service worker update-check mislukt:', err);
      }

      registration = serviceWorkerRegistration || await navigator.serviceWorker.getRegistration() || registration;
      if (!registration) return false;

      if (registration.installing) {
        await waitForServiceWorkerState(registration.installing, ['installed', 'activated', 'redundant'], 12000);
      }
      registration = await navigator.serviceWorker.getRegistration() || registration;
      requestWaitingServiceWorkerActivation(registration);

      const changed = await Promise.race([
        controllerChange,
        waitForTimeout(12000).then(() => false),
      ]);
      return changed || Boolean(registration.active);
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

      const updateToApply = pendingAppUpdate;
      if (!(await remoteDeploymentReady(updateToApply))) {
        hideAppUpdateDialog();
        setAppUpdateAvailable(null);
        showToast('Update wordt nog klaargezet. Probeer zo opnieuw.', 'error');
        return;
      }

      setAppUpdateAvailable(null);
      rememberExpectedAppUpdate(updateToApply);
      await activateUpdatedServiceWorker();

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
	    let imageEditorSaveErrorDetailsText = '';

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
      if (event.key !== 'Escape') return;
      if (reportProblemPopup?.style.display !== 'none') {
        hideReportProblemDialog();
        return;
      }
      if (adminSessionsPopup?.style.display !== 'none') {
        hideAdminSessionsPopup();
      }
    });

    appUpdateButton?.addEventListener('click', showAppUpdateDialog);
    appUpdateLaterButton?.addEventListener('click', hideAppUpdateDialog);
    appUpdateConfirmButton?.addEventListener('click', applyAppUpdate);
    appUpdateOverlay?.addEventListener('click', hideAppUpdateDialog);
    adminOnlinePanel?.addEventListener('click', showAdminSessionsPopup);
    adminOnlinePanel?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      showAdminSessionsPopup();
    });
    adminSessionsClose?.addEventListener('click', hideAdminSessionsPopup);
    adminSessionsOverlay?.addEventListener('click', hideAdminSessionsPopup);

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

    const CUSTOMERS_CACHE_KEY = envStorageKey('fd_customers_cache');
    const JOTFORM_RETURN_CONTEXT_KEY = envStorageKey('fd_jotform_return_context');

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

    function normalizeJotFormFormType(value) {
      const type = String(value || '').trim();
      return Object.prototype.hasOwnProperty.call(CONFIG.jotformForms || {}, type)
        ? type
        : 'maintenance';
    }

    function jotFormFormTypes() {
      return Object.entries(CONFIG.jotformForms || {})
        .filter(([, form]) => form?.formId && !form.disabled)
        .map(([type]) => normalizeJotFormFormType(type));
    }

    function currentJotFormReturnContext(formType = 'maintenance') {
      const { customer, floorplan } = getSelectedFloorplan();
      return FD.DoorActionService.createReturnContext({
        customer: customer || currentCustomer,
        floorplan: floorplan || currentFloorplan,
        doorId: selectedDoor,
        formType,
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

    function isJotFormLookupEnabled() {
      return CONFIG.jotformMode !== 'shared-form-limited';
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

    function normalizeJotFormSubmission(item) {
      if (!item?.editUrl) return null;
      return {
        editUrl: String(item.editUrl),
        formType: normalizeJotFormFormType(item.formType),
        statusDoneAt: String(item.statusDoneAt || ''),
        lastSeenAt: String(item.lastSeenAt || ''),
        doorCondition: ['ok', 'attention', 'unknown'].includes(item.doorCondition) ? item.doorCondition : 'unknown',
        doorConditionLabel: String(item.doorConditionLabel || ''),
      };
    }

    function setJotFormSubmissionInMap(submissions, doorId, formType, submission) {
      const type = normalizeJotFormFormType(formType);
      if (!submissions[doorId] || submissions[doorId].editUrl) submissions[doorId] = {};
      if (submission?.editUrl) {
        submissions[doorId][type] = {
          ...submission,
          formType: type,
        };
      } else if (submissions[doorId]) {
        delete submissions[doorId][type];
        if (Object.keys(submissions[doorId]).length === 0) delete submissions[doorId];
      }
    }

    function markJotFormChecked(checkedDoors, doorId, formType) {
      const type = normalizeJotFormFormType(formType);
      if (!checkedDoors[doorId] || checkedDoors[doorId] === true) checkedDoors[doorId] = {};
      checkedDoors[doorId][type] = true;
    }

    function isJotFormChecked(checkedDoors, doorId, formType) {
      const type = normalizeJotFormFormType(formType);
      return checkedDoors?.[doorId] === true || checkedDoors?.[doorId]?.[type] === true;
    }

    function normalizeJotFormSubmissionMap(response) {
      const source = response?.submissions && typeof response.submissions === 'object'
        ? response.submissions
        : {};
      const normalized = {};
      Object.entries(source).forEach(([doorId, item]) => {
        if (!doorId || !item || typeof item !== 'object') return;

        const direct = normalizeJotFormSubmission(item);
        if (direct) {
          setJotFormSubmissionInMap(normalized, doorId, direct.formType, direct);
        }

        jotFormFormTypes().forEach(formType => {
          const nested = normalizeJotFormSubmission(item[formType]);
          if (nested) setJotFormSubmissionInMap(normalized, doorId, formType, nested);
        });
      });
      return normalized;
    }

    function getCachedJotFormSubmission(doorId, formType = 'maintenance') {
      const key = jotformSubmissionCacheKey();
      if (!doorId || !key || jotformSubmissionCache.key !== key) return null;
      const bucket = jotformSubmissionCache.submissions?.[doorId];
      if (!bucket) return null;
      if (bucket.editUrl) return normalizeJotFormSubmission(bucket);
      return bucket[normalizeJotFormFormType(formType)] || null;
    }

    function getCachedJotFormSubmissionsForDoor(doorId) {
      const key = jotformSubmissionCacheKey();
      if (!doorId || !key || jotformSubmissionCache.key !== key) return [];
      const bucket = jotformSubmissionCache.submissions?.[doorId];
      if (!bucket) return [];
      if (bucket.editUrl) {
        const direct = normalizeJotFormSubmission(bucket);
        return direct ? [direct] : [];
      }
      return jotFormFormTypes()
        .map(formType => bucket[formType])
        .filter(Boolean);
    }

    function isJotFormConditionChecking(doorId) {
      if (!isJotFormLookupEnabled()) return false;
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
      const submissions = getCachedJotFormSubmissionsForDoor(doorId);
      if (submissions.some(submission => submission?.doorCondition === 'attention')) return 'attention';
      if (isJotFormConditionChecking(doorId)) return 'checking';
      return 'unknown';
    }

    function getJotFormButtonStateForDoor({ selectedDoor: doorId, isDone, formType = 'maintenance' } = {}) {
      const type = normalizeJotFormFormType(formType);
      if (!doorId || !isDone) return { action: 'new' };
      if (!isJotFormLookupEnabled()) return { action: 'new' };
      const key = jotformSubmissionCacheKey();
      const cached = key && jotformSubmissionCache.key === key
        ? getCachedJotFormSubmission(doorId, type)
        : null;
      if (cached?.editUrl) return { action: 'edit', editUrl: cached.editUrl };
      if (hasManualNewFormHint(doorId)) return { action: 'new' };
      if (!key || jotformSubmissionCache.key !== key) return { action: 'open', loading: true };
      if (jotformSubmissionCache.loading || !jotformSubmissionCache.ready) return { action: 'open', loading: true };
      if (jotformSubmissionCache.allChecked || isJotFormChecked(jotformSubmissionCache.checkedDoors, doorId, type)) {
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

      const selectedFormTypes = jotFormFormTypes();
      const pending = Promise.all(selectedFormTypes.map(formType => (
        FD.DataService.findJotFormSubmission(CONFIG, {
          ...target,
          doorId,
          formType,
        }, {
          diagnostics: {
            purpose: 'jotform_submission_selected_lookup',
            background: true,
          },
        }).then(response => ({ formType, response }))
      ))).then(results => {
        if (jotformSubmissionCache.requestId !== requestId || jotformSubmissionCache.key !== key) return null;
        const submissions = {
          ...(jotformSubmissionCache.submissions || {}),
        };
        const checkedDoors = {
          ...(jotformSubmissionCache.checkedDoors || {}),
        };
        let foundAny = false;
        let foundFocusForm = false;
        results.forEach(({ formType, response }) => {
          const type = normalizeJotFormFormType(response?.formType || formType);
          const submission = normalizeJotFormSubmission({ ...response, formType: type });
          if (response?.found && submission?.editUrl) {
            foundAny = true;
            if (type === jotformFocusRefreshFormType) foundFocusForm = true;
            markJotFormChecked(checkedDoors, doorId, type);
            setJotFormSubmissionInMap(submissions, doorId, type, submission);
          } else {
            setJotFormSubmissionInMap(submissions, doorId, type, null);
            if (
              doorId === jotformFocusRefreshDoorId &&
              type === jotformFocusRefreshFormType &&
              Date.now() <= jotformFocusRefreshUntil
            ) {
              // Keep this one pending while the webhook catches up.
            } else {
              markJotFormChecked(checkedDoors, doorId, type);
            }
          }
        });
        const waitingForFocusForm = doorId === jotformFocusRefreshDoorId && Date.now() <= jotformFocusRefreshUntil;
        if (foundFocusForm || !waitingForFocusForm) {
          clearJotFormSubmissionLookupRetry();
        } else if (!foundAny || !foundFocusForm) {
          scheduleJotFormSubmissionLookupRetry(doorId);
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
      if (!isJotFormLookupEnabled()) {
        resetJotFormSubmissionCache();
        return null;
      }
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
      jotformFocusRefreshFormType = normalizeJotFormFormType(context?.formType);
      jotformFocusRefreshUntil = context?.doorId
        ? Date.now() + CONFIG.jotformReturnRefreshMaxDuration
        : 0;
      jotformFocusBaselineSubmission = context?.doorId
        ? getCachedJotFormSubmission(context.doorId, jotformFocusRefreshFormType)
        : null;
    }

    function saveJotFormReturnContext(openContext = {}) {
      if (!isJotFormLookupEnabled()) return;
      const context = currentJotFormReturnContext(openContext.formType);
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
      if (!isJotFormLookupEnabled()) return null;
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
      jotformFocusRefreshFormType = 'maintenance';
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
        jotformFocusRefreshFormType = 'maintenance';
        jotformFocusRefreshUntil = 0;
        jotformFocusBaselineSubmission = null;
        return;
      }
      if (selectedDoor !== jotformFocusRefreshDoorId || navigator.onLine === false) return;
      startJotFormReturnFastRefresh(jotformFocusRefreshDoorId, jotformFocusRefreshFormType);
    }

    function startJotFormReturnFastRefresh(doorId, formType = jotformFocusRefreshFormType) {
      stopJotFormReturnFastRefreshTimer();
      if (!doorId || navigator.onLine === false || typeof statusController?.poll !== 'function') return;

      const deadline = Date.now() + CONFIG.jotformReturnRefreshMaxDuration;
      const baselineSubmission = jotformFocusBaselineSubmission;
      const type = normalizeJotFormFormType(formType);

      function submissionChangedAfterExternalOpen() {
        const current = getCachedJotFormSubmission(doorId, type);
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
            jotformFocusRefreshFormType = normalizeJotFormFormType(context.formType);
            startJotFormReturnFastRefresh(context.doorId, jotformFocusRefreshFormType);
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
      const displayName = String(currentUser?.displayName || currentUser?.display_name || currentUser?.username || '').trim();
      const label = displayName || (['admin', 'monteur', 'viewer'].includes(role) ? role : '');
      accountLabel.textContent = label;
      accountIndicator.hidden = !label;
      accountIndicator.title = label
        ? `Ingelogd als ${label}${role ? ` (${role})` : ''}`
        : 'Ingelogd account';
      accountIndicator.dataset.role = role;
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

    function canUseExcelExport() {
      return currentUser?.role === 'admin' || currentUser?.role === 'viewer';
    }

    function isTestCustomerName(customerName) {
      return String(customerName || '') === CONFIG.workerStatusWriteTestCustomer;
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
      return FD.SelectSheetService.floorplanDisplayName(floorplan);
    }

    function getFloorplanLocationDetails(customer, floorplan) {
      return FD.SelectSheetService.getFloorplanLocationDetails(customer, floorplan);
    }

    function floorplanGroupName(floorplan) {
      return FD.SelectSheetService.floorplanGroupName(floorplan);
    }

    function floorplanGroupMeta(floorplan) {
      const group = floorplanGroupName(floorplan);
      return group ? `Groep: ${group}` : '';
    }

    function floorplanGroupDisplayLabel(floorplan) {
      const group = floorplanGroupName(floorplan);
      return group || FD.SelectSheetService.GROUP_NONE_LABEL || 'Zonder groep';
    }

    function floorplanAddressMeta(customer, floorplan) {
      return formatLocationMeta(getFloorplanLocationDetails(customer, floorplan));
    }

    function formatLocationMeta(details) {
      if (!details) return '';
      const address = String(details.address || '').trim();
      const note = String(details.note || '').trim();
      return [
        address,
        note ? `Notitie: ${note}` : '',
      ].filter(Boolean).join(' · ');
    }

    const LOCATION_DETAILS_SAVE_ERROR = 'location_details_not_persisted';

    function locationDetailsSaveError() {
      const error = new Error('Adresgegevens zijn niet opgeslagen. Vernieuw de app en probeer opnieuw.');
      error.code = LOCATION_DETAILS_SAVE_ERROR;
      return error;
    }

    function normalizeLocationDetailsKey(value) {
      return String(value || '').trim().toLowerCase();
    }

    function getPersistedCustomerLocationDetails(customersList, customerName, locationName, locationGroup = '') {
      const customerKey = String(customerName || '');
      const locationKey = normalizeLocationDetailsKey(locationName);
      const groupKey = normalizeLocationDetailsKey(locationGroup);
      if (!customerKey || !locationKey || !Array.isArray(customersList)) return null;
      const customer = customersList.find(item => String(item?.customer || '') === customerKey);
      if (!customer || !Array.isArray(customer.locations)) return null;
      const exactLocation = groupKey
        ? customer.locations.find(item =>
            normalizeLocationDetailsKey(item?.name) === locationKey &&
            normalizeLocationDetailsKey(item?.locationGroup || item?.group) === groupKey
          )
        : null;
      const location = exactLocation || customer.locations.find(item =>
        normalizeLocationDetailsKey(item?.name) === locationKey &&
        !normalizeLocationDetailsKey(item?.locationGroup || item?.group)
      ) || customer.locations.find(item => normalizeLocationDetailsKey(item?.name) === locationKey);
      if (!location) return null;
      return {
        address: String(location.address || '').trim(),
        note: String(location.note || '').trim(),
      };
    }

    function assertLocationDetailsPersisted(customersList, customerName, locationName, expectedAddress, expectedNote, locationGroup = '') {
      if (!String(locationName || '').trim()) return;
      const address = String(expectedAddress || '').trim();
      const note = String(expectedNote || '').trim();
      const details = getPersistedCustomerLocationDetails(customersList, customerName, locationName, locationGroup);
      if (!address && !note) {
        if (details && (details.address || details.note)) throw locationDetailsSaveError();
        return;
      }
      if (!details || details.address !== address || details.note !== note) {
        throw locationDetailsSaveError();
      }
    }

    function metadataSaveErrorText(err, duplicateMessage) {
      if (err?.code === LOCATION_DETAILS_SAVE_ERROR) return err.message;
      if (err?.status === 409) return duplicateMessage;
      return 'Opslaan mislukt: ' + (err?.message || 'onbekende fout');
    }

    function floorplanPermissionMeta(customer, floorplan) {
      if (!floorplan) return '';
      if (isViewerReadOnlyFloorplan(customer?.customer || customer, floorplan.name)) {
        return 'Alleen kijken';
      }
      return currentUser?.role === 'viewer' ? 'Testen toegestaan' : '';
    }

    function floorplanPickerMetaText(customer, floorplan) {
      return [
        floorplanGroupMeta(floorplan),
        floorplanAddressMeta(customer, floorplan),
        floorplanPermissionMeta(customer, floorplan),
      ].filter(Boolean).join(' · ');
    }

    function renderLocationAddressBar(customer, floorplan) {
      if (!locationAddressBar) return;
      const details = getFloorplanLocationDetails(customer, floorplan);
      if (!details) {
        locationAddressBar.hidden = true;
        if (locationAddressName) locationAddressName.textContent = '';
        if (locationAddressText) locationAddressText.textContent = '';
        if (locationAddressNote) locationAddressNote.textContent = '';
        return;
      }

      locationAddressBar.hidden = false;
      const address = details.address || '';
      const note = details.note || '';
      if (locationAddressName) locationAddressName.textContent = details.name || floorplan?.building || 'Locatie';
      if (locationAddressText) {
        locationAddressText.textContent = address;
        locationAddressText.hidden = !address;
      }
      if (locationAddressNote) {
        locationAddressNote.textContent = note ? `Notitie: ${note}` : '';
        locationAddressNote.hidden = !note;
      }
      locationAddressBar.title = [details.locationGroup, details.name, address, note].filter(Boolean).join(' · ');
    }

    function hideLocationAddressBar() {
      renderLocationAddressBar(null, null);
    }

    function getSelectedTopbarFloorplanRecord() {
      const { customer, floorplan } = getSelectedFloorplan();
      const locationDetails = getFloorplanLocationDetails(customer, floorplan);
      if (!customer || !floorplan) return null;
      return {
        customer: customer.customer,
        name: floorplan.name,
        displayName: FD.SelectSheetService.floorplanDisplayName(floorplan),
        locationGroup: floorplanGroupName(floorplan),
        building: floorplan.building || '',
        floorLabel: floorplan.floorLabel || '',
        locationAddress: locationDetails?.address || '',
        locationNote: locationDetails?.note || '',
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

          Object.values(btnJotforms).forEach(button => {
            if (!button) return;
            const jotformPending = button.dataset.jotformPending === '1';
            const jotformUnavailable = button.dataset.jotformUnavailable === '1';
            button.classList.toggle('disabled', !allowed || jotformPending || jotformUnavailable);
            button.title = jotformUnavailable
              ? 'Opname formulier nog niet beschikbaar'
              : (!allowed
              ? 'Alleen kijken op deze plattegrond'
              : (jotformPending ? 'Formulierstatus controleren...' : ''));
          });
        }

    function hasCurrentFloorplanView() {
      return Boolean(currentCustomer && currentFloorplan && svgContainer.querySelector('svg'));
    }

    function topbarSelectionMatchesCurrentFloorplan() {
      const { customer, floorplan } = getSelectedFloorplan();
      if (!customer || !floorplan || !currentCustomer || !currentFloorplan) return false;
      return customer.customer === currentCustomer && floorplan.name === currentFloorplan;
    }

    function canUseTopbarFloorplanActions() {
      const { customer, floorplan } = getSelectedFloorplan();
      if (!customer || !floorplan || adminDashboardState.visible || !hasCurrentFloorplanView()) return false;
      return topbarFloorplanActionsLocked || topbarSelectionMatchesCurrentFloorplan();
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

      const canUseFloorplanActions = canUseTopbarFloorplanActions();
      const canWrite = canUseFloorplanActions && canWriteCurrentFloorplan();
      if (btnReset) {
        btnReset.style.display = canUseFloorplanActions ? 'inline-block' : 'none';
        btnReset.disabled = !canUseFloorplanActions;
        btnReset.title = canUseFloorplanActions ? '' : 'Kies eerst een plattegrond';
      }
      if (btnPrintFloorplan) {
        const canPrint = canUseFloorplanActions && appMode.isInteractiveView();
        btnPrintFloorplan.disabled = !canPrint;
        btnPrintFloorplan.title = canPrint ? '' : 'Kies eerst een plattegrond';
      }
      if (btnExportExcel) {
        const selected = getSelectedFloorplan();
        const selectedCustomerName = selected.customer?.customer || currentCustomer;
        const exportAllowed = canUseExcelExport();
        const exportBlockedForTest = isTestCustomerName(selectedCustomerName);
        const canExport = exportAllowed && canUseFloorplanActions && appMode.isInteractiveView() && !exportBlockedForTest;
        btnExportExcel.style.display = exportAllowed ? 'block' : 'none';
        btnExportExcel.disabled = !canExport;
        btnExportExcel.title = canExport
          ? ''
          : (exportBlockedForTest ? 'Excel export is niet beschikbaar voor de testklant' : 'Kies eerst een plattegrond');
      }
      const editButton = document.getElementById('btn-edit');
      if (editButton) {
        editButton.style.display = canWrite ? 'inline-block' : 'none';
        editButton.disabled = !canWrite;
        editButton.title = canUseFloorplanActions
          ? (canWrite ? '' : 'Alleen kijken op deze plattegrond')
          : 'Kies eerst een plattegrond';
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
    const floorplanPickerMeta = document.getElementById('floorplan-picker-meta');
    const selectSheetOverlay = document.getElementById('select-sheet-overlay');
    const selectSheet = document.getElementById('select-sheet');
    const selectSheetEyebrow = document.getElementById('select-sheet-eyebrow');
    const selectSheetTitle = document.getElementById('select-sheet-title');
    const selectSheetSearch = document.getElementById('select-sheet-search');
    const selectSheetLocationFilters = document.getElementById('select-sheet-location-filters');
    const selectSheetList = document.getElementById('select-sheet-list');
    const selectSheetClose = document.getElementById('select-sheet-close');
    const LOCATION_COLLATOR = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

    function floorplanLocationValue(floorplan) {
      return FD.SelectSheetService.floorplanLocationFilterValue(floorplan);
    }

    function floorplanGroupValue(floorplan) {
      return FD.SelectSheetService.floorplanGroupFilterValue(floorplan);
    }

    function floorplanLocationLabelForValue(value) {
      return FD.SelectSheetService.floorplanLocationFilterLabel(value);
    }

    function floorplanGroupLabelForValue(value) {
      return FD.SelectSheetService.floorplanGroupFilterLabel(value);
    }

    function compareFloorplanLocationValues(left, right) {
      const noneValue = FD.SelectSheetService.LOCATION_NONE_VALUE;
      const leftNone = left === noneValue;
      const rightNone = right === noneValue;
      if (leftNone !== rightNone) return leftNone ? 1 : -1;
      return LOCATION_COLLATOR.compare(
        floorplanLocationLabelForValue(left),
        floorplanLocationLabelForValue(right)
      );
    }

    function compareFloorplanGroupValues(left, right) {
      const noneValue = FD.SelectSheetService.GROUP_NONE_VALUE;
      const leftNone = left === noneValue;
      const rightNone = right === noneValue;
      if (leftNone !== rightNone) return leftNone ? 1 : -1;
      return LOCATION_COLLATOR.compare(
        floorplanGroupLabelForValue(left),
        floorplanGroupLabelForValue(right)
      );
    }

    function compareFloorplanSheetItems(left, right) {
      if ((left.sectionRank || 0) !== (right.sectionRank || 0)) {
        return (left.sectionRank || 0) - (right.sectionRank || 0);
      }
      if (left.isRecent || right.isRecent) {
        return (left.recentRank || 0) - (right.recentRank || 0);
      }
      if ((left.organizerNone ? 1 : 0) !== (right.organizerNone ? 1 : 0)) {
        return left.organizerNone ? 1 : -1;
      }
      const organizerCompare = LOCATION_COLLATOR.compare(left.organizerLabel || '', right.organizerLabel || '');
      if (organizerCompare) return organizerCompare;
      if (left.organizerKind === 'group' && right.organizerKind === 'group') {
        const buildingCompare = compareFloorplanLocationValues(left.locationValue, right.locationValue);
        if (buildingCompare) return buildingCompare;
      }
      const displayCompare = FD.SelectSheetService.compareFloorplanDisplayOrder(
        left.floorplan,
        right.floorplan,
        left.label,
        right.label
      );
      if (displayCompare) return displayCompare;
      const labelCompare = LOCATION_COLLATOR.compare(left.label, right.label);
      return labelCompare || left.index - right.index;
    }

    function floorplanRecentKey(floorplan) {
      return [
        String(floorplan?.name || '').trim(),
        floorplan?.repo === 'uploads' ? 'uploads' : 'gallery',
        String(floorplan?.file || '').trim(),
      ].join('\n');
    }

    function floorplanCustomerRecentKey(customer) {
      return String(customer?.customer || '').trim();
    }

    function readRecentFloorplans() {
      try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_FLOORPLANS_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (err) {
        console.warn('Recente plattegronden konden niet gelezen worden:', err);
        return {};
      }
    }

    function writeRecentFloorplans(value) {
      try {
        localStorage.setItem(RECENT_FLOORPLANS_STORAGE_KEY, JSON.stringify(value || {}));
      } catch (err) {
        console.warn('Recente plattegronden konden niet opgeslagen worden:', err);
      }
    }

    function rememberRecentFloorplan(customer, floorplan) {
      const customerKey = floorplanCustomerRecentKey(customer);
      const floorplanKey = floorplanRecentKey(floorplan);
      const floorplans = Array.isArray(customer?.floorplans) ? customer.floorplans : [];
      if (!customerKey || !floorplanKey.trim() || floorplans.length < RECENT_FLOORPLAN_MIN_COUNT) return;
      const recent = readRecentFloorplans();
      const current = Array.isArray(recent[customerKey]) ? recent[customerKey] : [];
      recent[customerKey] = [
        {
          key: floorplanKey,
          name: String(floorplan?.name || '').trim(),
          file: String(floorplan?.file || '').trim(),
          repo: floorplan?.repo === 'uploads' ? 'uploads' : 'gallery',
          at: new Date().toISOString(),
        },
        ...current.filter(item => String(item?.key || '') !== floorplanKey),
      ].slice(0, RECENT_FLOORPLAN_LIMIT);
      writeRecentFloorplans(recent);
    }

    function recentFloorplanIndexes(customer, floorplans) {
      const customerKey = floorplanCustomerRecentKey(customer);
      if (!customerKey || !Array.isArray(floorplans) || floorplans.length < RECENT_FLOORPLAN_MIN_COUNT) return [];
      const recent = readRecentFloorplans();
      const records = Array.isArray(recent[customerKey]) ? recent[customerKey] : [];
      if (!records.length) return [];
      const indexByKey = new Map();
      floorplans.forEach((floorplan, index) => {
        indexByKey.set(floorplanRecentKey(floorplan), index);
      });
      const seen = new Set();
      return records
        .map(record => indexByKey.get(String(record?.key || '')))
        .filter(index => {
          if (!Number.isInteger(index) || seen.has(index)) return false;
          seen.add(index);
          return true;
        })
        .slice(0, RECENT_FLOORPLAN_LIMIT);
    }

    function floorplanOrganizerMeta(floorplan) {
      const group = floorplanGroupName(floorplan);
      if (group) {
        return {
          key: `group:${group}`,
          label: group,
          kind: 'group',
          none: false,
        };
      }
      const location = FD.SelectSheetService.floorplanLocationName(floorplan);
      if (location) {
        return {
          key: `location:${location}`,
          label: location,
          kind: 'location',
          none: false,
        };
      }
      return {
        key: FD.SelectSheetService.ORGANIZER_NONE_VALUE,
        label: FD.SelectSheetService.ORGANIZER_NONE_LABEL,
        kind: 'none',
        none: true,
      };
    }

    function floorplanSheetSearchText(floorplan, label, meta = '') {
      return [
        label,
        meta,
        floorplanGroupLabelForValue(floorplanGroupValue(floorplan)),
        floorplanLocationLabelForValue(floorplanLocationValue(floorplan)),
        floorplan?.name,
        floorplanGroupName(floorplan),
        floorplan?.building,
        floorplan?.floorLabel,
        floorplan?.file,
      ].join(' ').toLowerCase();
    }

    function normalizeLocationFilterValue(value, options) {
      const allowed = new Set((options || []).map(option => String(option.value || '')));
      const normalized = String(value || '');
      return allowed.has(normalized) ? normalized : '';
    }

    function locationOptionDescription(customer, value, groupValue = '') {
      if (!customer || !value || value === FD.SelectSheetService.LOCATION_NONE_VALUE) return '';
      const groupName = groupValue && groupValue !== FD.SelectSheetService.GROUP_NONE_VALUE
        ? floorplanGroupLabelForValue(groupValue)
        : '';
      return formatLocationMeta(FD.SelectSheetService.getCustomerLocationDetails(customer, value, groupName));
    }

    function buildLocationFilterOptions(items, customer = null, groupValue = '') {
      const options = FD.SelectSheetService.buildLocationFilterOptions(items);
      if (options.length <= 1) return [];
      if (!customer) return options;
      return options.map(option => ({
        ...option,
        description: locationOptionDescription(customer, option.value, groupValue),
      }));
    }

    function topbarFloorplansForSelectedCustomer() {
      const ci = FD.SelectSheetService.selectedIndex(customerSelect);
      if (ci === null || !customers[ci]) return { customer: null, floorplans: [] };
      return {
        customer: customers[ci],
        floorplans: customers[ci].floorplans || [],
      };
    }

    function floorplansScopedByTopbarGroup(floorplans) {
      if (!topbarFloorplanGroupFilter) return floorplans || [];
      return (floorplans || []).filter(floorplan => floorplanGroupValue(floorplan) === topbarFloorplanGroupFilter);
    }

    function buildTopbarGroupFilterOptions(floorplans) {
      return FD.SelectSheetService.buildGroupFilterOptions(floorplans);
    }

    function buildTopbarLocationFilterOptions(floorplans, customer, groupValue = '') {
      const scopedFloorplans = floorplansScopedByTopbarGroup(floorplans);
      const options = buildLocationFilterOptions(scopedFloorplans, customer, groupValue);
      const specificGroupSelected = Boolean(groupValue);
      if (specificGroupSelected && options.length <= 2) return [];
      return options;
    }

    function syncTopbarFloorplanFilters(customer, floorplans) {
      const groupOptions = buildTopbarGroupFilterOptions(floorplans);
      topbarFloorplanGroupFilter = normalizeLocationFilterValue(topbarFloorplanGroupFilter, groupOptions);
      const locationOptions = buildTopbarLocationFilterOptions(
        floorplans,
        customer,
        topbarFloorplanGroupFilter
      );
      topbarFloorplanLocationFilter = normalizeLocationFilterValue(
        topbarFloorplanLocationFilter,
        locationOptions
      );
      return { groupOptions, locationOptions };
    }

    function getSelectSheetItems(type) {
      if (type === 'customer') {
        return FD.SelectSheetService
          .sortedWithOriginalIndex(customers, customer => customer.customer)
          .map(({ index, label }) => ({ index, label }));
      }
      const ci = FD.SelectSheetService.selectedIndex(customerSelect);
      if (ci === null || !customers[ci]) return [];
      const customer = customers[ci];
      const floorplans = customer.floorplans || [];
      const { groupOptions } = syncTopbarFloorplanFilters(customer, floorplans);
      if (type === 'location') return [];
      const hasOrganizerBlocks = floorplans.some(floorplan =>
        floorplanGroupName(floorplan) || FD.SelectSheetService.floorplanLocationName(floorplan)
      );
      const groupFilterActive = Boolean(groupOptions.length && !topbarFloorplanGroupFilter);
      const locationFilterActive = Boolean(!topbarFloorplanLocationFilter);
      const toSheetItem = (fp, index, label, overrides = {}) => {
        const readOnly = isViewerReadOnlyFloorplan(customer.customer, fp.name);
        const groupValue = floorplanGroupValue(fp);
        const locationValue = floorplanLocationValue(fp);
        const description = floorplanAddressMeta(customer, fp);
        const meta = floorplanPermissionMeta(customer, fp);
        const organizer = floorplanOrganizerMeta(fp);
        const groupLabel = overrides.groupLabel !== undefined
          ? overrides.groupLabel
          : (groupFilterActive
            ? floorplanGroupLabelForValue(groupValue)
            : (locationFilterActive ? floorplanLocationLabelForValue(locationValue) : organizer.label));
        return {
          index,
          label,
          meta,
          description,
          filterValues: {
            group: groupValue,
            location: locationValue,
          },
          floorplan: fp,
          groupValue,
          locationValue,
          organizerKey: organizer.key,
          organizerLabel: organizer.label,
          organizerKind: organizer.kind,
          organizerNone: organizer.none,
          collapsibleGroupKey: hasOrganizerBlocks ? organizer.key : '',
          collapsibleGroupLabel: hasOrganizerBlocks ? organizer.label : '',
          groupLabel,
          searchText: floorplanSheetSearchText(fp, label, [description, meta].filter(Boolean).join(' ')),
          readOnly,
          sectionRank: 1,
          ...overrides,
        };
      };
      const sortedItems = FD.SelectSheetService
        .sortedWithOriginalIndex(customers[ci].floorplans, floorplan => FD.SelectSheetService.floorplanDisplayName(floorplan))
        .map(({ item: fp, index, label }) => toSheetItem(fp, index, label))
        .sort(compareFloorplanSheetItems);
      const recentItems = recentFloorplanIndexes(customer, floorplans)
        .map((index, recentRank) => {
          const fp = floorplans[index];
          if (!fp) return null;
          return toSheetItem(fp, index, FD.SelectSheetService.floorplanDisplayName(fp), {
            collapsibleGroupKey: '',
            collapsibleGroupLabel: '',
            groupLabel: 'Recent',
            isRecent: true,
            recentRank,
            sectionRank: 0,
          });
        })
        .filter(Boolean);
      return [...recentItems, ...sortedItems]
        .sort(compareFloorplanSheetItems);
    }

    function getSelectSheetFilters(type) {
      if (type !== 'floorplan') return [];
      const ci = FD.SelectSheetService.selectedIndex(customerSelect);
      if (ci === null || !customers[ci]) return [];
      const { locationOptions } = syncTopbarFloorplanFilters(customers[ci], customers[ci].floorplans || []);
      return locationOptions;
    }

    function getSelectSheetFilterGroups(type) {
      if (type !== 'floorplan') return [];
      const { customer, floorplans } = topbarFloorplansForSelectedCustomer();
      if (!customer) return [];
      const { groupOptions, locationOptions } = syncTopbarFloorplanFilters(customer, floorplans);
      if (!groupOptions.length) return [];
      const groups = [];
      groups.push({
        key: 'group',
        label: 'Groep',
        value: topbarFloorplanGroupFilter,
        options: groupOptions,
      });
      if (locationOptions.length) {
        groups.push({
          key: 'location',
          label: 'Pand',
          value: topbarFloorplanLocationFilter,
          options: locationOptions,
        });
      }
      return groups;
    }

    function getSelectSheetFilterLabel(type) {
      return type === 'group' ? 'Groep' : (type === 'floorplan' ? 'Pand' : 'Pand');
    }

    function getSelectSheetFilterValue(type) {
      if (type === 'group') return topbarFloorplanGroupFilter;
      if (type === 'location' || type === 'floorplan') return topbarFloorplanLocationFilter;
      return '';
    }

    function getSelectSheetPickerMeta(type) {
      if (type !== 'floorplan') return '';
      const { customer, floorplan } = getSelectedFloorplan();
      return floorplanPickerMetaText(customer, floorplan);
    }

    function handleSelectSheetFilterChange(type, value) {
      if (type === 'group') {
        topbarFloorplanGroupFilter = String(value || '');
        topbarFloorplanLocationFilter = '';
        return;
      }
      if (type === 'location' || type === 'floorplan') topbarFloorplanLocationFilter = String(value || '');
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
      const isDone = item?.status === 'done' || item?.new_status === 'done' || item?.newStatus === 'done';
      if (isDone && item?.doorCondition === 'attention') return 'Aandacht nodig';
      if (item?.new_status === 'done' || item?.newStatus === 'done') return 'Afgerond';
      if (item?.status === 'done') return 'Afgerond';
      if (item?.new_status === 'todo' || item?.newStatus === 'todo' || item?.result === 'todo') return 'Open';
      return 'Open';
    }

    function adminActivityKey(row) {
      return [
        row?.customer || '',
        row?.floorplan || row?.name || '',
        row?.doorId || row?.door_id || row?.code || '',
      ].join('\n');
    }

    function adminActivityDoorCondition(row) {
      const condition = String(row?.doorCondition || row?.door_condition || '').trim();
      return ['ok', 'attention', 'unknown'].includes(condition) ? condition : 'unknown';
    }

    function isCompletedAdminActivity(row) {
      const result = String(row?.result || '');
      return row?.newStatus === 'done' ||
        row?.new_status === 'done' ||
        result === 'done' ||
        result.startsWith('done_') ||
        result.startsWith('already_done');
    }

    function normalizeAdminActivityRows(rows) {
      const normalized = [];
      const byKey = new Map();
      (Array.isArray(rows) ? rows : []).forEach(row => {
        if (!isCompletedAdminActivity(row)) return;
        const key = adminActivityKey(row);
        if (!key.trim()) return;
        const existing = byKey.get(key);
        const condition = adminActivityDoorCondition(row);
        if (!existing) {
          const copy = { ...row, doorCondition: condition };
          byKey.set(key, copy);
          normalized.push(copy);
          return;
        }
        if (condition === 'attention') {
          existing.doorCondition = 'attention';
          existing.doorConditionLabel = row.doorConditionLabel || row.door_condition_label || existing.doorConditionLabel || '';
        }
      });
      return normalized;
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
        floorplanGroupLabelForValue(floorplanGroupValue(record)),
        floorplanGroupName(record),
        floorplanLocationLabelForValue(floorplanLocationValue(record)),
        record.building,
        record.floorLabel,
        record.locationAddress,
        record.locationNote,
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

    const ADMIN_OVERVIEW_METRICS = {
      customers: {
        title: 'Klanten',
        subtitle: 'Meeste plattegronden',
        empty: 'Geen klanten gevonden.',
      },
      floorplans: {
        title: 'Plattegronden',
        subtitle: 'Alle beschikbare plattegronden',
        empty: 'Geen plattegronden gevonden.',
      },
      doors: {
        title: 'Deuren',
        subtitle: 'Meeste deurmarkers',
        empty: 'Geen deuren gevonden.',
      },
      open: {
        title: 'Openstaande deuren',
        subtitle: 'Nog te doen',
        empty: 'Geen open deuren gevonden.',
      },
      done: {
        title: 'Afgeronde deuren',
        subtitle: 'Meeste afgerond',
        empty: 'Geen afgeronde deuren gevonden.',
      },
      attention: {
        title: 'Aandacht nodig',
        subtitle: 'Rode status',
        empty: 'Geen deuren die aandacht nodig hebben.',
      },
    };

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

    function buildAdminGroupFilterOptions(records) {
      return FD.SelectSheetService.buildGroupFilterOptions(records, { allLabel: 'Alle groepen' });
    }

    function getFilteredAdminFloorplans() {
      const data = getAdminData();
      const query = adminNormalizeSearch(adminDashboardState.searchQuery);
      const selectedCustomer = adminDashboardState.selectedCustomer;
      const selectedGroup = adminDashboardState.selectedGroup;
      const selectedLocation = adminDashboardState.selectedLocation;
      return (Array.isArray(data.floorplans) ? data.floorplans : []).filter(record => {
        if (selectedCustomer && record.customer !== selectedCustomer) return false;
        if (selectedGroup && floorplanGroupValue(record) !== selectedGroup) return false;
        if (selectedLocation && floorplanLocationValue(record) !== selectedLocation) return false;
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
      renderAdminFreshness();
    }

    function renderAdminKpis() {
      const summary = getAdminData().summary || {};
      Object.entries(adminKpiEls).forEach(([key, el]) => {
        if (!el) return;
        el.textContent = String(Number(summary[key] || 0));
      });
      const activeMetric = getActiveAdminOverviewMetric();
      adminKpiButtons.forEach(button => {
        const active = button.dataset.adminKpi === activeMetric;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    function renderAdminFreshness() {
      if (!adminDashboardFreshness) return;
      if (adminDashboardState.loading) {
        adminDashboardFreshness.textContent = 'Dashboard wordt bijgewerkt...';
        return;
      }
      if (adminDashboardState.loadError && !adminDashboardState.data) {
        adminDashboardFreshness.textContent = 'Laatste update mislukt';
        return;
      }
      if (!adminDashboardState.lastUpdatedAt) {
        adminDashboardFreshness.textContent = 'Nog niet bijgewerkt';
        return;
      }
      const formatted = adminFormatDateTime(adminDashboardState.lastUpdatedAt);
      adminDashboardFreshness.textContent = formatted
        ? `Bijgewerkt ${formatted} (Amsterdam)`
        : 'Bijgewerkt';
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

    function adminSessionRoleLabel(role) {
      if (role === 'admin') return 'admin';
      if (role === 'monteur') return 'monteur';
      if (role === 'viewer') return 'viewer';
      return role || 'sessie';
    }

    function adminFormatDuration(seconds) {
      const total = Math.max(0, Number(seconds || 0));
      if (total < 60) return '< 1 min';
      const minutes = Math.floor(total / 60);
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      if (hours < 24) return rest ? `${hours}u ${rest}m` : `${hours}u`;
      const days = Math.floor(hours / 24);
      const restHours = hours % 24;
      return restHours ? `${days}d ${restHours}u` : `${days}d`;
    }

    function adminSessionLocationLabel(session) {
      return session.locationLabel || (session.cfColo ? `Cloudflare ${session.cfColo}` : 'Onbekend');
    }

    function adminSessionIpLabel(session) {
      if (session.ipAddress) return session.ipAddress;
      if (session.ipHash) return `hash ${session.ipHash}`;
      return 'Onbekend';
    }

    function appendAdminSessionField(container, label, value) {
      const field = document.createElement('div');
      field.className = 'admin-session-field';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('strong');
      valueEl.textContent = value || '-';
      field.append(labelEl, valueEl);
      container.appendChild(field);
    }

    function renderAdminSessionsPopup() {
      if (!adminSessionsList) return;
      const activeUsers = adminDashboardState.activeUsers || {};
      const sessions = Array.isArray(activeUsers.sessions) ? activeUsers.sessions : [];
      const windowMinutes = Number(activeUsers.windowMinutes || 10);
      if (adminSessionsSummary) {
        const total = sessions.length;
        adminSessionsSummary.textContent = `${total} actieve ${total === 1 ? 'sessie' : 'sessies'} in de laatste ${windowMinutes} minuten.`;
      }
      adminSessionsList.innerHTML = '';
      if (!sessions.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-dashboard-empty';
        empty.textContent = 'Geen actieve sessies gevonden.';
        adminSessionsList.appendChild(empty);
        return;
      }

      sessions.forEach(session => {
        const item = document.createElement('article');
        item.className = 'admin-session-item';

        const main = document.createElement('div');
        main.className = 'admin-session-main';
        const user = document.createElement('div');
        user.className = 'admin-session-user';
        user.textContent = session.displayName || session.username || 'Gebruiker';
        const badges = document.createElement('div');
        badges.className = 'admin-session-badges';
        const roleBadge = document.createElement('span');
        roleBadge.className = 'admin-session-badge';
        roleBadge.textContent = adminSessionRoleLabel(session.role);
        badges.appendChild(roleBadge);
        if (session.current) {
          const currentBadge = document.createElement('span');
          currentBadge.className = 'admin-session-badge current';
          currentBadge.textContent = 'dit scherm';
          badges.appendChild(currentBadge);
        }
        main.append(user, badges);

        const grid = document.createElement('div');
        grid.className = 'admin-session-grid';
        appendAdminSessionField(grid, 'IP', adminSessionIpLabel(session));
        appendAdminSessionField(grid, 'Locatie', adminSessionLocationLabel(session));
        appendAdminSessionField(grid, 'Verbonden', adminFormatDuration(session.connectedSeconds));
        appendAdminSessionField(grid, 'Laatste hartslag', `${adminFormatDuration(session.idleSeconds)} geleden`);
        appendAdminSessionField(grid, 'Apparaat', session.deviceLabel || 'Browser');
        appendAdminSessionField(grid, 'Sessie', session.id || '-');
        item.append(main, grid);
        adminSessionsList.appendChild(item);
      });
    }

    function showAdminSessionsPopup() {
      if (!isAdminUser()) return;
      renderAdminSessionsPopup();
      adminSessionsDialog.show();
      loadActiveUsers({ refreshNow: true });
    }

    function hideAdminSessionsPopup() {
      adminSessionsDialog.hide();
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
        adminDashboardState.activeUsers = result;
        renderActiveUsers(result.counts);
        if (adminSessionsPopup?.style.display !== 'none') renderAdminSessionsPopup();
      } catch (err) {
        console.warn('Online gebruikers laden mislukt:', err);
        adminDashboardState.activeUsers = null;
        renderActiveUsers(null);
        if (adminSessionsPopup?.style.display !== 'none') renderAdminSessionsPopup();
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

    function getActiveAdminOverviewMetric() {
      return ADMIN_OVERVIEW_METRICS[adminDashboardState.overviewMetric]
        ? adminDashboardState.overviewMetric
        : 'attention';
    }

    function adminPlural(count, singular, plural) {
      return `${count} ${count === 1 ? singular : plural}`;
    }

    function adminFloorplanDisplayName(record) {
      return record?.displayName || record?.name || 'Plattegrond';
    }

    function createAdminFloorplanMetricItem(record, badge) {
      return {
        type: 'floorplan',
        record,
        label: adminFloorplanDisplayName(record),
        meta: [record.customer || 'Onbekende klant', floorplanGroupMeta(record)].filter(Boolean).join(' · '),
        badge,
      };
    }

    function sortAdminFloorplansByMetric(records, metric) {
      return records.slice().sort((left, right) => {
        const byCount = Number(right[metric] || 0) - Number(left[metric] || 0);
        if (byCount) return byCount;
        const byCustomer = ADMIN_COLLATOR.compare(left.customer || '', right.customer || '');
        if (byCustomer) return byCustomer;
        return ADMIN_COLLATOR.compare(adminFloorplanDisplayName(left), adminFloorplanDisplayName(right));
      });
    }

    function getAdminCustomerMetricItems() {
      const data = getAdminData();
      const byCustomer = new Map();
      const ensureCustomer = name => {
        const key = name || 'Onbekende klant';
        if (!byCustomer.has(key)) {
          byCustomer.set(key, {
            type: 'customer',
            customer: key,
            label: key,
            floorplans: 0,
            doors: 0,
            open: 0,
            done: 0,
            attention: 0,
          });
        }
        return byCustomer.get(key);
      };

      (data.customers || customers || []).forEach(customer => {
        if (customer?.customer) ensureCustomer(customer.customer);
      });
      (data.floorplans || []).forEach(record => {
        const item = ensureCustomer(record.customer);
        item.floorplans += 1;
        item.doors += Number(record.doorsTotal || 0);
        item.open += Number(record.open || 0);
        item.done += Number(record.done || 0);
        item.attention += Number(record.attention || 0);
      });

      return Array.from(byCustomer.values())
        .sort((left, right) => {
          const byFloorplans = right.floorplans - left.floorplans;
          if (byFloorplans) return byFloorplans;
          return ADMIN_COLLATOR.compare(left.customer, right.customer);
        })
        .slice(0, 6)
        .map(item => ({
          ...item,
          meta: `${adminPlural(item.floorplans, 'plattegrond', 'plattegronden')} · ${adminPlural(item.doors, 'deur', 'deuren')}`,
          badge: item.attention > 0 ? `${item.attention} aandacht` : `${item.open} open`,
        }));
    }

    function getAdminOverviewMetricItems(metric) {
      const floorplans = getAdminData().floorplans || [];
      if (metric === 'customers') return getAdminCustomerMetricItems();
      if (metric === 'floorplans') {
        return floorplans
          .slice()
          .sort((left, right) => {
            const byCustomer = ADMIN_COLLATOR.compare(left.customer || '', right.customer || '');
            if (byCustomer) return byCustomer;
            return ADMIN_COLLATOR.compare(adminFloorplanDisplayName(left), adminFloorplanDisplayName(right));
          })
          .slice(0, 6)
          .map(record => createAdminFloorplanMetricItem(record, adminPlural(Number(record.doorsTotal || 0), 'deur', 'deuren')));
      }
      if (metric === 'doors') {
        return sortAdminFloorplansByMetric(floorplans, 'doorsTotal')
          .filter(record => Number(record.doorsTotal || 0) > 0)
          .slice(0, 6)
          .map(record => createAdminFloorplanMetricItem(record, adminPlural(Number(record.doorsTotal || 0), 'deur', 'deuren')));
      }
      if (metric === 'open') {
        return sortAdminFloorplansByMetric(floorplans, 'open')
          .filter(record => Number(record.open || 0) > 0)
          .slice(0, 6)
          .map(record => createAdminFloorplanMetricItem(record, `${record.open || 0} open`));
      }
      if (metric === 'done') {
        return sortAdminFloorplansByMetric(floorplans, 'done')
          .filter(record => Number(record.done || 0) > 0)
          .slice(0, 6)
          .map(record => createAdminFloorplanMetricItem(record, `${record.done || 0} klaar`));
      }
      return sortAdminFloorplansByMetric(floorplans, 'attention')
        .filter(record => Number(record.attention || 0) > 0)
        .slice(0, 6)
        .map(record => createAdminFloorplanMetricItem(record, `${record.attention || 0} rood`));
    }

    function renderAdminOverviewList(container, items, emptyText) {
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
        title.textContent = record.label || adminFloorplanDisplayName(record.record || record);
        const badge = document.createElement('span');
        badge.className = 'admin-overview-badge';
        badge.textContent = record.badge || '';
        main.append(title, badge);
        const meta = document.createElement('div');
        meta.className = 'admin-overview-item-meta';
        meta.textContent = record.meta || record.customer || 'Onbekende klant';
        button.append(main, meta);
        button.addEventListener('click', () => {
          if (record.type === 'customer') {
            adminDashboardState.selectedCustomer = record.customer || '';
            adminDashboardState.selectedGroup = '';
            adminDashboardState.selectedLocation = '';
            adminDashboardState.selectedKey = '';
            adminDashboardState.selectedDoorKey = '';
            adminDashboardState.previewKey = '';
            adminDashboardState.bulkMode = false;
            adminDashboardState.bulkSelectedKeys.clear();
            setAdminTab('floorplans');
            renderAdminDashboard();
            return;
          }
          const target = record.record || record;
          adminDashboardState.selectedGroup = '';
          adminDashboardState.selectedLocation = '';
          adminDashboardState.selectedKey = adminFloorplanKey(target);
          adminDashboardState.selectedDoorKey = '';
          adminDashboardState.bulkMode = false;
          adminDashboardState.bulkSelectedKeys.clear();
          setAdminTab('details');
          renderAdminDashboard();
        });
        container.appendChild(button);
      });
    }

    function renderAdminOverview() {
      const activeMetric = getActiveAdminOverviewMetric();
      const metricConfig = ADMIN_OVERVIEW_METRICS[activeMetric] || ADMIN_OVERVIEW_METRICS.attention;
      const metricItems = getAdminOverviewMetricItems(activeMetric);
      const floorplans = getAdminData().floorplans || [];
      const open = floorplans
        .filter(record => Number(record.open || 0) > 0)
        .sort((left, right) => Number(right.open || 0) - Number(left.open || 0))
        .slice(0, 6);

      if (adminOverviewKpiTitle) adminOverviewKpiTitle.textContent = metricConfig.title;
      if (adminOverviewKpiSubtitle) adminOverviewKpiSubtitle.textContent = metricConfig.subtitle;
      renderAdminOverviewList(
        adminOverviewAttention,
        metricItems,
        adminDashboardState.loading ? 'Dashboard laden...' : metricConfig.empty
      );
      renderAdminOverviewList(
        adminOverviewOpen,
        open.map(record => createAdminFloorplanMetricItem(record, `${record.open || 0} open`)),
        adminDashboardState.loading ? 'Dashboard laden...' : 'Geen open deuren gevonden.'
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
        const rowCondition = adminActivityDoorCondition(row);
        const activityStatus = {
          status: row.newStatus === 'done' || row.new_status === 'done' ? 'done' : 'todo',
          doorCondition: rowCondition === 'attention' || door?.doorCondition === 'attention'
            ? 'attention'
            : rowCondition || door?.doorCondition || 'unknown',
          newStatus: row.newStatus || row.new_status || '',
          new_status: row.new_status || row.newStatus || '',
          result: row.result || '',
        };
        dot.style.background = adminDoorColor(activityStatus);
        const code = row.doorId || row.door_id || door?.doorId || door?.code || 'Deur';
        label.append(dot, document.createTextNode(`${code} · ${adminStatusLabel(activityStatus)}`));
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
          adminDashboardState.selectedGroup = '';
          adminDashboardState.selectedLocation = '';
          adminDashboardState.selectedKey = adminFloorplanKey(targetFloorplan);
          adminDashboardState.selectedDoorKey = door ? adminDoorKey(door) : adminDoorKey(row);
          adminDashboardState.bulkMode = false;
          adminDashboardState.bulkSelectedKeys.clear();
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
        adminDashboardState.activity = normalizeAdminActivityRows(result.activity);
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
          adminDashboardState.selectedGroup = '';
          adminDashboardState.selectedLocation = '';
          adminDashboardState.selectedKey = '';
          adminDashboardState.selectedDoorKey = '';
          adminDashboardState.previewKey = '';
          adminDashboardState.bulkMode = false;
          adminDashboardState.bulkSelectedKeys.clear();
          renderAdminDashboard();
        });
        adminCustomerFilters.appendChild(button);
      });
    }

    function renderAdminGroupFilters() {
      if (!adminGroupFilters) return;
      adminGroupFilters.innerHTML = '';
      const data = getAdminData();
      const selectedCustomer = adminDashboardState.selectedCustomer;
      const scopedFloorplans = (Array.isArray(data.floorplans) ? data.floorplans : [])
        .filter(record => !selectedCustomer || record.customer === selectedCustomer);
      const options = buildAdminGroupFilterOptions(scopedFloorplans);
      adminDashboardState.selectedGroup = normalizeLocationFilterValue(
        adminDashboardState.selectedGroup,
        options
      );

      if (!options.length) {
        if (adminGroupFilterHeading) adminGroupFilterHeading.hidden = true;
        adminGroupFilters.hidden = true;
        adminDashboardState.selectedGroup = '';
        return;
      }

      if (adminGroupFilterHeading) adminGroupFilterHeading.hidden = false;
      adminGroupFilters.hidden = false;
      const select = document.createElement('select');
      select.className = 'admin-dashboard-input admin-location-select';
      select.setAttribute('aria-label', 'Groep');
      options.forEach(item => {
        const value = String(item.value || '');
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${item.label} (${item.count})`;
        select.appendChild(option);
      });
      select.value = adminDashboardState.selectedGroup;
      select.addEventListener('change', () => {
        adminDashboardState.selectedGroup = select.value;
        adminDashboardState.selectedLocation = '';
        adminDashboardState.selectedKey = '';
        adminDashboardState.selectedDoorKey = '';
        adminDashboardState.previewKey = '';
        renderAdminDashboard();
      });
      adminGroupFilters.appendChild(select);
    }

    function getAdminBulkSelectedRecords() {
      const selectedKeys = adminDashboardState.bulkSelectedKeys;
      if (!selectedKeys || !selectedKeys.size) return [];
      return (getAdminData().floorplans || [])
        .filter(record => selectedKeys.has(adminFloorplanKey(record)) &&
          (!adminDashboardState.selectedCustomer || record.customer === adminDashboardState.selectedCustomer));
    }

    function pruneAdminBulkSelection() {
      const allKeys = new Set((getAdminData().floorplans || [])
        .filter(record => !adminDashboardState.selectedCustomer || record.customer === adminDashboardState.selectedCustomer)
        .map(adminFloorplanKey));
      Array.from(adminDashboardState.bulkSelectedKeys).forEach(key => {
        if (!allKeys.has(key)) adminDashboardState.bulkSelectedKeys.delete(key);
      });
    }

    function setAdminBulkMode(active) {
      if (active && !adminDashboardState.selectedCustomer) {
        showToast('Kies eerst één klant voor bulkbewerking', 'error');
        return;
      }
      adminDashboardState.bulkMode = Boolean(active);
      adminDashboardState.bulkSelectedKeys.clear();
      hideAdminBulkGroupDialog();
      renderAdminDashboard();
    }

    function renderAdminBulkControls(filtered) {
      pruneAdminBulkSelection();
      const bulkMode = Boolean(adminDashboardState.bulkMode);
      const selectedCount = getAdminBulkSelectedRecords().length;
      if (adminBulkToggle) {
        adminBulkToggle.hidden = bulkMode;
        adminBulkToggle.disabled = !adminDashboardState.selectedCustomer;
        adminBulkToggle.title = adminDashboardState.selectedCustomer
          ? 'Meerdere plattegronden selecteren'
          : 'Kies eerst één klant';
      }
      if (adminBulkSelectVisible) {
        adminBulkSelectVisible.hidden = !bulkMode;
        adminBulkSelectVisible.disabled = !filtered.length;
      }
      if (adminBulkClear) {
        adminBulkClear.hidden = !bulkMode;
        adminBulkClear.disabled = selectedCount === 0;
      }
      if (adminBulkGroup) {
        adminBulkGroup.hidden = !bulkMode;
        adminBulkGroup.disabled = selectedCount === 0;
        adminBulkGroup.textContent = selectedCount ? `Groep wijzigen (${selectedCount})` : 'Groep wijzigen';
      }
      if (adminBulkCancel) {
        adminBulkCancel.hidden = !bulkMode;
      }
    }

    function toggleAdminBulkRecord(record) {
      const key = adminFloorplanKey(record);
      if (!key.trim()) return;
      if (adminDashboardState.bulkSelectedKeys.has(key)) {
        adminDashboardState.bulkSelectedKeys.delete(key);
      } else {
        adminDashboardState.bulkSelectedKeys.add(key);
      }
      renderAdminFloorplanList();
    }

    function selectVisibleAdminBulkFloorplans() {
      if (!adminDashboardState.bulkMode) return;
      getFilteredAdminFloorplans().forEach(record => {
        adminDashboardState.bulkSelectedKeys.add(adminFloorplanKey(record));
      });
      renderAdminFloorplanList();
    }

    function clearAdminBulkSelection() {
      adminDashboardState.bulkSelectedKeys.clear();
      renderAdminFloorplanList();
    }

    function renderAdminLocationFilters() {
      if (!adminLocationFilters) return;
      adminLocationFilters.innerHTML = '';
      const data = getAdminData();
      const selectedCustomer = adminDashboardState.selectedCustomer;
      const selectedGroup = adminDashboardState.selectedGroup;
      const scopedFloorplans = (Array.isArray(data.floorplans) ? data.floorplans : [])
        .filter(record => !selectedCustomer || record.customer === selectedCustomer)
        .filter(record => !selectedGroup || floorplanGroupValue(record) === selectedGroup);
      const options = buildLocationFilterOptions(scopedFloorplans);
      adminDashboardState.selectedLocation = normalizeLocationFilterValue(
        adminDashboardState.selectedLocation,
        options
      );

      if (!options.length) {
        if (adminLocationFilterHeading) adminLocationFilterHeading.hidden = true;
        adminLocationFilters.hidden = true;
        adminDashboardState.selectedLocation = '';
        return;
      }

      if (adminLocationFilterHeading) adminLocationFilterHeading.hidden = false;
      adminLocationFilters.hidden = false;
      const select = document.createElement('select');
      select.className = 'admin-dashboard-input admin-location-select';
      select.setAttribute('aria-label', 'Locatie');
      options.forEach(item => {
        const value = String(item.value || '');
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${item.label} (${item.count})`;
        select.appendChild(option);
      });
      select.value = adminDashboardState.selectedLocation;
      select.addEventListener('change', () => {
        adminDashboardState.selectedLocation = select.value;
        adminDashboardState.selectedKey = '';
        adminDashboardState.selectedDoorKey = '';
        adminDashboardState.previewKey = '';
        renderAdminDashboard();
      });
      adminLocationFilters.appendChild(select);
    }

    function renderAdminFloorplanList() {
      if (!adminFloorplanList) return;
      const filtered = getFilteredAdminFloorplans();
      renderAdminBulkControls(filtered);
      if (adminFloorplanCount) {
        const bulkSelected = adminDashboardState.bulkMode ? ` · ${getAdminBulkSelectedRecords().length} geselecteerd` : '';
        adminFloorplanCount.textContent = `${filtered.length} gevonden${bulkSelected}`;
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
        const key = adminFloorplanKey(record);
        const bulkSelected = adminDashboardState.bulkSelectedKeys.has(key);
        row.classList.toggle('has-bulk-checkbox', adminDashboardState.bulkMode);
        row.classList.toggle('active', !adminDashboardState.bulkMode && key === adminDashboardState.selectedKey);
        row.classList.toggle('is-bulk-selected', bulkSelected);

        if (adminDashboardState.bulkMode) {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'admin-bulk-checkbox';
          checkbox.checked = bulkSelected;
          checkbox.tabIndex = -1;
          checkbox.setAttribute('aria-hidden', 'true');
          row.appendChild(checkbox);
        }

        const main = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'admin-floorplan-name';
        name.textContent = record.displayName || record.name || 'Plattegrond';
        const group = document.createElement('div');
        group.className = 'admin-floorplan-group-meta';
        group.textContent = floorplanGroupMeta(record) || 'Geen groep';
        const customer = document.createElement('div');
        customer.className = 'admin-floorplan-customer';
        customer.textContent = record.customer || 'Onbekende klant';
        main.append(name, group, customer);

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
          if (adminDashboardState.bulkMode) {
            toggleAdminBulkRecord(record);
            return;
          }
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
          adminDashboardState.selectedGroup = '';
          adminDashboardState.selectedLocation = '';
          adminDashboardState.selectedKey = adminFloorplanKey(door);
          adminDashboardState.selectedDoorKey = adminDoorKey(door);
          adminDashboardState.bulkMode = false;
          adminDashboardState.bulkSelectedKeys.clear();
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

    function getAdminRecordLocationDetails(record) {
      const customer = (getAdminData().customers || customers || [])
        .find(item => item?.customer === record?.customer);
      const details = getFloorplanLocationDetails(customer, {
        building: record?.building || '',
        locationGroup: floorplanGroupName(record),
      });
      return {
        address: String(record?.locationAddress || details?.address || '').trim(),
        note: String(record?.locationNote || details?.note || '').trim(),
      };
    }

    function renderAdminMetadataForm(record) {
      if (!record) return;
      const locationDetails = getAdminRecordLocationDetails(record);
      renderAdminCustomerSelect(record);
      if (adminDetailLocationGroup) adminDetailLocationGroup.value = floorplanGroupName(record);
      if (adminDetailBuilding) adminDetailBuilding.value = record.building || '';
      if (adminDetailFloorLabel) adminDetailFloorLabel.value = record.floorLabel || record.displayName || record.name || '';
      if (adminDetailLocationAddress) adminDetailLocationAddress.value = locationDetails.address;
      if (adminDetailLocationNote) adminDetailLocationNote.value = locationDetails.note;
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

    function hideAdminBulkGroupDialog() {
      if (adminBulkGroupDialogOverlay) adminBulkGroupDialogOverlay.hidden = true;
      if (adminBulkGroupDialog) adminBulkGroupDialog.hidden = true;
      if (adminBulkGroupError) adminBulkGroupError.textContent = '';
    }

    function openAdminBulkGroupDialog() {
      const records = getAdminBulkSelectedRecords();
      if (!records.length) {
        showToast('Selecteer eerst plattegronden', 'error');
        return;
      }
      const firstGroup = floorplanGroupName(records[0]);
      const sharedGroup = records.every(record => floorplanGroupName(record) === firstGroup) ? firstGroup : '';
      if (adminBulkGroupDialogContext) {
        adminBulkGroupDialogContext.textContent =
          `${records.length} plattegrond${records.length === 1 ? '' : 'en'} bij ${adminDashboardState.selectedCustomer}.`;
      }
      if (adminBulkGroupInput) adminBulkGroupInput.value = sharedGroup;
      if (adminBulkGroupError) adminBulkGroupError.textContent = '';
      if (adminBulkGroupDialogOverlay) adminBulkGroupDialogOverlay.hidden = false;
      if (adminBulkGroupDialog) adminBulkGroupDialog.hidden = false;
      requestAnimationFrame(() => adminBulkGroupInput?.focus());
    }

    async function saveAdminBulkGroup() {
      const records = getAdminBulkSelectedRecords();
      if (!records.length) {
        if (adminBulkGroupError) adminBulkGroupError.textContent = 'Selecteer eerst plattegronden.';
        return;
      }
      const customerName = adminDashboardState.selectedCustomer;
      if (!customerName) {
        if (adminBulkGroupError) adminBulkGroupError.textContent = 'Kies eerst één klant.';
        return;
      }
      const locationGroup = adminBulkGroupInput?.value.trim() || '';
      const selectedBeforeUpdate = getSelectedFloorplan();
      if (adminBulkGroupSave) {
        adminBulkGroupSave.disabled = true;
        adminBulkGroupSave.textContent = 'Opslaan...';
      }
      if (adminBulkGroupError) adminBulkGroupError.textContent = '';
      busyOverlay.show({
        title: 'Groep wijzigen',
        subtitle: `${records.length} plattegrond${records.length === 1 ? '' : 'en'} worden bijgewerkt...`,
      });
      try {
        const result = await FD.DataService.updateFloorplanGroupsBulk(CONFIG, {
          customerName,
          locationGroup,
          records: records.map(record => ({
            floorplanName: record.name,
            repo: record.repo,
            fileName: record.file,
          })),
        });
        if (Array.isArray(result.customers)) {
          customers = result.customers;
          cacheCustomers();
          populateCustomerDropdown();
          restoreTopbarSelectionAfterCustomerRefresh(selectedBeforeUpdate);
        }
        adminDashboardState.bulkMode = false;
        adminDashboardState.bulkSelectedKeys.clear();
        adminDashboardState.selectedGroup = '';
        adminDashboardState.selectedLocation = '';
        adminDashboardState.selectedKey = '';
        adminDashboardState.previewKey = '';
        await loadAdminDashboard({ force: true });
        hideAdminBulkGroupDialog();
        showToast('Groep bijgewerkt', 'success');
      } catch (err) {
        if (adminBulkGroupError) {
          adminBulkGroupError.textContent = err?.status === 409
            ? 'Deze groep zou dubbele zichtbare plattegrondnamen maken.'
            : 'Groep wijzigen mislukt: ' + (err?.message || 'onbekende fout');
        }
      } finally {
        if (adminBulkGroupSave) {
          adminBulkGroupSave.disabled = false;
          adminBulkGroupSave.textContent = 'Groep opslaan';
        }
        busyOverlay.hide();
      }
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
        adminDetailMeta.textContent = [record.customer, floorplanGroupMeta(record), repoLabel, `technisch: ${record.name}`]
          .filter(Boolean)
          .join(' · ');
      }
      if (adminDetailStats) {
        adminDetailStats.textContent = `${record.done || 0} van ${record.doorsTotal || 0} deuren afgerond · ${record.open || 0} openstaand · ${record.attention || 0} aandacht nodig`;
      }
      if (adminDashboardState.activeTab === 'details') loadAdminPreview(record);
    }

    function renderAdminDashboard() {
      setAdminTab(adminDashboardState.activeTab);
      renderAdminFreshness();
      renderAdminKpis();
      renderAdminOverview();
      renderAdminActivity();
      renderAdminCustomerFilters();
      renderAdminGroupFilters();
      renderAdminLocationFilters();
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
      adminDashboardState.loadError = '';
      try {
        const data = await FD.DataService.fetchAdminOverview(CONFIG, {
          diagnostics: {
            purpose: 'admin_overview',
          },
        });
        adminDashboardState.data = data;
        adminDashboardState.lastUpdatedAt = data.generated_at || data.generatedAt || new Date().toISOString();
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
        adminDashboardState.loadError = err.message || 'dashboard_failed';
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
      const locationGroup = adminDetailLocationGroup?.value.trim() || '';
      const buildingName = adminDetailBuilding?.value.trim() || '';
      const floorLabel = adminDetailFloorLabel?.value.trim() || '';
      const locationAddress = adminDetailLocationAddress?.value.trim() || '';
      const locationNote = adminDetailLocationNote?.value.trim() || '';
      const editingCurrentFloorplan = currentCustomer === record.customer && currentFloorplan === record.name;
      if (!floorLabel) {
        if (adminDetailError) adminDetailError.textContent = 'Vul een verdieping of naam in.';
        return;
      }
      if ((locationAddress || locationNote) && !buildingName) {
        if (adminDetailError) adminDetailError.textContent = 'Vul een pand in om adresgegevens te bewaren.';
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
          locationGroup,
          buildingName,
          floorLabel,
          locationAddress,
          locationNote,
        });
        assertLocationDetailsPersisted(result.customers, nextCustomerName, buildingName, locationAddress, locationNote, locationGroup);
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
          locationGroup,
          building: buildingName,
          floorLabel,
          locationAddress,
          locationNote,
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
        adminDashboardState.selectedGroup = '';
        adminDashboardState.selectedLocation = '';
        adminDashboardState.selectedKey = adminFloorplanKey(nextRecord);
        adminDashboardState.previewKey = '';
        await loadAdminDashboard({ force: true });
        hideAdminMetadataDialog();
        showToast('Plattegrondgegevens opgeslagen', 'success');
      } catch (err) {
        if (adminDetailError) {
          adminDetailError.textContent = metadataSaveErrorText(
            err,
            'Deze klant heeft al een plattegrond met deze naam of dit bestand.',
          );
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
        locationGroup: floorplanGroupName(record),
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
        floorplanPickerMeta,
        overlay: selectSheetOverlay,
        sheet: selectSheet,
        eyebrow: selectSheetEyebrow,
        title: selectSheetTitle,
        search: selectSheetSearch,
        filters: selectSheetLocationFilters,
        list: selectSheetList,
        closeButton: selectSheetClose,
      },
      getState: () => ({ customersLoading }),
      getItems: getSelectSheetItems,
      getFilters: getSelectSheetFilters,
      getFilterGroups: getSelectSheetFilterGroups,
      getFilterLabel: getSelectSheetFilterLabel,
      getFilterValue: getSelectSheetFilterValue,
      getPickerMeta: getSelectSheetPickerMeta,
      onFilterChange: handleSelectSheetFilterChange,
      onCustomerChange: ({ value }) => {
        topbarFloorplanGroupFilter = '';
        topbarFloorplanLocationFilter = '';
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
      requestAnimationFrame(updateTopbarHeight);
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
        btnJotforms,
        btnClose,
        btnDone,
      },
      config: {
        baseUrl: CONFIG.jotformBaseUrl,
        formId: CONFIG.jotformFormId,
        forms: CONFIG.jotformForms,
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
      findJotFormSubmission: isJotFormLookupEnabled() ? (({ selectedDoor, currentCustomer, currentFloorplan, formType = 'maintenance' }) => {
        const type = normalizeJotFormFormType(formType);
        const cached = getCachedJotFormSubmission(selectedDoor, type);
        if (cached?.editUrl) {
          return Promise.resolve({ ok: true, found: true, formType: type, editUrl: cached.editUrl });
        }
        const target = {
          customer: currentCustomer.customer || currentCustomer,
          floorplan: currentFloorplan.name || currentFloorplan,
          repo: currentFloorplan.repo === 'uploads' ? 'uploads' : 'gallery',
          file: currentFloorplan.file,
          doorId: selectedDoor,
          formType: type,
        };
        return FD.DataService.findJotFormSubmission(CONFIG, target, {
          diagnostics: {
            purpose: 'jotform_submission_lookup',
          },
        });
      }) : null,
      prepareJotFormContext: ({ selectedDoor, currentCustomer, currentFloorplan, formType = 'maintenance' }) => {
        if (!isJotFormLookupEnabled()) return Promise.resolve(null);
        return FD.DataService.createJotFormContext(CONFIG, {
          customer: currentCustomer.customer || currentCustomer,
          floorplan: currentFloorplan.name || currentFloorplan,
          repo: currentFloorplan.repo === 'uploads' ? 'uploads' : 'gallery',
          file: currentFloorplan.file,
          doorId: selectedDoor,
          formType: normalizeJotFormFormType(formType),
        });
      },
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
        hideLocationAddressBar();
        infoPanel.style.display = 'none';
        btnPanelToggle.style.display = 'none';
        closeSidePanel();
        sidePanelController.clear();
        loadingEl.classList.add('hidden');
      },
      onSvgReady: ({ svgEl, context }) => {
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
      hideLocationAddressBar();
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
      adminDashboardState.selectedGroup = '';
      adminDashboardState.selectedLocation = '';
      adminDashboardState.searchQuery = '';
      adminDashboardState.doorQuery = '';
      adminDashboardState.doorOrder = 'asc';
      adminDashboardState.doorCustomerFilter = '';
      adminDashboardState.doorFloorplanFilter = '';
      adminDashboardState.activeTab = 'overview';
      adminDashboardState.selectedDoorKey = '';
      adminDashboardState.overviewMetric = 'attention';
      adminDashboardState.activity = [];
      adminDashboardState.activityLoading = false;
      adminDashboardState.activityError = '';
      adminDashboardState.activityUnavailable = false;
      adminDashboardState.previewKey = '';
      adminDashboardState.previewRequestId += 1;
      adminDashboardState.metadataRecord = null;
      adminDashboardState.bulkMode = false;
      adminDashboardState.bulkSelectedKeys.clear();
      adminDashboardState.lastUpdatedAt = '';
      adminDashboardState.loadError = '';
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
      hideExportExcelDialog();
      hideAdminBulkGroupDialog();
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
      const result = await floorplanLoadController.load({ customerIndex, floorplanIndex, customer: c, floorplan: fp });
      rememberRecentFloorplan(c, fp);
      return result;
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
      let color = COLORS.todo;
      let filter = 'drop-shadow(0 1px 2px rgba(15, 23, 42, 0.28))';

      if (isDone && condition === 'attention') {
        color = COLORS.attention;
        filter = 'drop-shadow(0 0 6px rgba(217, 48, 37, 0.62)) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.22))';
      } else if (isDone && condition === 'checking') {
        color = COLORS.checking;
        filter = 'drop-shadow(0 0 5px rgba(95, 99, 104, 0.38)) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.18))';
      } else if (isDone) {
        color = COLORS.done;
        filter = 'drop-shadow(0 0 5px rgba(52, 168, 83, 0.40)) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.20))';
      }

      if (markerOutlineMode) {
        marker.style.fill = 'transparent';
        marker.style.stroke = color;
        marker.style.strokeWidth = '5';
      } else {
        marker.style.fill = color;
        marker.style.stroke = 'transparent';
        marker.style.strokeWidth = '20';
      }
      marker.style.vectorEffect = 'non-scaling-stroke';

      if (isSelected) {
        marker.style.opacity = OPACITY.selected;
        marker.style.filter = 'drop-shadow(0 0 9px rgba(26, 115, 232, 0.95)) drop-shadow(0 0 3px rgba(255, 255, 255, 0.98))';
      } else if (hasSelection) {
        marker.style.opacity = OPACITY.dimmed;
        marker.style.filter = 'drop-shadow(0 1px 1px rgba(15, 23, 42, 0.16))';
      } else {
        marker.style.opacity = OPACITY.normal;
        marker.style.filter = filter;
      }
    }

    function doorPrintColor(doorId) {
      const isDone = getDoorStatus(doorId);
      const condition = getDoorCondition(doorId);
      if (isDone && condition === 'attention') return COLORS.attention;
      if (isDone && condition === 'checking') return COLORS.checking;
      if (isDone) return COLORS.done;
      return COLORS.todo;
    }

    function applyPrintDoorMarkerStyle(marker) {
      const doorId = marker?.dataset?.doorId;
      if (!doorId) return;
      const color = doorPrintColor(doorId);
      if (markerOutlineMode) {
        marker.style.fill = 'transparent';
        marker.style.stroke = color;
        marker.style.strokeWidth = '5';
      } else {
        marker.style.fill = color;
        marker.style.stroke = 'transparent';
        marker.style.strokeWidth = '20';
      }
      marker.style.opacity = OPACITY.normal;
      marker.style.filter = 'none';
      marker.style.pointerEvents = 'none';
      marker.style.cursor = 'default';
      marker.style.transition = 'none';
      marker.style.vectorEffect = 'non-scaling-stroke';
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

        async function openJotForm(formType = 'maintenance') {
          const type = normalizeJotFormFormType(formType);
          const button = btnJotforms[type] || btnJotform;
          if (button?.classList.contains('disabled')) return;
          if (!canWriteCurrentFloorplan()) {
            showToast('Alleen kijken op deze plattegrond', 'error');
            return;
          }
          try {
            await doorActionController.openJotForm(type);
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
    const LABELS_STORAGE_KEY = envStorageKey('fd_show_labels');
    const LABELS_DEFAULT_MIGRATION_KEY = envStorageKey('fd_show_labels_default_on_v1');
    const MARKER_OUTLINE_STORAGE_KEY = envStorageKey('fd_marker_outline');
    if (localStorage.getItem(LABELS_DEFAULT_MIGRATION_KEY) !== '1') {
      localStorage.setItem(LABELS_STORAGE_KEY, '1');
      localStorage.setItem(LABELS_DEFAULT_MIGRATION_KEY, '1');
    }
    let showLabels = localStorage.getItem(LABELS_STORAGE_KEY) !== '0';
    let markerOutlineMode = localStorage.getItem(MARKER_OUTLINE_STORAGE_KEY) === '1';
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
      if (!marker) return;
      applyDoorColor(marker, getDoorStatus(marker.dataset.doorId));
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

    function toggleMarkerOutlineMode() {
      markerOutlineMode = !markerOutlineMode;
      localStorage.setItem(MARKER_OUTLINE_STORAGE_KEY, markerOutlineMode ? '1' : '0');
      updateMarkerOutlineMenuButton();
      refreshAllDoorColors();
      hideTopbarMenu();
    }

    function updateMarkerOutlineMenuButton() {
      FD.UIShellService.updateMarkerOutlineButton(btnMenuMarkerOutline, markerOutlineMode);
    }

    function getExportBaseRecord() {
      if (adminDashboardState.visible) {
        const adminRecord = getSelectedAdminFloorplan();
        if (adminRecord) return adminRecord;
      }
      return getSelectedTopbarFloorplanRecord();
    }

    function setExportExcelBusy(busy) {
      [exportExcelCurrent, exportExcelSelect, exportExcelConfirm].forEach(button => {
        if (button) button.disabled = busy;
      });
    }

    function setExportExcelError(message) {
      if (exportExcelError) exportExcelError.textContent = message || '';
    }

    function hideExportExcelDialog() {
      exportExcelBaseRecord = null;
      if (exportExcelSelection) exportExcelSelection.hidden = true;
      setExportExcelError('');
      exportExcelDialog.hide();
    }

    async function ensureAdminOverviewForExport() {
      if (adminDashboardState.data) return adminDashboardState.data;
      const data = await FD.DataService.fetchAdminOverview(CONFIG, {
        diagnostics: {
          purpose: 'admin_export_excel',
        },
      });
      adminDashboardState.data = data;
      adminDashboardState.lastUpdatedAt = new Date().toISOString();
      return data;
    }

    function findExportFloorplanRecord(record, data = getAdminData()) {
      if (!record) return null;
      const key = adminFloorplanKey(record);
      const floorplans = data.floorplans || [];
      return floorplans.find(item => adminFloorplanKey(item) === key) ||
        floorplans.find(item => (
          item?.customer === record.customer &&
          (item?.repo === 'uploads' ? 'uploads' : 'gallery') === (record.repo === 'uploads' ? 'uploads' : 'gallery') &&
          item?.file === record.file
        )) ||
        floorplans.find(item => (
          item?.customer === record.customer &&
          (
            (item?.displayName || item?.name || '') === (record.displayName || record.name || '') ||
            (item?.name || item?.floorplan || '') === (record.name || record.floorplan || '')
          )
        )) ||
        null;
    }

    function exportFloorplansForExcel(floorplans) {
      const selectedFloorplans = (Array.isArray(floorplans) ? floorplans : []).filter(Boolean);
      if (!selectedFloorplans.length) {
        setExportExcelError('Selecteer minimaal een plattegrond.');
        return;
      }
      const result = FD.ExportService.downloadDoorcodeWorkbook({
        floorplans: selectedFloorplans,
        doors: getAdminData().doors || [],
        documentEl: document,
      });
      hideExportExcelDialog();
      showToast(`Excel export gemaakt: ${result.filename}`, 'success');
    }

    function renderExportFloorplanChoices() {
      if (!exportExcelList) return;
      exportExcelList.innerHTML = '';
      const data = getAdminData();
      const base = findExportFloorplanRecord(exportExcelBaseRecord, data);
      if (!base) {
        setExportExcelError('Deze plattegrond staat niet in de exportdata.');
        return;
      }
      const sameCustomer = (data.floorplans || [])
        .filter(record => record.customer === base.customer)
        .sort((left, right) => ADMIN_COLLATOR.compare(
          left.displayName || left.name || '',
          right.displayName || right.name || ''
        ));
      if (!sameCustomer.length) {
        setExportExcelError('Geen plattegronden gevonden voor deze klant.');
        return;
      }

      sameCustomer.forEach(record => {
        const label = document.createElement('label');
        label.className = 'export-excel-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = adminFloorplanKey(record);
        input.checked = adminFloorplanKey(record) === adminFloorplanKey(base);
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = record.displayName || record.name || 'Plattegrond';
        const meta = document.createElement('span');
        meta.textContent = `${record.doorsTotal || 0} deurcode${Number(record.doorsTotal || 0) === 1 ? '' : 's'}`;
        text.append(name, meta);
        label.append(input, text);
        exportExcelList.appendChild(label);
      });
    }

    async function openExportExcelDialog() {
      hideTopbarMenu();
      if (!canUseExcelExport()) return;
      if (!appMode.isInteractiveView()) {
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      const base = getExportBaseRecord();
      if (!base) {
        showToast('Kies eerst een plattegrond', 'error');
        return;
      }
      if (isTestCustomerName(base.customer)) {
        showToast('Excel export is niet beschikbaar voor de testklant', 'error');
        return;
      }
      exportExcelBaseRecord = base;
      if (exportExcelContext) {
        exportExcelContext.textContent = `${base.customer} · ${base.displayName || base.name || 'Plattegrond'}`;
      }
      if (exportExcelSelection) exportExcelSelection.hidden = true;
      setExportExcelError('Exportdata laden...');
      setExportExcelBusy(true);
      exportExcelDialog.show();
      try {
        await ensureAdminOverviewForExport();
        setExportExcelError('');
      } catch (err) {
        setExportExcelError('Exportdata laden mislukt.');
        console.warn('Excel exportdata laden mislukt:', err);
      } finally {
        setExportExcelBusy(false);
      }
    }

    function exportCurrentFloorplan() {
      const record = findExportFloorplanRecord(exportExcelBaseRecord);
      if (!record) {
        setExportExcelError('Deze plattegrond staat niet in de exportdata.');
        return;
      }
      exportFloorplansForExcel([record]);
    }

    function showExportFloorplanSelection() {
      if (exportExcelSelection) exportExcelSelection.hidden = false;
      setExportExcelError('');
      renderExportFloorplanChoices();
    }

    function exportSelectedFloorplans() {
      const selectedKeys = Array.from(exportExcelList?.querySelectorAll('input[type="checkbox"]:checked') || [])
        .map(input => input.value);
      const selectedSet = new Set(selectedKeys);
      const base = findExportFloorplanRecord(exportExcelBaseRecord);
      const selected = (getAdminData().floorplans || [])
        .filter(record => record.customer === base?.customer && selectedSet.has(adminFloorplanKey(record)));
      exportFloorplansForExcel(selected);
    }

    function printFloorplanTitle() {
      const record = getSelectedTopbarFloorplanRecord();
      return [
        record?.customer || currentCustomer,
        record?.displayName || record?.name || currentFloorplan,
      ].filter(Boolean).join(' - ') || 'Plattegrond';
    }

    function ensurePrintFloorplanRoot() {
      let root = document.getElementById('print-floorplan-root');
      if (root) return root;
      root = document.createElement('div');
      root.id = 'print-floorplan-root';
      root.className = 'print-floorplan-root';
      document.body.appendChild(root);
      return root;
    }

    function cleanPrintFilename(value) {
      return String(value || 'Plattegrond')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Plattegrond';
    }

    function appendPrintLabels(svgEl) {
      if (!svgEl || !showLabels) return;
      const ns = 'http://www.w3.org/2000/svg';
      const labelScale = savedScale || scale || 1;
      const labels = FD.MarkerService.labelPlacements(svgEl.querySelectorAll('[data-door-id]'), {
        scale: labelScale,
        activeDoorId: '',
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
      });
    }

    function cloneCurrentFloorplanForPrint() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return null;
      const printSvg = svgEl.cloneNode(true);
      printSvg.querySelectorAll('[data-fd-label]').forEach(el => el.remove());
      printSvg.querySelectorAll('[data-fd-pending-marker]').forEach(el => el.remove());
      printSvg.querySelectorAll('[data-door-id]').forEach(marker => applyPrintDoorMarkerStyle(marker));
      printSvg.removeAttribute('width');
      printSvg.removeAttribute('height');
      printSvg.removeAttribute('transform');
      printSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      printSvg.style.position = 'static';
      printSvg.style.top = '';
      printSvg.style.left = '';
      printSvg.style.transform = 'none';
      printSvg.style.transformOrigin = '50% 50%';
      printSvg.style.width = '100%';
      printSvg.style.height = 'auto';
      printSvg.style.maxWidth = '100%';
      printSvg.style.maxHeight = '100%';
      printSvg.style.userSelect = 'none';
      appendPrintLabels(printSvg);
      return printSvg;
    }

    function renderPrintFloorplan() {
      const printSvg = cloneCurrentFloorplanForPrint();
      if (!printSvg) return null;
      const title = printFloorplanTitle();
      const root = ensurePrintFloorplanRoot();
      root.innerHTML = '';

      const pageEl = document.createElement('section');
      pageEl.className = 'print-floorplan-page';
      const titleEl = document.createElement('div');
      titleEl.className = 'print-floorplan-title';
      titleEl.textContent = title;
      const canvasEl = document.createElement('div');
      canvasEl.className = 'print-floorplan-canvas';
      canvasEl.appendChild(printSvg);
      pageEl.append(titleEl, canvasEl);
      root.appendChild(pageEl);

      return { root, title };
    }

    function printCurrentFloorplanToPdf() {
      if (!appMode.isInteractiveView()) {
        hideTopbarMenu();
        showToast('Sluit eerst het huidige scherm', 'error');
        return;
      }
      if (adminDashboardState.visible || !hasCurrentFloorplanView() || !topbarSelectionMatchesCurrentFloorplan()) {
        hideTopbarMenu();
        showToast('Kies eerst een plattegrond', 'error');
        return;
      }

      const rendered = renderPrintFloorplan();
      if (!rendered) {
        hideTopbarMenu();
        showToast('Geen plattegrond gevonden om te printen', 'error');
        return;
      }

      hideTopbarMenu();
      const previousTitle = document.title;
      const printTitle = cleanPrintFilename(rendered.title);
      document.title = printTitle;

      let cleanupTimer = null;
      const cleanup = () => {
        window.removeEventListener('afterprint', cleanup);
        if (cleanupTimer) clearTimeout(cleanupTimer);
        if (document.title === printTitle) document.title = previousTitle;
        rendered.root.innerHTML = '';
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 60000);

      requestAnimationFrame(() => {
        try {
          window.print();
        } catch (err) {
          cleanup();
          showToast('Printen mislukt', 'error');
        }
      });
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
        locationGroupInput: document.getElementById('upload-location-group'),
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
        pdfLocationGroupInput: document.getElementById('upload-pdf-location-group'),
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
	          locationGroup: form.locationGroup || '',
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
    const metadataLocationGroupInput = document.getElementById('metadata-location-group');
    const metadataBuildingInput = document.getElementById('metadata-building-name');
    const metadataFloorLabelInput = document.getElementById('metadata-floor-label');
    const metadataLocationAddressInput = document.getElementById('metadata-location-address');
    const metadataLocationNoteInput = document.getElementById('metadata-location-note');
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
      const locationDetails = getFloorplanLocationDetails(customer, floorplan);
      if (metadataLocationGroupInput) metadataLocationGroupInput.value = parts.locationGroup || floorplanGroupName(floorplan);
      metadataBuildingInput.value = parts.building;
      metadataFloorLabelInput.value = parts.floorLabel || floorplan.name || '';
      if (metadataLocationAddressInput) metadataLocationAddressInput.value = locationDetails?.address || '';
      if (metadataLocationNoteInput) metadataLocationNoteInput.value = locationDetails?.note || '';
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
      const locationGroup = metadataLocationGroupInput?.value.trim() || '';
      const buildingName = metadataBuildingInput.value.trim();
      const locationAddress = metadataLocationAddressInput?.value.trim() || '';
      const locationNote = metadataLocationNoteInput?.value.trim() || '';
      if (!floorLabel) {
        metadataFpError.textContent = 'Vul een verdieping of naam in.';
        return;
      }
      if ((locationAddress || locationNote) && !buildingName) {
        metadataFpError.textContent = 'Vul een pand in om adresgegevens te bewaren.';
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
          locationGroup,
          buildingName,
          floorLabel,
          locationAddress,
          locationNote,
        });
        assertLocationDetailsPersisted(currentCustomers, customer.customer, buildingName, locationAddress, locationNote, locationGroup);
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
        metadataFpError.textContent = metadataSaveErrorText(
          err,
          'Deze zichtbare naam bestaat al bij deze klant.',
        );
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

        Object.entries(btnJotforms).forEach(([formType, button]) => {
          button?.addEventListener('click', () => openJotForm(formType));
        });
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
    btnPrintFloorplan?.addEventListener('click', printCurrentFloorplanToPdf);
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
      tokenKey: envStorageKey('fd_auth_token'),
      tokenTimeKey: envStorageKey('fd_auth_time'),
      lockoutKey: envStorageKey('fd_lockout'),
      attemptsKey: envStorageKey('fd_attempts'),
      rememberSessionKey: envStorageKey('fd_remember_session'),
      legacyRememberKey: 'fd_remember_pw',
      savedPasswordKey: envStorageKey('fd_saved_password'),
      workerSessionTokenKey: CONFIG.workerSessionTokenKey,
      workerSessionExpiresKey: CONFIG.workerSessionExpiresKey,
      workerSessionUserKey: CONFIG.workerSessionUserKey,
      lastUsernameKey: envStorageKey('fd_login_username'),
      allowLegacyMigration: CONFIG.environment !== 'staging',
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
    adminKpiButtons.forEach(button => {
      button.addEventListener('click', () => {
        const metric = button.dataset.adminKpi || 'attention';
        if (!ADMIN_OVERVIEW_METRICS[metric]) return;
        adminDashboardState.overviewMetric = metric;
        renderAdminDashboard();
      });
    });
    adminDashboardRefresh?.addEventListener('click', () => loadAdminDashboard({ force: true }));
    adminBulkToggle?.addEventListener('click', () => setAdminBulkMode(true));
    adminBulkSelectVisible?.addEventListener('click', selectVisibleAdminBulkFloorplans);
    adminBulkClear?.addEventListener('click', clearAdminBulkSelection);
    adminBulkGroup?.addEventListener('click', openAdminBulkGroupDialog);
    adminBulkCancel?.addEventListener('click', () => setAdminBulkMode(false));
    adminBulkGroupSave?.addEventListener('click', saveAdminBulkGroup);
    adminBulkGroupCancel?.addEventListener('click', hideAdminBulkGroupDialog);
    adminBulkGroupClose?.addEventListener('click', hideAdminBulkGroupDialog);
    adminBulkGroupDialogOverlay?.addEventListener('click', hideAdminBulkGroupDialog);
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
    btnMenuMarkerOutline?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMarkerOutlineMode();
    });
    btnExportExcel?.addEventListener('click', (e) => {
      e.stopPropagation();
      openExportExcelDialog();
    });
    exportExcelClose?.addEventListener('click', hideExportExcelDialog);
    exportExcelOverlay?.addEventListener('click', hideExportExcelDialog);
    exportExcelCurrent?.addEventListener('click', exportCurrentFloorplan);
    exportExcelSelect?.addEventListener('click', showExportFloorplanSelection);
    exportExcelConfirm?.addEventListener('click', exportSelectedFloorplans);

    const authController = FD.AuthService.createAuthController({
      loginConfig: LOGIN_CONFIG,
      appConfig: CONFIG,
      elements: {
        splashScreen: document.getElementById('splash-screen'),
        loginScreen: document.getElementById('login-screen'),
        appContainer,
        usernameInput: document.getElementById('login-username'),
        passwordInput: document.getElementById('login-password'),
        passwordToggleButton: document.getElementById('login-password-toggle'),
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
      updateMarkerOutlineMenuButton();
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
      updateRoleActionButtons();
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

	    function formatEditorSaveSize(length) {
	      const value = Number(length || 0);
	      if (!Number.isFinite(value) || value <= 0) return 'onbekend';
	      return `${value.toLocaleString('nl-NL')} tekens`;
	    }

	    function imageEditorSaveUserMessage(err) {
	      const code = String(err?.code || '').toLowerCase();
	      const status = Number(err?.status || 0);
	      if (code === 'image_editor_too_large' || code === 'invalid_svg' || code === 'invalid_request_body' || status === 413 || status === 400) {
	        return 'Deze plattegrond is te groot om op te slaan. Probeer een iets kleinere uitsnede of meld dit bij Mark.';
	      }
	      return 'Deze plattegrond kon niet worden opgeslagen. Probeer het opnieuw of meld dit bij Mark.';
	    }

	    function buildImageEditorSaveErrorDetails(err, {
	      fp,
	      plan,
	      imageResult,
	      svgText,
	    } = {}) {
	      const lines = [
	        `Klant: ${currentCustomer || '-'}`,
	        `Plattegrond: ${currentFloorplan || '-'}`,
	        `Bestand: ${fp?.file || '-'}`,
	        `Repo: ${fp?.repo || 'uploads'}`,
	        `Geschatte JPEG-grootte: ${formatEditorSaveSize(err?.estimatedLength || imageResult?.dataUrl?.length)}`,
	        `SVG-grootte: ${formatEditorSaveSize(svgText?.length)}`,
	        `Limiet JPEG: ${formatEditorSaveSize(err?.maxLength || FD.ImageEditorService?.MAX_IMAGE_EDITOR_DATA_URL_LENGTH)}`,
	        `Uitsnede: ${Math.round(plan?.cropW || 0)} x ${Math.round(plan?.cropH || 0)}`,
	        `Output: ${imageResult?.width || err?.width || '-'} x ${imageResult?.height || err?.height || '-'}`,
	        `Schaal: ${imageResult?.scale || err?.scale || '-'}`,
	        `Kwaliteit: ${imageResult?.quality || err?.quality || '-'}`,
	        `Poginglimiet: ${formatEditorSaveSize(imageResult?.maxLength || err?.maxLength)}`,
	        `Pogingen: ${imageResult?.attempt || err?.attempt || '-'}`,
	        `Foutcode: ${err?.code || err?.message || 'unknown'}`,
	        `HTTP-status: ${err?.status || '-'}`,
	        `Appversie: ${APP_VERSION}`,
	      ];
	      return lines.join('\n');
	    }

	    function showImageEditorSaveError(err, context = {}) {
	      imageEditorSaveErrorDetailsText = buildImageEditorSaveErrorDetails(err, context);
	      if (imageEditorSaveErrorMessage) {
	        imageEditorSaveErrorMessage.textContent = imageEditorSaveUserMessage(err);
	      }
	      if (imageEditorSaveErrorDetails) {
	        imageEditorSaveErrorDetails.textContent = imageEditorSaveErrorDetailsText;
	      }
	      imageEditorSaveErrorDialog.show();
	    }

	    function hideImageEditorSaveError() {
	      imageEditorSaveErrorDialog.hide();
	    }

	    async function copyImageEditorSaveErrorDetails() {
	      if (!imageEditorSaveErrorDetailsText) return;
	      try {
	        if (navigator.clipboard?.writeText) {
	          await navigator.clipboard.writeText(imageEditorSaveErrorDetailsText);
	        } else {
	          const textarea = document.createElement('textarea');
	          textarea.value = imageEditorSaveErrorDetailsText;
	          textarea.setAttribute('readonly', 'readonly');
	          textarea.style.position = 'fixed';
	          textarea.style.left = '-9999px';
	          document.body.appendChild(textarea);
	          textarea.select();
	          document.execCommand('copy');
	          textarea.remove();
	        }
	        showToast('Details gekopieerd', 'success');
	      } catch {
	        showToast('Kopiëren lukt niet', 'error');
	      }
	    }

	    function isRetryableEditorSaveSizeError(err) {
	      const code = String(err?.code || '').toLowerCase();
	      const status = Number(err?.status || 0);
	      return code === 'invalid_request_body' ||
	        code === 'invalid_svg' ||
	        code === 'image_editor_too_large' ||
	        status === 413 ||
	        status === 400;
	    }

	    function buildEditorSaveSVG({ imageDataUrl, rotatedPlan, plan }) {
	      return rotatedPlan ? buildRotatedEditorSVGText({
	        imageDataUrl,
	        plan: rotatedPlan,
	      }) : FD.ImageEditorService.buildCroppedSVGText({
	        svgEl: editorCropContext.svgEl,
	        imageDataUrl,
	        plan,
	        markerService: FD.MarkerService,
	      });
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

	      let imageResult = null;
	      let svgTextForSave = '';
	      try {
	        const outputCanvas = editorCropper.getCroppedCanvas({
	          width: Math.max(1, Math.round(plan.cropW)),
	          height: Math.max(1, Math.round(plan.cropH)),
	          fillColor: '#fff',
	          imageSmoothingEnabled: true,
	          imageSmoothingQuality: 'high',
	        });
	        const fileUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fp.file);
	        const saveTargets = [
	          FD.ImageEditorService.MAX_IMAGE_EDITOR_DATA_URL_LENGTH || 1560000,
	          1120000,
	          1040000,
	          900000,
	        ];
	        let updateResult = null;
	        let lastSaveError = null;
	        for (let attempt = 0; attempt < saveTargets.length; attempt += 1) {
	          const maxLength = saveTargets[attempt];
	          imageResult = {
	            ...FD.ImageEditorService.canvasToLimitedJPEGResult(outputCanvas, { maxLength }),
	            maxLength,
	            attempt: attempt + 1,
	          };
	          svgTextForSave = buildEditorSaveSVG({
	            imageDataUrl: imageResult.dataUrl,
	            rotatedPlan,
	            plan,
	          });
	          try {
	            updateResult = await FD.DataService.saveFloorplanSVG(fileUrl, svgTextForSave, {
	              config: CONFIG,
	              customerName: currentCustomer,
	              floorplanName: currentFloorplan,
	              message: 'Afbeelding bewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
	              fetchErrorMessage: 'Kon bestand niet ophalen ({status})',
	              saveErrorMessage: 'Opslaan mislukt ({status})',
	            });
	            lastSaveError = null;
	            break;
	          } catch (err) {
	            lastSaveError = err;
	            if (attempt >= saveTargets.length - 1 || !isRetryableEditorSaveSizeError(err)) throw err;
	            busyOverlay.update({
	              title: 'Afbeelding verkleinen',
	              subtitle: 'Bestand is te groot voor opslaan; kleinere versie wordt geprobeerd...',
	            });
	          }
	        }
	        if (!updateResult) throw lastSaveError || new Error('Opslaan mislukt');
	        await updateCachedSVGAfterSave(fileUrl, updateResult, svgTextForSave);

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
	        editorSaving = false;
	        if (appMode.is(AppModes.IMAGE_EDITOR_SAVING)) appMode.enter(AppModes.IMAGE_EDITOR);
	        btnSave.disabled = false;
	        btnSave.textContent = '\uD83D\uDCBE Opslaan';
	        busyOverlay.hide();
	        showImageEditorSaveError(duplicateMessage ? new Error(duplicateMessage) : err, {
	          fp,
	          plan,
	          imageResult,
	          svgText: svgTextForSave,
	        });
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
	    imageEditorSaveErrorClose?.addEventListener('click', hideImageEditorSaveError);
	    imageEditorSaveErrorOverlay?.addEventListener('click', hideImageEditorSaveError);
	    imageEditorSaveErrorCopy?.addEventListener('click', copyImageEditorSaveErrorDetails);

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

    verifyExpectedAppUpdateAfterReload();
    startAppUpdateChecks();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(reg => {
          serviceWorkerRegistration = reg;
          reg.onupdatefound = () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.onstatechange = () => {
              if (installing.state === 'activated' && navigator.serviceWorker.controller) checkForAppUpdate();
            };
          };
        })
        .catch(err => console.warn('SW registration failed:', err));
    }
