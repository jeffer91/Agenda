(() => {
  const CLIENT_KEY = 'agenda_google_client_id';
  const ID_KEY = 'agenda_id_token';
  const ACCESS_KEY = 'agenda_google_access_token';
  const ACCESS_EXP_KEY = 'agenda_google_access_expiry';
  const GRANTED_KEY = 'agenda_google_scopes_granted';
  const SYNC_INTERVAL = 5 * 60 * 1000;
  let oauthPatched = false;
  let gestureArmed = false;
  let refreshingIdentity = false;

  function jwtExpired(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return true;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const payload = JSON.parse(atob(padded));
      return !payload.exp || Date.now() >= payload.exp * 1000 - 60000;
    } catch {
      return true;
    }
  }

  function cachedAccess() {
    const token = sessionStorage.getItem(ACCESS_KEY) || '';
    const expiry = Number(sessionStorage.getItem(ACCESS_EXP_KEY) || 0);
    if (!token || !expiry || Date.now() >= expiry - 60000) {
      sessionStorage.removeItem(ACCESS_KEY);
      sessionStorage.removeItem(ACCESS_EXP_KEY);
      return null;
    }
    return { token, expiry };
  }

  function saveAccess(response) {
    if (!response?.access_token) return;
    const seconds = Math.max(60, Number(response.expires_in || 3600));
    sessionStorage.setItem(ACCESS_KEY, response.access_token);
    sessionStorage.setItem(ACCESS_EXP_KEY, String(Date.now() + seconds * 1000));
    localStorage.setItem(GRANTED_KEY, '1');
  }

  function patchOAuth() {
    if (oauthPatched || !window.google?.accounts?.oauth2?.initTokenClient) return false;

    try {
      const oauth = google.accounts.oauth2;
      const originalInit = oauth.initTokenClient.bind(oauth);

      oauth.initTokenClient = config => {
        const appCallback = config.callback;
        const wrappedCallback = response => {
          if (response?.access_token) saveAccess(response);
          if (response?.error && ['interaction_required', 'consent_required', 'access_denied'].includes(response.error)) {
            localStorage.removeItem(GRANTED_KEY);
          }
          appCallback?.(response);
        };

        const client = originalInit({ ...config, callback: wrappedCallback });
        const originalRequest = client.requestAccessToken.bind(client);

        client.requestAccessToken = options => {
          const cached = cachedAccess();
          if (cached) {
            queueMicrotask(() => wrappedCallback({
              access_token: cached.token,
              expires_in: Math.max(60, Math.floor((cached.expiry - Date.now()) / 1000))
            }));
            return;
          }

          const next = { ...(options || {}) };
          const automaticGesture = Boolean(window.__agendaAutomaticGoogleGesture);
          if (automaticGesture || localStorage.getItem(GRANTED_KEY) === '1') {
            next.prompt = '';
          }
          return originalRequest(next);
        };

        return client;
      };

      oauthPatched = true;
      return true;
    } catch {
      return false;
    }
  }

  function connected() {
    const token = localStorage.getItem(ID_KEY) || '';
    return Boolean(token && !jwtExpired(token));
  }

  function syncButton() {
    return document.getElementById('syncBtn');
  }

  function isSynced() {
    const button = syncButton();
    return Boolean(button && /Sincronizado/.test(button.textContent || ''));
  }

  function triggerSync({ automaticGesture = false, requireCached = false } = {}) {
    const button = syncButton();
    if (!button || button.disabled || !connected()) return false;
    if (requireCached && !cachedAccess()) return false;

    window.__agendaAutomaticGoogleGesture = automaticGesture;
    try {
      button.click();
    } finally {
      queueMicrotask(() => { window.__agendaAutomaticGoogleGesture = false; });
    }
    return true;
  }

  function disarmGestureSync() {
    if (!gestureArmed) return;
    gestureArmed = false;
    document.removeEventListener('pointerdown', onFirstGesture, true);
    document.removeEventListener('keydown', onFirstGesture, true);
    document.removeEventListener('touchstart', onFirstGesture, true);
  }

  function onFirstGesture() {
    if (!connected() || isSynced()) {
      disarmGestureSync();
      return;
    }
    disarmGestureSync();
    triggerSync({ automaticGesture: true });
  }

  function armGestureSync() {
    if (gestureArmed || !connected() || isSynced()) return;
    gestureArmed = true;
    document.addEventListener('pointerdown', onFirstGesture, true);
    document.addEventListener('keydown', onFirstGesture, true);
    document.addEventListener('touchstart', onFirstGesture, true);
  }

  function maybeAutoSync() {
    if (!connected() || isSynced()) return;
    if (cachedAccess()) {
      triggerSync({ requireCached: true });
    } else {
      armGestureSync();
    }
  }

  function maybeAutoConnect() {
    const clientId = localStorage.getItem(CLIENT_KEY) || '';
    const idToken = localStorage.getItem(ID_KEY) || '';
    if (!clientId || (idToken && !jwtExpired(idToken)) || refreshingIdentity) return;
    if (!window.google?.accounts?.id) return;

    const button = document.getElementById('googleBtn');
    if (button && !/Conectar Google/.test(button.textContent || '')) return;

    refreshingIdentity = true;
    try {
      google.accounts.id.initialize({
        client_id: clientId,
        auto_select: true,
        callback: response => {
          if (response?.credential) {
            localStorage.setItem(ID_KEY, response.credential);
            location.reload();
          } else {
            refreshingIdentity = false;
          }
        }
      });
      google.accounts.id.prompt(() => { refreshingIdentity = false; });
    } catch {
      refreshingIdentity = false;
    }
  }

  function boot() {
    const poll = setInterval(() => {
      patchOAuth();
      if (window.google?.accounts?.id) {
        clearInterval(poll);
        setTimeout(() => {
          maybeAutoConnect();
          maybeAutoSync();
        }, 450);
      }
    }, 100);

    setTimeout(() => clearInterval(poll), 10000);

    const uiObserver = new MutationObserver(() => {
      patchOAuth();
      if (connected()) maybeAutoSync();
      else maybeAutoConnect();
    });

    const header = document.querySelector('.topbar');
    if (header) uiObserver.observe(header, { childList: true, subtree: true, characterData: true, attributes: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (cachedAccess() && connected()) triggerSync({ requireCached: true });
      else if (connected()) armGestureSync();
      else maybeAutoConnect();
    });

    setInterval(() => {
      if (document.visibilityState === 'visible' && cachedAccess() && connected()) {
        triggerSync({ requireCached: true });
      }
    }, SYNC_INTERVAL);
  }

  boot();
})();
