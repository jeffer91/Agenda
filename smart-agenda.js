const SMART_TYPES = ['commitment', 'routine', 'reminder', 'notice'];
const TYPE_LABELS = {
  commitment: 'Compromiso',
  routine: 'Rutina',
  reminder: 'Recordatorio',
  notice: 'Aviso'
};

const normalizeTitle = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const ROUTINE_PATTERNS = [
  /\balarma\b/,
  /\blevantar(se)?\b/,
  /\baseo\b/,
  /\bmanana temprano\b/,
  /\bsalir al trabajo\b/,
  /\bgimnasio\b/,
  /\bejercicio\b/,
  /\bentrenar\b/,
  /\bbicicleta\b/,
  /\bdesayun/,
  /\balmorz/,
  /\bcena(r)?\b/,
  /\bcocina\b/,
  /\bayuno\b/,
  /\bdormir\b/,
  /\bducha\b/,
  /\bmeditar\b/,
  /\brutina\b/
];

const COMMITMENT_PATTERNS = [
  /\breunion\b/,
  /\bclase\b/,
  /\bdefensa\b/,
  /\bexamen\b/,
  /\bcita\b/,
  /\bentrevista\b/,
  /\brefuerzo\b/,
  /\btribunal\b/,
  /\basesoria\b/,
  /\bcapacitacion\b/,
  /\bpresentacion\b/,
  /\bconferencia\b/,
  /\btaller\b/,
  /\bvuelo\b/,
  /\bviaje\b/,
  /\btit\s*\|/,
  /\bcomplexivo\b/
];

const REMINDER_PATTERNS = [
  /\bcomprar\b/,
  /\bpagar\b/,
  /\bllamar\b/,
  /\brecordar\b/,
  /\benviar\b/,
  /\brevisar\b/,
  /\btramite\b/
];

function overrideKey(title) {
  return `agenda_smart_type:${normalizeTitle(title)}`;
}

function savedOverride(title) {
  const value = localStorage.getItem(overrideKey(title));
  return SMART_TYPES.includes(value) ? value : null;
}

function classifyEvent(title, isAllDay) {
  const manual = savedOverride(title);
  if (manual) return { type: manual, source: 'manual', confidence: 1 };

  const text = normalizeTitle(title);
  if (ROUTINE_PATTERNS.some(pattern => pattern.test(text))) {
    return { type: 'routine', source: 'rules', confidence: 0.96 };
  }
  if (COMMITMENT_PATTERNS.some(pattern => pattern.test(text))) {
    return { type: 'commitment', source: 'rules', confidence: 0.94 };
  }
  if (REMINDER_PATTERNS.some(pattern => pattern.test(text))) {
    return { type: 'reminder', source: 'rules', confidence: 0.88 };
  }
  if (isAllDay) {
    return { type: 'notice', source: 'rules', confidence: 0.82 };
  }

  // Conservative fallback: a timed Calendar entry is treated as a real commitment
  // so the smart view never hides a potentially important appointment.
  return { type: 'commitment', source: 'fallback', confidence: 0.62 };
}

function makeGroup(title, type, cards) {
  if (!cards.length) return null;
  const group = document.createElement('div');
  group.className = `smart-event-group smart-${type}`;
  group.innerHTML = `<div class="smart-group-title"><span>${title}</span><strong>${cards.length}</strong></div>`;
  cards.forEach(card => group.append(card));
  return group;
}

function decorateEvent(card) {
  const titleEl = card.querySelector('.row-title');
  const timeEl = card.querySelector('.event-time');
  if (!titleEl || !timeEl) return null;

  const title = titleEl.textContent.trim();
  const isAllDay = timeEl.textContent.trim().toLowerCase() === 'día';
  const classification = classifyEvent(title, isAllDay);

  card.dataset.smartType = classification.type;
  card.classList.add('smart-event-card');

  let tag = card.querySelector('.smart-type-tag');
  if (!tag) {
    tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'smart-type-tag';
    tag.title = 'Haz clic para cambiar la clasificación';
    titleEl.insertAdjacentElement('afterend', tag);
  }

  tag.dataset.type = classification.type;
  tag.textContent = TYPE_LABELS[classification.type];
  tag.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    const current = SMART_TYPES.indexOf(card.dataset.smartType);
    const nextType = SMART_TYPES[(current + 1) % SMART_TYPES.length];
    localStorage.setItem(overrideKey(title), nextType);
    const smartRoot = card.closest('[data-smart-events]');
    if (smartRoot) smartRoot.removeAttribute('data-smart-events');
    applySmartToday(true);
  };

  return classification.type;
}

function smartEvents(section) {
  if (!section || section.dataset.smartEvents === '1') return;

  const cards = [...section.querySelectorAll(':scope > .event-card')];
  if (!cards.length) {
    section.dataset.smartEvents = '1';
    return;
  }

  const groups = {
    commitment: [],
    notice: [],
    reminder: [],
    routine: []
  };

  cards.forEach(card => {
    const type = decorateEvent(card);
    if (type && groups[type]) groups[type].push(card);
  });

  const titleBar = section.querySelector('.section-title');
  section.querySelectorAll('.smart-event-group').forEach(node => node.remove());

  const order = [
    ['Compromisos', 'commitment'],
    ['Avisos del día', 'notice'],
    ['Recordatorios', 'reminder'],
    ['Rutinas', 'routine']
  ];

  order.forEach(([label, type]) => {
    const group = makeGroup(label, type, groups[type]);
    if (group) section.append(group);
  });

  if (titleBar) {
    const totalImportant = groups.commitment.length;
    const totalRoutine = groups.routine.length;
    titleBar.querySelector('.smart-event-summary')?.remove();
    const summary = document.createElement('span');
    summary.className = 'smart-event-summary';
    summary.textContent = `${totalImportant} compromiso${totalImportant === 1 ? '' : 's'} · ${totalRoutine} rutina${totalRoutine === 1 ? '' : 's'}`;
    titleBar.querySelector('h2')?.insertAdjacentElement('afterend', summary);
  }

  section.dataset.smartEvents = '1';
}

function smartTasks(section, rangeLabel) {
  if (!section || section.dataset.smartTasks === '1') return;

  const rows = [...section.querySelectorAll(':scope > .task-row')];
  if (!rows.length) {
    section.dataset.smartTasks = '1';
    return;
  }

  const overdue = rows.filter(row => row.classList.contains('is-overdue'));
  const current = rows.filter(row => !row.classList.contains('is-overdue'));
  const titleBar = section.querySelector('.section-title');

  rows.forEach(row => row.remove());

  if (current.length) {
    const currentGroup = document.createElement('div');
    currentGroup.className = 'smart-task-current';
    const label = rangeLabel === 'Hoy' ? 'Pendientes de hoy' : `Pendientes · ${rangeLabel}`;
    currentGroup.innerHTML = `<div class="smart-group-title"><span>${label}</span><strong>${current.length}</strong></div>`;
    current.forEach(row => currentGroup.append(row));
    section.append(currentGroup);
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty smart-no-current';
    empty.textContent = rangeLabel === 'Hoy' ? 'Sin pendientes para hoy.' : 'Sin pendientes en este periodo.';
    section.append(empty);
  }

  if (overdue.length) {
    const details = document.createElement('details');
    details.className = 'smart-overdue';
    details.innerHTML = `<summary><span>Atrasados</span><strong>${overdue.length}</strong><small>Mostrar</small></summary>`;
    const body = document.createElement('div');
    body.className = 'smart-overdue-body';
    overdue.forEach(row => body.append(row));
    details.append(body);
    section.append(details);
  }

  if (titleBar) {
    titleBar.querySelector('.smart-task-summary')?.remove();
    const summary = document.createElement('span');
    summary.className = 'smart-task-summary';
    summary.textContent = overdue.length ? `${overdue.length} atrasado${overdue.length === 1 ? '' : 's'}` : 'Al día';
    titleBar.querySelector('h2')?.insertAdjacentElement('afterend', summary);
  }

  section.dataset.smartTasks = '1';
}

function addDaySummary(eventSection, taskSection) {
  const pageHead = document.querySelector('#app .page-head');
  if (!pageHead || document.querySelector('#app .smart-day-summary')) return;

  const commitments = eventSection?.querySelectorAll('[data-smart-type="commitment"]').length || 0;
  const routines = eventSection?.querySelectorAll('[data-smart-type="routine"]').length || 0;
  const currentTasks = taskSection?.querySelectorAll('.smart-task-current .task-row').length || 0;
  const overdue = taskSection?.querySelectorAll('.smart-overdue .task-row').length || 0;

  const summary = document.createElement('div');
  summary.className = 'smart-day-summary';
  summary.innerHTML = `
    <span><strong>${commitments}</strong> compromisos</span>
    <span><strong>${routines}</strong> rutinas</span>
    <span><strong>${currentTasks}</strong> pendientes</span>
    ${overdue ? `<span class="smart-summary-overdue"><strong>${overdue}</strong> atrasados</span>` : ''}
  `;
  pageHead.insertAdjacentElement('afterend', summary);
}

function applySmartToday(force = false) {
  const app = document.querySelector('#app');
  if (!app) return;
  const heading = app.querySelector('.page-head h1');
  if (!heading || heading.textContent.trim() !== 'Hoy') return;

  if (force) {
    app.querySelectorAll('[data-smart-events], [data-smart-tasks]').forEach(node => {
      node.removeAttribute('data-smart-events');
      node.removeAttribute('data-smart-tasks');
    });
    app.querySelector('.smart-day-summary')?.remove();
  }

  const cards = [...app.querySelectorAll('.grid.two > section.card')];
  const eventSection = cards.find(section => section.querySelector('.event-card') || section.querySelector('.section-title h2')?.textContent.trim() === 'Eventos');
  const taskSection = cards.find(section => section.querySelector('.task-row') || section.querySelector('.section-title h2')?.textContent.trim() === 'Pendientes');
  const activeRange = app.querySelector('.tabs .tab.active')?.textContent.trim() || 'Hoy';

  smartEvents(eventSection);
  smartTasks(taskSection, activeRange);
  addDaySummary(eventSection, taskSection);
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    applySmartToday();
  });
});

const appRoot = document.querySelector('#app');
if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });

applySmartToday();
