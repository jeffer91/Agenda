const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyAJgkVqr7p_GKnYFTSHybvBLyFGHplE_uc',
  authDomain: 'jeff-2f92d.firebaseapp.com',
  projectId: 'jeff-2f92d',
  storageBucket: 'jeff-2f92d.firebasestorage.app',
  messagingSenderId: '337984443748',
  appId: '1:337984443748:web:86e7019aa4a5559c3b9671',
  measurementId: 'G-PMQ5N15D5Y'
});

const FIREBASE_SDK_VERSION = '10.14.1';
const appSdkUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`;
const authSdkUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`;

// Esta configuración identifica el proyecto Firebase y es pública por diseño.
// Nunca guardes aquí secretos de cliente, contraseñas, API keys privadas o tokens administrativos.
window.AgendaFirebaseConfig = firebaseConfig;

window.AgendaFirebaseReady = (async () => {
  const [appSdk, authSdk] = await Promise.all([
    import(appSdkUrl),
    import(authSdkUrl)
  ]);

  const firebaseApp = appSdk.getApps().length
    ? appSdk.getApp()
    : appSdk.initializeApp(firebaseConfig);

  const auth = authSdk.getAuth(firebaseApp);

  try {
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
  } catch (error) {
    console.warn('Agenda: Firebase Auth no pudo fijar persistencia local.', error);
  }

  const firebase = Object.freeze({
    app: firebaseApp,
    auth,
    config: firebaseConfig
  });

  window.AgendaFirebase = firebase;
  console.info('Agenda: Firebase Auth inicializado para el proyecto jeff-2f92d.');
  return firebase;
})().catch(error => {
  console.error('Agenda: no se pudo inicializar Firebase.', error);
  window.AgendaFirebase = null;
  return null;
});
