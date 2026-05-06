(function (global) {
  const FD = global.FD = global.FD || {};

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
    createController,
    clearDoorInfo,
    renderDoneButton,
    renderDoorInfo,
  };
})(window);
