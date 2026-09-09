import http from 'node:http';

const PORT = Number(process.env.PORT || 10000);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://jeffer91.github.io,http://localhost:8080,http://localhost:4173,capacitor://localhost').split(',').map(x => x.trim()).filter(Boolean));
const MAX_BODY = 12_000;
const rate = new Map();

const TYPES = new Set(['commitment', 'routine', 'reminder', 'notice']);
const PRIORITIES = new Set(['high', 'medium', 'low']);

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function send(res, status, payload, origin = '') {
  res.writeHead(status, corsHeaders(origin));
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('Solicitud demasiado grande');
  }
  return raw ? JSON.parse(raw) : {};
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function withinRateLimit(key) {
  const now = Date.now();
  const entry = rate.get(key) || { start: now, count: 0 };
  if (now - entry.start > 60 * 60 * 1000) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count += 1;
  rate.set(key, entry);
  return entry.count <= 120;
}

async function verifyGoogleIdToken(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new Error('Falta la sesión de Google');

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error('Sesión de Google inválida o vencida');
  const info = await response.json();
  if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) throw new Error('El token no pertenece a Agenda');
  return info;
}

function buildPrompt(event) {
  return `Clasifica un elemento de una agenda personal. Responde SOLO JSON válido con estas claves: type, priority, confidence, reason.\n\nTipos permitidos:\n- commitment: reunión, clase, cita, defensa, examen, entrevista, viaje u otro compromiso real con horario.\n- routine: hábito o rutina repetitiva/personal como levantarse, aseo, gimnasio, comida, salir al trabajo, dormir.\n- reminder: recordatorio puntual como comprar, pagar, llamar, revisar, enviar.\n- notice: aviso informativo, especialmente de todo el día, que no exige presencia ni una acción a una hora concreta.\n\nPrioridad: high, medium o low. Confidence entre 0 y 1. reason máximo 12 palabras.\n\nDatos mínimos del evento:\n${JSON.stringify(event)}`;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('La IA no devolvió JSON');
  return JSON.parse(match[0]);
}

function normalizeResult(value, provider) {
  const type = TYPES.has(value?.type) ? value.type : null;
  if (!type) throw new Error('Clasificación inválida');
  const priority = PRIORITIES.has(value?.priority) ? value.priority : 'medium';
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence ?? 0.7)));
  const reason = String(value?.reason || '').slice(0, 120);
  return { type, priority, confidence, reason, provider };
}

async function callGemini(event) {
  if (!GEMINI_API_KEY) throw new Error('Gemini no configurado');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(event) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  return normalizeResult(extractJson(text), 'gemini');
}

async function callOpenAICompatible({ url, apiKey, model, provider, event, extraHeaders = {} }) {
  if (!apiKey) throw new Error(`${provider} no configurado`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'Eres un clasificador de agenda. Devuelve exclusivamente JSON válido.' },
        { role: 'user', content: buildPrompt(event) }
      ]
    })
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return normalizeResult(extractJson(text), provider);
}

async function classify(event) {
  const providers = [
    () => callGemini(event),
    () => callOpenAICompatible({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: GROQ_API_KEY,
      model: GROQ_MODEL,
      provider: 'groq',
      event
    }),
    () => callOpenAICompatible({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      provider: 'openrouter',
      event,
      extraHeaders: {
        'HTTP-Referer': 'https://jeffer91.github.io/Agenda/',
        'X-Title': 'Agenda'
      }
    })
  ];

  const errors = [];
  for (const provider of providers) {
    try { return await provider(); }
    catch (error) { errors.push(error.message); }
  }
  throw new Error(`Ninguna IA disponible: ${errors.join(' | ')}`);
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: 'Origen no autorizado' }, origin);

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, {
      ok: true,
      providers: {
        gemini: Boolean(GEMINI_API_KEY),
        groq: Boolean(GROQ_API_KEY),
        openrouter: Boolean(OPENROUTER_API_KEY)
      }
    }, origin);
  }

  if (req.method === 'POST' && url.pathname === '/classify') {
    try {
      const identity = await verifyGoogleIdToken(req);
      const key = identity.sub || clientIp(req);
      if (!withinRateLimit(key)) return send(res, 429, { error: 'Límite temporal de clasificación alcanzado' }, origin);

      const body = await readJson(req);
      const event = {
        title: String(body?.title || '').slice(0, 240),
        time: String(body?.time || '').slice(0, 20),
        allDay: Boolean(body?.allDay),
        calendar: String(body?.calendar || '').slice(0, 120)
      };
      if (!event.title) return send(res, 400, { error: 'Falta el título' }, origin);

      const result = await classify(event);
      return send(res, 200, result, origin);
    } catch (error) {
      return send(res, 503, { error: error.message || 'No se pudo clasificar' }, origin);
    }
  }

  return send(res, 404, { error: 'No encontrado' }, origin);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agenda AI backend listening on ${PORT}`);
});
