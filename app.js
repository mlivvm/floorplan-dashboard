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
      offlineCacheVersion: 'fd-v1.8.11',
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
    const connectionIndicator = document.getElementById('connection-indicator');
    const connectionLabel = document.getElementById('connection-label');
    const syncIndicator = document.getElementById('sync-indicator');
    const syncLabel = document.getElementById('sync-label');

    // ============================================================
    // SHARED UI HELPERS
    // ============================================================

    const BUILDING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><rect x="8" y="32" width="74" height="50" rx="5" fill="#E5E8E8" stroke="#304A5E" stroke-width="2.5"/><rect x="18" y="44" width="16" height="16" rx="3" fill="#304A5E" opacity="0.45"/><rect x="56" y="44" width="16" height="16" rx="3" fill="#304A5E" opacity="0.45"/><rect x="37" y="50" width="16" height="32" rx="3" fill="#304A5E" opacity="0.65"/><polygon points="45,6 6,32 84,32" fill="#304A5E" opacity="0.75"/></svg>`;

    function setEmptyState(subtitle, hint) {
      loadingEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">${BUILDING_SVG}</div>
        <div class="empty-state-title">Plattegrond Dashboard</div>
        <div class="empty-state-sub">${subtitle}</div>
        ${hint ? `<div class="empty-state-hint">${hint}</div>` : ''}
      </div>`;
    }

    function setLoadingState() {
      loadingEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon loading-scan-container">${BUILDING_SVG}<div class="loading-scan-line"></div></div>
        <div class="empty-state-title" style="color:#555; font-size:18px; font-weight:600;">Plattegrond laden</div>
        <div class="loading-dots"><span></span><span></span><span></span></div>
      </div>`;
    }

    // ============================================================
    // LAYOUT — measure topbar, handle resize/orientation
    // ============================================================

    function updateViewportMetrics() {
      const viewport = window.visualViewport;
      const height = viewport ? viewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', Math.round(height) + 'px');
    }

    function updateTopbarHeight() {
      const topbar = document.querySelector('.topbar');
      if (!topbar) return;
      const h = topbar.offsetHeight;
      document.documentElement.style.setProperty('--topbar-h', h + 'px');
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

    function updateConnectionIndicator() {
      const isOnline = navigator.onLine;
      connectionIndicator.classList.toggle('offline', !isOnline);
      connectionLabel.textContent = isOnline ? 'Online' : 'Offline';
      connectionIndicator.title = isOnline ? 'Online' : 'Offline';
      requestAnimationFrame(updateTopbarHeight);
    }

    function updateStatusSyncIndicator() {
      const count = readStatusSyncQueue().length;
      syncIndicator.style.display = count > 0 ? 'inline-flex' : 'none';
      syncLabel.textContent = 'Sync ' + count;
      syncIndicator.title = count === 1 ? '1 statuswijziging wacht op sync' : count + ' statuswijzigingen wachten op sync';
      requestAnimationFrame(updateTopbarHeight);
    }

    window.addEventListener('online', () => {
      updateConnectionIndicator();
      showToast('Je bent weer online', 'success');
      flushStatusSyncQueue();
    });

    window.addEventListener('offline', () => {
      updateConnectionIndicator();
      showToast('Offline modus', 'error');
    });

    // ============================================================
    // DATA LOADING
    // ============================================================

    const CUSTOMERS_CACHE_KEY = 'fd_customers_cache';

    function getGitHubToken() {
      return localStorage.getItem('fd_github_token') || sessionStorage.getItem('fd_github_token') || '';
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

    async function fetchGitHubSVGCacheFirst(fileUrl) {
      if (!('caches' in window)) return { svgText: await fetchGitHubSVG(fileUrl), revalidate: null };
      try {
        const cache = await caches.open(CONFIG.offlineCacheVersion);
        const cachedMetaResp = await cache.match(fileUrl, { ignoreVary: true });
        if (cachedMetaResp) {
          const meta = await cachedMetaResp.clone().json();
          const repoMatch = fileUrl.match(/repos\/([^/]+\/[^/]+)\//);
          const repo = repoMatch ? repoMatch[1] : 'mlivvm/gallery';
          const blobUrl = `https://api.github.com/repos/${repo}/git/blobs/${meta.sha}`;
          const cachedBlobResp = await cache.match(blobUrl, { ignoreVary: true });
          if (cachedBlobResp) {
            const blob = await cachedBlobResp.clone().json();
            const svgText = decodeBase64UTF8(blob.content);
            const revalidate = revalidateSVGInBackground(fileUrl, meta.sha);
            return { svgText, revalidate };
          }
        }
      } catch (err) {
        console.warn('Cache-first lookup mislukt:', err);
      }
      return { svgText: await fetchGitHubSVG(fileUrl), revalidate: null };
    }

    async function revalidateSVGInBackground(fileUrl, cachedSha) {
      try {
        const metaResp = await fetch(fileUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!metaResp.ok) return null;
        const meta = await metaResp.json();
        if (meta.sha === cachedSha) return null;
        const repoMatch = fileUrl.match(/repos\/([^/]+\/[^/]+)\//);
        const repo = repoMatch ? repoMatch[1] : 'mlivvm/gallery';
        const blobUrl = `https://api.github.com/repos/${repo}/git/blobs/${meta.sha}`;
        const blobResp = await fetch(blobUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!blobResp.ok) return null;
        const blob = await blobResp.json();
        return decodeBase64UTF8(blob.content);
      } catch {
        return null;
      }
    }

    async function updateCachedSVGAfterSave(fileUrl, updateResult, svgBase64) {
      if (!('caches' in window) || !updateResult?.content?.sha) return;
      try {
        const repoMatch = fileUrl.match(/repos\/([^/]+\/[^/]+)\//);
        const repo = repoMatch ? repoMatch[1] : 'mlivvm/gallery';
        const sha = updateResult.content.sha;
        const blobUrl = getGitHubBlobUrl(repo, sha);
        const cache = await caches.open(CONFIG.offlineCacheVersion);

        await Promise.all([
          cache.put(fileUrl, new Response(JSON.stringify(updateResult.content), {
            headers: { 'Content-Type': 'application/json' }
          })),
          cache.put(blobUrl, new Response(JSON.stringify({ content: svgBase64 }), {
            headers: { 'Content-Type': 'application/json' }
          }))
        ]);

        const manifest = readFloorplanCacheManifest();
        const path = decodeURIComponent(fileUrl.split('/contents/')[1] || '');
        if (path) {
          manifest.files[getFloorplanCacheKey(repo, path)] = sha;
          writeFloorplanCacheManifest(manifest);
        }
      } catch (err) {
        console.warn('SVG cache kon niet direct worden bijgewerkt:', err);
      }
    }

    function getFloorplanRepo(fp) {
      return fp.repo === 'uploads' ? 'mlivvm/floorplan-uploads' : 'mlivvm/gallery';
    }

    function getFloorplanPath(fp) {
      return fp.file;
    }

    function getFloorplanApiUrl(fp) {
      const baseUrl = fp.repo === 'uploads' ? CONFIG.svgUploadsUrl : CONFIG.svgBaseUrl;
      return baseUrl + encodeURIComponent(getFloorplanPath(fp));
    }

    async function warmGitHubSVGCache(fileUrl) {
      const metaResp = await fetch(fileUrl, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!metaResp.ok) throw new Error('Metadata cache mislukt: ' + metaResp.status);
      const meta = await metaResp.json();

      const repoMatch = fileUrl.match(/repos\/([^/]+\/[^/]+)\//);
      const repo = repoMatch ? repoMatch[1] : 'mlivvm/gallery';
      const blobUrl = `https://api.github.com/repos/${repo}/git/blobs/${meta.sha}`;
      const blobResp = await fetch(blobUrl, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!blobResp.ok) throw new Error('Blob cache mislukt: ' + blobResp.status);
    }

    const FLOORPLAN_CACHE_MANIFEST_KEY = 'fd_floorplan_cache_manifest';

    function readFloorplanCacheManifest() {
      try {
        const raw = localStorage.getItem(FLOORPLAN_CACHE_MANIFEST_KEY);
        if (!raw) return { version: CONFIG.offlineCacheVersion, files: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.files) {
          return { version: CONFIG.offlineCacheVersion, files: {} };
        }
        if (parsed.version !== CONFIG.offlineCacheVersion) {
          return { version: CONFIG.offlineCacheVersion, files: {} };
        }
        return parsed;
      } catch {
        return { version: CONFIG.offlineCacheVersion, files: {} };
      }
    }

    function writeFloorplanCacheManifest(manifest) {
      try {
        localStorage.setItem(FLOORPLAN_CACHE_MANIFEST_KEY, JSON.stringify(manifest));
      } catch (err) {
        console.warn('Offline cache manifest kon niet worden opgeslagen:', err);
      }
    }

    function getFloorplanCacheKey(repo, path) {
      return repo + ':' + path;
    }

    function getGitHubBlobUrl(repo, sha) {
      return `https://api.github.com/repos/${repo}/git/blobs/${sha}`;
    }

    function getGitHubGetRequest(url) {
      return new Request(url, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
    }

    async function isFloorplanCached(item) {
      if (!item.sha || !('caches' in window)) return false;
      try {
        const [metaCached, blobCached] = await Promise.all([
          caches.match(getGitHubGetRequest(item.fileUrl)),
          caches.match(getGitHubGetRequest(getGitHubBlobUrl(item.repo, item.sha))),
        ]);
        return Boolean(metaCached && blobCached);
      } catch (err) {
        console.warn('Offline cache controle mislukt:', item.fileUrl, err);
        return false;
      }
    }

    async function fetchRepoDefaultBranch(repo) {
      const resp = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!resp.ok) throw new Error('Repo metadata fetch mislukt: ' + repo + ' ' + resp.status);
      const data = await resp.json();
      return data.default_branch || 'main';
    }

    async function fetchRepoTreeMap(repo) {
      const refs = [];
      let lastErr = null;

      try {
        refs.push(await fetchRepoDefaultBranch(repo));
      } catch (err) {
        lastErr = err;
      }
      ['main', 'master'].forEach(ref => {
        if (!refs.includes(ref)) refs.push(ref);
      });

      for (const ref of refs) {
        try {
          const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`;
          const resp = await fetch(treeUrl, {
            headers: ghHeaders(),
            cache: 'no-store',
          });
          if (!resp.ok) {
            lastErr = new Error('Tree fetch mislukt: ' + repo + '@' + ref + ' ' + resp.status);
            continue;
          }

          const data = await resp.json();
          const map = new Map();
          (data.tree || []).forEach(item => {
            if (item.type === 'blob') map.set(item.path, item.sha);
          });
          if (data.truncated) {
            console.warn('GitHub tree is truncated voor repo:', repo);
          }
          return map;
        } catch (err) {
          lastErr = err;
        }
      }

      throw lastErr || new Error('Tree fetch mislukt: ' + repo);
    }

    let floorplanCacheWarmStarted = false;

    async function waitForServiceWorkerReady() {
      if (!('serviceWorker' in navigator)) return false;
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
        ]);
        return true;
      } catch (err) {
        console.warn('Service worker niet klaar voor offline cache warmup:', err);
        return false;
      }
    }

    function scheduleFloorplanCacheWarmup() {
      if (floorplanCacheWarmStarted || !customers.length) return;
      floorplanCacheWarmStarted = true;

      const run = async () => {
        const swReady = await waitForServiceWorkerReady();
        if (!swReady) return;
        await warmFloorplanCache();
      };

      const safeRun = () => run().catch(err => {
        console.warn('Offline cache warmup mislukt:', err);
      });

      if ('requestIdleCallback' in window) {
        requestIdleCallback(safeRun, { timeout: 5000 });
      } else {
        setTimeout(safeRun, 1500);
      }
    }

    async function warmFloorplanCache() {
      const queue = [];
      customers.forEach(c => {
        c.floorplans.forEach(fp => {
          if (!fp.file) return;
          const repo = getFloorplanRepo(fp);
          const path = getFloorplanPath(fp);
          queue.push({
            repo,
            path,
            fileUrl: getFloorplanApiUrl(fp),
            cacheKey: getFloorplanCacheKey(repo, path),
          });
        });
      });

      const repoTreeMaps = {};
      await Promise.all(Array.from(new Set(queue.map(item => item.repo))).map(async repo => {
        try {
          repoTreeMaps[repo] = await fetchRepoTreeMap(repo);
        } catch (err) {
          repoTreeMaps[repo] = null;
          console.warn('GitHub tree niet beschikbaar, warmup valt terug op volledige check:', repo, err);
        }
      }));

      const manifest = readFloorplanCacheManifest();
      const warmQueue = [];
      let skipped = 0;

      await Promise.all(queue.map(async item => {
        const treeMap = repoTreeMaps[item.repo];
        const sha = treeMap ? treeMap.get(item.path) : null;
        item.sha = sha;

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
          const item = warmQueue[next++];
          try {
            await warmGitHubSVGCache(item.fileUrl);
            if (item.sha) manifest.files[item.cacheKey] = item.sha;
            cached++;
          } catch (err) {
            console.warn('Plattegrond niet in offline cache:', item.fileUrl, err);
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      await Promise.all(Array.from({ length: workerCount }, worker));
      writeFloorplanCacheManifest(manifest);
      console.info(`Offline cache warmup klaar: ${cached} vernieuwd, ${skipped} overgeslagen, ${queue.length} totaal.`);
    }

    async function loadCustomers() {
      try {
        customers = await fetchGitHubJSON(CONFIG.customersUrl);
        cacheCustomers();
        populateCustomerDropdown();
        scheduleFloorplanCacheWarmup();
      } catch (err) {
        console.error('Kon klanten niet laden:', err);
        const cachedCustomers = readCachedCustomers();
        if (cachedCustomers.length > 0) {
          customers = cachedCustomers;
          populateCustomerDropdown();
          setEmptyState('Offline klantgegevens geladen.<br>Kies een klant en plattegrond.', 'Controleer later online of alles actueel is');
        } else {
          loadingEl.textContent = 'Fout bij laden van klantgegevens.';
        }
      }
    }

    async function loadStatus() {
      const queuedOps = readStatusSyncQueue();
      const cachedStatus = readCachedDoorStatus();
      if (Object.keys(cachedStatus).length > 0) {
        doorStatus = applyQueuedStatusOperations(cachedStatus, queuedOps);
        updateStatusBar();
      }

      try {
        const remoteStatus = await fetchGitHubJSON(CONFIG.statusUrl);
        doorStatus = applyQueuedStatusOperations(remoteStatus, queuedOps);
        cacheDoorStatus();
        flushStatusSyncQueue();
      } catch (err) {
        console.error('Kon status niet laden:', err);
        if (Object.keys(cachedStatus).length === 0) doorStatus = {};
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

    function resetFloorplanUI() {
      stopPolling();
      deselectDoor();
      svgContainer.style.display = 'none';
      svgContainer.innerHTML = '';
      btnReset.style.display = 'none';
      infoPanel.style.display = 'none';
      btnPanelToggle.style.display = 'none';
      btnEdit.style.display = 'none';
      sidePanel.classList.remove('open');
      btnPanelToggle.classList.remove('panel-open');
      sidePanelList.innerHTML = '';
      sidePanelHeader.textContent = 'Deuren';
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

      // Non-visual cleanup: stop polling, reset UI chrome, but keep current SVG
      // visible until new content is ready (prevents blank/flash between selections).
      stopPolling();
      deselectDoor();
      btnReset.style.display = 'none';
      infoPanel.style.display = 'none';
      btnPanelToggle.style.display = 'none';
      btnEdit.style.display = 'none';
      sidePanel.classList.remove('open');
      btnPanelToggle.classList.remove('panel-open');
      sidePanelList.innerHTML = '';
      sidePanelHeader.textContent = 'Deuren';
      loadingEl.classList.add('hidden');

      // Only show loading state after 150ms — hides old SVG then.
      // Fast cache hits swap content before this fires.
      const showLoadingTimer = setTimeout(() => {
        if (thisGeneration !== loadGeneration) return;
        svgContainer.style.display = 'none';
        svgContainer.innerHTML = '';
        setLoadingState();
        loadingEl.classList.remove('hidden');
      }, 150);

      try {
        const svgUrl = getFloorplanApiUrl(fp);
        const { svgText, revalidate } = await fetchGitHubSVGCacheFirst(svgUrl);
        clearTimeout(showLoadingTimer);

        // Another floorplan was requested while we were loading — abort
        if (thisGeneration !== loadGeneration) return;

        // Atomically swap: hide old, set new content
        svgContainer.style.display = 'none';
        svgContainer.innerHTML = svgText;
        const svgEl = svgContainer.querySelector('svg');
        if (!svgEl) throw new Error('Geen geldig SVG bestand.');

        // Show container invisible so it has layout dimensions for fitToScreen.
        // Stays hidden until after fitToScreen so SVG never appears unscaled.
        loadingEl.classList.add('hidden');
        svgContainer.style.visibility = 'hidden';
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
        if (showLabels) updateEditLabels();
        infoPanel.style.display = 'flex';
        btnPanelToggle.style.display = 'block';
        btnEdit.style.display = 'inline-block';
        populateSidePanel();
        updateDeleteButton();
        startPolling();

        // Fit SVG, then reveal — never visible before this point
        await new Promise(r => requestAnimationFrame(r));
        fitToScreen(vb.width, vb.height);
        svgContainer.style.visibility = '';

        // Background revalidation: re-render if SVG changed on GitHub
        if (revalidate) {
          revalidate.then(newSvgText => {
            if (!newSvgText || thisGeneration !== loadGeneration) return;
            svgContainer.style.visibility = 'hidden';
            svgContainer.innerHTML = newSvgText;
            const newSvgEl = svgContainer.querySelector('svg');
            if (!newSvgEl) { svgContainer.style.visibility = ''; return; }
            const newVb = newSvgEl.viewBox.baseVal;
            if (!newVb.width || !newVb.height) { svgContainer.style.visibility = ''; return; }
            newSvgEl.setAttribute('width', newVb.width);
            newSvgEl.setAttribute('height', newVb.height);
            newSvgEl.style.width = newVb.width + 'px';
            newSvgEl.style.height = newVb.height + 'px';
            initDoorMarkers(newSvgEl);
            deselectDoor();
            updateStatusBar();
            if (showLabels) updateEditLabels();
            populateSidePanel();
            fitToScreen(newVb.width, newVb.height);
            svgContainer.style.visibility = '';
            showToast('Plattegrond bijgewerkt', 'success');
          }).catch(() => {});
        }

      } catch (err) {
        clearTimeout(showLoadingTimer);
        svgContainer.style.visibility = '';
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
      if (!navigator.onLine) {
        showToast('Geen internet — vul later in via JotForm Mobile Forms-app', 'error');
        return;
      }

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
    let editChanges = [];
    let editMarkerSize = 15;
    let qrScanner = null;

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

    function getSliderRange() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return { max: 30, def: 15 };
      const vb = svgEl.viewBox.baseVal;
      const shortest = Math.min(vb.width || 1000, vb.height || 1000);
      const max = Math.max(20, Math.min(150, Math.round(shortest * 0.03)));
      const def = Math.round(max / 3);
      return { max, def };
    }

    function getMarkerRadius(marker) {
      const rx = parseFloat(marker.getAttribute('rx')) || parseFloat(marker.getAttribute('r')) || editMarkerSize || 10;
      const ry = parseFloat(marker.getAttribute('ry')) || parseFloat(marker.getAttribute('r')) || rx;
      return Math.max(rx, ry);
    }

    function getSvgPointFromClient(clientX, clientY) {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return null;
      const matrix = svgEl.getScreenCTM();
      if (!matrix) return null;
      const point = svgEl.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      return point.matrixTransform(matrix.inverse());
    }

    function getEditableBounds() {
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return null;

      const imageBounds = Array.from(svgEl.querySelectorAll('image'))
        .map(img => {
          const x = parseFloat(img.getAttribute('x') || '0');
          const y = parseFloat(img.getAttribute('y') || '0');
          const width = parseFloat(img.getAttribute('width') || '');
          const height = parseFloat(img.getAttribute('height') || '');
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
          return { x, y, width, height };
        })
        .filter(Boolean);

      if (imageBounds.length) {
        const minX = Math.min(...imageBounds.map(b => b.x));
        const minY = Math.min(...imageBounds.map(b => b.y));
        const maxX = Math.max(...imageBounds.map(b => b.x + b.width));
        const maxY = Math.max(...imageBounds.map(b => b.y + b.height));
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }

      const vb = svgEl.viewBox.baseVal;
      if (!vb.width || !vb.height) return null;
      return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    }

    function clampMarkerPosition(svgX, svgY, radius) {
      const bounds = getEditableBounds();
      if (!bounds) return { x: svgX, y: svgY };
      const minX = bounds.x + radius;
      const minY = bounds.y + radius;
      const maxX = bounds.x + bounds.width - radius;
      const maxY = bounds.y + bounds.height - radius;
      if (minX > maxX || minY > maxY) {
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      return {
        x: Math.max(minX, Math.min(maxX, svgX)),
        y: Math.max(minY, Math.min(maxY, svgY))
      };
    }

    function isPointInsideEditableBounds(svgX, svgY) {
      const bounds = getEditableBounds();
      if (!bounds) return false;
      return svgX >= bounds.x &&
             svgY >= bounds.y &&
             svgX <= bounds.x + bounds.width &&
             svgY <= bounds.y + bounds.height;
    }

    function getMaxRadiusAtPosition(marker) {
      const bounds = getEditableBounds();
      if (!bounds) return Infinity;
      const cx = parseFloat(marker.getAttribute('cx')) || 0;
      const cy = parseFloat(marker.getAttribute('cy')) || 0;
      return Math.max(1, Math.floor(Math.min(
        cx - bounds.x,
        cy - bounds.y,
        bounds.x + bounds.width - cx,
        bounds.y + bounds.height - cy
      )));
    }

    function enterEditMode() {
      if (!currentFloorplan) return;
      isEditMode = true;
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
      const slider = document.getElementById('edit-marker-size');
      slider.max = range.max;
      slider.value = range.def;
      editMarkerSize = range.def;
      document.getElementById('edit-size-label').textContent = range.def;
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
      requestAnimationFrame(updateTopbarHeight);
    }

    function exitEditMode() {
      if (resizingMarker) applyResize();
      if (movingMarker) cancelMoveMode();
      isEditMode = false;
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
      closeEditPopup();
      requestAnimationFrame(updateTopbarHeight);
    }

    function cancelEditMode() {
      if (resizingMarker) cancelResize();
      if (movingMarker) cancelMoveMode();
      editChanges.reverse().forEach(change => {
        if (change.type === 'add') {
          const marker = svgContainer.querySelector(`[data-door-id="${change.doorId}"]`);
          if (marker) marker.remove();
        } else if (change.type === 'delete') {
          const svgEl = svgContainer.querySelector('svg');
          svgEl.appendChild(change.element);
          initSingleMarker(change.element, change.doorId);
        } else if (change.type === 'rename') {
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
        } else if (change.type === 'move') {
          const marker = svgContainer.querySelector(`[data-door-id="${change.doorId}"]`);
          if (marker) {
            marker.setAttribute('cx', change.oldCx.toString());
            marker.setAttribute('cy', change.oldCy.toString());
          }
        }
      });
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

      svgClone.querySelectorAll('[data-fd-label]').forEach(el => el.remove());
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
          cache: 'no-store',
          body: JSON.stringify({
            message: 'Markers bijgewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
            content: content,
            sha: meta.sha,
          }),
        });
        if (!updateResp.ok) throw new Error('Kon niet opslaan');
        const updateResult = await updateResp.json();
        await updateCachedSVGAfterSave(fileUrl, updateResult, content);

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

    const editPopupInputRow = document.getElementById('edit-popup-input-row');
    const editPopupError = document.getElementById('edit-popup-error');
    const btnScanQr = document.getElementById('btn-scan-qr');

    function showEditPopup(title, defaultValue, buttons) {
      editPopupTitle.textContent = title;
      editPopupError.textContent = '';
      editPopupButtons.innerHTML = '';
      editPopupCustom.innerHTML = '';
      editPopupCustom.style.display = 'none';
      editPopup.style.top = '50%';
      editPopup.style.left = '50%';
      editPopup.style.right = '';
      editPopup.style.bottom = '';
      editPopup.style.transform = 'translate(-50%, -50%)';
      const primaryAction = buttons.length > 0 ? buttons[0].action : null;
      buttons.forEach(btn => {
        const el = document.createElement('button');
        el.textContent = btn.text;
        el.style.background = btn.color || '#304A5E';
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
      if (resizingMarker) cancelResize();
      editPopup.style.display = 'none';
      editOverlay.style.display = 'none';
      editPopupCustom.innerHTML = '';
      editPopupCustom.style.display = 'none';
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
      const pos = clampMarkerPosition(svgX, svgY, editMarkerSize);

      const ellipse = document.createElementNS(ns, 'ellipse');
      ellipse.setAttribute('id', doorId);
      ellipse.setAttributeNS(inkNs, 'inkscape:label', doorId);
      ellipse.setAttribute('cx', Math.round(pos.x));
      ellipse.setAttribute('cy', Math.round(pos.y));
      ellipse.setAttribute('rx', editMarkerSize.toString());
      ellipse.setAttribute('ry', editMarkerSize.toString());
      ellipse.style.fill = '#1a73e8';
      ellipse.style.opacity = '0.7';

      svgEl.appendChild(ellipse);
      initSingleMarker(ellipse, doorId);

      editChanges.push({ type: 'add', doorId: doorId });
      populateSidePanel();
      if (showLabels) updateEditLabels();
    }

    function deleteMarker(doorId) {
      const marker = svgContainer.querySelector(`[data-door-id="${doorId}"]`);
      if (!marker) return;
      editChanges.push({ type: 'delete', doorId: doorId, element: marker });
      marker.remove();
      deselectDoor();
      populateSidePanel();
      if (showLabels) updateEditLabels();
    }

    function renameMarker(doorId, newId) {
      const marker = svgContainer.querySelector(`[data-door-id="${doorId}"]`);
      if (!marker) return;
      marker.setAttribute('id', newId);
      marker.setAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label', newId);
      marker.dataset.doorId = newId;
      editChanges.push({ type: 'rename', oldId: doorId, newId: newId });
      populateSidePanel();
      if (showLabels) updateEditLabels();
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
      editChanges.push({ type: 'resize', doorId: resizingMarker.doorId, oldRx: resizingOldRx });
      clearResizeHighlight(resizingMarker.marker);
      resizingMarker = null;
      resizingOldRx = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
      if (showLabels) updateEditLabels();
    }

    function cancelResize() {
      if (!resizingMarker) return;
      resizingMarker.marker.setAttribute('rx', resizingOldRx.toString());
      resizingMarker.marker.setAttribute('ry', resizingOldRx.toString());
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
      editChanges.push({ type: 'move', doorId: movingMarker.doorId, oldCx: movingMarker.origCx, oldCy: movingMarker.origCy });
      clearMoveHighlight(movingMarker.marker);
      movingMarker = null;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
      if (showLabels) updateEditLabels();
    }

    function cancelMoveMode() {
      if (!movingMarker) return;
      movingMarker.marker.setAttribute('cx', movingMarker.origCx.toString());
      movingMarker.marker.setAttribute('cy', movingMarker.origCy.toString());
      clearMoveHighlight(movingMarker.marker);
      movingMarker = null;
      isDraggingMove = false;
      document.querySelector('.edit-label').textContent = 'Bewerkingsmodus';
    }

    // ============================================================
    // AUTO-NUMBERING
    // ============================================================

    function getNextAutoCode() {
      if (!autoPrefix) return '';
      const markers = svgContainer.querySelectorAll('[data-door-id]');
      let max = 0;
      markers.forEach(m => {
        const id = m.dataset.doorId;
        if (id.startsWith(autoPrefix)) {
          const suffix = id.slice(autoPrefix.length);
          if (/^\d+$/.test(suffix)) {
            const n = parseInt(suffix, 10);
            if (n > max) max = n;
          }
        }
      });
      return autoPrefix + String(max + 1).padStart(autoPadding, '0');
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
      const currentScale = scale || 1;
      const fontSize = Math.max(5, Math.min(120, 16 / currentScale));
      const offset = Math.max(3, 8 / currentScale);
      const strokeWidth = Math.max(1, 3 / currentScale);
      svgContainer.querySelectorAll('[data-door-id]').forEach(m => {
        const cx = parseFloat(m.getAttribute('cx')) || 0;
        const cy = parseFloat(m.getAttribute('cy')) || 0;
        const rx = parseFloat(m.getAttribute('rx')) || 10;
        const labelText = m.dataset.doorId;
        const estimatedWidth = labelText.length * fontSize * 0.62;
        const bounds = getEditableBounds();
        const hasRoomRight = !bounds || (cx + rx + offset + estimatedWidth <= bounds.x + bounds.width);
        const x = hasRoomRight ? cx + rx + offset : cx - rx - offset;
        const y = bounds
          ? Math.max(bounds.y + fontSize, Math.min(bounds.y + bounds.height - fontSize * 0.25, cy + fontSize * 0.4))
          : cy + fontSize * 0.4;
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x.toString());
        text.setAttribute('y', y.toString());
        text.setAttribute('font-size', fontSize.toString());
        text.setAttribute('fill', '#222');
        text.setAttribute('stroke', '#fff');
        text.setAttribute('stroke-width', strokeWidth.toString());
        text.setAttribute('paint-order', 'stroke');
        text.setAttribute('text-anchor', hasRoomRight ? 'start' : 'end');
        text.setAttribute('data-fd-label', '1');
        text.setAttribute('pointer-events', 'none');
        text.style.userSelect = 'none';
        text.textContent = labelText;
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
      topbarMenu.style.display = 'none';
    }

    function updateLabelsMenuButton() {
      const btn = document.getElementById('btn-menu-labels');
      if (!btn) return;
      btn.textContent = showLabels ? 'Labels verbergen' : 'Labels tonen';
      btn.classList.toggle('active', showLabels);
    }

    function handleEditTapOnEmpty(e) {
      if (!isEditMode) return;
      if (movingMarker) { cancelMoveMode(); return; }
      if (resizingMarker) { applyResize(); return; }
      const svgEl = svgContainer.querySelector('svg');
      if (!svgEl) return;

      const svgPoint = getSvgPointFromClient(e.clientX, e.clientY);
      if (!svgPoint || !isPointInsideEditableBounds(svgPoint.x, svgPoint.y)) return;

      if (autoNumbering) {
        const code = getNextAutoCode();
        if (!code) { showToast('Voer eerst een prefix in', 'error'); return; }
        if ([...svgContainer.querySelectorAll('[data-door-id]')].some(m => m.dataset.doorId === code)) {
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
            if (svgContainer.querySelector(`[data-door-id="${code}"]`)) {
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
      if (!isEditMode) return;
      if (movingMarker) { cancelMoveMode(); return; }
      if (resizingMarker) { applyResize(); return; }
      const marker = svgContainer.querySelector(`[data-door-id="${doorId}"]`);
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
          text: 'Code wijzigen', color: '#304A5E',
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

    const STATUS_CACHE_KEY = 'fd_status_cache';
    const STATUS_QUEUE_KEY = 'fd_status_sync_queue';
    let statusSyncInProgress = false;
    let statusSyncRetryTimer = null;

    function readCachedDoorStatus() {
      try {
        return JSON.parse(localStorage.getItem(STATUS_CACHE_KEY) || '{}') || {};
      } catch {
        return {};
      }
    }

    function cacheDoorStatus() {
      try {
        localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(doorStatus));
      } catch (err) {
        console.warn('Status cache kon niet worden opgeslagen:', err);
      }
    }

    function readStatusSyncQueue() {
      try {
        const queue = JSON.parse(localStorage.getItem(STATUS_QUEUE_KEY) || '[]');
        return Array.isArray(queue) ? queue : [];
      } catch {
        return [];
      }
    }

    function writeStatusSyncQueue(queue) {
      try {
        localStorage.setItem(STATUS_QUEUE_KEY, JSON.stringify(queue));
      } catch (err) {
        console.warn('Status sync queue kon niet worden opgeslagen:', err);
      }
      updateStatusSyncIndicator();
    }

    function applyStatusOperation(statusData, op) {
      if (!statusData[op.customer]) statusData[op.customer] = {};
      if (!statusData[op.customer][op.floorplan]) statusData[op.customer][op.floorplan] = {};

      if (op.status === 'done') {
        statusData[op.customer][op.floorplan][op.doorId] = 'done';
      } else {
        delete statusData[op.customer][op.floorplan][op.doorId];
      }
    }

    function applyQueuedStatusOperations(statusData, queue) {
      queue.forEach(op => applyStatusOperation(statusData, op));
      return statusData;
    }

    function enqueueStatusSync(op) {
      const queue = readStatusSyncQueue()
        .filter(existing => !(existing.customer === op.customer &&
                              existing.floorplan === op.floorplan &&
                              existing.doorId === op.doorId));
      queue.push(op);
      writeStatusSyncQueue(queue);
    }

    function isSameStatusOperation(a, b) {
      return a.customer === b.customer &&
             a.floorplan === b.floorplan &&
             a.doorId === b.doorId &&
             a.status === b.status &&
             a.ts === b.ts;
    }

    function removeSyncedStatusOperations(syncedQueue) {
      const latestQueue = readStatusSyncQueue();
      return latestQueue.filter(op => !syncedQueue.some(synced => isSameStatusOperation(op, synced)));
    }

    function scheduleStatusSyncRetry() {
      if (statusSyncRetryTimer) return;
      statusSyncRetryTimer = setTimeout(() => {
        statusSyncRetryTimer = null;
        flushStatusSyncQueue();
      }, 15000);
    }

    async function saveStatusToGitHub(statusData, messageCustomer) {
      // Get current file SHA (needed for update)
      const metaResp = await fetch(CONFIG.statusUrl, {
        headers: ghHeaders(),
        cache: 'no-store',
      });
      if (!metaResp.ok) throw new Error('Kon status.json niet ophalen');
      const meta = await metaResp.json();

      // Encode updated status as base64
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(statusData, null, 2))));

      // Update file on GitHub
      const updateResp = await fetch(CONFIG.statusUrl, {
        method: 'PUT',
        headers: ghHeaders(),
        cache: 'no-store',
        body: JSON.stringify({
          message: 'Status update: ' + (messageCustomer || 'offline queue'),
          content: content,
          sha: meta.sha,
        }),
      });
      if (!updateResp.ok) throw new Error('Kon status niet opslaan');
    }

    async function flushStatusSyncQueue() {
      const queue = readStatusSyncQueue();
      if (statusSyncInProgress || queue.length === 0 || !navigator.onLine) return;

      statusSyncInProgress = true;
      let shouldFlushAgain = false;
      try {
        const remoteStatus = await fetchGitHubJSON(CONFIG.statusUrl);
        const mergedStatus = applyQueuedStatusOperations(remoteStatus, queue);
        await saveStatusToGitHub(mergedStatus, queue[queue.length - 1]?.customer);
        const remainingQueue = removeSyncedStatusOperations(queue);
        doorStatus = applyQueuedStatusOperations(mergedStatus, remainingQueue);
        writeStatusSyncQueue(remainingQueue);
        cacheDoorStatus();
        refreshAllDoorColors();
        updateDoneButton();
        showToast('Status gesynchroniseerd', 'success');
        shouldFlushAgain = remainingQueue.length > 0;
      } catch (err) {
        console.error('Status sync queue mislukt:', err);
        scheduleStatusSyncRetry();
      } finally {
        statusSyncInProgress = false;
        if (shouldFlushAgain) setTimeout(flushStatusSyncQueue, 0);
      }
    }

    async function toggleDoorStatus() {
      if (!selectedDoor || !currentCustomer || !currentFloorplan) return;

      const customer = currentCustomer;
      const floorplan = currentFloorplan;
      const doorId = selectedDoor;
      const isDone = getDoorStatus(doorId);
      const newStatus = isDone ? 'todo' : 'done';
      const op = { customer, floorplan, doorId, status: newStatus, ts: Date.now() };

      // Update local state
      if (!doorStatus[customer]) doorStatus[customer] = {};
      if (!doorStatus[customer][floorplan]) doorStatus[customer][floorplan] = {};

      if (newStatus === 'done') {
        doorStatus[customer][floorplan][doorId] = 'done';
      } else {
        delete doorStatus[customer][floorplan][doorId];
      }

      // Update UI immediately
      refreshAllDoorColors();
      updateDoneButton();
      cacheDoorStatus();
      enqueueStatusSync(op);

      if (navigator.onLine) {
        flushStatusSyncQueue();
        showToast(newStatus === 'done' ? 'Deur afgerond' : 'Deur teruggezet', 'success');
      } else {
        showToast('Status lokaal opgeslagen — synchroniseert later', 'success');
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
        movingMarker.marker.setAttribute('cx', Math.round(pos.x).toString());
        movingMarker.marker.setAttribute('cy', Math.round(pos.y).toString());
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
        panX = cx - (cx - panX) * (clampedScale / scale);
        panY = cy - (cy - panY) * (clampedScale / scale);
        scale = clampedScale;

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

      panX = cx - (cx - panX) * (newScale / scale);
      panY = cy - (cy - panY) * (newScale / scale);
      scale = newScale;

      applyTransform();
      if (showLabels) updateEditLabels();
    }, { passive: false });

    // ============================================================
    // STATUS POLLING
    // ============================================================

    async function pollStatus() {
      if (!currentFloorplan || isEditMode) return;
      try {
        const remoteStatus = await fetchGitHubJSON(CONFIG.statusUrl);
        doorStatus = applyQueuedStatusOperations(remoteStatus, readStatusSyncQueue());
        cacheDoorStatus();
        refreshAllDoorColors();
        flushStatusSyncQueue();
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
    let uploadGeneration = 0;

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
      uploadGeneration++;
      uploadOverlay.style.display = 'none';
      uploadPopup.style.display = 'none';
      uploadPdfInput.value = '';
      uploadPhotoInput.value = '';
      uploadImageDataUrl = null;
      uploadImageWidth = 0;
      uploadImageHeight = 0;
      uploadPreviewImg.src = '';
      uploadCustomerSelect.style.display = '';
      uploadNewCustomerWrapper.style.display = 'none';
      uploadNewCustomer.value = '';
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

      uploadCustomerSelect.style.display = '';
      uploadNewCustomerWrapper.style.display = 'none';
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
      if (file.size > 20 * 1024 * 1024) {
        showToast('Bestand is te groot (max 20 MB)', 'error');
        return;
      }
      const gen = ++uploadGeneration;
      const img = new Image();
      img.onload = () => {
        if (gen !== uploadGeneration) return;
        const result = resizeImageToCanvas(img, 2000);
        let quality = 0.8, dataUrl;
        do { dataUrl = result.canvas.toDataURL('image/jpeg', quality); quality -= 0.1; }
        while (dataUrl.length > 1040000 && quality > 0.2);
        if (dataUrl.length > 1040000) {
          showToast('Afbeelding te groot. Probeer een kleinere foto.', 'error');
          URL.revokeObjectURL(img.src);
          return;
        }
        showUploadPreview(dataUrl, result.width, result.height);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });

    // PDF handling
    uploadPdfInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        showToast('Bestand is te groot (max 20 MB)', 'error');
        return;
      }
      if (!window.pdfjsLib) {
        showToast('PDF library niet geladen. Gebruik een foto.', 'error');
        return;
      }
      const gen = ++uploadGeneration;
      // Show loading state
      uploadStepChoose.style.display = 'none';
      uploadStepPreview.style.display = 'block';
      uploadPreviewImg.style.display = 'none';
      document.querySelector('#upload-step-preview h3').textContent = 'PDF verwerken...';
      document.querySelector('#upload-step-preview .upload-btn-grey').style.display = 'none';
      document.querySelector('#upload-step-preview .upload-btn-green').style.display = 'none';
      try {
        const arrayBuffer = await file.arrayBuffer();
        if (gen !== uploadGeneration) return;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (gen !== uploadGeneration) return;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (gen !== uploadGeneration) return;
        let quality = 0.8, dataUrl;
        do { dataUrl = canvas.toDataURL('image/jpeg', quality); quality -= 0.1; }
        while (dataUrl.length > 1040000 && quality > 0.2);
        if (dataUrl.length > 1040000) {
          uploadStepPreview.style.display = 'none';
          uploadStepChoose.style.display = 'block';
          showToast('PDF te groot. Probeer een andere pagina of foto.', 'error');
          return;
        }
        uploadPreviewImg.style.display = '';
        document.querySelector('#upload-step-preview h3').textContent = 'Voorbeeld';
        document.querySelector('#upload-step-preview .upload-btn-grey').style.display = '';
        document.querySelector('#upload-step-preview .upload-btn-green').style.display = '';
        showUploadPreview(dataUrl, viewport.width, viewport.height);
      } catch (err) {
        if (gen !== uploadGeneration) return;
        uploadStepPreview.style.display = 'none';
        uploadStepChoose.style.display = 'block';
        showToast('PDF kon niet worden geladen', 'error');
      }
    });

    const uploadNewCustomerWrapper = document.getElementById('upload-new-customer-wrapper');

    function showNewCustomerInput() {
      uploadCustomerSelect.style.display = 'none';
      uploadNewCustomerWrapper.style.display = 'block';
      uploadNewCustomer.focus();
    }

    function showCustomerSelect() {
      uploadNewCustomerWrapper.style.display = 'none';
      uploadCustomerSelect.style.display = '';
      uploadCustomerSelect.value = '';
      uploadNewCustomer.value = '';
    }

    uploadCustomerSelect.addEventListener('change', () => {
      if (uploadCustomerSelect.value === '__new__') showNewCustomerInput();
    });

    document.getElementById('btn-back-to-select').addEventListener('click', showCustomerSelect);

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

      let uploadedSvgUrl = null;
      let uploadedSvgSha = null;

      try {
        // Step 1: Upload SVG to floorplan-uploads repo
        const svgContent = btoa(unescape(encodeURIComponent(svgText)));
        const uploadUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fileName);
        uploadedSvgUrl = uploadUrl;

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
        const uploadData = await uploadResp.json();
        uploadedSvgSha = uploadData.content?.sha;

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
        cacheCustomers();
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
        // Rollback: delete the uploaded SVG if customers.json update failed
        if (uploadedSvgUrl && uploadedSvgSha) {
          try {
            await fetch(uploadedSvgUrl, {
              method: 'DELETE',
              headers: ghHeaders(),
              cache: 'no-store',
              body: JSON.stringify({ message: 'Rollback: upload mislukt', sha: uploadedSvgSha }),
            });
          } catch (e) {}
        }
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
    const btnEditImage = document.getElementById('btn-edit-image');
    const deleteFpOverlay = document.getElementById('delete-fp-overlay');
    const deleteFpPopup = document.getElementById('delete-fp-popup');
    const deleteFpMessage = document.getElementById('delete-fp-message');

    function updateDeleteButton() {
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      if (!isNaN(ci) && !isNaN(fi) && customers[ci] && customers[ci].floorplans[fi]) {
        const fp = customers[ci].floorplans[fi];
        const isUpload = fp.uploaded || fp.repo === 'uploads';
        btnDeleteFp.style.display  = isUpload ? 'block' : 'none';
        btnEditImage.style.display = isUpload ? 'block' : 'none';
      } else {
        btnDeleteFp.style.display  = 'none';
        btnEditImage.style.display = 'none';
      }
      requestAnimationFrame(updateTopbarHeight);
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
        // Step 1: Update customers.json first (resolve by name, not stale index)
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

        // Step 2: Delete SVG from uploads repo (after customers.json is updated)
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
        if (!deleteResp.ok) {
          // Rollback: restore customers.json entry
          try {
            const rollbackResp = await fetch(CONFIG.customersUrl, { headers: ghHeaders(), cache: 'no-store' });
            if (rollbackResp.ok) {
              const rollbackMeta = await rollbackResp.json();
              const rollbackCustomers = JSON.parse(decodeBase64UTF8(rollbackMeta.content));
              const rollbackCi = rollbackCustomers.findIndex(c => c.customer === customerName);
              if (rollbackCi >= 0) {
                rollbackCustomers[rollbackCi].floorplans.push({ name: fp.name, file: fp.file, repo: 'uploads', uploaded: true });
              } else {
                rollbackCustomers.push({ customer: customerName, floorplans: [{ name: fp.name, file: fp.file, repo: 'uploads', uploaded: true }] });
              }
              await fetch(CONFIG.customersUrl, {
                method: 'PUT',
                headers: ghHeaders(),
                cache: 'no-store',
                body: JSON.stringify({
                  message: 'Rollback: verwijderen mislukt',
                  content: btoa(unescape(encodeURIComponent(JSON.stringify(rollbackCustomers, null, 2)))),
                  sha: rollbackMeta.sha,
                }),
              });
            }
          } catch (e) {}
          throw new Error('Kon bestand niet verwijderen');
        }

        // Reload
        customers = currentCustomers;
        cacheCustomers();
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
          setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
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
      if (isEditMode) exitEditMode();
      resetFloorplanUI();
      currentCustomer = null;
      currentFloorplan = null;
      updateDeleteButton();

      const idx = customerSelect.value;
      if (idx === '') {
        floorplanSelect.innerHTML = '<option value="">-- Kies plattegrond --</option>';
        floorplanSelect.disabled = true;
        setEmptyState('Kies een klant en plattegrond<br>om te beginnen.', 'Gebruik de dropdowns bovenaan');
        loadingEl.classList.remove('hidden');
        return;
      }
      setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
      loadingEl.classList.remove('hidden');
      populateFloorplanDropdown(parseInt(idx, 10));
    });

    floorplanSelect.addEventListener('change', () => {
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      if (isNaN(ci) || isNaN(fi)) {
        if (isEditMode) exitEditMode();
        resetFloorplanUI();
        currentCustomer = null;
        currentFloorplan = null;
        setEmptyState('Kies een plattegrond<br>uit het dropdown menu.');
        loadingEl.classList.remove('hidden');
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

    document.getElementById('btn-edit-cancel').addEventListener('click', () => {
      if (editChanges.length === 0 && !resizingMarker && !movingMarker) { cancelEditMode(); return; }
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
      if (resizingMarker) {
        value = Math.min(value, getMaxRadiusAtPosition(resizingMarker.marker));
      }
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
    const splashScreen = document.getElementById('splash-screen');
    function hideSplash() { if (splashScreen) splashScreen.style.display = 'none'; }
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

    async function validateGitHubTokenForLogin(token) {
      try {
        const testResp = await fetch(CONFIG.customersUrl, {
          headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
          cache: 'no-store',
        });
        if (testResp.ok) return { ok: true, offline: false };
        if (testResp.status === 401 || testResp.status === 403) {
          return { ok: false, message: 'GitHub token is ongeldig of verlopen.' };
        }
        return { ok: false, message: 'GitHub controle mislukt: ' + testResp.status };
      } catch {
        return { ok: true, offline: true };
      }
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

        // Validate token against GitHub API; network failure is allowed for offline use.
        const validation = await validateGitHubTokenForLogin(token);
        if (!validation.ok) {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Inloggen';
          loginError.textContent = validation.message;
          return;
        }

        localStorage.setItem(LOGIN_CONFIG.tokenKey, 'authenticated');
        localStorage.setItem(LOGIN_CONFIG.tokenTimeKey, Date.now().toString());
        localStorage.setItem('fd_github_token', token);
        sessionStorage.removeItem(LOGIN_CONFIG.tokenKey);
        sessionStorage.removeItem(LOGIN_CONFIG.tokenTimeKey);
        sessionStorage.removeItem('fd_github_token');

        // Read attempts before clearing
        const priorAttempts = getAttempts();
        localStorage.removeItem(LOGIN_CONFIG.attemptsKey);
        localStorage.removeItem(LOGIN_CONFIG.lockoutKey);

        // Remember checkbox state (not the password — use browser password manager)
        localStorage.removeItem('fd_saved_password');
        if (document.getElementById('login-remember').checked) {
          localStorage.setItem('fd_remember_pw', '1');
        } else {
          localStorage.removeItem('fd_remember_pw');
        }

        loginBtn.textContent = 'Inloggen';
        sendLoginNotification('Succesvol ingelogd', priorAttempts > 0 ? priorAttempts + ' foute pogingen vooraf' : '0');
        if (validation.offline) showToast('Offline ingelogd', 'success');
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
      updateConnectionIndicator();
      updateStatusSyncIndicator();
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
      localStorage.removeItem(LOGIN_CONFIG.tokenKey);
      localStorage.removeItem(LOGIN_CONFIG.tokenTimeKey);
      localStorage.removeItem('fd_github_token');
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
    document.getElementById('btn-menu-labels').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLabels();
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
      updateLabelsMenuButton();
      await Promise.all([loadCustomers(), loadStatus()]);
    }

    // Check if already logged in. Phase 5 keeps the session until explicit logout.
    function isSessionValid() {
      const legacyToken = sessionStorage.getItem(LOGIN_CONFIG.tokenKey);
      if (legacyToken === 'authenticated') {
        localStorage.setItem(LOGIN_CONFIG.tokenKey, 'authenticated');
        localStorage.setItem(LOGIN_CONFIG.tokenTimeKey, sessionStorage.getItem(LOGIN_CONFIG.tokenTimeKey) || Date.now().toString());
        const legacyGitHubToken = sessionStorage.getItem('fd_github_token');
        if (legacyGitHubToken) localStorage.setItem('fd_github_token', legacyGitHubToken);
        sessionStorage.removeItem(LOGIN_CONFIG.tokenKey);
        sessionStorage.removeItem(LOGIN_CONFIG.tokenTimeKey);
        sessionStorage.removeItem('fd_github_token');
      }

      const token = localStorage.getItem(LOGIN_CONFIG.tokenKey);
      const githubToken = localStorage.getItem('fd_github_token');
      if (token !== 'authenticated' || !githubToken) {
        localStorage.removeItem(LOGIN_CONFIG.tokenKey);
        localStorage.removeItem(LOGIN_CONFIG.tokenTimeKey);
        localStorage.removeItem('fd_github_token');
        return false;
      }
      return true;
    }

    function restoreSavedPassword() {
      if (localStorage.getItem('fd_remember_pw') === '1') {
        document.getElementById('login-remember').checked = true;
      }
    }

    restoreSavedPassword();

    try {
      if (isSessionValid()) {
        // Show app immediately; validate token silently in background.
        // Only kick back to login on explicit 401/403 — network errors are fine (offline use).
        hideSplash();
        showApp();
        validateGitHubTokenForLogin(getGitHubToken()).then(validation => {
          if (!validation.ok && !validation.offline) {
            localStorage.removeItem(LOGIN_CONFIG.tokenKey);
            localStorage.removeItem(LOGIN_CONFIG.tokenTimeKey);
            localStorage.removeItem('fd_github_token');
            appContainer.style.display = 'none';
            loginScreen.style.display = 'flex';
            loginError.textContent = validation.message || 'Sessie verlopen. Log opnieuw in.';
            checkLockoutState();
          }
        }).catch(() => {
          // Network error — stay in app (offline use allowed)
        });
      } else {
        hideSplash();
        loginScreen.style.display = 'flex';
        checkLockoutState();
      }
    } catch (err) {
      // Fallback: always hide splash and show login on unexpected error
      hideSplash();
      loginScreen.style.display = 'flex';
      console.error('Startup fout:', err);
    }

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

    function getCurrentFloorplanObj() {
      const ci = parseInt(customerSelect.value, 10);
      const fi = parseInt(floorplanSelect.value, 10);
      return customers[ci]?.floorplans[fi];
    }

    function openImageEditor() {
      if (isEditMode) { showToast('Sluit eerst de bewerkingsmodus', 'error'); return; }
      topbarMenu.style.display = 'none';

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
      const imgX = svgImgEl.getAttribute('x') || '0';
      const imgY = svgImgEl.getAttribute('y') || '0';
      const imgW = svgImgEl.getAttribute('width') || String(vb.width);
      const imgH = svgImgEl.getAttribute('height') || String(vb.height);
      const tempSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb.width} ${vb.height}"><image href="${imageHref}" x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}"/></svg>`;
      const editorSourceUrl = URL.createObjectURL(new Blob([tempSvg], { type: 'image/svg+xml;charset=utf-8' }));

      editorStage = document.getElementById('img-editor-stage');
      editorCanvas = document.getElementById('img-editor-canvas');
      editorCtx = editorCanvas.getContext('2d');
      editorUndoStack = [];
      editorBaseScale = 0;
      editorPanX = 0; editorPanY = 0;
      cropRect = null; activeCropHandle = null;
      editorSnapshot = null;
      editorSaving = false;

      const img = new Image();
      img.onload = () => {
        editorCanvas.width  = Math.round(vb.width);
        editorCanvas.height = Math.round(vb.height);
        editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
        editorCtx.drawImage(img, 0, 0, editorCanvas.width, editorCanvas.height);
        URL.revokeObjectURL(editorSourceUrl);
        document.getElementById('img-editor-undo').disabled = true;
        document.getElementById('img-editor-save').disabled = false;
        document.getElementById('img-editor-save').textContent = '\uD83D\uDCBE Opslaan';
        document.getElementById('img-editor-overlay').style.display = 'flex';
        waitForEditorLayoutAndFit();
      };
      img.onerror = () => {
        URL.revokeObjectURL(editorSourceUrl);
        showToast('Afbeelding laden mislukt', 'error');
      };
      img.src = editorSourceUrl;
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

    function closeImageEditor() {
      stopCropPreview({ restoreCanvas: false, clearSnapshot: true });
      document.getElementById('img-editor-overlay').style.display = 'none';
      editorUndoStack = [];
      cropRect = null; activeCropHandle = null;
      editorSaving = false;
      editorTool = 'pan';
      editorCanvas.dataset.tool = 'pan';
      editorIsPanning = false; editorDragMode = null;
      activeEditorPointers.clear(); editorIsPinching = false; editorPinchDist = null;
    }

    function setEditorTool(tool) {
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

    async function saveEditorChanges() {
      if (editorSaving) return;
      const fp = getCurrentFloorplanObj();
      if (!fp) { showToast('Geen plattegrond geselecteerd', 'error'); return; }

      const btnSave = document.getElementById('img-editor-save');
      btnSave.disabled = true;
      btnSave.textContent = 'Opslaan...';
      editorSaving = true;
      const shouldResumeCrop = editorTool === 'crop' && !!editorSnapshot;
      const savedCropRect = cropRect ? { ...cropRect } : null;

      try {
        if (editorSnapshot) stopCropPreview({ restoreCanvas: true, clearSnapshot: false });
        const newDataUrl = editorCanvas.toDataURL('image/jpeg', 0.8);
        const W = editorCanvas.width, H = editorCanvas.height;
        const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">\n  <image href="${newDataUrl}" width="${W}" height="${H}"/>\n</svg>`;
        const svgContent = btoa(unescape(encodeURIComponent(svgText)));

        const fileUrl = CONFIG.svgUploadsUrl + encodeURIComponent(fp.file);
        const metaResp = await fetch(fileUrl, { headers: ghHeaders(), cache: 'no-store' });
        if (!metaResp.ok) throw new Error('Kon bestand niet ophalen (' + metaResp.status + ')');
        const meta = await metaResp.json();

        const updateResp = await fetch(fileUrl, {
          method: 'PUT',
          headers: ghHeaders(),
          cache: 'no-store',
          body: JSON.stringify({
            message: 'Afbeelding bewerkt: ' + currentCustomer + ' - ' + currentFloorplan,
            content: svgContent,
            sha: meta.sha,
          }),
        });
        if (!updateResp.ok) throw new Error('Opslaan mislukt (' + updateResp.status + ')');

        closeImageEditor();
        showToast('Afbeelding opgeslagen', 'success');
        const ci = parseInt(customerSelect.value, 10);
        const fi = parseInt(floorplanSelect.value, 10);
        if (!isNaN(ci) && !isNaN(fi)) loadFloorplan(ci, fi);

      } catch (err) {
        if (shouldResumeCrop && document.getElementById('img-editor-overlay').style.display !== 'none') {
          setEditorTool('crop');
          if (savedCropRect) cropRect = savedCropRect;
        }
        showToast('Fout: ' + err.message, 'error');
        editorSaving = false;
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

    document.getElementById('img-editor-undo').addEventListener('click', editorUndo);
    document.getElementById('img-editor-tool-pan').addEventListener('click', () => setEditorTool('pan'));
    document.getElementById('img-editor-tool-crop').addEventListener('click', () => setEditorTool('crop'));
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
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomEditorAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    window.addEventListener('resize', () => {
      if (document.getElementById('img-editor-overlay').style.display !== 'none') {
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
