(function (global) {
  const FD = global.FD = global.FD || {};

  function createEditPopupController({ elements, documentRef = document, onBeforeHide = () => {} }) {
    function show(title, defaultValue, buttons) {
      elements.titleEl.textContent = title;
      elements.errorEl.textContent = '';
      elements.buttonsEl.innerHTML = '';
      elements.customEl.innerHTML = '';
      elements.customEl.style.display = 'none';
      elements.popupEl.style.top = '50%';
      elements.popupEl.style.left = '50%';
      elements.popupEl.style.right = '';
      elements.popupEl.style.bottom = '';
      elements.popupEl.style.transform = 'translate(-50%, -50%)';

      const primaryAction = buttons.length > 0 ? buttons[0].action : null;
      buttons.forEach(button => {
        const el = documentRef.createElement('button');
        el.textContent = button.text;
        el.style.background = button.color || '#1a73e8';
        el.style.color = button.textColor || 'white';
        el.addEventListener('click', button.action);
        elements.buttonsEl.appendChild(el);
      });

      elements.popupEl.style.display = 'block';
      elements.overlayEl.style.display = 'block';
      if (defaultValue === null) {
        elements.inputRowEl.style.display = 'none';
      } else {
        elements.inputRowEl.style.display = 'flex';
        elements.inputEl.value = defaultValue || '';
        elements.inputEl.focus();
      }
      elements.inputEl.onkeydown = (event) => {
        if (event.key === 'Enter' && primaryAction) primaryAction();
      };
    }

    function hide() {
      onBeforeHide();
      elements.popupEl.style.display = 'none';
      elements.overlayEl.style.display = 'none';
      elements.customEl.innerHTML = '';
      elements.customEl.style.display = 'none';
    }

    return { hide, show };
  }

  function createCancelEditController({
    openButtonEl,
    overlayEl,
    popupEl,
    confirmButtonEl,
    cancelButtonEl,
    hasPendingChanges = () => false,
    onCancel = () => {},
  }) {
    let bound = false;
    const dialog = FD.UIShellService.createPopupPair({ overlayEl, popupEl });

    function requestCancel() {
      if (!hasPendingChanges()) {
        onCancel();
        return;
      }
      dialog.show();
    }

    function confirmCancel() {
      dialog.hide();
      onCancel();
    }

    function bind() {
      if (bound) return;
      bound = true;
      openButtonEl.addEventListener('click', requestCancel);
      confirmButtonEl.addEventListener('click', confirmCancel);
      cancelButtonEl.addEventListener('click', dialog.hide);
      overlayEl.addEventListener('click', dialog.hide);
    }

    return {
      bind,
      hide: dialog.hide,
      requestCancel,
    };
  }

  function valueFromTouch(sliderEl, event) {
    const rect = sliderEl.getBoundingClientRect();
    const x = (event.touches ? event.touches[0].clientX : event.clientX) - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const min = parseInt(sliderEl.min, 10);
    const max = parseInt(sliderEl.max, 10);
    return Math.round(min + ratio * (max - min));
  }

  function createMarkerSizeSliderController({
    sliderEl,
    labelEl,
    getMaxValue = () => Infinity,
    onChange = () => {},
  }) {
    let bound = false;

    function setValue(value) {
      const max = getMaxValue();
      const safeValue = Number.isFinite(max) ? Math.min(value, max) : value;
      sliderEl.value = safeValue;
      labelEl.textContent = safeValue;
      onChange(safeValue);
      return safeValue;
    }

    function setRange({ min, max, value }) {
      if (min !== undefined) sliderEl.min = min;
      if (max !== undefined) sliderEl.max = max;
      if (value !== undefined) setValue(value);
    }

    function bind() {
      if (bound) return;
      bound = true;
      sliderEl.addEventListener('input', (event) => {
        setValue(parseInt(event.target.value, 10));
      });
      sliderEl.addEventListener('touchstart', (event) => {
        event.preventDefault();
        setValue(valueFromTouch(sliderEl, event));
      }, { passive: false });
      sliderEl.addEventListener('touchmove', (event) => {
        event.preventDefault();
        setValue(valueFromTouch(sliderEl, event));
      }, { passive: false });
    }

    return {
      bind,
      setRange,
      setValue,
    };
  }

  function createQrScannerController({
    scanButtonEl,
    closeButtonEl,
    overlayEl,
    statusEl,
    readerId,
    scannerFactory = () => new global.Html5Qrcode(readerId),
    onScan = () => {},
    logger = console,
  }) {
    let bound = false;
    let scanner = null;

    async function start() {
      overlayEl.style.display = 'flex';
      statusEl.textContent = 'Camera starten...';

      try {
        scanner = scannerFactory();
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            onScan(decodedText);
            stop();
          },
          () => {}
        );
        statusEl.textContent = 'Richt de camera op een QR code';
      } catch (err) {
        scanner = null;
        logger.error('Camera fout:', err);
        statusEl.textContent = 'Camera niet beschikbaar. Controleer de permissies.';
      }
    }

    async function stop() {
      if (scanner) {
        try {
          await scanner.stop();
          scanner.clear();
        } catch (err) {}
        scanner = null;
      }
      overlayEl.style.display = 'none';
    }

    function bind() {
      if (bound) return;
      bound = true;
      scanButtonEl.addEventListener('click', start);
      closeButtonEl.addEventListener('click', stop);
    }

    return {
      bind,
      isActive: () => Boolean(scanner),
      start,
      stop,
    };
  }

  FD.EditUIService = {
    createCancelEditController,
    createEditPopupController,
    createMarkerSizeSliderController,
    createQrScannerController,
    valueFromTouch,
  };
})(window);
