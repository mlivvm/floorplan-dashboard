(function (global) {
  const FD = global.FD = global.FD || {};

  const AUTHENTICATED = 'authenticated';
  const LEGACY_DIRECT_TOKEN_KEY = ['fd', 'github', 'token'].join('_');
  const REMEMBER_KEY = 'fd_remember_pw';
  const SAVED_PASSWORD_KEY = 'fd_saved_password';
  const WORKER_SESSION_TOKEN_KEY = 'fd_worker_session_token';
  const WORKER_SESSION_EXPIRES_KEY = 'fd_worker_session_expires_at';

  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function getAttempts(config, storage = localStorage) {
    return parseInt(storage.getItem(config.attemptsKey) || '0', 10);
  }

  function clearLockout(config, storage = localStorage) {
    storage.removeItem(config.lockoutKey);
    storage.removeItem(config.attemptsKey);
  }

  function isLockedOut(config, now = Date.now(), storage = localStorage) {
    const lockout = storage.getItem(config.lockoutKey);
    if (!lockout) return false;
    const remaining = parseInt(lockout, 10) - now;
    if (remaining <= 0) {
      clearLockout(config, storage);
      return false;
    }
    return true;
  }

  function getLockoutMinutes(config, now = Date.now(), storage = localStorage) {
    const lockout = storage.getItem(config.lockoutKey);
    if (!lockout) return 0;
    return Math.ceil((parseInt(lockout, 10) - now) / 60000);
  }

  function recordFailedAttempt(config, now = Date.now(), storage = localStorage) {
    const attempts = getAttempts(config, storage) + 1;
    storage.setItem(config.attemptsKey, attempts.toString());
    if (attempts >= config.maxAttempts) {
      const lockoutUntil = now + (config.lockoutMinutes * 60000);
      storage.setItem(config.lockoutKey, lockoutUntil.toString());
      return { attempts, locked: true, lockoutUntil };
    }
    return {
      attempts,
      locked: false,
      remaining: config.maxAttempts - attempts,
    };
  }

  function clearSession(config, local = localStorage, session = sessionStorage) {
    local.removeItem(config.tokenKey);
    local.removeItem(config.tokenTimeKey);
    local.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    local.removeItem(WORKER_SESSION_TOKEN_KEY);
    local.removeItem(WORKER_SESSION_EXPIRES_KEY);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    session.removeItem(WORKER_SESSION_TOKEN_KEY);
    session.removeItem(WORKER_SESSION_EXPIRES_KEY);
  }

  function recordSuccessfulLogin(config, rememberPassword, passwordOrNow = Date.now(), local = localStorage, session = sessionStorage) {
    const now = typeof passwordOrNow === 'number' ? passwordOrNow : Date.now();
    const savedPassword = typeof passwordOrNow === 'number' ? '' : String(passwordOrNow || '');
    const priorAttempts = getAttempts(config, local);
    local.setItem(config.tokenKey, AUTHENTICATED);
    local.setItem(config.tokenTimeKey, now.toString());
    local.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    clearLockout(config, local);
    if (rememberPassword) {
      local.setItem(REMEMBER_KEY, '1');
      if (savedPassword) local.setItem(SAVED_PASSWORD_KEY, savedPassword);
    } else {
      local.removeItem(REMEMBER_KEY);
      local.removeItem(SAVED_PASSWORD_KEY);
    }
    return { priorAttempts };
  }

  function migrateLegacySession(config, local = localStorage, session = sessionStorage) {
    if (session.getItem(config.tokenKey) !== AUTHENTICATED) return;
    local.setItem(config.tokenKey, AUTHENTICATED);
    local.setItem(config.tokenTimeKey, session.getItem(config.tokenTimeKey) || Date.now().toString());
    local.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(LEGACY_DIRECT_TOKEN_KEY);
  }

  function isSessionValid(config, local = localStorage, session = sessionStorage) {
    migrateLegacySession(config, local, session);
    const token = local.getItem(config.tokenKey);
    local.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    session.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    if (token !== AUTHENTICATED) {
      clearSession(config, local, session);
      return false;
    }
    return true;
  }

  function isRememberPasswordEnabled(storage = localStorage) {
    return storage.getItem(REMEMBER_KEY) === '1';
  }

  function getSavedPassword(storage = localStorage) {
    return isRememberPasswordEnabled(storage) ? (storage.getItem(SAVED_PASSWORD_KEY) || '') : '';
  }

  async function sendLoginNotification({
    emailjsClient = global.emailjs,
    serviceId,
    templateId,
    type,
    attempts,
    fetchImpl = global.fetch,
    logger = console,
  }) {
    if (!emailjsClient?.send || !serviceId || !templateId) return;
    let location = '-';
    try {
      const resp = await fetchImpl('https://api.ipify.org?format=json');
      const ipData = await resp.json();
      const geoResp = await fetchImpl(`https://ipapi.co/${ipData.ip}/json/`);
      const data = await geoResp.json();
      location = `${data.city}, ${data.country_name} (${data.ip})`;
    } catch (err) {
      logger.error('Locatie ophalen mislukt:', err);
    }
    emailjsClient.send(serviceId, templateId, {
      type,
      time: new Date().toLocaleString('nl-NL'),
      attempts: attempts || '-',
      location,
    }).catch(err => logger.error('Email notificatie mislukt:', err));
  }

  function createAuthController({
    loginConfig,
    appConfig,
    elements,
    logoutControls,
    modeController,
    modes,
    emailConfig = {},
    emailjsClient = global.emailjs,
    hideTopbarMenu = () => {},
    showToast = () => {},
    onShowApp = () => {},
    onLogout = () => {},
    onSessionExpired = () => {},
    logger = console,
  }) {
    let bound = false;
    let lockoutTimer = null;
    const logoutDialog = FD.UIShellService.createPopupPair({
      overlayEl: logoutControls.overlay,
      popupEl: logoutControls.popup,
    });

    function initEmail() {
      if (emailConfig.enabled === false) return;
      if (emailConfig.publicKey && emailjsClient?.init) {
        emailjsClient.init(emailConfig.publicKey);
      }
    }

    function notifyLogin(type, attempts) {
      if (emailConfig.enabled === false) return;
      sendLoginNotification({
        emailjsClient,
        serviceId: emailConfig.serviceId,
        templateId: emailConfig.templateId,
        type,
        attempts,
        logger,
      });
    }

    function hideSplash() {
      if (elements.splashScreen) elements.splashScreen.style.display = 'none';
    }

    function restoreSavedPassword() {
      if (isRememberPasswordEnabled()) {
        elements.rememberCheckbox.checked = true;
        const savedPassword = getSavedPassword();
        if (savedPassword) elements.passwordInput.value = savedPassword;
      } else {
        elements.rememberCheckbox.checked = false;
      }
    }

    function setLoginEnabled(enabled) {
      elements.loginButton.disabled = !enabled;
      elements.passwordInput.disabled = !enabled;
    }

    function clearLockoutTimer() {
      if (lockoutTimer) global.clearTimeout(lockoutTimer);
      lockoutTimer = null;
    }

    function needsWorkerSession() {
      return FD.DataService?.isWorkerSessionAuthEnabled?.(appConfig) ||
        FD.DataService?.isWorkerStatusWriteEnabled?.(appConfig) ||
        FD.DataService?.isWorkerFloorplanWriteEnabled?.(appConfig) ||
        FD.DataService?.isWorkerUploadWriteEnabled?.(appConfig);
    }

    function hasValidWorkerSession() {
      try {
        const token = localStorage.getItem(WORKER_SESSION_TOKEN_KEY);
        const expiresAt = localStorage.getItem(WORKER_SESSION_EXPIRES_KEY);
        if (!token || !expiresAt) return false;
        const expiresTime = Date.parse(expiresAt);
        return Number.isFinite(expiresTime) && expiresTime > Date.now() + 60000;
      } catch {
        return false;
      }
    }

    async function ensureWorkerSessionForStoredLogin() {
      if (!needsWorkerSession() || hasValidWorkerSession()) return true;
      const savedPassword = getSavedPassword();
      if (!savedPassword) return false;

      try {
        await FD.DataService.loginWorkerSession(appConfig, savedPassword);
        return true;
      } catch (err) {
        logger.warn('Worker sessie hervatten mislukt:', err);
        return false;
      }
    }

    function checkLockoutState() {
      clearLockoutTimer();
      if (!isLockedOut(loginConfig)) {
        setLoginEnabled(true);
        return;
      }

      elements.errorEl.textContent = `Geblokkeerd. Probeer opnieuw over ${getLockoutMinutes(loginConfig)} minuten.`;
      setLoginEnabled(false);
      lockoutTimer = global.setTimeout(() => {
        if (!isLockedOut(loginConfig)) {
          setLoginEnabled(true);
          elements.errorEl.textContent = '';
        } else {
          checkLockoutState();
        }
      }, 30000);
    }

    function showLoginScreen({ message = '', clearPassword = false, restorePassword = false } = {}) {
      hideSplash();
      modeController.enter(modes.LOGIN);
      elements.appContainer.style.display = 'none';
      elements.loginScreen.style.display = 'flex';
      if (clearPassword) elements.passwordInput.value = '';
      elements.errorEl.textContent = message;
      elements.loginButton.disabled = false;
      elements.loginButton.textContent = 'Inloggen';
      elements.passwordInput.disabled = false;
      if (restorePassword) restoreSavedPassword();
      checkLockoutState();
    }

    async function handleLogin() {
      if (isLockedOut(loginConfig)) {
        elements.errorEl.textContent = `Geblokkeerd. Probeer opnieuw over ${getLockoutMinutes(loginConfig)} minuten.`;
        return;
      }

      const password = elements.passwordInput.value;
      if (!password) {
        elements.errorEl.textContent = 'Vul het wachtwoord in.';
        return;
      }

      const hash = await hashPassword(password);
      if (hash !== loginConfig.passwordHash) {
        const failedAttempt = recordFailedAttempt(loginConfig);
        if (failedAttempt.locked) {
          notifyLogin('Geblokkeerd na ' + failedAttempt.attempts + ' foute pogingen', failedAttempt.attempts);
          elements.errorEl.textContent = `Te veel pogingen. Geblokkeerd voor ${loginConfig.lockoutMinutes} minuten.`;
          setLoginEnabled(false);
        } else {
          elements.errorEl.textContent = `Onjuist wachtwoord. Nog ${failedAttempt.remaining} poging${failedAttempt.remaining === 1 ? '' : 'en'}.`;
          notifyLogin('Fout wachtwoord (poging ' + failedAttempt.attempts + '/' + loginConfig.maxAttempts + ')', failedAttempt.attempts);
        }
        elements.passwordInput.value = '';
        return;
      }

      elements.loginButton.disabled = true;
      elements.loginButton.textContent = 'Controleren...';

      if (needsWorkerSession()) {
        if (global.navigator?.onLine === false) {
          if (!hasValidWorkerSession()) {
            elements.loginButton.disabled = false;
            elements.loginButton.textContent = 'Inloggen';
            elements.errorEl.textContent = 'Maak eerst online verbinding om een server-sessie te starten.';
            return;
          }
        } else {
          try {
            await FD.DataService.loginWorkerSession(appConfig, password);
          } catch (err) {
            elements.loginButton.disabled = false;
            elements.loginButton.textContent = 'Inloggen';
            elements.errorEl.textContent = err?.status === 429
              ? 'Te veel loginpogingen via server. Probeer later opnieuw.'
              : 'Server-login mislukt.';
            logger.warn('Worker sessie-login mislukt:', err);
            return;
          }
        }
      } else if (global.navigator?.onLine === false) {
        showToast('Offline ingelogd', 'success');
      }

      const { priorAttempts } = recordSuccessfulLogin(
        loginConfig,
        elements.rememberCheckbox.checked,
        password
      );

      elements.loginButton.textContent = 'Inloggen';
      notifyLogin('Succesvol ingelogd', priorAttempts > 0 ? priorAttempts + ' foute pogingen vooraf' : '0');
      onShowApp();
    }

    async function resumeStoredSession() {
      hideSplash();
      if (!(await ensureWorkerSessionForStoredLogin())) {
        clearSession(loginConfig);
        showLoginScreen({
          message: 'Log opnieuw in voor server-sessie.',
          restorePassword: true,
        });
        return;
      }

      onShowApp();
    }

    function showLogoutConfirm() {
      hideTopbarMenu();
      logoutDialog.show();
    }

    function hideLogoutConfirm() {
      logoutDialog.hide();
    }

    function logout() {
      clearSession(loginConfig);
      FD.DataService?.clearWorkerSession?.(appConfig);
      clearLockoutTimer();
      hideLogoutConfirm();
      notifyLogin('Uitgelogd', '-');
      onLogout();
      showLoginScreen({ clearPassword: true, restorePassword: true });
    }

    function bind() {
      if (bound) return;
      bound = true;
      initEmail();
      restoreSavedPassword();
      elements.loginButton.addEventListener('click', handleLogin);
      elements.passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
      });
      logoutControls.openButton.addEventListener('click', showLogoutConfirm);
      logoutControls.confirmButton.addEventListener('click', logout);
      logoutControls.cancelButton.addEventListener('click', hideLogoutConfirm);
      logoutControls.overlay.addEventListener('click', hideLogoutConfirm);
      checkLockoutState();
    }

    async function start() {
      if (isSessionValid(loginConfig)) {
        await resumeStoredSession();
      } else {
        showLoginScreen({ restorePassword: true });
      }
    }

    return {
      bind,
      start,
      showLoginScreen,
      logout,
    };
  }

  FD.AuthService = {
    clearLockout,
    clearSession,
    createAuthController,
    getAttempts,
    getLockoutMinutes,
    getSavedPassword,
    hashPassword,
    isLockedOut,
    isRememberPasswordEnabled,
    isSessionValid,
    recordFailedAttempt,
    recordSuccessfulLogin,
  };
})(window);
