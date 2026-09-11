import { downloadTaskMatrix, openTaskExcelImport } from './task-excel.js';

const API = 'https://ep-nameless-sunset-ak959lh3.apirest.c-3.us-west-2.aws.neon.tech/agenda/rest/v1';
const TIME_ZONE = 'America/Guayaquil';
const ECUADOR_OFFSET = '-05:00';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const S = {
  view: 'today',
  days: 1,
  id: localStorage.agenda_id_token || '',
  access: '',
  client: localStorage.agenda_google_client_id || '',
  synced: false,
  syncing: false,
  events: [],
  tasks: [],
  areas: [],
  projects: [],
  objectives: [],
  activities: [],
  goals: [],
  journal: [],
  ideas: [],
  stats: {}
};

const app = $('#app');
const toastEl = $('#toast');
const setup = $('#setupDialog');
const entity = $('#entityDialog');
let resolveForm;

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[m]));

function parseAgendaDate(value) {
  if (value instanceof Date) return value;
  const s = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T12:00:00${ECUADOR_OFFSET}`);
  }
  return new Date(value);
}

function day(value) {
  const x = parseAgendaDate(value);
  return new Intl.DateTimeFormat('es-EC', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: TIME_ZONE
  }).format(x);
}

function long(value) {
  const x = parseAgendaDate(value);
  return new Intl.DateTimeFormat('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE
  }).format(x);
}

function time(value) {
  return new Intl.DateTimeFormat('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE
  }).format(parseAgendaDate(value));
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

function jwtExpired(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return true;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return !payload.exp || Date.now() >= (payload.exp * 1000 - 30000);
  } catch {
    return true;
  }
}

function clearIdentity() {
  S.id = '';
  S.access = '';
  S.synced = false;
  S.events = [];
  S.tasks = [];
  delete localStorage.agenda_id_token;
}

function oauthHint() {
  const hint = $('#oauthHint');
  if (!hint) return;

  const native = Boolean(window.Capacitor);
  if (native) {
    hint.innerHTML = 'Android usa el <strong>Web Client ID</strong> en este campo y valida la app nativa con su package name y SHA-1.';
    return;
  }

  hint.innerHTML = `Origen actual que debe estar autorizado en Google Cloud: <strong>${esc(location.origin)}</strong>`;
}

function openSetup() {
  $('#clientIdInput').value = S.client;
  oauthHint();
  setup.showModal();
}

function updateChrome() {
  const googleBtn = $('#googleBtn');
  const syncBtn = $('#syncBtn');

  googleBtn.textContent = S.id ? 'Google ✓' : 'Conectar Google';
  googleBtn.classList.toggle('connected', Boolean(S.id));

  syncBtn.textContent = S.syncing ? 'Sincronizando…' : (S.synced ? 'Sincronizado ✓' : 'Sincronizar');
  syncBtn.classList.toggle('connected', S.synced);
  syncBtn.disabled = S.syncing;
}

async function readError(response) {
  const text = await response.text();
  if (!text) return `Error ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error_description || parsed.error || text;
  } catch {
    return text;
  }
}

async function api(path, opt = {}) {
  if (!S.id) throw Error('Conecta Google primero');

  const response = await fetch(`${API}/${path}`, {
    method: opt.method || 'GET',
    headers: {
      Authorization: `Bearer ${S.id}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });

  if (response.status === 401) {
    clearIdentity();
    updateChrome();
    throw Error('La sesión venció. Conecta Google otra vez.');
  }

  if (!response.ok) throw Error(await readError(response));
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadDB() {
  if (!S.id) return;

  const [areas, projects, objectives, activities, goals, journal, ideas, stats] = await Promise.all([
    api('areas?archived=eq.false&order=name'),
    api('projects?status=neq.archivado&order=updated_at.desc'),
    api('objectives?order=sort_order'),
    api('activities?order=completed,due_date.nullslast'),
    api('life_goals?status=neq.archivado&order=updated_at.desc'),
    api('journal_entries?order=entry_date.desc,created_at.desc&limit=100'),
    api('ideas?status=neq.archivada&order=created_at.desc'),
    api('dashboard_stats?select=*')
  ]);

  Object.assign(S, {
    areas,
    projects,
    objectives,
    activities,
    goals,
    journal,
    ideas,
    stats: stats?.[0] || {}
  });
}

function initGIS() {
  if (!S.client || !window.google?.accounts) return;

  google.accounts.id.initialize({
    client_id: S.client,
    callback: async response => {
      S.id = response.credential;
      localStorage.agenda_id_token = response.credential;
      try {
        await loadDB();
        toast('Agenda conectada');
      } catch (error) {
        toast(error.message);
      }
      render();
    }
  });
}

function signIn() {
  if (!S.client) {
    openSetup();
    return;
  }

  if (!window.google?.accounts?.id) {
    toast('Google todavía está cargando. Intenta nuevamente.');
    return;
  }

  initGIS();
  document.querySelector('[data-signin-overlay]')?.remove();

  const overlay = document.createElement('div');
  overlay.dataset.signinOverlay = '1';
  overlay.className = 'signin-overlay';
  overlay.innerHTML = `
    <div class="signin-card">
      <h3>Conectar Agenda</h3>
      <p class="muted">Usa tu cuenta de Google para acceder a tus datos y sincronizar Calendar y Tasks.</p>
      <div id="gis"></div>
      <button class="btn secondary" id="closegis">Cerrar</button>
    </div>`;
  document.body.append(overlay);

  google.accounts.id.renderButton(overlay.querySelector('#gis'), {
    theme: 'outline',
    size: 'large',
    width: 300
  });

  overlay.querySelector('#closegis').onclick = () => overlay.remove();
  const watcher = setInterval(() => {
    if (!document.body.contains(overlay) || S.id) {
      clearInterval(watcher);
      overlay.remove();
    }
  }, 300);
}

function authGoogle() {
  if (!S.client) {
    openSetup();
    return;
  }
  if (!S.id) {
    toast('Primero conecta tu cuenta de Google');
    signIn();
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    toast('Google todavía está cargando. Intenta nuevamente.');
    return;
  }
  if (S.syncing) return;

  S.syncing = true;
  updateChrome();

  const client = google.accounts.oauth2.initTokenClient({
    client_id: S.client,
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks',
    callback: async response => {
      try {
        if (response.error) throw Error(response.error_description || response.error);
        S.access = response.access_token;
        await syncGoogle();
        toast('Calendar y Tasks sincronizados');
      } catch (error) {
        S.synced = false;
        toast(error.message);
      } finally {
        S.syncing = false;
        render();
      }
    }
  });

  try {
    client.requestAccessToken({ prompt: 'consent' });
  } catch (error) {
    S.syncing = false;
    updateChrome();
    toast(error.message);
  }
}

async function gf(url, opt = {}) {
  if (!S.access) throw Error('Pulsa Sincronizar para autorizar Calendar y Tasks');

  const response = await fetch(url, {
    ...opt,
    headers: {
      Authorization: `Bearer ${S.access}`,
      'Content-Type': 'application/json',
      ...(opt.headers || {})
    }
  });

  if (response.status === 401) {
    S.access = '';
    S.synced = false;
    throw Error('La autorización de Google venció. Pulsa Sincronizar otra vez.');
  }

  if (!response.ok) throw Error(await readError(response));
  return response.status === 204 ? null : response.json();
}

function eventStart(event) {
  return parseAgendaDate(event.start?.dateTime || event.start?.date);
}

function taskDue(task) {
  return task.due ? parseAgendaDate(String(task.due).slice(0, 10)) : null;
}

async function syncGoogle() {
  const from = startOfToday();
  const to = addDays(6);
  to.setHours(23, 59, 59, 999);

  const calendars = await gf('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50');
  const eventGroups = await Promise.all((calendars.items || []).map(async calendar => {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`);
    url.searchParams.set('timeMin', from.toISOString());
    url.searchParams.set('timeMax', to.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '100');

    const response = await gf(url);
    return (response.items || []).map(event => ({ ...event, calendar: calendar.summary }));
  }));

  S.events = eventGroups.flat().sort((a, b) => eventStart(a) - eventStart(b));

  const lists = await gf('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
  const taskGroups = await Promise.all((lists.items || []).map(async list => {
    const response = await gf(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=true&maxResults=100`);
    return (response.items || [])
      .filter(task => task.status !== 'completed')
      .map(task => ({ ...task, listId: list.id, list: list.title }));
  }));

  S.tasks = taskGroups.flat();
  S.synced = true;
}

function form(title, fields) {
  return new Promise(resolve => {
    resolveForm = resolve;
    $('#entityForm').reset();
    $('#entityTitle').textContent = title;
    $('#entityFields').innerHTML = fields.map(field => {
      const [name, label, type, required, options] = field;
      const req = required ? 'required' : '';

      if (type === 'textarea') {
        return `<label>${label}<textarea name="${name}" ${req}></textarea></label>`;
      }
      if (type === 'select') {
        return `<label>${label}<select name="${name}" ${req}>${options.map(option => `<option value="${esc(option[0])}">${esc(option[1])}</option>`).join('')}</select></label>`;
      }
      return `<label>${label}<input name="${name}" type="${type}" ${req}></label>`;
    }).join('');
    entity.showModal();
  });
}

entity.addEventListener('close', () => {
  if (!resolveForm) return;
  const result = entity.returnValue === 'default'
    ? Object.fromEntries(new FormData($('#entityForm').entries()))
    : null;
  resolveForm(result);
  resolveForm = null;
});

const progress = id => {
  const activities = S.activities.filter(activity => activity.project_id === id);
  return activities.length
    ? Math.round(activities.filter(activity => activity.completed).length / activities.length * 100)
    : 0;
};

async function refreshDB() {
  await loadDB();
  render();
}

async function act(type, el) {
  if (type === 'connect') {
    signIn();
    return;
  }

  if (type === 'sync') {
    authGoogle();
    return;
  }

  if (type === 'task-template') {
    await downloadTaskMatrix();
    toast('Matriz de pendientes descargada');
    return;
  }

  if (type === 'task-import') {
    if (!S.access) {
      toast('Primero pulsa Sincronizar para autorizar Google Tasks');
      authGoogle();
      return;
    }
    await openTaskExcelImport({ tasks: S.tasks, gf, syncGoogle, render, toast });
    return;
  }

  if (type === 'event') {
    const f = await form('Nuevo evento', [
      ['title', 'Título', 'text', 1],
      ['date', 'Fecha', 'date', 1],
      ['start', 'Hora inicio', 'time', 1],
      ['end', 'Hora fin', 'time', 1]
    ]);
    if (!f) return;
    if (!S.access) {
      toast('Primero pulsa Sincronizar y vuelve a crear el evento');
      authGoogle();
      return;
    }
    if (f.end <= f.start) throw Error('La hora de fin debe ser posterior a la hora de inicio.');

    await gf('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify({
        summary: f.title,
        start: { dateTime: `${f.date}T${f.start}:00${ECUADOR_OFFSET}` },
        end: { dateTime: `${f.date}T${f.end}:00${ECUADOR_OFFSET}` }
      })
    });
    await syncGoogle();
    toast('Evento creado');
    render();
    return;
  }

  if (type === 'task') {
    const f = await form('Nuevo pendiente', [
      ['title', 'Pendiente', 'text', 1],
      ['due', 'Fecha límite', 'date', 0]
    ]);
    if (!f) return;
    if (!S.access) {
      toast('Primero pulsa Sincronizar y vuelve a crear el pendiente');
      authGoogle();
      return;
    }

    const lists = await gf('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1');
    const list = lists.items?.[0];
    if (!list) throw Error('No encontré una lista de Google Tasks para guardar el pendiente.');

    const body = { title: f.title };
    if (f.due) body.due = `${f.due}T00:00:00.000Z`;

    await gf(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    await syncGoogle();
    toast('Pendiente creado');
    render();
    return;
  }

  if (type === 'area') {
    const f = await form('Nueva área', [['name', 'Nombre', 'text', 1]]);
    if (!f) return;
    await api('areas', { method: 'POST', body: f });
    await refreshDB();
    return;
  }

  if (type === 'project') {
    const f = await form('Nuevo proyecto', [
      ['title', 'Nombre', 'text', 1],
      ['description', 'Descripción', 'textarea', 0],
      ['area_id', 'Área', 'select', 0, [['', 'Sin área'], ...S.areas.map(area => [area.id, area.name])]],
      ['target_date', 'Fecha objetivo', 'date', 0]
    ]);
    if (!f) return;
    await api('projects', {
      method: 'POST',
      body: {
        ...f,
        area_id: f.area_id || null,
        target_date: f.target_date || null
      }
    });
    await refreshDB();
    return;
  }

  if (type === 'objective') {
    const f = await form('Nuevo objetivo', [
      ['title', 'Objetivo', 'text', 1],
      ['target_date', 'Fecha objetivo', 'date', 0]
    ]);
    if (!f) return;
    await api('objectives', {
      method: 'POST',
      body: {
        ...f,
        project_id: el.dataset.project,
        target_date: f.target_date || null
      }
    });
    await refreshDB();
    return;
  }

  if (type === 'activity') {
    const f = await form('Nueva actividad', [
      ['title', 'Actividad', 'text', 1],
      ['due_date', 'Fecha límite', 'date', 0]
    ]);
    if (!f) return;
    await api('activities', {
      method: 'POST',
      body: {
        ...f,
        project_id: el.dataset.project,
        objective_id: el.dataset.objective || null,
        due_date: f.due_date || null
      }
    });
    await refreshDB();
    return;
  }

  if (type === 'goal') {
    const f = await form('Objetivo de vida', [
      ['title', 'Objetivo', 'text', 1],
      ['description', 'Descripción', 'textarea', 0],
      ['horizon', 'Horizonte', 'select', 1, [
        ['corto', 'Corto plazo'],
        ['mediano', 'Mediano plazo'],
        ['largo', 'Largo plazo']
      ]],
      ['target_date', 'Fecha objetivo', 'date', 0]
    ]);
    if (!f) return;
    await api('life_goals', {
      method: 'POST',
      body: { ...f, target_date: f.target_date || null }
    });
    await refreshDB();
    return;
  }

  if (type === 'journal') {
    const f = await form('Nueva entrada', [
      ['entry_date', 'Fecha', 'date', 1],
      ['title', 'Título', 'text', 0],
      ['body', 'Escribe libremente', 'textarea', 1]
    ]);
    if (!f) return;
    await api('journal_entries', { method: 'POST', body: f });
    await refreshDB();
    return;
  }

  if (type === 'idea') {
    const f = await form('Nueva idea', [
      ['title', 'Idea', 'text', 1],
      ['body', 'Detalle', 'textarea', 0]
    ]);
    if (!f) return;
    await api('ideas', { method: 'POST', body: f });
    await refreshDB();
  }
}

function callout() {
  return (!S.client || !S.id)
    ? '<div class="setup-callout"><strong>Conecta tu cuenta de Google</strong><span>Accede a tu agenda personal y luego sincroniza Calendar y Tasks.</span><button class="icon-btn" data-action="connect">Conectar</button></div>'
    : '';
}

function head(title, subtitle = '', buttons = '') {
  return `<div class="page-head"><div><h1>${title}</h1><div class="muted">${subtitle}</div></div>${buttons}</div>`;
}

function events(daysToShow = S.days) {
  if (S.id && !S.synced) {
    return '<div class="empty">Pulsa <strong>Sincronizar</strong> para cargar Google Calendar.</div>';
  }

  const end = addDays(daysToShow - 1);
  end.setHours(23, 59, 59, 999);
  const now = startOfToday();

  const visible = S.events.filter(event => {
    const date = eventStart(event);
    return date >= now && date <= end;
  });

  return visible.length
    ? visible.map(event => {
        const start = eventStart(event);
        return `<div class="event-card">
          <div class="event-time">${event.start?.dateTime ? time(start) : 'Día'}</div>
          <div>
            <div class="row-title">${esc(event.summary || 'Sin título')}</div>
            <div class="row-sub">${esc(event.calendar || 'Calendar')} · ${day(start)}</div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Sin eventos en este periodo.</div>';
}

function tasks(daysToShow = null) {
  if (S.id && !S.synced) {
    return '<div class="empty">Pulsa <strong>Sincronizar</strong> para cargar Google Tasks.</div>';
  }

  const today = startOfToday();
  let visible = [...S.tasks];

  if (daysToShow !== null) {
    const end = addDays(daysToShow - 1);
    end.setHours(23, 59, 59, 999);
    visible = visible.filter(task => {
      const due = taskDue(task);
      return due && due <= end;
    });
  }

  visible.sort((a, b) => {
    const aDue = taskDue(a);
    const bDue = taskDue(b);
    if (aDue && bDue) return aDue - bDue;
    if (aDue) return -1;
    if (bDue) return 1;
    return String(a.title || '').localeCompare(String(b.title || ''), 'es');
  });

  return visible.length
    ? visible.map(task => {
        const index = S.tasks.indexOf(task);
        const due = taskDue(task);
        const overdue = due && due < today;
        return `<div class="row task-row ${overdue ? 'is-overdue' : ''}">
          <label class="check">
            <input type="checkbox" data-task="${index}" aria-label="Completar ${esc(task.title)}">
            <div>
              <div class="row-title">${esc(task.title)}</div>
              <div class="row-sub ${overdue ? 'overdue' : ''}">${due ? `${overdue ? 'Vencido · ' : 'Fecha: '}${day(String(task.due).slice(0, 10))}` : 'Sin fecha'} · ${esc(task.list || 'Tasks')}</div>
            </div>
          </label>
        </div>`;
      }).join('')
    : `<div class="empty">${daysToShow === null ? 'Sin pendientes.' : 'Sin pendientes con fecha en este periodo.'}</div>`;
}

function today() {
  return `${callout()}${head('Hoy', long(new Date()))}
    <div class="tabs">
      ${[1, 3, 5].map(n => `<button class="tab ${S.days === n ? 'active' : ''}" data-days="${n}">${n === 1 ? 'Hoy' : `${n} días`}</button>`).join('')}
    </div>
    <div class="grid two">
      <section class="card accent-card accent-events">
        <div class="section-title"><h2>Eventos</h2><button class="icon-btn" data-action="event">+ Evento</button></div>
        ${events()}
      </section>
      <section class="card accent-card accent-tasks">
        <div class="section-title"><h2>Pendientes</h2><button class="icon-btn" data-action="task">+ Pendiente</button></div>
        ${tasks(S.days)}
      </section>
    </div>
    <div class="grid two lower-grid">
      <section class="card accent-card accent-projects">
        <h2>Proyectos activos</h2>
        ${S.projects.filter(project => project.status === 'activo').slice(0, 6).map(project => `<div class="row">
          <div class="row-main">
            <b>${esc(project.title)}</b>
            <div class="progress"><span style="width:${progress(project.id)}%"></span></div>
          </div>
          <strong>${progress(project.id)}%</strong>
        </div>`).join('') || '<div class="empty">Sin proyectos activos.</div>'}
      </section>
      <section class="card today-note">
        <h2>Objetivos de vida</h2>
        ${['corto', 'mediano', 'largo'].map(horizon => `<div class="row">
          <div>${horizon[0].toUpperCase() + horizon.slice(1)} plazo</div>
          <strong>${S.goals.filter(goal => goal.horizon === horizon && goal.status === 'activo').length}</strong>
        </div>`).join('')}
      </section>
    </div>`;
}

function projects() {
  return `${callout()}${head(
    'Proyectos',
    'Objetivos, actividades y avance',
    '<div class="actions"><button class="btn secondary" data-action="area">Nueva área</button><button class="btn" data-action="project">Nuevo proyecto</button></div>'
  )}
  <div class="grid two">
    ${S.projects.map(project => {
      const area = S.areas.find(item => item.id === project.area_id);
      const objectives = S.objectives.filter(item => item.project_id === project.id);
      const activities = S.activities.filter(item => item.project_id === project.id);

      return `<article class="card project-card accent-card accent-projects">
        <div class="section-title">
          <div>
            <h2>${esc(project.title)}</h2>
            <div class="project-meta">
              ${area ? `<span class="pill">${esc(area.name)}</span>` : ''}
              <span class="pill status-${esc(project.status)}">${esc(project.status)}</span>
            </div>
          </div>
          <strong>${progress(project.id)}%</strong>
        </div>
        <div class="progress"><span style="width:${progress(project.id)}%"></span></div>
        ${project.description ? `<div class="muted">${esc(project.description)}</div>` : ''}
        ${project.target_date ? `<div class="row-sub">Fecha objetivo: ${day(project.target_date)}</div>` : ''}

        <div class="section-title"><b>Objetivos</b><button class="icon-btn" data-action="objective" data-project="${project.id}">+ Objetivo</button></div>
        ${objectives.map(objective => `<div class="row">
          <div>
            <b>${esc(objective.title)}</b>
            <div class="row-sub">${objective.target_date ? day(objective.target_date) : 'Sin fecha'}</div>
          </div>
          <button class="icon-btn" data-action="activity" data-project="${project.id}" data-objective="${objective.id}">+ Actividad</button>
        </div>`).join('') || '<div class="empty">Sin objetivos.</div>'}

        <div class="section-title"><b>Actividades</b><button class="icon-btn" data-action="activity" data-project="${project.id}">+ Actividad</button></div>
        ${activities.map(activity => {
          const due = activity.due_date ? parseAgendaDate(activity.due_date) : null;
          const overdue = due && !activity.completed && due < startOfToday();
          return `<label class="check row ${overdue ? 'is-overdue' : ''}">
            <input type="checkbox" ${activity.completed ? 'checked' : ''} data-activity="${activity.id}">
            <div>
              <b>${esc(activity.title)}</b>
              <div class="row-sub ${overdue ? 'overdue' : ''}">${activity.due_date ? `${overdue ? 'Vencida · ' : ''}${day(activity.due_date)}` : 'Sin fecha'}</div>
            </div>
          </label>`;
        }).join('') || '<div class="empty">Sin actividades.</div>'}
      </article>`;
    }).join('') || '<section class="card"><div class="empty">Crea tu primer proyecto.</div></section>'}
  </div>`;
}

function goals() {
  const labels = {
    corto: 'Corto plazo',
    mediano: 'Mediano plazo',
    largo: 'Largo plazo'
  };

  return `${callout()}${head('Objetivos de vida', 'Corto, mediano y largo plazo', '<button class="btn" data-action="goal">Nuevo objetivo</button>')}
    <div class="grid three">
      ${Object.entries(labels).map(([horizon, label]) => `<section class="card accent-card accent-goals">
        <h2>${label}</h2>
        ${S.goals.filter(goal => goal.horizon === horizon).map(goal => `<div class="row">
          <div>
            <b>${esc(goal.title)}</b>
            <div class="row-sub">${goal.target_date ? day(goal.target_date) : 'Sin fecha'}</div>
          </div>
          <span class="pill status-${esc(goal.status)}">${esc(goal.status)}</span>
        </div>`).join('') || '<div class="empty">Sin objetivos.</div>'}
      </section>`).join('')}
    </div>`;
}

function journal() {
  return `${callout()}${head('Mi diario', 'Notas personales por fecha', '<button class="btn" data-action="journal">Nueva entrada</button>')}
    <div class="grid">
      ${S.journal.map(entry => `<article class="card accent-card accent-journal">
        <h2>${esc(entry.title || day(entry.entry_date))}</h2>
        <div class="row-sub">${long(entry.entry_date)}</div>
        <p class="journal-entry">${esc(entry.body)}</p>
      </article>`).join('') || '<section class="card"><div class="empty">Tu diario está vacío.</div></section>'}
    </div>`;
}

function ideas() {
  return `${callout()}${head('Ideas', 'Captura rápida para desarrollar después', '<button class="btn" data-action="idea">Nueva idea</button>')}
    <div class="grid two">
      ${S.ideas.map(idea => `<article class="card accent-card accent-ideas">
        <div class="section-title"><h2>${esc(idea.title)}</h2><span class="badge">${esc(idea.status)}</span></div>
        <p>${esc(idea.body || '')}</p>
      </article>`).join('') || '<section class="card"><div class="empty">Sin ideas.</div></section>'}
    </div>`;
}

function stats() {
  const x = S.stats;
  const metrics = [
    ['Proyectos activos', x.active_projects, 'metric-blue'],
    ['Proyectos completados', x.completed_projects, 'metric-green'],
    ['Actividades pendientes', x.pending_activities, 'metric-amber'],
    ['Actividades completadas', x.completed_activities, 'metric-teal'],
    ['Objetivos de vida', x.active_life_goals, 'metric-purple'],
    ['Diario', x.journal_entries, 'metric-indigo'],
    ['Ideas', x.open_ideas, 'metric-orange']
  ];

  return `${callout()}${head('Estadísticas', 'Tu avance acumulado')}
    <div class="grid three">
      ${metrics.map(([label, value, color]) => `<div class="card metric-card ${color}"><div class="metric">${value ?? 0}</div><div class="metric-label">${label}</div></div>`).join('')}
    </div>`;
}

function render() {
  const views = {
    today,
    calendar: () => `${callout()}${head('Calendario', 'Próximos 7 días · Google Calendar', '<button class="btn" data-action="event">Nuevo evento</button>')}<section class="card accent-card accent-events">${events(7)}</section>`,
    tasks: () => `${callout()}${head('Pendientes', 'Google Tasks', '<div class="actions"><button class="btn secondary" data-action="task-template">↓ Matriz Excel</button><button class="btn secondary" data-action="task-import">↑ Subir Excel</button><button class="btn" data-action="task">Nuevo pendiente</button></div>')}<section class="card accent-card accent-tasks">${tasks()}</section>`,
    projects,
    goals,
    journal,
    ideas,
    stats
  };

  const view = views[S.view] || today;
  app.innerHTML = view();
  updateChrome();

  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === S.view));
  $$('[data-days]').forEach(button => {
    button.onclick = () => {
      S.days = +button.dataset.days;
      render();
    };
  });
  $$('[data-action]').forEach(button => {
    button.onclick = () => act(button.dataset.action, button).catch(error => toast(error.message));
  });

  $$('[data-task]').forEach(checkbox => {
    checkbox.onchange = async () => {
      const task = S.tasks[+checkbox.dataset.task];
      if (!task) return;
      checkbox.disabled = true;
      try {
        await gf(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(task.listId)}/tasks/${encodeURIComponent(task.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'completed',
            completed: new Date().toISOString()
          })
        });
        await syncGoogle();
        toast('Pendiente completado');
        render();
      } catch (error) {
        checkbox.checked = false;
        checkbox.disabled = false;
        toast(error.message);
      }
    };
  });

  $$('[data-activity]').forEach(checkbox => {
    checkbox.onchange = async () => {
      const activity = S.activities.find(item => item.id === checkbox.dataset.activity);
      if (!activity) return;
      checkbox.disabled = true;
      try {
        await api(`activities?id=eq.${activity.id}`, {
          method: 'PATCH',
          body: { completed: !activity.completed }
        });
        await loadDB();
        render();
      } catch (error) {
        checkbox.checked = activity.completed;
        checkbox.disabled = false;
        toast(error.message);
      }
    };
  });
}

$$('.nav-item').forEach(button => {
  button.onclick = () => {
    S.view = button.dataset.view;
    render();
  };
});

$('#googleBtn').onclick = () => {
  if (S.id) openSetup();
  else signIn();
};
$('#syncBtn').onclick = authGoogle;

$('#setupForm').onsubmit = event => {
  event.preventDefault();
  const nextClient = $('#clientIdInput').value.trim();
  if (!nextClient.endsWith('.apps.googleusercontent.com')) {
    toast('El Client ID de Google no parece válido');
    return;
  }

  const changed = S.client && S.client !== nextClient;
  S.client = nextClient;
  localStorage.agenda_google_client_id = S.client;
  if (changed) clearIdentity();
  setup.close();
  initGIS();
  signIn();
};

(async () => {
  if (S.id && jwtExpired(S.id)) clearIdentity();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  for (let i = 0; i < 50 && !window.google?.accounts; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  initGIS();
  try {
    await loadDB();
  } catch (error) {
    toast(error.message);
  }
  render();
})();