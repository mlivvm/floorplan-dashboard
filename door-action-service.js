(function (global) {
  const FD = global.FD = global.FD || {};
  const DEFAULT_RETURN_CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function setActionDisabled(button, disabled) {
    if (!button) return;
    button.classList.toggle('disabled', disabled);
  }

  function renderDoorInfo({
    doorNameEl,
    doorStatusEl,
    btnJotform,
    btnClose,
  }, { doorId, isDone, colors }) {
    doorNameEl.textContent = doorId;
    doorStatusEl.textContent = isDone ? '(afgerond)' : '(nog te doen)';
    doorStatusEl.style.color = isDone ? colors.done : colors.todo;
    setActionDisabled(btnJotform, false);
    setActionDisabled(btnClose, false);
  }

  function clearDoorInfo({
    doorNameEl,
    doorStatusEl,
    btnJotform,
    btnClose,
  }) {
    doorNameEl.textContent = '—';
    doorStatusEl.textContent = '';
    setActionDisabled(btnJotform, true);
    setActionDisabled(btnClose, true);
  }

  function renderDoneButton(button, { doorId, isDone }) {
    if (!doorId) {
      button.textContent = 'Gedaan';
      button.className = 'btn btn-done disabled';
      return;
    }

    if (isDone) {
      button.textContent = 'Terugzetten';
      button.className = 'btn btn-undo';
    } else {
      button.textContent = 'Gedaan';
      button.className = 'btn btn-done';
    }
  }

  function buildJotFormUrl({ baseUrl, formId, customer, doorId }) {
    const params = new URLSearchParams();
    params.set('klant', customer);
    params.set('deurNummer', doorId);
    return `${baseUrl}${formId}?${params.toString()}`;
  }

  function createReturnContext({ customer, floorplan, doorId, now = Date.now() }) {
    if (!customer || !floorplan || !doorId) return null;
    return {
      customerName: customer.customer || customer,
      floorplanName: floorplan.name || floorplan,
      floorplanFile: floorplan.file || '',
      floorplanRepo: floorplan.repo === 'uploads' ? 'uploads' : 'gallery',
      doorId,
      savedAt: now,
    };
  }

  function saveReturnContext(storage, key, context) {
    if (!storage || !key || !context) return false;
    try {
      storage.setItem(key, JSON.stringify(context));
      return true;
    } catch {
      return false;
    }
  }

  function readReturnContext(storage, key, {
    now = Date.now(),
    maxAgeMs = DEFAULT_RETURN_CONTEXT_MAX_AGE_MS,
  } = {}) {
    if (!storage || !key) return null;
    try {
      const context = JSON.parse(storage.getItem(key) || 'null');
      if (!context || typeof context !== 'object') return null;
      if (!context.customerName || !context.floorplanName || !context.doorId) return null;
      if (Number.isFinite(context.savedAt) && now - context.savedAt > maxAgeMs) return null;
      return context;
    } catch {
      return null;
    }
  }

  function hasReturnParam(locationObj = global.location) {
    return new URLSearchParams(locationObj.search || '').get('jotformReturn') === '1';
  }

  function clearReturnParam(historyObj = global.history, locationObj = global.location) {
    if (!historyObj?.replaceState || !locationObj) return;
    const url = new URL(locationObj.href);
    url.searchParams.delete('jotformReturn');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    historyObj.replaceState(null, '', nextUrl);
  }

  function findFloorplanIndex(floorplans, context) {
    if (!Array.isArray(floorplans) || !context) return -1;
    const repo = context.floorplanRepo === 'uploads' ? 'uploads' : 'gallery';
    const byFile = floorplans.findIndex(fp =>
      fp.file === context.floorplanFile &&
      (fp.repo === 'uploads' ? 'uploads' : 'gallery') === repo
    );
    if (byFile >= 0) return byFile;
    return floorplans.findIndex(fp => fp.name === context.floorplanName);
  }

  function createController({
    elements,
    config,
    colors,
    getState,
    setSelectedDoor,
    getDoorStatus,
    refreshAllDoorColors,
    scrollToDoor,
    showToast,
    openWindow,
    onBeforeOpenJotForm,
  }) {
    function state() {
      return typeof getState === 'function' ? getState() : {};
    }

    function updateDoneButton() {
      const { selectedDoor } = state();
      renderDoneButton(elements.btnDone, {
        doorId: selectedDoor,
        isDone: selectedDoor && typeof getDoorStatus === 'function' ? getDoorStatus(selectedDoor) : false,
      });
    }

    function selectDoor(doorId) {
      const { selectedDoor } = state();
      if (selectedDoor === doorId) {
        deselectDoor();
        return;
      }

      if (typeof setSelectedDoor === 'function') setSelectedDoor(doorId);
      if (typeof refreshAllDoorColors === 'function') refreshAllDoorColors();

      renderDoorInfo(elements, {
        doorId,
        isDone: typeof getDoorStatus === 'function' ? getDoorStatus(doorId) : false,
        colors,
      });
      updateDoneButton();
      if (typeof scrollToDoor === 'function') scrollToDoor(doorId);
    }

    function deselectDoor() {
      if (typeof setSelectedDoor === 'function') setSelectedDoor(null);
      if (typeof refreshAllDoorColors === 'function') refreshAllDoorColors();
      clearDoorInfo(elements);
      updateDoneButton();
    }

    function openJotForm() {
      const { selectedDoor, currentCustomer, online } = state();
      if (!selectedDoor) return;
      if (online === false) {
        if (typeof showToast === 'function') {
          showToast('Geen internet — vul later in via JotForm Mobile Forms-app', 'error');
        }
        return;
      }

      const url = buildJotFormUrl({
        baseUrl: config.baseUrl,
        formId: config.formId,
        customer: currentCustomer,
        doorId: selectedDoor,
      });
      if (typeof onBeforeOpenJotForm === 'function') {
        onBeforeOpenJotForm({ url, selectedDoor, currentCustomer, currentFloorplan });
      }
      if (typeof openWindow === 'function') openWindow(url, '_blank');
    }

    return {
      deselectDoor,
      openJotForm,
      selectDoor,
      updateDoneButton,
    };
  }

  FD.DoorActionService = {
    buildJotFormUrl,
    clearReturnParam,
    createController,
    createReturnContext,
    clearDoorInfo,
    findFloorplanIndex,
    hasReturnParam,
    readReturnContext,
    renderDoneButton,
    renderDoorInfo,
    saveReturnContext,
  };
})(window);
