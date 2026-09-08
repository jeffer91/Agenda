# Agenda

Agenda personal de productividad conectada con **Google Calendar**, **Google Tasks** y **Neon PostgreSQL**.

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

## Arquitectura

- Frontend: GitHub Pages.
- Base de datos: Neon PostgreSQL.
- API: Neon Data API con JWT de Google Identity y RLS por usuario.
- Eventos: Google Calendar API.
- Pendientes: Google Tasks API.

## Primer inicio

1. En Google Cloud crea un **OAuth 2.0 Client ID** de tipo *Web application*.
2. Habilita **Google Calendar API** y **Google Tasks API**.
3. Añade como origen autorizado: `https://jeffer91.github.io`.
4. Abre Agenda y pulsa **Conectar Google**.
5. Pega el Client ID. Se almacena únicamente en `localStorage` del dispositivo.

No se deben guardar secretos ni contraseñas dentro del repositorio.
