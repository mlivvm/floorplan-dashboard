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
    return fp?.repo === 'uploads' ? 'mlivvm/floorplan-uploads' : 'mlivvm/gallery';
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

  function getGitHubGetRequest(url) {
    return new global.Request(url, {
      headers: FD.Repository.headers(),
      cache: 'no-store',
    });
  }

  async function fetchSVGCacheFirst(fileUrl, { cacheVersion, signal } = {}) {
    if (!global.caches) {
      return { svgText: await FD.DataService.loadFloorplanSVG(fileUrl, { signal }), revalidate: null };
    }

    try {
      const cache = await global.caches.open(cacheVersion);
      const cachedMetaResp = await cache.match(fileUrl, { ignoreVary: true });
      if (cachedMetaResp) {
        const meta = await cachedMetaResp.clone().json();
        const repo = FD.Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
        const blobUrl = FD.Repository.blobUrl(repo, meta.sha);
        const cachedBlobResp = await cache.match(blobUrl, { ignoreVary: true });
        if (cachedBlobResp) {
          const blob = await cachedBlobResp.clone().json();
          const svgText = FD.Repository.blobJSONToText(blob);
          const revalidate = revalidateSVGInBackground(fileUrl, meta.sha, { signal });
          return { svgText, revalidate };
        }
      }
    } catch (err) {
      console.warn('Cache-first lookup mislukt:', err);
    }

    return { svgText: await FD.DataService.loadFloorplanSVG(fileUrl, { signal }), revalidate: null };
  }

  async function revalidateSVGInBackground(fileUrl, cachedSha, options) {
    try {
      return FD.DataService.revalidateFloorplanSVG(fileUrl, cachedSha, options);
    } catch {
      return null;
    }
  }

  async function updateCachedSVGAfterSave(fileUrl, updateResult, svgText, { cacheVersion } = {}) {
    if (!global.caches || !updateResult?.content?.sha) return;
    try {
      const repo = FD.Repository.repoFromContentsUrl(fileUrl, 'mlivvm/gallery');
      const sha = updateResult.content.sha;
      const blobUrl = FD.Repository.blobUrl(repo, sha);
      const cache = await global.caches.open(cacheVersion);

      await Promise.all([
        cache.put(fileUrl, new global.Response(JSON.stringify(updateResult.content), {
          headers: { 'Content-Type': 'application/json' },
        })),
        cache.put(blobUrl, new global.Response(JSON.stringify(FD.Repository.textBlobJSON(svgText)), {
          headers: { 'Content-Type': 'application/json' },
        })),
      ]);

      const manifest = readManifest(cacheVersion);
      const path = decodeURIComponent(fileUrl.split('/contents/')[1] || '');
      if (path) {
        manifest.files[getCacheKey(repo, path)] = sha;
        writeManifest(cacheVersion, manifest);
      }
    } catch (err) {
      console.warn('SVG cache kon niet direct worden bijgewerkt:', err);
    }
  }

  async function isFloorplanCached(item) {
    if (!item.sha || !global.caches) return false;
    try {
      const [metaCached, blobCached] = await Promise.all([
        global.caches.match(getGitHubGetRequest(item.fileUrl)),
        global.caches.match(getGitHubGetRequest(FD.Repository.blobUrl(item.repo, item.sha))),
      ]);
      return Boolean(metaCached && blobCached);
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

  function createWarmupController({ config, getCustomers, getToken, isOnline, logger = console } = {}) {
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
      const token = getToken ? getToken() : FD.Repository.getToken();
      controller = new global.AbortController();
      const signal = controller.signal;

      const run = async () => {
        if (shouldCancel(runGeneration, token, signal)) return;
        const swReady = await waitForServiceWorkerReady({ logger });
        if (shouldCancel(runGeneration, token, signal)) return;
        if (!swReady) return;
        await warmFloorplanCache({ customers, config, token, generation: runGeneration, signal });
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

    function shouldCancel(runGeneration, token, signal) {
      const online = isOnline ? isOnline() : global.navigator?.onLine;
      const currentToken = getToken ? getToken() : FD.Repository.getToken();
      return signal?.aborted || !online || runGeneration !== generation || !token || currentToken !== token;
    }

    async function warmFloorplanCache({ customers, config, token, generation: runGeneration, signal }) {
      if (shouldCancel(runGeneration, token, signal)) return;

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
        if (shouldCancel(runGeneration, token, signal)) return;
        try {
          repoTreeMaps[repo] = await FD.DataService.fetchFloorplanTreeMap(repo, { signal });
        } catch (err) {
          if (err?.name === 'AbortError') return;
          repoTreeMaps[repo] = null;
          if (err?.status === 401 || err?.status === 403) {
            markRepoAuthSkipped(repo, err);
            return;
          }
          logger.warn('GitHub tree niet beschikbaar, warmup valt terug op volledige check:', repo, err);
        }
      }));

      if (shouldCancel(runGeneration, token, signal)) return;

      const manifest = readManifest(config.offlineCacheVersion);
      const warmQueue = [];
      let skipped = 0;
      let authSkipped = 0;
      let missing = 0;
      let transientFailed = 0;

      await Promise.all(queue.map(async item => {
        if (shouldCancel(runGeneration, token, signal)) return;
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

        if (sha && manifest.files[item.cacheKey] === sha && await isFloorplanCached(item)) {
          skipped++;
        } else {
          warmQueue.push(item);
        }
      }));

      let next = 0;
      let cached = 0;
      const workerCount = Math.min(3, warmQueue.length);

      async function worker() {
        while (next < warmQueue.length) {
          if (shouldCancel(runGeneration, token, signal)) return;
          const item = warmQueue[next++];
          if (authSkippedRepos.has(item.repo)) {
            authSkipped++;
            continue;
          }
          try {
            await FD.DataService.warmFloorplanSVG(item.fileUrl, { signal });
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
              transientFailed++;
              continue;
            }
            logger.warn('Plattegrond niet in offline cache:', item.fileUrl, err);
          }
          await new Promise(resolve => global.setTimeout(resolve, 50));
        }
      }

      await Promise.all(Array.from({ length: workerCount }, worker));
      if (shouldCancel(runGeneration, token, signal)) return;

      writeManifest(config.offlineCacheVersion, manifest, logger);
      const details = [];
      if (authSkipped) details.push(`${authSkipped} auth overgeslagen`);
      if (missing) details.push(`${missing} ontbrekend in repo`);
      if (transientFailed) details.push(`${transientFailed} tijdelijk mislukt`);
      const detailText = details.length ? `, ${details.join(', ')}` : '';
      logger.info(`Offline cache warmup klaar: ${cached} vernieuwd, ${skipped} overgeslagen, ${queue.length} totaal${detailText}.`);
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
