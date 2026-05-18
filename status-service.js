(function (global) {
  const FD = global.FD = global.FD || {};

  const STATUS_CACHE_KEY = 'fd_status_cache';
  const STATUS_QUEUE_KEY = 'fd_status_sync_queue';
  const DONE_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

  function isDoneStatusValue(value) {
    if (value === 'done') return true;
    if (typeof value !== 'string') return false;
    return DONE_AT_RE.test(value) && Number.isFinite(Date.parse(value));
  }

  function statusDoneAt(timestamp) {
    const parsed = Number(timestamp || Date.now());
    const safeTimestamp = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
    return new Date(safeTimestamp).toISOString();
  }

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

  function isDoorDone(statusData, customer, floorplan, doorId) {
    const bucket = getFloorplanStatusBucket(statusData, customer, floorplan);
    return Boolean(bucket && isDoneStatusValue(bucket[doorId]));
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
      bucket[op.doorId] = statusDoneAt(op.ts);
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
    isDoneStatusValue,
    statusDoneAt,
    getFloorplanStatusBucket,
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
