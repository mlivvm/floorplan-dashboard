(function (global) {
  const FD = global.FD = global.FD || {};
  const Repository = FD.Repository;

  function requireRepository() {
    if (!Repository) throw new Error('FD.Repository ontbreekt');
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
      const disableFlagKey = config?.workerReadProxyDisableFlagKey || 'fd_disable_worker_read_proxy';
      const paramValue = readUrlFlag('fd_worker_read_proxy');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(disableFlagKey)) return false;
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
      const disableFlagKey = config?.workerStatusWriteDisableFlagKey || 'fd_disable_worker_status_write';
      const paramValue = readUrlFlag('fd_worker_status_write');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(disableFlagKey)) return false;
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
      const disableFlagKey = config?.workerSessionAuthDisableFlagKey || 'fd_disable_worker_auth';
      const paramValue = readUrlFlag('fd_worker_auth');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(disableFlagKey)) return false;
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
      const disableFlagKey = config?.workerFloorplanWriteDisableFlagKey || 'fd_disable_worker_floorplan_write';
      const paramValue = readUrlFlag('fd_worker_floorplan_write');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(disableFlagKey)) return false;
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
      const disableFlagKey = config?.workerUploadWriteDisableFlagKey || 'fd_disable_worker_upload_write';
      const paramValue = readUrlFlag('fd_worker_upload_write');
      if (paramValue !== null) return paramValue;
      if (readLocalFlag(disableFlagKey)) return false;
      if (readLocalFlag(flagKey)) return true;
      return config?.workerUploadWriteEnabled === true;
    } catch {
      return config?.workerUploadWriteEnabled === true;
    }
  }

  function isWorkerStatusReadEnabled(config) {
    return isWorkerReadProxyEnabled(config) || isWorkerStatusWriteEnabled(config);
  }

  function getWorkerSessionToken(config) {
    try {
      return global.localStorage?.getItem(config?.workerSessionTokenKey || 'fd_worker_session_token') || '';
    } catch {
      return '';
    }
  }

  function setWorkerSession(config, sessionData) {
    try {
      if (sessionData?.token) {
        global.localStorage?.setItem(config?.workerSessionTokenKey || 'fd_worker_session_token', sessionData.token);
      }
      if (sessionData?.expiresAt) {
        global.localStorage?.setItem(config?.workerSessionExpiresKey || 'fd_worker_session_expires_at', sessionData.expiresAt);
      }
    } catch {}
  }

  function clearWorkerSession(config) {
    try {
      global.localStorage?.removeItem(config?.workerSessionTokenKey || 'fd_worker_session_token');
      global.localStorage?.removeItem(config?.workerSessionExpiresKey || 'fd_worker_session_expires_at');
    } catch {}
  }

  function workerUrl(config, path) {
    return getWorkerApiBaseUrl(config) + path;
  }

  function workerError(status, code) {
    const error = new Error(code || 'Worker request failed');
    error.status = status;
    return error;
  }

  async function fetchWorkerJSON(config, path, options) {
    const response = await fetch(workerUrl(config, path), {
      cache: 'no-store',
      signal: options?.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) {
      throw workerError(response.status, data?.error || 'worker_json_failed');
    }
    return data;
  }

  async function postWorkerJSON(config, path, data, options) {
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
  }

  async function putWorkerJSON(config, path, data, options) {
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
  }

  async function deleteWorkerJSON(config, path, data, options) {
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

    requireRepository();
    return Repository.fetchJSON(config.customersUrl);
  }

  async function loadStatus(config) {
    if (isWorkerStatusReadEnabled(config)) {
      const data = await fetchWorkerJSON(config, '/api/status');
      return data.status && typeof data.status === 'object' ? data.status : {};
    }

    requireRepository();
    return Repository.fetchJSON(config.statusUrl);
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

    requireRepository();
    const { meta } = await Repository.fetchJSONWithMeta(config.statusUrl, 'Kon status.json niet ophalen');
    return Repository.putJSON(config.statusUrl, {
      message: 'Status update: ' + (messageCustomer || 'offline queue'),
      data: statusData,
      sha: meta.sha,
    }, 'Kon status niet opslaan');
  }

  async function loadFloorplanSVG(fileUrl, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const floorplan = await fetchWorkerFloorplan(options.config, fileUrl, options);
      if (floorplan) return floorplan.text;
    }

    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, 'Bestand niet gevonden', options);
    const repo = Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
    return Repository.fetchBlobText(repo, meta.sha, 'Kon blob niet laden', options);
  }

  async function revalidateFloorplanSVG(fileUrl, cachedSha, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const floorplan = await fetchWorkerFloorplan(options.config, fileUrl, options);
      if (floorplan) {
        if (floorplan.sha && floorplan.sha === cachedSha) return null;
        return floorplan.text;
      }
    }

    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, null, options);
    if (meta.sha === cachedSha) return null;
    const repo = Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
    return Repository.fetchBlobText(repo, meta.sha, null, options);
  }

  async function warmFloorplanSVG(fileUrl, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const floorplan = await fetchWorkerFloorplan(options.config, fileUrl, options);
      if (floorplan) return floorplan;
    }

    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, 'Metadata cache mislukt: {status}', options);
    const repo = Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
    await Repository.fetchBlobText(repo, meta.sha, 'Blob cache mislukt: {status}', options);
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

    requireRepository();
    const meta = await Repository.fetchContentMeta(fileUrl, saveOptions.fetchErrorMessage || 'Kon bestand niet ophalen');
    return Repository.putTextContent(fileUrl, {
      message: saveOptions.message,
      text: svgText,
      sha: meta.sha,
    }, saveOptions.saveErrorMessage || 'Kon niet opslaan');
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

    requireRepository();
    let uploadedSvgSha = null;

    try {
      const uploadData = await Repository.putTextContent(uploadUrl, {
        message: 'Upload: ' + customerName + ' - ' + floorplanName,
        text: svgText,
      }, 'SVG upload mislukt');
      uploadedSvgSha = uploadData.content?.sha;

      const { meta: customersMeta, data: currentCustomers } = await Repository.fetchJSONWithMeta(config.customersUrl, 'Kon customers.json niet ophalen');
      const newEntry = { name: floorplanName, file: fileName, repo: 'uploads', uploaded: true };

      if (isNewCustomer) {
        currentCustomers.push({ customer: customerName, floorplans: [newEntry] });
      } else {
        const freshCi = currentCustomers.findIndex(c => c.customer === customerName);
        if (freshCi < 0) throw new Error('Klant niet gevonden in customers.json');
        currentCustomers[freshCi].floorplans.push(newEntry);
      }

      await Repository.putJSON(config.customersUrl, {
        message: 'Plattegrond toegevoegd: ' + customerName + ' - ' + floorplanName,
        data: currentCustomers,
        sha: customersMeta.sha,
      }, 'Kon customers.json niet bijwerken');

      return { customers: currentCustomers, entry: newEntry, uploadUrl };
    } catch (err) {
      if (uploadedSvgSha) {
        try {
          await Repository.deleteContent(uploadUrl, { message: 'Rollback: upload mislukt', sha: uploadedSvgSha });
        } catch (e) {}
      }
      throw err;
    }
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

    requireRepository();

    const { meta: customersMeta, data: currentCustomers } = await Repository.fetchJSONWithMeta(config.customersUrl, 'Kon customers.json niet ophalen');

    const freshCi = currentCustomers.findIndex(c => c.customer === customerName);
    if (freshCi >= 0) {
      const freshFi = currentCustomers[freshCi].floorplans.findIndex(f => f.file === fp.file);
      if (freshFi >= 0) currentCustomers[freshCi].floorplans.splice(freshFi, 1);
      if (currentCustomers[freshCi].floorplans.length === 0) currentCustomers.splice(freshCi, 1);
    }

    await Repository.putJSON(config.customersUrl, {
      message: 'Plattegrond verwijderd: ' + customerName + ' - ' + fp.name,
      data: currentCustomers,
      sha: customersMeta.sha,
    }, 'Kon customers.json niet bijwerken');

    const fileUrl = uploadedFloorplanUrl(config, fp.file);
    const meta = await Repository.fetchContentMeta(fileUrl, 'Kon bestand niet vinden');
    try {
      await Repository.deleteContent(fileUrl, {
        message: 'Verwijderd: ' + customerName + ' - ' + fp.name,
        sha: meta.sha,
      }, 'Kon bestand niet verwijderen');
    } catch (deleteErr) {
      try {
        const { meta: rollbackMeta, data: rollbackCustomers } = await Repository.fetchJSONWithMeta(config.customersUrl);
        const rollbackCi = rollbackCustomers.findIndex(c => c.customer === customerName);
        const rollbackEntry = { name: fp.name, file: fp.file, repo: 'uploads', uploaded: true };
        if (rollbackCi >= 0) {
          rollbackCustomers[rollbackCi].floorplans.push(rollbackEntry);
        } else {
          rollbackCustomers.push({ customer: customerName, floorplans: [rollbackEntry] });
        }
        await Repository.putJSON(config.customersUrl, {
          message: 'Rollback: verwijderen mislukt',
          data: rollbackCustomers,
          sha: rollbackMeta.sha,
        });
      } catch (e) {}
      throw deleteErr;
    }

    return { customers: currentCustomers };
  }

  async function fetchFloorplanTreeMap(repo, options) {
    if (isWorkerReadProxyEnabled(options?.config)) {
      const workerTreeMap = await fetchWorkerFloorplanTreeMap(options.config, repo, options);
      if (workerTreeMap) return workerTreeMap;
    }

    requireRepository();
    return Repository.fetchRepoTreeMap(repo, options);
  }

  async function validateTokenForCustomers(config, token) {
    requireRepository();
    return Repository.testTokenAccess(config.customersUrl, token);
  }

  async function loginWorkerSession(config, password, options) {
    const sessionData = await postWorkerJSON(config, '/api/session/login', { password }, options);
    setWorkerSession(config, sessionData);
    return sessionData;
  }

  FD.DataService = {
    clearWorkerSession,
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
    validateTokenForCustomers,
  };
})(window);
