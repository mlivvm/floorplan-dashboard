(function (global) {
  const FD = global.FD = global.FD || {};

  const MODES = Object.freeze({
    LOGIN: 'login',
    VIEW: 'view',
    EDIT: 'edit',
    UPLOAD: 'upload',
    UPLOAD_SAVING: 'upload-saving',
    IMAGE_EDITOR: 'image-editor',
    IMAGE_EDITOR_SAVING: 'image-editor-saving',
  });

  const BUSY_MODES = new Set([
    MODES.UPLOAD_SAVING,
    MODES.IMAGE_EDITOR_SAVING,
  ]);

  function validateMode(mode) {
    if (!Object.values(MODES).includes(mode)) {
      throw new Error('Onbekende app mode: ' + mode);
    }
  }

  function runHook(hook, payload) {
    if (typeof hook === 'function') hook(payload);
  }

  function createModeController(initialMode = MODES.LOGIN, options = {}) {
    validateMode(initialMode);
    let currentMode = initialMode;
    const hooks = { ...(options.hooks || {}) };
    const transitionListeners = [];

    function enter(nextMode, context = {}) {
      validateMode(nextMode);
      if (nextMode === currentMode) return currentMode;

      const previousMode = currentMode;
      const payload = { from: previousMode, to: nextMode, context };
      runHook(hooks[previousMode]?.exit, payload);
      currentMode = nextMode;
      runHook(hooks[nextMode]?.enter, payload);
      transitionListeners.forEach(listener => listener(payload));
      return currentMode;
    }

    function setHooks(mode, modeHooks) {
      validateMode(mode);
      hooks[mode] = { ...(hooks[mode] || {}), ...(modeHooks || {}) };
    }

    function onTransition(listener) {
      if (typeof listener !== 'function') return () => {};
      transitionListeners.push(listener);
      return () => {
        const index = transitionListeners.indexOf(listener);
        if (index >= 0) transitionListeners.splice(index, 1);
      };
    }

    return {
      get current() {
        return currentMode;
      },
      enter,
      setHooks,
      onTransition,
      is(mode) {
        return currentMode === mode;
      },
      isAny(modes) {
        return modes.includes(currentMode);
      },
      isBusy() {
        return BUSY_MODES.has(currentMode);
      },
      isInteractiveView() {
        return currentMode === MODES.VIEW;
      },
    };
  }

  FD.ModeService = {
    MODES,
    createModeController,
  };
})(window);
