(function (global) {
  const FD = global.FD = global.FD || {};
  const location = global.location || {};
  const hostname = String(location.hostname || '');
  const pathname = String(location.pathname || '');
  const isGitHubPages = hostname === 'mlivvm.github.io';
  const isStagingPath = /\/floorplan-dashboard-staging(?:\/|$)/.test(pathname);
  const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1';

      const LIVE_WORKER = 'https://floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev';
      const STAGING_WORKER = 'https://floorplan-dashboard-api-staging.mko-floorplan-dashboard.workers.dev';
      const jotformForms = {
        maintenance: { label: 'Onderhoud', formId: '250122093908351' },
        inspection: { label: 'Opname', formId: '243196137549364' },
      };

  const liveConfig = {
    environment: 'live',
    storagePrefix: 'fd_live_',
    cachePrefix: 'fd-live-v',
    workerApiBaseUrl: LIVE_WORKER,
        workerApiHostname: 'floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev',
        jotformMode: 'live',
        jotformFormId: '250122093908351',
        jotformForms,
        loginEmailNotificationsEnabled: true,
      };

  const stagingConfig = {
    environment: 'staging',
    storagePrefix: 'fd_staging_',
    cachePrefix: 'fd-staging-v',
    workerApiBaseUrl: STAGING_WORKER,
        workerApiHostname: 'floorplan-dashboard-api-staging.mko-floorplan-dashboard.workers.dev',
        jotformMode: 'shared-form-limited',
        jotformFormId: '250122093908351',
        jotformForms,
        loginEmailNotificationsEnabled: false,
      };

  const localConfig = {
    ...liveConfig,
    environment: 'local',
    storagePrefix: '',
  };

  const defaults = isGitHubPages
    ? (isStagingPath ? stagingConfig : liveConfig)
    : (isLocalHost ? localConfig : liveConfig);
  const existing = global.FD_ENV_CONFIG && typeof global.FD_ENV_CONFIG === 'object'
    ? global.FD_ENV_CONFIG
    : {};
  const config = {
    ...defaults,
    ...existing,
  };

  function storageKey(key) {
    const text = String(key || '');
    const prefix = String(config.storagePrefix || '');
    if (!prefix || !text) return text;
    if (text.startsWith(prefix)) return text;
    if (text.startsWith('fd_')) return `${prefix}${text.slice(3)}`;
    return `${prefix}${text}`;
  }

  function cacheNameForVersion(version) {
    const value = String(version || '').trim();
    if (!value) return '';
    return `${String(config.cachePrefix || 'fd-v')}${value}`;
  }

  function cacheVersionToVersion(cacheName) {
    const match = String(cacheName || '').match(/^fd(?:-[a-z0-9-]+)?-v(\d+\.\d+\.\d+)$/i);
    return match ? match[1] : '';
  }

  config.storageKey = storageKey;
  config.cacheNameForVersion = cacheNameForVersion;
  config.cacheVersionToVersion = cacheVersionToVersion;

  global.FD_ENV_CONFIG = config;
  FD.Env = {
    config,
    storageKey,
    cacheNameForVersion,
    cacheVersionToVersion,
  };
})(typeof self !== 'undefined' ? self : window);
