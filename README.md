# Agenda

Agenda personal de productividad conectada con **Google Calendar**, **Google Tasks** y **Neon PostgreSQL**.

La misma aplicación funciona en tres formatos:

- **Web / PWA** mediante GitHub Pages.
- **Desktop Electron** mediante `npm start`.
- **Android APK** mediante Capacitor.

## Funciones

- Panel **Hoy / 3 días / 5 días**.
- Eventos desde Google Calendar, separados de pendientes.
- Pendientes desde Google Tasks y visibles hasta completarlos.
- Proyectos con objetivos, actividades y avance automático.
- Áreas de vida.
- Objetivos de vida a corto, mediano y largo plazo.
- Diario personal.
- Ideas.
- Estadísticas.
- PWA instalable desde navegador.

## Requisitos locales

- Node.js 22 o superior.
- npm.
- Para APK: Android Studio/Android SDK y JDK compatibles con Capacitor 8.

## Clonar en Windows (disco D)

```powershell
D:
cd \
git clone https://github.com/jeffer91/Agenda.git
cd Agenda
npm install
```

## Electron

```powershell
npm start
```

Electron levanta Agenda en `http://localhost:4173` dentro de la ventana de escritorio.

Para que Google funcione en Electron, agrega este origen a tu OAuth Client ID de tipo **Web application**:

```text
http://localhost:4173
```

## Web local

```powershell
npm run web
```

Abre:

```text
http://localhost:8080
```

Si usarás Google desde esta dirección, agrega también `http://localhost:8080` como origen autorizado en el OAuth web.

## Web publicada

GitHub Pages publica la rama `main` mediante GitHub Actions. Para Google, el OAuth web debe incluir:

```text
https://jeffer91.github.io
```

## Android APK

Primero instala las dependencias:

```powershell
npm install
```

Para preparar Android:

```powershell
npm run android:setup
```

Para obtener el SHA-1 de la firma debug:

```powershell
npm run android:sha
```

En Google Cloud crea un segundo OAuth Client ID de tipo **Android** con:

```text
Package name: com.jeffer91.agenda
SHA-1: el valor mostrado por npm run android:sha
```

Debe estar en el mismo proyecto de Google Cloud donde están habilitadas Google Calendar API y Google Tasks API. El Client ID que se pega dentro de Agenda sigue siendo el **Web Client ID**; el Android Client ID solo autoriza la firma del APK.

Para crear el APK:

```powershell
npm run apk
```

El archivo final queda en:

```text
artifacts\Agenda-debug.apk
```

También puedes abrir el proyecto nativo en Android Studio:

```powershell
npm run android:open
```

## Compilar versión portable de Electron para Windows

```powershell
npm run desktop:dist
```

El resultado se genera en `dist-desktop/`.

## Arquitectura

- Frontend estático: HTML, CSS y JavaScript.
- Web: GitHub Pages.
- Desktop: Electron con servidor local de loopback.
- Android: Capacitor 8.
- Inicio de sesión Android: Google nativo mediante `@capgo/capacitor-social-login`.
- Base de datos: Neon PostgreSQL.
- API: Neon Data API con JWT de Google Identity y RLS por usuario.
- Eventos: Google Calendar API.
- Pendientes: Google Tasks API.

## Seguridad

El Google Web Client ID se guarda únicamente en `localStorage` del dispositivo. No se deben guardar secretos, contraseñas ni claves privadas dentro del repositorio.
