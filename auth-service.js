(function (global) {
  const FD = global.FD = global.FD || {};

  const AUTHENTICATED = 'authenticated';
  const GITHUB_TOKEN_KEY = 'fd_github_token';
  const REMEMBER_KEY = 'fd_remember_pw';
  const SAVED_PASSWORD_KEY = 'fd_saved_password';

  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function decryptToken(password, encryptedToken, {
    salt = 'fd_salt',
    iterations = 100000,
  } = {}) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const iv = Uint8Array.from(atob(encryptedToken.iv), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encryptedToken.data), c => c.charCodeAt(0));
    const tag = Uint8Array.from(atob(encryptedToken.tag), c => c.charCodeAt(0));
    const combined = new Uint8Array(data.length + tag.length);
    combined.set(data);
    combined.set(tag, data.length);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
    return new TextDecoder().decode(decrypted);
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
    local.removeItem(GITHUB_TOKEN_KEY);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(GITHUB_TOKEN_KEY);
  }

  function recordSuccessfulLogin(config, githubToken, rememberPassword, passwordOrNow = Date.now(), local = localStorage, session = sessionStorage) {
    const now = typeof passwordOrNow === 'number' ? passwordOrNow : Date.now();
    const savedPassword = typeof passwordOrNow === 'number' ? '' : String(passwordOrNow || '');
    const priorAttempts = getAttempts(config, local);
    local.setItem(config.tokenKey, AUTHENTICATED);
    local.setItem(config.tokenTimeKey, now.toString());
    local.setItem(GITHUB_TOKEN_KEY, githubToken);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(GITHUB_TOKEN_KEY);
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
    const legacyGitHubToken = session.getItem(GITHUB_TOKEN_KEY);
    if (legacyGitHubToken) local.setItem(GITHUB_TOKEN_KEY, legacyGitHubToken);
    session.removeItem(config.tokenKey);
    session.removeItem(config.tokenTimeKey);
    session.removeItem(GITHUB_TOKEN_KEY);
  }

  function isSessionValid(config, local = localStorage, session = sessionStorage) {
    migrateLegacySession(config, local, session);
    const token = local.getItem(config.tokenKey);
    const githubToken = local.getItem(GITHUB_TOKEN_KEY);
    if (token !== AUTHENTICATED || !githubToken) {
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

  async function validateGitHubToken(config, token, dataService = FD.DataService) {
    try {
      const testResp = await dataService.validateTokenForCustomers(config, token);
      if (testResp.ok) return { ok: true, offline: false };
      if (testResp.status === 401 || testResp.status === 403) {
        return { ok: false, message: 'GitHub token is ongeldig of verlopen.' };
      }
      return { ok: false, message: 'GitHub controle mislukt: ' + testResp.status };
    } catch {
      return { ok: true, offline: true };
    }
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
    encryptedToken,
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

      let token;
      try {
        token = await decryptToken(password, encryptedToken);
      } catch {
        elements.loginButton.disabled = false;
        elements.loginButton.textContent = 'Inloggen';
        elements.errorEl.textContent = 'Kon token niet ontsleutelen.';
        return;
      }

      const validation = await validateGitHubToken(appConfig, token);
      if (!validation.ok) {
        elements.loginButton.disabled = false;
        elements.loginButton.textContent = 'Inloggen';
        elements.errorEl.textContent = validation.message;
        return;
      }

      const { priorAttempts } = recordSuccessfulLogin(
        loginConfig,
        token,
        elements.rememberCheckbox.checked,
        password
      );

      elements.loginButton.textContent = 'Inloggen';
      notifyLogin('Succesvol ingelogd', priorAttempts > 0 ? priorAttempts + ' foute pogingen vooraf' : '0');
      if (validation.offline) showToast('Offline ingelogd', 'success');
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
      hideLogoutConfirm();
      onLogout();
      clearSession(loginConfig);
      showLoginScreen({ clearPassword: true, restorePassword: true });
    }

    function bind() {
      if (bound) return;
      bound = true;
      logoutControls.openButton.addEventListener('click', showLogoutConfirm);
      logoutControls.confirmButton.addEventListener('click', logout);
      logoutControls.cancelButton.addEventListener('click', hideLogoutConfirm);
      logoutControls.overlay.addEventListener('click', hideLogoutConfirm);
      elements.loginButton.addEventListener('click', handleLogin);
      elements.passwordInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handleLogin();
      });
    }

    function start() {
      initEmail();
      restoreSavedPassword();
      try {
        if (isSessionValid(loginConfig)) {
          hideSplash();
          onShowApp();
          validateGitHubToken(appConfig, FD.Repository.getToken()).then(validation => {
            if (!validation.ok && !validation.offline) {
              clearSession(loginConfig);
              onSessionExpired();
              showLoginScreen({ message: validation.message || 'Sessie verlopen. Log opnieuw in.' });
            }
          }).catch(() => {
            // Network error: stay in app for offline use.
          });
        } else {
          showLoginScreen();
        }
      } catch (err) {
        showLoginScreen();
        logger.error('Startup fout:', err);
      }
    }

    return {
      bind,
      checkLockoutState,
      handleLogin,
      logout,
      restoreSavedPassword,
      start,
    };
  }

  FD.AuthService = {
    clearSession,
    createAuthController,
    decryptToken,
    getAttempts,
    getLockoutMinutes,
    getSavedPassword,
    hashPassword,
    isLockedOut,
    isRememberPasswordEnabled,
    isSessionValid,
    migrateLegacySession,
    recordFailedAttempt,
    recordSuccessfulLogin,
    sendLoginNotification,
    validateGitHubToken,
  };
})(window);
