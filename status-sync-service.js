(function (global) {
  const FD = global.FD = global.FD || {};
  const StatusService = FD.StatusService;
  const DataService = FD.DataService;

  function requireServices() {
    if (!StatusService) throw new Error('FD.StatusService ontbreekt');
    if (!DataService) throw new Error('FD.DataService ontbreekt');
  }

  function create(config, options = {}) {
    requireServices();

    const retryDelayMs = options.retryDelayMs || 15000;
    const networkCooldownMs = options.networkCooldownMs || 60000;
    let syncInProgress = false;
    let retryTimer = null;
    let networkUnavailableUntil = 0;

    function isOnline() {
      if (typeof options.isOnline === 'function') return options.isOnline();
      return global.navigator?.onLine !== false;
    }

    function canAttemptNetworkWrite() {
      return isOnline() && Date.now() >= networkUnavailableUntil;
    }

    function markNetworkUnavailable() {
      networkUnavailableUntil = Date.now() + networkCooldownMs;
    }

    function markNetworkAvailable() {
      networkUnavailableUntil = 0;
    }

    function isNetworkError(err) {
      const message = String(err?.message || '');
      return err?.name === 'TypeError' ||
             /Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(message);
    }

    function readQueue() {
      return StatusService.readSyncQueue();
    }

    function getQueueCount() {
      return readQueue().length;
    }

    function writeQueue(queue) {
      StatusService.writeSyncQueue(queue);
      if (typeof options.onQueueChange === 'function') options.onQueueChange(queue);
    }

    function readCachedStatus() {
      return StatusService.readCachedDoorStatus();
    }

    function cacheStatus(statusData) {
      StatusService.cacheDoorStatus(statusData);
    }

    function applyQueuedStatusOperations(statusData, queue = readQueue()) {
      return StatusService.applyQueuedStatusOperations(statusData, queue);
    }

    function applyOperation(statusData, op) {
      StatusService.applyStatusOperation(statusData, op);
    }

    function enqueue(op) {
      const queue = StatusService.enqueueOperation(readQueue(), op);
      writeQueue(queue);
      return queue;
    }

    function toggleDoorStatus(statusData, params) {
      const op = StatusService.buildToggleOperation(statusData, params);
      applyOperation(statusData, op);
      cacheStatus(statusData);
      enqueue(op);
      setCurrentStatus(statusData);
      return {
        statusData,
        op,
        newStatus: op.status,
      };
    }

    function setCurrentStatus(statusData) {
      if (typeof options.setStatus === 'function') options.setStatus(statusData);
    }

    function scheduleRetry() {
      if (retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        flush();
      }, retryDelayMs);
    }

    async function loadStatusLocalFirst({ onCachedStatus } = {}) {
      const queuedOps = readQueue();
      const cachedStatus = readCachedStatus();
      const hasCachedStatus = Object.keys(cachedStatus).length > 0;
      let cachedMergedStatus = null;

      if (hasCachedStatus) {
        cachedMergedStatus = applyQueuedStatusOperations(cachedStatus, queuedOps);
        cacheStatus(cachedMergedStatus);
        if (typeof onCachedStatus === 'function') onCachedStatus(cachedMergedStatus);
      }

      if (!isOnline()) {
        return {
          status: cachedMergedStatus || {},
          source: cachedMergedStatus ? 'cache' : 'empty',
          error: null,
          offline: true,
        };
      }

      try {
        const remoteStatus = await DataService.loadStatus(config);
        const mergedStatus = applyQueuedStatusOperations(remoteStatus, queuedOps);
        cacheStatus(mergedStatus);
        flush();
        return { status: mergedStatus, source: 'remote', error: null };
      } catch (err) {
        return {
          status: cachedMergedStatus || {},
          source: cachedMergedStatus ? 'cache' : 'empty',
          error: err,
        };
      }
    }

    async function refreshRemoteStatus() {
      if (!isOnline()) {
        return applyQueuedStatusOperations(readCachedStatus(), readQueue());
      }
      const remoteStatus = await DataService.loadStatus(config);
      const mergedStatus = applyQueuedStatusOperations(remoteStatus, readQueue());
      cacheStatus(mergedStatus);
      return mergedStatus;
    }

    async function flush() {
      const queue = readQueue();
      if (syncInProgress || queue.length === 0 || !canAttemptNetworkWrite()) {
        return { synced: false, skipped: true, queue };
      }

      syncInProgress = true;
      let shouldFlushAgain = false;

      try {
        const remoteStatus = await DataService.loadStatus(config);
        const mergedStatus = applyQueuedStatusOperations(remoteStatus, queue);
        if (!canAttemptNetworkWrite()) {
          scheduleRetry();
          return { synced: false, skipped: true, queue, offline: true };
        }
        await DataService.saveStatus(config, mergedStatus, queue[queue.length - 1]?.customer);

        const remainingQueue = StatusService.removeSyncedOperations(readQueue(), queue);
        const nextStatus = applyQueuedStatusOperations(mergedStatus, remainingQueue);
        writeQueue(remainingQueue);
        cacheStatus(nextStatus);
        setCurrentStatus(nextStatus);

        if (typeof options.onSynced === 'function') {
          options.onSynced({ status: nextStatus, remainingQueue });
        }

        shouldFlushAgain = remainingQueue.length > 0;
        return { synced: true, status: nextStatus, remainingQueue };
      } catch (err) {
        if (isNetworkError(err)) {
          markNetworkUnavailable();
          if (typeof options.onNetworkUnavailable === 'function') options.onNetworkUnavailable(err);
        } else if (typeof options.onSyncError === 'function') {
          options.onSyncError(err);
        }
        scheduleRetry();
        return { synced: false, error: err };
      } finally {
        syncInProgress = false;
        if (shouldFlushAgain) setTimeout(flush, 0);
      }
    }

    return {
      readQueue,
      getQueueCount,
      writeQueue,
      readCachedStatus,
      cacheStatus,
      applyQueuedStatusOperations,
      applyOperation,
      enqueue,
      toggleDoorStatus,
      loadStatusLocalFirst,
      refreshRemoteStatus,
      flush,
      markNetworkAvailable,
      isSyncInProgress: () => syncInProgress,
    };
  }

  function createController({
    sync,
    intervalMs,
    getStatus,
    setStatus,
    getState,
    onStatusChanged,
    updateDoneButton,
    showToast,
    logger = console,
  }) {
    let pollTimer = null;

    function state() {
      return typeof getState === 'function' ? getState() : {};
    }

    function notifyStatusChanged() {
      if (typeof onStatusChanged === 'function') onStatusChanged();
      if (typeof updateDoneButton === 'function') updateDoneButton();
    }

    function flush() {
      return sync.flush();
    }

    async function toggleDoorStatus() {
      const { selectedDoor, currentCustomer, currentFloorplan, online } = state();
      if (!selectedDoor || !currentCustomer || !currentFloorplan) return null;

      const result = sync.toggleDoorStatus(getStatus(), {
        customer: currentCustomer,
        floorplan: currentFloorplan,
        doorId: selectedDoor,
        ts: Date.now(),
      });

      notifyStatusChanged();

      if (online === false) {
        if (typeof showToast === 'function') showToast('Status lokaal opgeslagen — synchroniseert later', 'success');
      } else {
        flush();
        if (typeof showToast === 'function') {
          showToast(result.newStatus === 'done' ? 'Deur afgerond' : 'Deur teruggezet', 'success');
        }
      }

      return result;
    }

    async function poll() {
      const { currentFloorplan, isEditMode, online } = state();
      if (!currentFloorplan || isEditMode || online === false) return;
      try {
        const nextStatus = await sync.refreshRemoteStatus();
        if (typeof setStatus === 'function') setStatus(nextStatus);
        if (typeof onStatusChanged === 'function') onStatusChanged();
        flush();
      } catch (err) {
        logger.error('Sync fout:', err);
      }
    }

    function startPolling() {
      stopPolling();
      pollTimer = global.setInterval(poll, intervalMs);
    }

    function stopPolling() {
      if (pollTimer) {
        global.clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    return {
      flush,
      poll,
      startPolling,
      stopPolling,
      toggleDoorStatus,
    };
  }

  FD.StatusSyncService = {
    create,
    createController,
  };
})(window);
