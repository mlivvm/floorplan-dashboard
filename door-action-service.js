(function (global) {
  const FD = global.FD = global.FD || {};
  const DEFAULT_RETURN_CONTEXT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
  const DEFAULT_JOTFORM_FORM_TYPE = 'maintenance';
  const JOTFORM_FORM_TYPE_LABELS = {
    inspection: 'Opname',
    maintenance: 'Onderhoud',
  };

  function setActionDisabled(button, disabled) {
    if (!button) return;
    button.classList.toggle('disabled', disabled);
  }

  function normalizeJotFormFormType(value) {
    const type = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(JOTFORM_FORM_TYPE_LABELS, type)
      ? type
      : DEFAULT_JOTFORM_FORM_TYPE;
  }

  function getJotFormButtons(elements = {}) {
    const buttons = elements.btnJotforms && typeof elements.btnJotforms === 'object'
      ? { ...elements.btnJotforms }
      : {};
    if (elements.btnJotform && !buttons[DEFAULT_JOTFORM_FORM_TYPE]) {
      buttons[DEFAULT_JOTFORM_FORM_TYPE] = elements.btnJotform;
    }
    return Object.entries(buttons)
      .map(([type, button]) => ({ type: normalizeJotFormFormType(type), button }))
      .filter(({ button }) => button);
  }

  function setJotFormActionsDisabled(elements, disabled) {
    getJotFormButtons(elements).forEach(({ button }) => setActionDisabled(button, disabled));
  }

  function getJotFormForm(config = {}, formType = DEFAULT_JOTFORM_FORM_TYPE) {
    const type = normalizeJotFormFormType(formType);
    const forms = config.forms && typeof config.forms === 'object' ? config.forms : {};
    const form = forms[type] && typeof forms[type] === 'object' ? forms[type] : {};
    return {
      type,
      label: String(form.label || JOTFORM_FORM_TYPE_LABELS[type] || 'JotForm'),
      formId: String(form.formId || (type === DEFAULT_JOTFORM_FORM_TYPE ? config.formId : '') || '').trim(),
      disabled: Boolean(form.disabled),
    };
  }

  function renderDoorInfo({
    doorNameEl,
    doorStatusEl,
    btnJotform,
    btnJotforms,
    btnClose,
  }, { doorId, isDone, condition = 'unknown', colors }) {
    doorNameEl.textContent = doorId;
    const needsAttention = isDone && condition === 'attention';
    const checking = isDone && condition === 'checking';
    doorStatusEl.textContent = needsAttention ? '(aandacht nodig)' : (checking ? '(controleren...)' : (isDone ? '(afgerond)' : '(nog te doen)'));
    doorStatusEl.style.color = needsAttention
      ? (colors.attention || colors.done)
      : (checking ? (colors.checking || colors.done) : (isDone ? colors.done : colors.todo));
    setJotFormActionsDisabled({ btnJotform, btnJotforms }, false);
    setActionDisabled(btnClose, false);
  }

  function clearDoorInfo({
    doorNameEl,
    doorStatusEl,
    btnJotform,
    btnJotforms,
    btnClose,
  }) {
    doorNameEl.textContent = '—';
    doorStatusEl.textContent = '';
    setJotFormActionsDisabled({ btnJotform, btnJotforms }, true);
    setActionDisabled(btnClose, true);
  }

  function renderJotFormButton(button, { doorId, isDone, lookupState = {}, form = {} }) {
    if (!button) return;
    const baseLabel = String(form.label || 'JotForm');
    const unavailable = Boolean(form.disabled);
    const locked = Boolean(lookupState?.locked);
    const lockedLabel = String(lookupState?.lockedByLabel || '').trim();
    const lockedTitle = lockedLabel
      ? `Er hangt al een ${lockedLabel} formulier aan deze deur`
      : 'Er hangt al een ander formulier aan deze deur';
    button.dataset.jotformUnavailable = unavailable ? '1' : '0';
    button.dataset.jotformLocked = locked ? '1' : '0';
    button.dataset.jotformLockedTitle = locked ? lockedTitle : '';
    button.title = unavailable ? `${baseLabel} formulier nog niet beschikbaar` : '';
    if (!doorId || unavailable) {
      button.textContent = baseLabel;
      button.dataset.jotformAction = 'none';
      button.dataset.jotformPending = '0';
      setActionDisabled(button, true);
      return;
    }
    if (locked) {
      button.textContent = baseLabel;
      button.dataset.jotformAction = 'locked';
      button.dataset.jotformPending = '0';
      button.title = lockedTitle;
      setActionDisabled(button, true);
      return;
    }

    let action = 'new';
    let label = baseLabel;
    let pending = false;
    if (isDone) {
      if (lookupState?.editUrl || lookupState?.action === 'edit') {
        action = 'edit';
        label = `${baseLabel} aanpassen`;
      } else if (lookupState?.loading || lookupState?.action === 'open') {
        action = 'open';
        label = baseLabel;
        pending = true;
      }
    }

    button.textContent = label;
    button.dataset.jotformAction = action;
    button.dataset.jotformPending = pending ? '1' : '0';
    setActionDisabled(button, pending || !form.formId);
  }

  function renderDoneButton(button, { doorId, isDone }) {
    if (!doorId) {
      button.textContent = 'Gedaan';
      button.className = 'btn btn-done disabled';
      return;
    }

    if (isDone) {
      button.textContent = 'Terug';
      button.title = 'Terugzetten naar nog te doen';
      button.className = 'btn btn-undo';
    } else {
      button.textContent = 'Gedaan';
      button.title = '';
      button.className = 'btn btn-done';
    }
  }

  function buildJotFormUrl({ baseUrl, formId, formType = DEFAULT_JOTFORM_FORM_TYPE, customer, doorId, floorplan, context }) {
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
    params.set('fd_form_type', normalizeJotFormFormType(formType));
    if (appOrigin) params.set('fd_app_origin', appOrigin);
    if (returnUrl) params.set('fd_return_url', returnUrl);
    if (context?.contextToken) params.set('fd_context_token', context.contextToken);
    return `${baseUrl}${formId}?${params.toString()}`;
  }

  function createReturnContext({ customer, floorplan, doorId, formType = DEFAULT_JOTFORM_FORM_TYPE, now = Date.now() }) {
    if (!customer || !floorplan || !doorId) return null;
    return {
      customerName: customer.customer || customer,
      floorplanName: floorplan.name || floorplan,
      floorplanFile: floorplan.file || '',
      floorplanRepo: floorplan.repo === 'uploads' ? 'uploads' : 'gallery',
      doorId,
      formType: normalizeJotFormFormType(formType),
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
    getDoorCondition,
    refreshAllDoorColors,
    scrollToDoor,
    showToast,
    openWindow,
    onBeforeOpenJotForm,
    prepareJotFormContext,
    findJotFormSubmission,
    getJotFormButtonState,
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
      updateJotFormButton();
    }

    function updateJotFormButton() {
      const currentState = state();
      const { selectedDoor } = currentState;
      const isDone = selectedDoor && typeof getDoorStatus === 'function' ? getDoorStatus(selectedDoor) : false;
      getJotFormButtons(elements).forEach(({ type, button }) => {
        const lookupState = selectedDoor && typeof getJotFormButtonState === 'function'
          ? getJotFormButtonState({ ...currentState, isDone, formType: type })
          : {};
        renderJotFormButton(button, {
          doorId: selectedDoor,
          isDone,
          lookupState,
          form: getJotFormForm(config, type),
        });
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
        condition: typeof getDoorCondition === 'function' ? getDoorCondition(doorId) : 'unknown',
        colors,
      });
      updateJotFormButton();
      updateDoneButton();
      if (typeof scrollToDoor === 'function') scrollToDoor(doorId);
    }

    function deselectDoor() {
      if (typeof setSelectedDoor === 'function') setSelectedDoor(null);
      if (typeof refreshAllDoorColors === 'function') refreshAllDoorColors();
      clearDoorInfo(elements);
      updateJotFormButton();
      updateDoneButton();
    }

    async function openJotForm(formType = DEFAULT_JOTFORM_FORM_TYPE) {
      const type = normalizeJotFormFormType(formType);
      const form = getJotFormForm(config, type);
      if (form.disabled) {
        if (typeof showToast === 'function') showToast(`${form.label} formulier nog niet beschikbaar`, 'error');
        return;
      }
      if (!form.formId) {
        if (typeof showToast === 'function') showToast('JotForm formulier ontbreekt', 'error');
        return;
      }
      const { selectedDoor, currentCustomer, currentFloorplan, online } = state();
      if (!selectedDoor) return;
      if (online === false) {
        if (typeof showToast === 'function') {
          showToast('Geen internet — vul later in via JotForm Mobile Forms-app', 'error');
        }
        return;
      }

      const jotFormWindow = typeof openWindow === 'function' ? openWindow('about:blank', '_blank') : null;
      const stillCurrentSelection = () => {
        const latest = state();
        return latest.selectedDoor === selectedDoor &&
          latest.currentCustomer === currentCustomer &&
          latest.currentFloorplan === currentFloorplan;
      };
      const closeStaleWindow = () => {
        if (jotFormWindow && !jotFormWindow.closed && typeof jotFormWindow.close === 'function') {
          jotFormWindow.close();
        }
      };

      let context = null;
      try {
        const isDone = typeof getDoorStatus === 'function' ? getDoorStatus(selectedDoor) : false;
        if (isDone && typeof findJotFormSubmission === 'function') {
          let existing = null;
          try {
            existing = await findJotFormSubmission({ selectedDoor, currentCustomer, currentFloorplan, formType: type });
          } catch (err) {
            if (err?.status !== 404 && err?.status !== 501) throw err;
          }
          if (!stillCurrentSelection()) {
            closeStaleWindow();
            return;
          }
          if (existing?.found && existing.editUrl) {
            if (typeof onBeforeOpenJotForm === 'function') {
              onBeforeOpenJotForm({ url: existing.editUrl, selectedDoor, currentCustomer, currentFloorplan, formType: type });
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
          context = await prepareJotFormContext({ selectedDoor, currentCustomer, currentFloorplan, formType: type });
        }
        if (!stillCurrentSelection()) {
          closeStaleWindow();
          return;
        }

        const url = buildJotFormUrl({
          baseUrl: config.baseUrl,
          formId: form.formId,
          formType: type,
          customer: currentCustomer,
          doorId: selectedDoor,
          floorplan: currentFloorplan,
          context,
        });
        if (typeof onBeforeOpenJotForm === 'function') {
          onBeforeOpenJotForm({ url, selectedDoor, currentCustomer, currentFloorplan, formType: type });
        }

        if (jotFormWindow && !jotFormWindow.closed) {
          jotFormWindow.location.href = url;
        } else if (typeof openWindow === 'function') {
          openWindow(url, '_blank');
        }
      } catch (err) {
        closeStaleWindow();
        throw err;
      }
    }

    return {
      deselectDoor,
      openJotForm,
      selectDoor,
      updateDoneButton,
      updateJotFormButton,
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
    normalizeJotFormFormType,
    readReturnContext,
    renderJotFormButton,
    renderDoneButton,
    renderDoorInfo,
    saveReturnContext,
  };
})(window);
