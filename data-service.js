(function (global) {
  const FD = global.FD = global.FD || {};
  const CUSTOMER_WIDE_FLOORPLAN_PERMISSION = '*';

  function workerOnlyError(code) {
    const error = new Error(code || 'worker_route_required');
    error.status = 503;
    return error;
  }

  function getWorkerApiBaseUrl(config) {
    return String(config?.workerApiBaseUrl || '').replace(/\/+$/, '');
  }

  function readUrlFlag(paramName) {
    const params = new URLSearchParams(global.location?.search || '');
    const value = params.get(paramName);
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  }

  function readLocalFlag(key) {
    return global.localStorage?.getItem(key) === '1';
  }

  function isWorkerReadProxyEnabled(config) {
    if (!getWorkerApiBaseUrl(config)) return false;

    try {
      const flagKey = config?.workerReadProxyFlagKey || 'fd_use_worker_read_proxy';
      const paramValue = readUrlFlag('fd_worker_read_proxy');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(flagKey)) return true;
      return config?.workerReadProxyEnabled === true;
    } catch {
      return config?.workerReadProxyEnabled === true;
    }
  }

  function isWorkerStatusWriteEnabled(config) {
    if (!getWorkerApiBaseUrl(config)) return false;

    try {
      const flagKey = config?.workerStatusWriteFlagKey || 'fd_use_worker_status_write';
      const paramValue = readUrlFlag('fd_worker_status_write');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(flagKey)) return true;
      return config?.workerStatusWriteEnabled === true;
    } catch {
      return config?.workerStatusWriteEnabled === true;
    }
  }

  function isWorkerSessionAuthEnabled(config) {
    if (!getWorkerApiBaseUrl(config)) return false;

    try {
      const flagKey = config?.workerSessionAuthFlagKey || 'fd_use_worker_auth';
      const paramValue = readUrlFlag('fd_worker_auth');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(flagKey)) return true;
      return config?.workerSessionAuthEnabled === true;
    } catch {
      return config?.workerSessionAuthEnabled === true;
    }
  }

  function isWorkerFloorplanWriteEnabled(config) {
    if (!getWorkerApiBaseUrl(config)) return false;

    try {
      const flagKey = config?.workerFloorplanWriteFlagKey || 'fd_use_worker_floorplan_write';
      const paramValue = readUrlFlag('fd_worker_floorplan_write');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(flagKey)) return true;
      return config?.workerFloorplanWriteEnabled === true;
    } catch {
      return config?.workerFloorplanWriteEnabled === true;
    }
  }

  function isWorkerUploadWriteEnabled(config) {
    if (!getWorkerApiBaseUrl(config)) return false;

    try {
      const flagKey = config?.workerUploadWriteFlagKey || 'fd_use_worker_upload_write';
      const paramValue = readUrlFlag('fd_worker_upload_write');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(flagKey)) return true;
      return config?.workerUploadWriteEnabled === true;
    } catch {
      return config?.workerUploadWriteEnabled === true;
    }
  }

  function isWorkerStatusReadEnabled(config) {
    return isWorkerReadProxyEnabled(config) || isWorkerStatusWriteEnabled(config);
  }

  function getWorkerSessionKeys(config) {
    return {
      tokenKey: config?.workerSessionTokenKey || 'fd_worker_session_token',
      expiresKey: config?.workerSessionExpiresKey || 'fd_worker_session_expires_at',
      userKey: config?.workerSessionUserKey || 'fd_worker_session_user',
    };
  }

  function readWorkerSessionFrom(storage, keys, storageType) {
    try {
      const token = storage?.getItem(keys.tokenKey) || '';
      const expiresAt = storage?.getItem(keys.expiresKey) || '';
      return { token, expiresAt, storageType };
    } catch {
      return { token: '', expiresAt: '', storageType };
    }
  }

  function isWorkerSessionFresh(expiresAt) {
    const expiresTime = Date.parse(expiresAt || '');
    return Number.isFinite(expiresTime) && expiresTime > Date.now() + 60000;
  }

  function getWorkerSession(config) {
    const keys = getWorkerSessionKeys(config);
    const localSession = readWorkerSessionFrom(global.localStorage, keys, 'local');
    const tabSession = readWorkerSessionFrom(global.sessionStorage, keys, 'session');

    if (localSession.token && isWorkerSessionFresh(localSession.expiresAt)) return localSession;
    if (tabSession.token && isWorkerSessionFresh(tabSession.expiresAt)) return tabSession;
    if (localSession.token) return localSession;
    if (tabSession.token) return tabSession;
    return { token: '', expiresAt: '', storageType: '' };
  }

  function getWorkerSessionToken(config) {
    return getWorkerSession(config).token;
  }

  function setWorkerSession(config, sessionData, options = {}) {
    const keys = getWorkerSessionKeys(config);
    const persistent = options.persistent !== false;
    const target = persistent ? global.localStorage : global.sessionStorage;
    const other = persistent ? global.sessionStorage : global.localStorage;

    try {
      other?.removeItem(keys.tokenKey);
      other?.removeItem(keys.expiresKey);
      other?.removeItem(keys.userKey);
      if (sessionData?.token) {
        target?.setItem(keys.tokenKey, sessionData.token);
      }
      if (sessionData?.expiresAt) {
        target?.setItem(keys.expiresKey, sessionData.expiresAt);
      }
      if (sessionData?.user) {
        target?.setItem(keys.userKey, JSON.stringify(sessionData.user));
      }
    } catch {}
  }

  function clearWorkerSession(config) {
    const keys = getWorkerSessionKeys(config);
    try {
      global.localStorage?.removeItem(keys.tokenKey);
      global.localStorage?.removeItem(keys.expiresKey);
      global.localStorage?.removeItem(keys.userKey);
      global.sessionStorage?.removeItem(keys.tokenKey);
      global.sessionStorage?.removeItem(keys.expiresKey);
      global.sessionStorage?.removeItem(keys.userKey);
    } catch {}
  }

  function getWorkerSessionUser(config) {
    const keys = getWorkerSessionKeys(config);
    const currentSession = getWorkerSession(config);
    if (!currentSession.token || !isWorkerSessionFresh(currentSession.expiresAt)) return null;
    const store = currentSession.storageType === 'session' ? global.sessionStorage : global.localStorage;
    try {
      const user = JSON.parse(store?.getItem(keys.userKey) || 'null');
      if (user && typeof user === 'object') return user;
    } catch {}
    return null;
  }

  function userHasFloorplanPermission(user, customer, floorplan) {
    const permissions = Array.isArray(user?.permissions?.floorplans)
      ? user.permissions.floorplans
      : [];
    return permissions.some(item =>
      item.customer === customer &&
      (item.floorplan === floorplan || item.floorplan === CUSTOMER_WIDE_FLOORPLAN_PERMISSION)
    );
  }

  function canManageUploads(config) {
    return getWorkerSessionUser(config)?.role === 'admin';
  }

  function canWriteFloorplan(config, customer, floorplan) {
    const user = getWorkerSessionUser(config);
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'monteur') return true;
    if (user.role === 'viewer') return userHasFloorplanPermission(user, customer, floorplan);
    return false;
  }

  function isViewerReadOnlyFloorplan(config, customer, floorplan) {
    const user = getWorkerSessionUser(config);
    return user?.role === 'viewer' && !userHasFloorplanPermission(user, customer, floorplan);
  }

  function workerUrl(config, path) {
    return getWorkerApiBaseUrl(config) + path;
  }

  function workerError(status, code) {
    const error = new Error(code || 'Worker request failed');
    error.status = status;
    return error;
  }

  function reportWorkerFailure(path, method, err, options) {
    const diagnostics = options?.diagnostics || {};
    if (diagnostics.suppress) return;

    try {
      FD.DiagnosticsService?.record?.({
        level: diagnostics.level || 'error',
        eventType: diagnostics.eventType || 'api_failure',
        message: err?.code || err?.message || 'Worker request failed',
        source: 'data-service',
        endpoint: path,
        status: err?.status || null,
        details: {
          method,
          purpose: diagnostics.purpose || '',
          background: diagnostics.background === true,
          errorName: err?.name || '',
        },
      });
    } catch {}
  }

  async function fetchWorkerJSON(config, path, options) {
    try {
      const response = await fetch(workerUrl(config, path), {
        cache: 'no-store',
        signal: options?.signal,
        headers: {
          ...(options?.headers || {}),
        },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok === false) {
        throw workerError(response.status, data?.error || 'worker_json_failed');
      }
      return data;
    } catch (err) {
      if (err?.name !== 'AbortError') reportWorkerFailure(path, 'GET', err, options);
      throw err;
    }
  }

  async function postWorkerJSON(config, path, data, options) {
    try {
      const response = await fetch(workerUrl(config, path), {
        method: 'POST',
        cache: 'no-store',
        signal: options?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        body: JSON.stringify(data),
      });
      const responseData = await response.json().catch(() => null);
      if (!response.ok || responseData?.ok === false) {
        throw workerError(response.status, responseData?.error || 'worker_post_failed');
      }
      return responseData;
    } catch (err) {
      if (err?.name !== 'AbortError') reportWorkerFailure(path, 'POST', err, options);
      throw err;
    }
  }

  async function putWorkerJSON(config, path, data, options) {
    try {
      const response = await fetch(workerUrl(config, path), {
        method: 'PUT',
        cache: 'no-store',
        signal: options?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        body: JSON.stringify(data),
      });
      const responseData = await response.json().catch(() => null);
      if (!response.ok || responseData?.ok === false) {
        throw workerError(response.status, responseData?.error || 'worker_put_failed');
      }
      return responseData;
    } catch (err) {
      if (err?.name !== 'AbortError') reportWorkerFailure(path, 'PUT', err, options);
      throw err;
    }
  }

  async function deleteWorkerJSON(config, path, data, options) {
    try {
      const response = await fetch(workerUrl(config, path), {
        method: 'DELETE',
        cache: 'no-store',
        signal: options?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {}),
        },
        body: JSON.stringify(data),
      });
      const responseData = await response.json().catch(() => null);
      if (!response.ok || responseData?.ok === false) {
        throw workerError(response.status, responseData?.error || 'worker_delete_failed');
      }
      return responseData;
    } catch (err) {
      if (err?.name !== 'AbortError') reportWorkerFailure(path, 'DELETE', err, options);
      throw err;
    }
  }

  function floorplanTargetFromContentsUrl(config, fileUrl) {
    const url = String(fileUrl || '');
    const mappings = [
      { prefix: config?.svgUploadsUrl, repo: 'uploads' },
      { prefix: config?.svgBaseUrl, repo: 'gallery' },
    ];

    for (const item of mappings) {
      if (!item.prefix || !url.startsWith(item.prefix)) continue;
      const encodedFile = url.slice(item.prefix.length);
      const file = decodeURIComponent(encodedFile);
      return { repo: item.repo, file };
    }

    return null;
  }

  function floorplanRouteFromContentsUrl(config, fileUrl) {
    const target = floorplanTargetFromContentsUrl(config, fileUrl);
    if (!target) return null;
    return `/api/floorplan?repo=${encodeURIComponent(target.repo)}&file=${encodeURIComponent(target.file)}`;
  }

  function getWorkerFloorplanUrl(config, fileUrl) {
    const route = floorplanRouteFromContentsUrl(config, fileUrl);
    return route ? workerUrl(config, route) : null;
  }

  async function fetchWorkerFloorplan(config, fileUrl, options) {
    const url = getWorkerFloorplanUrl(config, fileUrl);
    if (!url) return null;

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: options?.signal,
      });
      if (!response.ok) {
        throw workerError(response.status, 'worker_floorplan_failed');
      }
      return {
        text: await response.text(),
        sha: response.headers.get('X-FD-Sha') || '',
      };
    } catch (err) {
      if (err?.name !== 'AbortError') reportWorkerFailure(floorplanRouteFromContentsUrl(config, fileUrl) || '/api/floorplan', 'GET', err, options);
      throw err;
    }
  }

  function floorplanRepoKeyFromFullRepo(repo) {
    const normalized = String(repo || '').trim();
    if (normalized === 'uploads' || normalized === 'mlivvm/floorplan-uploads') return 'uploads';
    if (normalized === 'gallery' || normalized === 'mlivvm/gallery') return 'gallery';
    return null;
  }

  async function fetchWorkerFloorplanTreeMap(config, repo, options) {
    const repoKey = floorplanRepoKeyFromFullRepo(repo);
    if (!repoKey) return null;
    const data = await fetchWorkerJSON(
      config,
      `/api/floorplan-manifest?repo=${encodeURIComponent(repoKey)}`,
      options,
    );
    const files = data.files && typeof data.files === 'object' ? data.files : {};
    return new Map(Object.entries(files).filter(([, sha]) => typeof sha === 'string' && sha));
  }

  async function loadCustomers(config) {
    if (isWorkerReadProxyEnabled(config)) {
      const data = await fetchWorkerJSON(config, '/api/customers');
      return Array.isArray(data.customers) ? data.customers : [];
    }

    throw workerOnlyError('worker_read_required');
  }

  async function loadStatus(config) {
    if (isWorkerStatusReadEnabled(config)) {
      const data = await fetchWorkerJSON(config, '/api/status');
      return data.status && typeof data.status === 'object' ? data.status : {};
    }

    throw workerOnlyError('worker_status_read_required');
  }

  function canUseWorkerStatusWrite(config, operations) {
    return Array.isArray(operations) &&
      operations.length > 0;
  }

  async function saveStatus(config, statusData, messageCustomer, options = {}) {
    if (isWorkerStatusWriteEnabled(config) && canUseWorkerStatusWrite(config, options.operations)) {
      const token = getWorkerSessionToken(config);
      if (!token) {
        throw workerError(401, 'worker_session_required');
      }
      return putWorkerJSON(config, '/api/status', {
        operations: options.operations,
      }, {
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    throw workerOnlyError('worker_status_write_required');
  }

  async function loadFloorplanSVG(fileUrl, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const floorplan = await fetchWorkerFloorplan(options.config, fileUrl, options);
      if (floorplan) return floorplan.text;
    }

    throw workerOnlyError('worker_floorplan_read_required');
  }

  async function revalidateFloorplanSVG(fileUrl, cachedSha, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const floorplan = await fetchWorkerFloorplan(options.config, fileUrl, options);
      if (floorplan) {
        if (floorplan.sha && floorplan.sha === cachedSha) return null;
        return floorplan.text;
      }
    }

    throw workerOnlyError('worker_floorplan_read_required');
  }

  async function warmFloorplanSVG(fileUrl, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const floorplan = await fetchWorkerFloorplan(options.config, fileUrl, {
        ...options,
        diagnostics: {
          suppress: true,
          purpose: 'offline_cache_warmup',
          background: true,
        },
      });
      if (floorplan) return floorplan;
    }

    throw workerOnlyError('worker_floorplan_read_required');
  }

  async function saveFloorplanSVG(fileUrl, svgText, options, legacyErrorMessage) {
    const saveOptions = typeof options === 'string'
      ? { message: options, saveErrorMessage: legacyErrorMessage }
      : (options || {});

    const config = saveOptions.config;
    if (config && isWorkerFloorplanWriteEnabled(config)) {
      const target = floorplanTargetFromContentsUrl(config, fileUrl);
      const token = getWorkerSessionToken(config);
      if (!target || !saveOptions.customerName || !saveOptions.floorplanName) {
        throw workerError(400, 'worker_floorplan_target_required');
      }
      if (!token) {
        throw workerError(401, 'worker_session_required');
      }
      return putWorkerJSON(config, '/api/floorplan', {
        repo: target.repo,
        file: target.file,
        customer: saveOptions.customerName,
        floorplan: saveOptions.floorplanName,
        svgText,
      }, {
        signal: saveOptions.signal,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    throw workerOnlyError('worker_floorplan_write_required');
  }

  function uploadedFloorplanUrl(config, fileName) {
    return config.svgUploadsUrl + encodeURIComponent(fileName);
  }

  async function addUploadedFloorplan(config, options) {
    const {
      customerName,
      floorplanName,
      fileName,
      svgText,
      isNewCustomer,
    } = options;

    const uploadUrl = uploadedFloorplanUrl(config, fileName);
    if (isWorkerUploadWriteEnabled(config)) {
      const token = getWorkerSessionToken(config);
      if (!token) throw workerError(401, 'worker_session_required');
      const data = await postWorkerJSON(config, '/api/uploaded-floorplan', {
        customerName,
        floorplanName,
        fileName,
        svgText,
        isNewCustomer,
      }, {
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return {
        customers: Array.isArray(data.customers) ? data.customers : [],
        entry: data.entry,
        uploadUrl,
      };
    }

    throw workerOnlyError('worker_upload_write_required');
  }

  async function deleteUploadedFloorplan(config, options) {
    const { customerName, floorplan } = options;
    const fp = floorplan;

    if (isWorkerUploadWriteEnabled(config)) {
      const token = getWorkerSessionToken(config);
      if (!token) throw workerError(401, 'worker_session_required');
      const data = await deleteWorkerJSON(config, '/api/uploaded-floorplan', {
        customerName,
        floorplanName: fp.name,
        fileName: fp.file,
      }, {
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return { customers: Array.isArray(data.customers) ? data.customers : [] };
    }

    throw workerOnlyError('worker_upload_write_required');
  }

  async function fetchFloorplanTreeMap(repo, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const workerTreeMap = await fetchWorkerFloorplanTreeMap(options.config, repo, options);
      if (workerTreeMap) return workerTreeMap;
    }

    throw workerOnlyError('worker_floorplan_manifest_required');
  }

  async function loginWorkerSession(config, username, password, options) {
    let resolvedUsername = username;
    let resolvedPassword = password;
    let resolvedOptions = options;
    if (typeof password === 'object' && options === undefined) {
      resolvedOptions = password;
      resolvedPassword = username;
      resolvedUsername = 'admin';
    }
    const sessionData = await postWorkerJSON(config, '/api/session/login', {
      username: resolvedUsername || 'admin',
      password: resolvedPassword,
    }, resolvedOptions);
    setWorkerSession(config, sessionData, { persistent: resolvedOptions?.persistent !== false });
    return sessionData;
  }

  async function renewWorkerSession(config, options = {}) {
    const currentSession = getWorkerSession(config);
    const token = currentSession.token;
    if (!token) throw workerError(401, 'worker_session_required');

    const persistent = typeof options.persistent === 'boolean'
      ? options.persistent
      : currentSession.storageType !== 'session';
    const sessionData = await postWorkerJSON(config, '/api/session/renew', {}, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    setWorkerSession(config, sessionData, { persistent });
    return sessionData;
  }

  async function refreshWorkerSessionUser(config, options = {}) {
    const currentSession = getWorkerSession(config);
    const token = currentSession.token;
    if (!token) throw workerError(401, 'worker_session_required');

    const persistent = currentSession.storageType !== 'session';
    const sessionData = await fetchWorkerJSON(config, '/api/session/me', {
      ...options,
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    setWorkerSession(config, {
      token,
      expiresAt: sessionData.expiresAt || currentSession.expiresAt,
      user: sessionData.user,
    }, { persistent });
    return sessionData;
  }

  async function createJotFormContext(config, target, options = {}) {
    const token = getWorkerSessionToken(config);
    if (!token) throw workerError(401, 'worker_session_required');
    return postWorkerJSON(config, '/api/jotform-context', target, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async function findJotFormSubmission(config, target, options = {}) {
    const token = getWorkerSessionToken(config);
    if (!token) throw workerError(401, 'worker_session_required');
    const params = new URLSearchParams({
      customer: target.customer || '',
      floorplan: target.floorplan || '',
      repo: target.repo || 'gallery',
      file: target.file || '',
      doorId: target.doorId || '',
    });
    return fetchWorkerJSON(config, `/api/jotform-submission?${params.toString()}`, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  FD.DataService = {
    canManageUploads,
    canWriteFloorplan,
    clearWorkerSession,
    createJotFormContext,
    findJotFormSubmission,
    getWorkerSessionUser,
    isViewerReadOnlyFloorplan,
    loadCustomers,
    loadStatus,
    saveStatus,
    loadFloorplanSVG,
    revalidateFloorplanSVG,
    warmFloorplanSVG,
    saveFloorplanSVG,
    addUploadedFloorplan,
    deleteUploadedFloorplan,
    fetchFloorplanTreeMap,
    getWorkerFloorplanUrl,
    isWorkerReadProxyEnabled,
    isWorkerFloorplanWriteEnabled,
    isWorkerUploadWriteEnabled,
    isWorkerStatusReadEnabled,
    isWorkerSessionAuthEnabled,
    isWorkerStatusWriteEnabled,
    loginWorkerSession,
    refreshWorkerSessionUser,
    renewWorkerSession,
  };
})(window);
