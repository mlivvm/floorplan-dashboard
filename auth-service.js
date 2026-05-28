(function (global) {
  const FD = global.FD = global.FD || {};

  const AUTHENTICATED = 'authenticated';
  const LEGACY_DIRECT_TOKEN_KEY = ['fd', 'github', 'token'].join('_');
  const REMEMBER_SESSION_KEY = 'fd_remember_session';
  const LEGACY_REMEMBER_KEY = 'fd_remember_pw';
  const SAVED_PASSWORD_KEY = 'fd_saved_password';
  const WORKER_SESSION_TOKEN_KEY = 'fd_worker_session_token';
  const WORKER_SESSION_EXPIRES_KEY = 'fd_worker_session_expires_at';
  const WORKER_SESSION_USER_KEY = 'fd_worker_session_user';
  const LAST_USERNAME_KEY = 'fd_login_username';
  const AUTH_TOKEN_KEY = 'fd_auth_token';
  const AUTH_TOKEN_TIME_KEY = 'fd_auth_time';

  function authKeys(config = {}) {
    return {
      rememberSessionKey: config.rememberSessionKey || REMEMBER_SESSION_KEY,
      legacyRememberKey: config.legacyRememberKey || LEGACY_REMEMBER_KEY,
      savedPasswordKey: config.savedPasswordKey || SAVED_PASSWORD_KEY,
      workerSessionTokenKey: config.workerSessionTokenKey || WORKER_SESSION_TOKEN_KEY,
      workerSessionExpiresKey: config.workerSessionExpiresKey || WORKER_SESSION_EXPIRES_KEY,
      workerSessionUserKey: config.workerSessionUserKey || WORKER_SESSION_USER_KEY,
      lastUsernameKey: config.lastUsernameKey || LAST_USERNAME_KEY,
      legacyTokenKey: config.legacyTokenKey || AUTH_TOKEN_KEY,
      legacyTokenTimeKey: config.legacyTokenTimeKey || AUTH_TOKEN_TIME_KEY,
    };
  }

  function removeStorageItem(storage, key) {
    if (key) storage.removeItem(key);
  }

  function isStorageLike(value) {
    return Boolean(value && typeof value.getItem === 'function' && typeof value.setItem === 'function');
  }

  function migrateKey(local, session, fromKey, toKey, { removeSource = true } = {}) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    [local, session].forEach(storage => {
      const value = storage.getItem(fromKey);
      if (value !== null && storage.getItem(toKey) === null) storage.setItem(toKey, value);
      if (removeSource) storage.removeItem(fromKey);
    });
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

  function clearStoredPassword(config = {}, local = localStorage, session = sessionStorage) {
    const keys = authKeys(config);
    [keys.savedPasswordKey, SAVED_PASSWORD_KEY].forEach(key => {
      removeStorageItem(local, key);
      removeStorageItem(session, key);
    });
  }

  function clearLegacyAuth(config = {}, local = localStorage, session = sessionStorage) {
    local.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    session.removeItem(LEGACY_DIRECT_TOKEN_KEY);
    clearStoredPassword(config, local, session);
  }

  function migrateLegacyWorkerSession(config, local = localStorage, session = sessionStorage) {
    if (config.allowLegacyMigration === false) return;
    const keys = authKeys(config);
    migrateKey(local, session, WORKER_SESSION_TOKEN_KEY, keys.workerSessionTokenKey);
    migrateKey(local, session, WORKER_SESSION_EXPIRES_KEY, keys.workerSessionExpiresKey);
    migrateKey(local, session, WORKER_SESSION_USER_KEY, keys.workerSessionUserKey);
  }

  function setWorkerSessionStorage(config, persistent, local = localStorage, session = sessionStorage) {
    const keys = authKeys(config);
    migrateLegacyWorkerSession(config, local, session);
    const localToken = local.getItem(keys.workerSessionTokenKey);
    const localExpiresAt = local.getItem(keys.workerSessionExpiresKey);
    const localUser = local.getItem(keys.workerSessionUserKey);
    const sessionToken = session.getItem(keys.workerSessionTokenKey);
    const sessionExpiresAt = session.getItem(keys.workerSessionExpiresKey);
    const sessionUser = session.getItem(keys.workerSessionUserKey);

    if (persistent) {
      if (!localToken && sessionToken) local.setItem(keys.workerSessionTokenKey, sessionToken);
      if (!localExpiresAt && sessionExpiresAt) local.setItem(keys.workerSessionExpiresKey, sessionExpiresAt);
      if (!localUser && sessionUser) local.setItem(keys.workerSessionUserKey, sessionUser);
      session.removeItem(keys.workerSessionTokenKey);
      session.removeItem(keys.workerSessionExpiresKey);
      session.removeItem(keys.workerSessionUserKey);
      return;
    }

    if (localToken) session.setItem(keys.workerSessionTokenKey, localToken);
    if (localExpiresAt) session.setItem(keys.workerSessionExpiresKey, localExpiresAt);
    if (localUser) session.setItem(keys.workerSessionUserKey, localUser);
    local.removeItem(keys.workerSessionTokenKey);
    local.removeItem(keys.workerSessionExpiresKey);
    local.removeItem(keys.workerSessionUserKey);
  }

  function migrateLegacyRemember(config = {}, local = localStorage, session = sessionStorage) {
    const keys = authKeys(config);
    if (config.allowLegacyMigration !== false && local.getItem(keys.legacyRememberKey) === '1') {
      local.setItem(keys.rememberSessionKey, '1');
    }
    if (keys.legacyRememberKey !== keys.rememberSessionKey) {
      local.removeItem(keys.legacyRememberKey);
      session.removeItem(keys.legacyRememberKey);
    }
    clearStoredPassword(config, local, session);
  }

  function clearSession(config, local = localStorage, session = sessionStorage) {
    const keys = authKeys(config);
    local.removeItem(config.tokenKey);
    local.removeItem(config.tokenTimeKey);
    local.removeItem(keys.workerSessionTokenKey);
    local.removeItem(keys.workerSessionExpiresKey);
    local.removeItem(keys.workerSessionUserKey);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(keys.workerSessionTokenKey);
    session.removeItem(keys.workerSessionExpiresKey);
    session.removeItem(keys.workerSessionUserKey);
    if (config.allowLegacyMigration !== false) {
      [keys.legacyTokenKey, keys.legacyTokenTimeKey, WORKER_SESSION_TOKEN_KEY, WORKER_SESSION_EXPIRES_KEY, WORKER_SESSION_USER_KEY].forEach(key => {
        local.removeItem(key);
        session.removeItem(key);
      });
    }
    clearLegacyAuth(config, local, session);
  }

  function recordSuccessfulLogin(config, rememberSession, now = Date.now(), local = localStorage, session = sessionStorage) {
    const priorAttempts = getAttempts(config, local);
    const target = rememberSession ? local : session;
    const other = rememberSession ? session : local;

    target.setItem(config.tokenKey, AUTHENTICATED);
    target.setItem(config.tokenTimeKey, now.toString());
    other.removeItem(config.tokenKey);
    other.removeItem(config.tokenTimeKey);
    clearLegacyAuth(config, local, session);
    clearLockout(config, local);
    setWorkerSessionStorage(config, rememberSession, local, session);

    if (rememberSession) {
      local.setItem(authKeys(config).rememberSessionKey, '1');
    } else {
      local.removeItem(authKeys(config).rememberSessionKey);
    }
    return { priorAttempts };
  }

  function migrateLegacySession(config, local = localStorage, session = sessionStorage) {
    const keys = authKeys(config);
    if (config.allowLegacyMigration !== false) {
      migrateKey(local, session, keys.legacyTokenKey, config.tokenKey);
      migrateKey(local, session, keys.legacyTokenTimeKey, config.tokenTimeKey);
      migrateKey(local, session, LAST_USERNAME_KEY, keys.lastUsernameKey);
    }
    migrateLegacyRemember(config, local, session);
    migrateLegacyWorkerSession(config, local, session);
    const rememberSession = isRememberSessionEnabled(config, local, session);
    if (local.getItem(config.tokenKey) === AUTHENTICATED && !rememberSession) {
      session.setItem(config.tokenKey, AUTHENTICATED);
      session.setItem(config.tokenTimeKey, local.getItem(config.tokenTimeKey) || Date.now().toString());
      local.removeItem(config.tokenKey);
      local.removeItem(config.tokenTimeKey);
      setWorkerSessionStorage(config, false, local, session);
    } else if (local.getItem(config.tokenKey) === AUTHENTICATED) {
      session.removeItem(config.tokenKey);
      session.removeItem(config.tokenTimeKey);
      setWorkerSessionStorage(config, true, local, session);
    } else if (session.getItem(config.tokenKey) === AUTHENTICATED) {
      setWorkerSessionStorage(config, false, local, session);
    }
    clearLegacyAuth(config, local, session);
  }

  function isSessionValid(config, local = localStorage, session = sessionStorage) {
    migrateLegacySession(config, local, session);
    const hasAuth = local.getItem(config.tokenKey) === AUTHENTICATED ||
      session.getItem(config.tokenKey) === AUTHENTICATED;
    clearLegacyAuth(config, local, session);
    if (!hasAuth) {
      clearSession(config, local, session);
      return false;
    }
    return true;
  }

  function isRememberSessionEnabled(config = {}, local = localStorage, session = sessionStorage) {
    if (isStorageLike(config)) {
      session = local || sessionStorage;
      local = config;
      config = {};
    }
    migrateLegacyRemember(config, local, session);
    return local.getItem(authKeys(config).rememberSessionKey) === '1';
  }

  async function sendLoginNotification({
    emailjsClient = global.emailjs,
    serviceId,
    templateId,
    type,
    attempts,
    timeZone = 'Europe/Amsterdam',
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
      time: new Date().toLocaleString('nl-NL', { timeZone }),
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
        timeZone: appConfig?.appTimeZone || 'Europe/Amsterdam',
        logger,
      });
    }

    function hideSplash() {
      if (elements.splashScreen) elements.splashScreen.style.display = 'none';
    }

    function restoreRememberSession() {
      const keys = authKeys(loginConfig);
      elements.rememberCheckbox.checked = isRememberSessionEnabled(loginConfig);
      if (elements.usernameInput) {
        elements.usernameInput.value = localStorage.getItem(keys.lastUsernameKey) ||
          (loginConfig.allowLegacyMigration === false ? '' : localStorage.getItem(LAST_USERNAME_KEY)) ||
          'admin';
      }
    }

    function setLoginEnabled(enabled) {
      elements.loginButton.disabled = !enabled;
      elements.passwordInput.disabled = !enabled;
      if (elements.usernameInput) elements.usernameInput.disabled = !enabled;
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
      const keys = authKeys(loginConfig);
      migrateLegacyWorkerSession(loginConfig);
      try {
        const sessions = [localStorage, sessionStorage];
        return sessions.some(storage => {
          const token = storage.getItem(keys.workerSessionTokenKey);
          const expiresAt = storage.getItem(keys.workerSessionExpiresKey);
          if (!token || !expiresAt) return false;
          const expiresTime = Date.parse(expiresAt);
          return Number.isFinite(expiresTime) && expiresTime > Date.now() + 60000;
        });
      } catch {
        return false;
      }
    }

    function hasPersistentStoredLogin() {
      try {
        return localStorage.getItem(loginConfig.tokenKey) === AUTHENTICATED &&
          isRememberSessionEnabled(loginConfig);
      } catch {
        return false;
      }
    }

    async function ensureWorkerSessionForStoredLogin() {
      if (!needsWorkerSession()) return true;
      if (!hasPersistentStoredLogin()) return hasValidWorkerSession();
      if (global.navigator?.onLine === false && hasValidWorkerSession()) return true;

      try {
        await FD.DataService.renewWorkerSession(appConfig, { persistent: true });
        return true;
      } catch (err) {
        logger.warn('Worker sessie hernieuwen mislukt:', err);
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

    function showLoginScreen({ message = '', clearPassword = false, restoreRemember = false } = {}) {
      hideSplash();
      modeController.enter(modes.LOGIN);
      elements.appContainer.style.display = 'none';
      elements.loginScreen.style.display = 'flex';
      if (clearPassword) elements.passwordInput.value = '';
      elements.errorEl.textContent = message;
      elements.loginButton.disabled = false;
      elements.loginButton.textContent = 'Inloggen';
      elements.passwordInput.disabled = false;
      if (elements.usernameInput) elements.usernameInput.disabled = false;
      if (restoreRemember) restoreRememberSession();
      checkLockoutState();
    }

    async function handleLogin() {
      if (isLockedOut(loginConfig)) {
        elements.errorEl.textContent = `Geblokkeerd. Probeer opnieuw over ${getLockoutMinutes(loginConfig)} minuten.`;
        return;
      }

      const username = (elements.usernameInput?.value || '').trim().toLowerCase();
      const password = elements.passwordInput.value;
      if (!username || !password) {
        elements.errorEl.textContent = 'Vul gebruiker en wachtwoord in.';
        return;
      }

      elements.loginButton.disabled = true;
      elements.loginButton.textContent = 'Controleren...';
      const rememberSession = elements.rememberCheckbox.checked;

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
            await FD.DataService.loginWorkerSession(appConfig, username, password, { persistent: rememberSession });
          } catch (err) {
            elements.loginButton.disabled = false;
            elements.loginButton.textContent = 'Inloggen';
            if (err?.status === 429) {
              elements.errorEl.textContent = 'Te veel loginpogingen via server. Probeer later opnieuw.';
            } else if (err?.status === 403) {
              elements.errorEl.textContent = 'Account is uitgeschakeld.';
            } else {
              elements.errorEl.textContent = 'Onjuiste gebruiker of wachtwoord.';
            }
            logger.warn('Worker sessie-login mislukt:', err);
            return;
          }
        }
      } else if (global.navigator?.onLine === false) {
        showToast('Offline ingelogd', 'success');
      }

      const { priorAttempts } = recordSuccessfulLogin(
        loginConfig,
        rememberSession
      );
      localStorage.setItem(authKeys(loginConfig).lastUsernameKey, username);

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
          restoreRemember: true,
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
      showLoginScreen({ clearPassword: true, restoreRemember: true });
    }

    function bind() {
      if (bound) return;
      bound = true;
      initEmail();
      restoreRememberSession();
      elements.loginButton.addEventListener('click', handleLogin);
      if (elements.usernameInput) {
        elements.usernameInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') handleLogin();
        });
      }
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
        showLoginScreen({ restoreRemember: true });
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
    isLockedOut,
    isRememberPasswordEnabled: isRememberSessionEnabled,
    isRememberSessionEnabled,
    isSessionValid,
    recordSuccessfulLogin,
  };
})(window);
