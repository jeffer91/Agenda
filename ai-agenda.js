const AI_CONFIG = window.AGENDA_AI_CONFIG || {};
const AI_ENDPOINT = String(AI_CONFIG.endpoint || '').replace(/\/$/, '');
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const TYPES = new Set(['commitment', 'routine', 'reminder', 'notice']);
const TYPE_LABELS = {
  commitment: 'Compromiso',
  routine: 'Rutina',
  reminder: 'Recordatorio',
  notice: 'Aviso'
};

const HIGH_CONFIDENCE_PATTERNS = [
  /\b(alarma|levantarse|aseo|gimnasio|ejercicio|entrenar|bicicleta|desayun|almorz|cena|cocina|ayuno|dormir|ducha|meditar|rutina)\b/i,
  /\b(reuni[oó]n|clase|defensa|examen|cita|entrevista|refuerzo|tribunal|asesor[ií]a|capacitaci[oó]n|presentaci[oó]n|conferencia|taller|vuelo|viaje|complexivo)\b/i,
  /\btit\s*\|/i,
  /\b(comprar|pagar|llamar|recordar|enviar|revisar|tr[aá]mite)\b/i
];

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function overrideKey(title) {
  return `agenda_smart_type:${normalizeTitle(title)}`;
}

function aiCacheKey(title) {
  return `agenda_ai_classification:${normalizeTitle(title)}`;
}

function userOverrideKey(title) {
  return `agenda_ai_user_override:${normalizeTitle(title)}`;
}

function hasUserOverride(title) {
  return localStorage.getItem(userOverrideKey(title)) === '1';
}

function getCached(title) {
  try {
    const parsed = JSON.parse(localStorage.getItem(aiCacheKey(title)) || 'null');
    if (!parsed || !TYPES.has(parsed.type) || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > CACHE_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveAI(title, result) {
  const entry = {
    type: result.type,
    priority: result.priority || 'medium',
    confidence: Number(result.confidence || 0),
    reason: String(result.reason || ''),
    provider: String(result.provider || 'ai'),
    savedAt: Date.now()
  };
  localStorage.setItem(aiCacheKey(title), JSON.stringify(entry));
  localStorage.setItem(overrideKey(title), entry.type);
}

function forceSmartRefresh(section) {
  if (!section) return;
  section.removeAttribute('data-smart-events');
  const marker = document.createComment('agenda-ai-refresh');
  section.append(marker);
  marker.remove();
}

function isAmbiguousCard(card) {
  const title = card.querySelector('.row-title')?.textContent?.trim() || '';
  if (!title) return false;
  if (hasUserOverride(title)) return false;
  if (HIGH_CONFIDENCE_PATTERNS.some(pattern => pattern.test(title))) return false;
  const currentType = card.dataset.smartType || '';
  const timeText = card.querySelector('.event-time')?.textContent?.trim().toLowerCase() || '';
  const allDay = timeText === 'día';
  return currentType === 'commitment' && !allDay;
}

function eventPayload(card) {
  const title = card.querySelector('.row-title')?.textContent?.trim() || '';
  const time = card.querySelector('.event-time')?.textContent?.trim() || '';
  const rowSub = card.querySelector('.row-sub')?.textContent?.trim() || '';
  const calendar = rowSub.split('·')[0]?.trim() || '';
  return { title, time, allDay: time.toLowerCase() === 'día', calendar };
}

async function classifyWithAI(card) {
  const payload = eventPayload(card);
  if (!payload.title || hasUserOverride(payload.title)) return;

  const cached = getCached(payload.title);
  if (cached) {
    localStorage.setItem(overrideKey(payload.title), cached.type);
    forceSmartRefresh(card.closest('section'));
    return;
  }

  if (!AI_ENDPOINT) return;
  const idToken = localStorage.getItem('agenda_id_token') || '';
  if (!idToken) return;

  card.dataset.aiPending = '1';
  try {
    const response = await fetch(`${AI_ENDPOINT}/classify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return;
    const result = await response.json();
    if (!TYPES.has(result?.type)) return;

    saveAI(payload.title, result);
    forceSmartRefresh(card.closest('section'));
  } catch {
    // La capa local sigue funcionando aunque la IA externa no esté disponible.
  } finally {
    delete card.dataset.aiPending;
  }
}

async function processCandidates() {
  const cards = [...document.querySelectorAll('#app .event-card.smart-event-card')]
    .filter(card => !card.dataset.aiPending && isAmbiguousCard(card));
  if (!cards.length) return;

  let index = 0;
  const workers = Array.from({ length: Math.min(3, cards.length) }, async () => {
    while (index < cards.length) {
      const card = cards[index++];
      await classifyWithAI(card);
    }
  });
  await Promise.all(workers);
}

// Si el usuario cambia una etiqueta manualmente, la IA deja de tocar ese título.
document.addEventListener('click', event => {
  const tag = event.target.closest?.('.smart-type-tag');
  if (!tag) return;
  const card = tag.closest('.event-card');
  const title = card?.querySelector('.row-title')?.textContent?.trim() || '';
  if (title) localStorage.setItem(userOverrideKey(title), '1');
}, true);

let timer;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(processCandidates, 120);
});

const root = document.querySelector('#app');
if (root) observer.observe(root, { childList: true, subtree: true });
setTimeout(processCandidates, 250);
