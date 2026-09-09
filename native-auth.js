(() => {
  const capacitor = window.Capacitor;
  if (!capacitor) return;

  const socialLogin = capacitor.Plugins?.SocialLogin || capacitor.registerPlugin?.('SocialLogin');
  if (!socialLogin) {
    console.error('Agenda: SocialLogin no está disponible en el entorno nativo.');
    return;
  }

  let idConfig = null;
  let initializedClientId = '';

  async function ensureInitialized(clientId) {
    if (!clientId) throw new Error('Falta el Google OAuth Client ID.');
    if (initializedClientId === clientId) return;

    await socialLogin.initialize({
      google: {
        webClientId: clientId,
        mode: 'online'
      }
    });
    initializedClientId = clientId;
  }

  function normalizeScopes(scopes) {
    const source = Array.isArray(scopes)
      ? scopes
      : String(scopes || '').split(/\s+/).filter(Boolean);

    return [...new Set(['profile', 'email', ...source])];
  }

  async function login(clientId, scopes) {
    await ensureInitialized(clientId);
    return socialLogin.login({
      provider: 'google',
      options: {
        scopes: normalizeScopes(scopes),
        style: 'standard',
        filterByAuthorizedAccounts: false
      }
    });
  }

  function errorPayload(error) {
    return {
      error: 'access_denied',
      error_description: error?.message || String(error || 'No se pudo iniciar sesión con Google')
    };
  }

  window.google = window.google || {};
  window.google.accounts = {
    id: {
      initialize(config) {
        idConfig = config || null;
      },

      renderButton(container) {
        if (!container) return;
        container.innerHTML = '';

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Continuar con Google';
        button.style.cssText = [
          'width:100%',
          'min-height:42px',
          'border:1px solid #dadce0',
          'border-radius:6px',
          'background:#fff',
          'color:#3c4043',
          'font:500 14px Arial,sans-serif',
          'cursor:pointer',
          'padding:0 16px'
        ].join(';');

        button.addEventListener('click', async () => {
          button.disabled = true;
          const oldText = button.textContent;
          button.textContent = 'Conectando…';

          try {
            if (!idConfig?.client_id || typeof idConfig.callback !== 'function') {
              throw new Error('La autenticación de Google no está inicializada.');
            }

            const response = await login(idConfig.client_id, ['profile', 'email']);
            const idToken = response?.result?.idToken;
            if (!idToken) throw new Error('Google no devolvió un ID token. Revisa la configuración OAuth de Android.');

            idConfig.callback({ credential: idToken, select_by: 'native' });
          } catch (error) {
            console.error('Agenda Google native sign-in:', error);
            alert(error?.message || 'No se pudo conectar con Google.');
          } finally {
            button.disabled = false;
            button.textContent = oldText;
          }
        });

        container.appendChild(button);
      }
    },

    oauth2: {
      initTokenClient(config) {
        return {
          async requestAccessToken() {
            try {
              const response = await login(config?.client_id, config?.scope);
              const accessToken = response?.result?.accessToken?.token;
              if (!accessToken) {
                throw new Error('Google no devolvió acceso a Calendar/Tasks. Revisa los permisos OAuth.');
              }

              config?.callback?.({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: 3600,
                scope: normalizeScopes(config?.scope).join(' ')
              });
            } catch (error) {
              console.error('Agenda Google native OAuth:', error);
              config?.callback?.(errorPayload(error));
            }
          }
        };
      }
    }
  };
})();
