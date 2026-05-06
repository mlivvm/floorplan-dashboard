(function (global) {
  const FD = global.FD = global.FD || {};

  const STATUS_CACHE_KEY = 'fd_status_cache';
  const STATUS_QUEUE_KEY = 'fd_status_sync_queue';
  const STATUS_CYCLE_STARTED_KEY = '_cycleStartedAt';

  function getFloorplanStatusBucket(statusData, customer, floorplan, create = false) {
    if (!statusData[customer]) {
      if (!create) return null;
      statusData[customer] = {};
    }
    if (!statusData[customer][floorplan]) {
      if (!create) return null;
      statusData[customer][floorplan] = {};
    }
    return statusData[customer][floorplan];
  }

  function getCycleStartedMs(bucket) {
    if (!bucket) return 0;
    const started = Date.parse(bucket[STATUS_CYCLE_STARTED_KEY] || '');
    return Number.isFinite(started) ? started : 0;
  }

  function setCycleStartedAt(bucket, timestamp) {
    bucket[STATUS_CYCLE_STARTED_KEY] = new Date(timestamp).toISOString();
  }

  function isDoorDone(statusData, customer, floorplan, doorId) {
    const bucket = getFloorplanStatusBucket(statusData, customer, floorplan);
    return Boolean(bucket && bucket[doorId] === 'done');
  }

  function readCachedDoorStatus() {
    try {
      return JSON.parse(localStorage.getItem(STATUS_CACHE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function cacheDoorStatus(statusData) {
    try {
      localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(statusData));
    } catch (err) {
      console.warn('Status cache kon niet worden opgeslagen:', err);
    }
  }

  function readSyncQueue() {
    try {
      const queue = JSON.parse(localStorage.getItem(STATUS_QUEUE_KEY) || '[]');
      return Array.isArray(queue) ? queue : [];
    } catch {
      return [];
    }
  }

  function writeSyncQueue(queue) {
    try {
      localStorage.setItem(STATUS_QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.warn('Status sync queue kon niet worden opgeslagen:', err);
    }
  }

  function applyStatusOperation(statusData, op) {
    const bucket = getFloorplanStatusBucket(statusData, op.customer, op.floorplan, true);

    if (op.status === 'done') {
      if (!getCycleStartedMs(bucket)) setCycleStartedAt(bucket, op.ts || Date.now());
      bucket[op.doorId] = 'done';
    } else {
      delete bucket[op.doorId];
    }
  }

  function buildToggleOperation(statusData, { customer, floorplan, doorId, ts = Date.now() }) {
    return {
      customer,
      floorplan,
      doorId,
      status: isDoorDone(statusData, customer, floorplan, doorId) ? 'todo' : 'done',
      ts,
    };
  }

  function applyQueuedStatusOperations(statusData, queue) {
    queue.forEach(op => applyStatusOperation(statusData, op));
    return statusData;
  }

  function enqueueOperation(queue, op) {
    const nextQueue = queue
      .filter(existing => !(existing.customer === op.customer &&
                            existing.floorplan === op.floorplan &&
                            existing.doorId === op.doorId));
    nextQueue.push(op);
    return nextQueue;
  }

  function isSameOperation(a, b) {
    return a.customer === b.customer &&
           a.floorplan === b.floorplan &&
           a.doorId === b.doorId &&
           a.status === b.status &&
           a.ts === b.ts;
  }

  function removeSyncedOperations(latestQueue, syncedQueue) {
    return latestQueue.filter(op => !syncedQueue.some(synced => isSameOperation(op, synced)));
  }

  FD.StatusService = {
    STATUS_CYCLE_STARTED_KEY,
    getFloorplanStatusBucket,
    getCycleStartedMs,
    setCycleStartedAt,
    isDoorDone,
    readCachedDoorStatus,
    cacheDoorStatus,
    readSyncQueue,
    writeSyncQueue,
    applyStatusOperation,
    buildToggleOperation,
    applyQueuedStatusOperations,
    enqueueOperation,
    isSameOperation,
    removeSyncedOperations,
  };
})(window);
