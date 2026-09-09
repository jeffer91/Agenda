const SMART_TYPES = ['commitment', 'routine', 'reminder', 'notice'];
const TYPE_LABELS = {
  commitment: 'Compromiso',
  routine: 'Rutina',
  reminder: 'Recordatorio',
  notice: 'Aviso'
};
const ACCORDION_KEY = 'agenda_today_accordion:';

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

function accordionOpen(key, defaultOpen) {
  const saved = localStorage.getItem(`${ACCORDION_KEY}${key}`);
  return saved === null ? defaultOpen : saved === '1';
}

function rememberAccordion(details, key) {
  details.addEventListener('toggle', () => {
    localStorage.setItem(`${ACCORDION_KEY}${key}`, details.open ? '1' : '0');
  });
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

  return { type: 'commitment', source: 'fallback', confidence: 0.62 };
}

function routineMeta(cards) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const timed = cards.map(card => {
    const raw = card.querySelector('.event-time')?.textContent?.trim() || '';
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return {
      card,
      raw,
      minutes: Number(match[1]) * 60 + Number(match[2]),
      title: card.querySelector('.row-title')?.textContent?.trim() || ''
    };
  }).filter(Boolean).sort((a, b) => a.minutes - b.minutes);

  const next = timed.find(item => item.minutes >= currentMinutes);
  const passed = timed.filter(item => item.minutes < currentMinutes).length;
  if (next) return `${passed ? `${passed} pasadas · ` : ''}Próxima ${next.raw}`;
  return timed.length ? `${timed.length} pasadas` : '';
}

function makeGroup(title, type, cards, defaultOpen = false) {
  if (!cards.length) return null;
  const details = document.createElement('details');
  details.className = `smart-event-group smart-${type} smart-accordion`;
  details.dataset.accordion = type;
  details.open = accordionOpen(type, defaultOpen);

  const meta = type === 'routine' ? routineMeta(cards) : '';
  details.innerHTML = `
    <summary class="smart-group-title">
      <span>${title}</span>
      ${meta ? `<small class="smart-group-meta">${meta}</small>` : '<small></small>'}
      <strong>${cards.length}</strong>
      <span class="smart-chevron" aria-hidden="true">›</span>
    </summary>
    <div class="smart-group-body"></div>`;

  const body = details.querySelector('.smart-group-body');
  cards.forEach(card => body.append(card));
  rememberAccordion(details, type);
  return details;
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
    const section = card.closest('section.card');
    if (section) section.removeAttribute('data-smart-events');
    document.querySelector('#app .smart-day-summary')?.remove();
    applySmartToday();
  };

  return classification.type;
}

function smartEvents(section) {
  if (!section || section.dataset.smartEvents === '1') return;

  const cards = [...section.querySelectorAll('.event-card')];
  if (!cards.length) {
    section.dataset.smartEvents = '1';
    return;
  }

  cards.forEach(card => section.append(card));
  section.querySelectorAll('.smart-event-group').forEach(node => node.remove());

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
  const order = [
    ['Compromisos', 'commitment', true],
    ['Avisos del día', 'notice', false],
    ['Recordatorios', 'reminder', false],
    ['Rutinas', 'routine', false]
  ];

  order.forEach(([label, type, defaultOpen]) => {
    const group = makeGroup(label, type, groups[type], defaultOpen);
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

function taskAccordion(label, key, rows, defaultOpen = true) {
  const details = document.createElement('details');
  details.className = `smart-task-current smart-accordion smart-task-${key}`;
  details.open = accordionOpen(`task-${key}`, defaultOpen);
  details.innerHTML = `
    <summary class="smart-group-title">
      <span>${label}</span>
      <small></small>
      <strong>${rows.length}</strong>
      <span class="smart-chevron" aria-hidden="true">›</span>
    </summary>
    <div class="smart-group-body"></div>`;
  const body = details.querySelector('.smart-group-body');
  rows.forEach(row => body.append(row));
  rememberAccordion(details, `task-${key}`);
  return details;
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
    const label = rangeLabel === 'Hoy' ? 'Pendientes de hoy' : `Pendientes · ${rangeLabel}`;
    section.append(taskAccordion(label, 'current', current, true));
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty smart-no-current';
    empty.textContent = rangeLabel === 'Hoy' ? 'Sin pendientes para hoy.' : 'Sin pendientes en este periodo.';
    section.append(empty);
  }

  if (overdue.length) {
    const details = document.createElement('details');
    details.className = 'smart-overdue smart-accordion';
    details.open = accordionOpen('overdue', false);
    details.innerHTML = `
      <summary class="smart-group-title">
        <span>Atrasados</span>
        <small></small>
        <strong>${overdue.length}</strong>
        <span class="smart-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="smart-overdue-body smart-group-body"></div>`;
    const body = details.querySelector('.smart-overdue-body');
    overdue.forEach(row => body.append(row));
    rememberAccordion(details, 'overdue');
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

function applySmartToday() {
  const app = document.querySelector('#app');
  if (!app) return;
  const heading = app.querySelector('.page-head h1');
  if (!heading || heading.textContent.trim() !== 'Hoy') return;

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
