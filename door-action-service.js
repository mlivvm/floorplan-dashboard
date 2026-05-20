(function (global) {
  const FD = global.FD = global.FD || {};
  const DEFAULT_RETURN_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

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

  function buildJotFormUrl({ baseUrl, formId, customer, doorId, floorplan, context }) {
    const params = new URLSearchParams();
    const customerName = customer?.customer || customer || '';
    const floorplanName = floorplan?.name || floorplan || '';
    const floorplanFile = floorplan?.file || '';
    const floorplanRepo = floorplan?.repo === 'uploads' ? 'uploads' : 'gallery';
    const signedDoorId = context?.signedDoorId || doorId;
    const appOrigin = global.location?.origin || '';
    const appPath = global.location?.pathname || '/';
    const returnUrl = appOrigin ? `${appOrigin}${appPath}?jotformReturn=1` : '';
    params.set('klant', customerName);
    params.set('deurNummer', doorId);
    params.set('fd_customer', customerName);
    params.set('fd_floorplan', floorplanName);
    params.set('fd_floorplan_file', floorplanFile);
    params.set('fd_floorplan_repo', floorplanRepo);
    params.set('fd_door_id', signedDoorId);
    if (appOrigin) params.set('fd_app_origin', appOrigin);
    if (returnUrl) params.set('fd_return_url', returnUrl);
    if (context?.contextToken) params.set('fd_context_token', context.contextToken);
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
      appOrigin: global.location?.origin || '',
      returnUrl: global.location?.origin ? `${global.location.origin}${global.location.pathname}?jotformReturn=1` : '',
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
    prepareJotFormContext,
    findJotFormSubmission,
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

    async function openJotForm() {
      const { selectedDoor, currentCustomer, currentFloorplan, online } = state();
      if (!selectedDoor) return;
      if (online === false) {
        if (typeof showToast === 'function') {
          showToast('Geen internet — vul later in via JotForm Mobile Forms-app', 'error');
        }
        return;
      }

      const jotFormWindow = typeof openWindow === 'function' ? openWindow('about:blank', '_blank') : null;

      let context = null;
      try {
        const isDone = typeof getDoorStatus === 'function' ? getDoorStatus(selectedDoor) : false;
        if (isDone && typeof findJotFormSubmission === 'function') {
          let existing = null;
          try {
            existing = await findJotFormSubmission({ selectedDoor, currentCustomer, currentFloorplan });
          } catch (err) {
            if (err?.status !== 404 && err?.status !== 501) throw err;
          }
          if (existing?.found && existing.editUrl) {
            if (typeof onBeforeOpenJotForm === 'function') {
              onBeforeOpenJotForm({ url: existing.editUrl, selectedDoor, currentCustomer, currentFloorplan });
            }
            if (jotFormWindow && !jotFormWindow.closed) {
              jotFormWindow.location.href = existing.editUrl;
            } else if (typeof openWindow === 'function') {
              openWindow(existing.editUrl, '_blank');
            }
            return;
          }

          if (typeof showToast === 'function') {
            showToast('Geen bestaand JotForm gevonden; nieuw formulier openen', 'success');
          }
        }

        if (typeof prepareJotFormContext === 'function') {
          context = await prepareJotFormContext({ selectedDoor, currentCustomer, currentFloorplan });
        }

        const url = buildJotFormUrl({
          baseUrl: config.baseUrl,
          formId: config.formId,
          customer: currentCustomer,
          doorId: selectedDoor,
          floorplan: currentFloorplan,
          context,
        });
        if (typeof onBeforeOpenJotForm === 'function') {
          onBeforeOpenJotForm({ url, selectedDoor, currentCustomer, currentFloorplan });
        }

        if (jotFormWindow && !jotFormWindow.closed) {
          jotFormWindow.location.href = url;
        } else if (typeof openWindow === 'function') {
          openWindow(url, '_blank');
        }
      } catch (err) {
        if (jotFormWindow && !jotFormWindow.closed && typeof jotFormWindow.close === 'function') {
          jotFormWindow.close();
        }
        throw err;
      }
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
