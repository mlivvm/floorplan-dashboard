(function (global) {
  const FD = global.FD = global.FD || {};
  const MANIFEST_KEY = 'fd_floorplan_cache_manifest';

  function getStorage() {
    try {
      return global.localStorage || null;
    } catch {
      return null;
    }
  }

  function getFloorplanRepo(fp) {
    return fp?.repo === 'uploads' ? 'uploads' : 'gallery';
  }

  function getFloorplanPath(fp) {
    return fp?.file || '';
  }

  function getFloorplanApiUrl(fp, config) {
    const baseUrl = fp?.repo === 'uploads' ? config.svgUploadsUrl : config.svgBaseUrl;
    return baseUrl + encodeURIComponent(getFloorplanPath(fp));
  }

  function getCacheKey(repo, path) {
    return repo + ':' + path;
  }

  function getRepoFromContentsUrl(fileUrl) {
    return String(fileUrl || '').startsWith('fd-floorplan://uploads/')
      ? 'uploads'
      : 'gallery';
  }

  function getPathFromContentsUrl(fileUrl) {
    return decodeURIComponent(String(fileUrl || '').replace(/^fd-floorplan:\/\/(?:gallery|uploads)\//, '') || '');
  }

  function readManifest(cacheVersion) {
    const storage = getStorage();
    if (!storage) return { version: cacheVersion, files: {} };
    try {
      const raw = storage.getItem(MANIFEST_KEY);
      if (!raw) return { version: cacheVersion, files: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.files) {
        return { version: cacheVersion, files: {} };
      }
      if (parsed.version !== cacheVersion) {
        return { version: cacheVersion, files: {} };
      }
      return parsed;
    } catch {
      return { version: cacheVersion, files: {} };
    }
  }

  function writeManifest(cacheVersion, manifest, logger = console) {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    } catch (err) {
      logger.warn('Offline cache manifest kon niet worden opgeslagen:', err);
    }
  }

  function isWorkerReadProxyEnabled(config) {
    return FD.DataService?.isWorkerReadProxyEnabled?.(config) === true;
  }

  function isOnline() {
    return global.navigator?.onLine !== false;
  }

  function isNetworkError(err) {
    const message = String(err?.message || '');
    return err?.name === 'TypeError' ||
      /Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(message);
  }

  function getWorkerFloorplanUrl(fileUrl, config) {
    return FD.DataService?.getWorkerFloorplanUrl?.(config, fileUrl) || null;
  }

  function updateManifestSha(cacheVersion, fileUrl, sha, logger = console) {
    if (!sha) return;
    const repo = getRepoFromContentsUrl(fileUrl);
    const path = getPathFromContentsUrl(fileUrl);
    if (!path) return;
    const manifest = readManifest(cacheVersion);
    manifest.files[getCacheKey(repo, path)] = sha;
    writeManifest(cacheVersion, manifest, logger);
  }

  async function fetchWorkerSVGCacheFirst(fileUrl, { cacheVersion, signal, config } = {}) {
    const workerUrl = getWorkerFloorplanUrl(fileUrl, config);
    if (!global.caches || !workerUrl) {
      return { svgText: await FD.DataService.loadFloorplanSVG(fileUrl, { signal, config }), revalidate: null };
    }

    try {
      const cache = await global.caches.open(cacheVersion);
      const cachedResp = await cache.match(workerUrl, { ignoreVary: true });
      if (cachedResp) {
        const svgText = await cachedResp.clone().text();
        const cachedSha = cachedResp.headers.get('X-FD-Sha') || '';
        const revalidate = isOnline() ? revalidateSVGInBackground(fileUrl, cachedSha, { signal, config }) : null;
        return { svgText, revalidate };
      }
    } catch (err) {
      console.warn('Worker cache-first lookup mislukt:', err);
    }

    return { svgText: await FD.DataService.loadFloorplanSVG(fileUrl, { signal, config }), revalidate: null };
  }

  async function fetchSVGCacheFirst(fileUrl, { cacheVersion, signal, config } = {}) {
    return fetchWorkerSVGCacheFirst(fileUrl, { cacheVersion, signal, config });
  }

  async function revalidateSVGInBackground(fileUrl, cachedSha, options) {
    try {
      return await FD.DataService.revalidateFloorplanSVG(fileUrl, cachedSha, options);
    } catch {
      return null;
    }
  }

  async function updateCachedSVGAfterSave(fileUrl, updateResult, svgText, { cacheVersion, config } = {}) {
    const sha = updateResult?.content?.sha || updateResult?.sha || '';
    if (!global.caches || !sha) return;
    try {
      const workerUrl = getWorkerFloorplanUrl(fileUrl, config);
      if (!workerUrl) return;
      const cache = await global.caches.open(cacheVersion);
      await cache.put(workerUrl, new global.Response(svgText, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'X-FD-Sha': sha,
        },
      }));
      updateManifestSha(cacheVersion, fileUrl, sha);
    } catch (err) {
      console.warn('SVG cache kon niet direct worden bijgewerkt:', err);
    }
  }

  async function isFloorplanCached(item, { cacheVersion, config } = {}) {
    if (!item.sha || !global.caches) return false;
    try {
      const workerUrl = getWorkerFloorplanUrl(item.fileUrl, config);
      if (!workerUrl) return false;
      const cache = await global.caches.open(cacheVersion || config?.offlineCacheVersion);
      const cachedResp = await cache.match(workerUrl, { ignoreVary: true });
      const cachedSha = cachedResp?.headers?.get('X-FD-Sha') || '';
      return Boolean(cachedResp && cachedSha === item.sha);
    } catch (err) {
      console.warn('Offline cache controle mislukt:', item.fileUrl, err);
      return false;
    }
  }

  async function waitForServiceWorkerReady({ timeoutMs = 8000, logger = console } = {}) {
    if (!global.navigator?.serviceWorker) return false;
    try {
      await Promise.race([
        global.navigator.serviceWorker.ready,
        new Promise((_, reject) => global.setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return true;
    } catch (err) {
      logger.warn('Service worker niet klaar voor offline cache warmup:', err);
      return false;
    }
  }

  function createWarmupController({ config, getCustomers, isOnline, logger = console } = {}) {
    let started = false;
    let generation = 0;
    let controller = null;

    function cancel() {
      generation++;
      started = false;
      if (controller) {
        controller.abort();
        controller = null;
      }
    }

    function schedule() {
      const customers = getCustomers ? getCustomers() : [];
      const online = isOnline ? isOnline() : global.navigator?.onLine;
      if (!online) return;
      if (started || !customers.length) return;
      started = true;
      const runGeneration = ++generation;
      controller = new global.AbortController();
      const signal = controller.signal;

      const run = async () => {
        if (shouldCancel(runGeneration, signal)) return;
        const swReady = await waitForServiceWorkerReady({ logger });
        if (shouldCancel(runGeneration, signal)) return;
        if (!swReady) return;
        await warmFloorplanCache({ customers, config, generation: runGeneration, signal });
      };

      const safeRun = () => run().catch(err => {
        if (err?.name === 'AbortError') return;
        logger.warn('Offline cache warmup mislukt:', err);
      });

      if (global.requestIdleCallback) {
        global.requestIdleCallback(safeRun, { timeout: 5000 });
      } else {
        global.setTimeout(safeRun, 1500);
      }
    }

    function shouldCancel(runGeneration, signal) {
      const online = isOnline ? isOnline() : global.navigator?.onLine;
      if (signal?.aborted || !online || runGeneration !== generation) return true;
      return false;
    }

    async function warmFloorplanCache({ customers, config, generation: runGeneration, signal }) {
      if (shouldCancel(runGeneration, signal)) return;

      const queue = [];
      customers.forEach(customer => {
        (customer.floorplans || []).forEach(fp => {
          if (!fp.file) return;
          const repo = getFloorplanRepo(fp);
          const path = getFloorplanPath(fp);
          queue.push({
            repo,
            path,
            fileUrl: getFloorplanApiUrl(fp, config),
            cacheKey: getCacheKey(repo, path),
          });
        });
      });

      const repoTreeMaps = {};
      const authSkippedRepos = new Set();
      const warnedAuthRepos = new Set();
      const markRepoAuthSkipped = (repo, err) => {
        authSkippedRepos.add(repo);
        if (warnedAuthRepos.has(repo)) return;
        warnedAuthRepos.add(repo);
        logger.warn('Offline cache warmup overgeslagen voor repo zonder toegang:', repo, err);
      };

      await Promise.all(Array.from(new Set(queue.map(item => item.repo))).map(async repo => {
        if (shouldCancel(runGeneration, signal)) return;
        try {
          repoTreeMaps[repo] = await FD.DataService.fetchFloorplanTreeMap(repo, { signal, config });
        } catch (err) {
          if (err?.name === 'AbortError') return;
          repoTreeMaps[repo] = null;
          if (err?.status === 401 || err?.status === 403) {
            markRepoAuthSkipped(repo, err);
            return;
          }
          logger.warn('Worker floorplan manifest niet beschikbaar, warmup valt terug op volledige check:', repo, err);
        }
      }));

      if (shouldCancel(runGeneration, signal)) return;

      const manifest = readManifest(config.offlineCacheVersion);
      const warmQueue = [];
      let skipped = 0;
      let authSkipped = 0;
      let missing = 0;
      let transientFailed = 0;

      await Promise.all(queue.map(async item => {
        if (shouldCancel(runGeneration, signal)) return;
        if (authSkippedRepos.has(item.repo)) {
          authSkipped++;
          return;
        }

        const treeMap = repoTreeMaps[item.repo];
        const sha = treeMap ? treeMap.get(item.path) : null;
        item.sha = sha;

        if (treeMap && !sha) {
          missing++;
          return;
        }

        if (sha && manifest.files[item.cacheKey] === sha && await isFloorplanCached(item, {
          cacheVersion: config.offlineCacheVersion,
          config,
        })) {
          skipped++;
        } else {
          warmQueue.push(item);
        }
      }));

      let next = 0;
      let cached = 0;
      let networkFailed = false;
      const transientSamples = [];
      const workerCount = Math.min(3, warmQueue.length);

      function markTransientFailure(item, err) {
        transientFailed++;
        if (transientSamples.length >= 5) return;
        transientSamples.push({
          repo: item.repo,
          path: item.path,
          message: err?.message || String(err || ''),
          status: err?.status || null,
        });
      }

      async function worker() {
        while (next < warmQueue.length) {
          if (networkFailed) return;
          if (shouldCancel(runGeneration, signal)) return;
          const item = warmQueue[next++];
          if (authSkippedRepos.has(item.repo)) {
            authSkipped++;
            continue;
          }
          try {
            await FD.DataService.warmFloorplanSVG(item.fileUrl, { signal, config });
            if (item.sha) manifest.files[item.cacheKey] = item.sha;
            cached++;
          } catch (err) {
            if (err?.name === 'AbortError') return;
            if (err?.status === 401 || err?.status === 403) {
              markRepoAuthSkipped(item.repo, err);
              authSkipped++;
              continue;
            }
            if (err?.status === 404) {
              missing++;
              continue;
            }
            if (err?.status >= 500 && err?.status < 600) {
              markTransientFailure(item, err);
              continue;
            }
            if (isNetworkError(err)) {
              markTransientFailure(item, err);
              networkFailed = true;
              return;
            }
            logger.warn('Plattegrond niet in offline cache:', item.fileUrl, err);
          }
          await new Promise(resolve => global.setTimeout(resolve, 50));
        }
      }

      await Promise.all(Array.from({ length: workerCount }, worker));
      if (shouldCancel(runGeneration, signal)) return;

      writeManifest(config.offlineCacheVersion, manifest, logger);
      const details = [];
      if (authSkipped) details.push(`${authSkipped} auth overgeslagen`);
      if (missing) details.push(`${missing} ontbrekend in repo`);
      if (transientFailed) details.push(`${transientFailed} tijdelijk mislukt`);
      const detailText = details.length ? `, ${details.join(', ')}` : '';
      logger.info(`Offline cache warmup klaar: ${cached} vernieuwd, ${skipped} overgeslagen, ${queue.length} totaal${detailText}.`);

      if (transientFailed || authSkipped) {
        try {
          FD.DiagnosticsService?.record?.({
            level: transientFailed ? 'warn' : 'info',
            eventType: 'offline_cache_warmup',
            message: transientFailed
              ? `Offline cache warmup deels mislukt: ${transientFailed} tijdelijk mislukt`
              : `Offline cache warmup deels overgeslagen: ${authSkipped} auth overgeslagen`,
            source: 'floorplan-cache-service',
            details: {
              cached,
              skipped,
              total: queue.length,
              authSkipped,
              missing,
              transientFailed,
              stoppedAfterNetworkError: networkFailed,
              samples: transientSamples,
            },
          });
        } catch {}
      }
    }

    return { cancel, schedule };
  }

  FD.FloorplanCacheService = {
    createWarmupController,
    fetchSVGCacheFirst,
    getFloorplanApiUrl,
    getFloorplanPath,
    getFloorplanRepo,
    readManifest,
    updateCachedSVGAfterSave,
    waitForServiceWorkerReady,
  };
})(window);
