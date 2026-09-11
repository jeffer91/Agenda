const XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let importRows = [];
let importContext = null;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

async function ensureXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${XLSX_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar el lector de Excel.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = XLSX_SRC;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión.'));
    document.head.append(script);
  });
  if (!window.XLSX) throw new Error('El lector de Excel no está disponible.');
  return window.XLSX;
}

function pick(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const key = entries.find(([name]) => normalize(name) === normalize(alias))?.[0];
    if (key) return row[key];
  }
  return '';
}

function excelDate(value, XLSX) {
  if (value === '' || value === null || value === undefined) return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }

  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    if (date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d) return text;
    return null;
  }

  const latam = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (latam) {
    const [, d, m, y] = latam;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
    if (date.getFullYear() === Number(y) && date.getMonth() + 1 === Number(m) && date.getDate() === Number(d)) return iso;
    return null;
  }

  return null;
}

function taskKey(title, due, list) {
  return `${normalize(title)}|${String(due || '').slice(0, 10)}|${normalize(list)}`;
}

function ensureDialog() {
  let dialog = document.querySelector('#taskExcelDialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'taskExcelDialog';
  dialog.className = 'modal';
  dialog.style.width = 'min(920px, calc(100% - 24px))';
  dialog.innerHTML = `
    <form method="dialog" id="taskExcelForm">
      <h2>Importar pendientes desde Excel</h2>
      <p class="muted" id="taskExcelFileName"></p>
      <div id="taskExcelSummary" class="task-excel-summary"></div>
      <label style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:9px;font-weight:650">
        <input id="taskExcelSkipDuplicates" type="checkbox" checked style="width:18px;height:18px;margin:0">
        Evitar pendientes duplicados
      </label>
      <div style="overflow:auto;max-height:52vh;border:1px solid #dfe4ea;border-radius:10px;margin-top:12px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead style="position:sticky;top:0;background:#f8fafc;z-index:1">
            <tr>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">Fila</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">Pendiente</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">Fecha</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">Lista / Área</th>
              <th style="text-align:left;padding:9px;border-bottom:1px solid #dfe4ea">Estado</th>
            </tr>
          </thead>
          <tbody id="taskExcelPreview"></tbody>
        </table>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn secondary" id="taskExcelCancel">Cancelar</button>
        <button type="button" class="btn" id="taskExcelImport">Importar pendientes</button>
      </div>
    </form>`;
  document.body.append(dialog);

  dialog.querySelector('#taskExcelCancel').onclick = () => dialog.close();
  dialog.querySelector('#taskExcelSkipDuplicates').onchange = renderPreview;
  dialog.querySelector('#taskExcelImport').onclick = importPendingTasks;
  return dialog;
}

function renderPreview() {
  const dialog = ensureDialog();
  const skipDuplicates = dialog.querySelector('#taskExcelSkipDuplicates').checked;
  const valid = importRows.filter(row => !row.error && !row.imported);
  const duplicates = valid.filter(row => row.duplicate);
  const ready = valid.filter(row => !(skipDuplicates && row.duplicate));
  const errors = importRows.filter(row => row.error);
  const imported = importRows.filter(row => row.imported);
  const newLists = [...new Set(
    ready
      .filter(row => row.needsListCreation)
      .map(row => normalize(row.listName))
      .filter(Boolean)
  )];

  dialog.querySelector('#taskExcelSummary').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px">
      <span class="pill">${importRows.length} filas</span>
      <span class="pill status-activo">${ready.length} para importar</span>
      ${newLists.length ? `<span class="pill" style="background:#edf5fb;color:#1769aa">${newLists.length} lista${newLists.length === 1 ? '' : 's'} nueva${newLists.length === 1 ? '' : 's'}</span>` : ''}
      ${imported.length ? `<span class="pill" style="background:#eaf5f4;color:#237a70">${imported.length} importado${imported.length === 1 ? '' : 's'}</span>` : ''}
      ${duplicates.length ? `<span class="pill status-pausado">${duplicates.length} duplicado${duplicates.length === 1 ? '' : 's'}</span>` : ''}
      ${errors.length ? `<span class="pill" style="background:#fff0ef;color:#b42318">${errors.length} con error</span>` : ''}
    </div>`;

  dialog.querySelector('#taskExcelPreview').innerHTML = importRows.map(row => {
    let state = '<span style="color:#2f7d4a;font-weight:700">Válido</span>';
    if (row.imported) state = '<span style="color:#237a70;font-weight:700">Importado</span>';
    else if (row.error) state = `<span style="color:#b42318;font-weight:700">${esc(row.error)}</span>`;
    else if (row.duplicate) state = `<span style="color:#a96708;font-weight:700">${skipDuplicates ? 'Duplicado · se omitirá' : 'Duplicado'}</span>`;
    else if (row.needsListCreation) state = `<span style="color:#1769aa;font-weight:700">Nueva lista · se creará “${esc(row.listName)}”</span>`;

    return `<tr>
      <td style="padding:9px;border-bottom:1px solid #edf0f3">${row.row}</td>
      <td style="padding:9px;border-bottom:1px solid #edf0f3;font-weight:650">${esc(row.title || '—')}</td>
      <td style="padding:9px;border-bottom:1px solid #edf0f3">${esc(row.due || 'Sin fecha')}</td>
      <td style="padding:9px;border-bottom:1px solid #edf0f3">${esc(row.listName || 'Predeterminada')}</td>
      <td style="padding:9px;border-bottom:1px solid #edf0f3">${state}</td>
    </tr>`;
  }).join('');

  const button = dialog.querySelector('#taskExcelImport');
  button.disabled = ready.length === 0;
  button.textContent = ready.length ? `Importar ${ready.length} pendiente${ready.length === 1 ? '' : 's'}` : 'Nada para importar';
}

async function chooseExcel() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.style.display = 'none';
    document.body.append(input);
    input.onchange = () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    input.click();
  });
}

export async function downloadTaskMatrix() {
  const XLSX = await ensureXLSX();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Pendiente', 'Fecha límite', 'Lista / Área de Google Tasks', 'Notas']
  ]);
  sheet['!cols'] = [{ wch: 42 }, { wch: 16 }, { wch: 31 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Pendientes');

  const instructions = XLSX.utils.aoa_to_sheet([
    ['Matriz de pendientes · Agenda'],
    ['Campo', 'Uso'],
    ['Pendiente', 'Obligatorio. Nombre del pendiente.'],
    ['Fecha límite', 'Opcional. Formato recomendado: AAAA-MM-DD.'],
    ['Lista / Área de Google Tasks', 'Opcional. Ejemplos: UGPA, UTET, Personal o Doctorado.'],
    ['Lista existente', 'Si la lista ya existe en Google Tasks, Agenda la utiliza.'],
    ['Lista nueva', 'Si la lista no existe, Agenda la crea automáticamente antes de importar los pendientes.'],
    ['Lista vacía', 'Si esta columna queda vacía, se utiliza la lista predeterminada de Google Tasks.'],
    ['Notas', 'Opcional. Se guarda como nota de Google Tasks.'],
    ['Duplicados', 'Agenda puede omitir automáticamente pendientes duplicados durante la importación.'],
    [],
    ['Importante', 'No cambies los nombres de las columnas de la hoja Pendientes.']
  ]);
  instructions['!cols'] = [{ wch: 32 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instrucciones');
  XLSX.writeFile(workbook, 'Matriz_Pendientes_Agenda.xlsx');
}

export async function openTaskExcelImport(context) {
  importContext = context;
  if (!context?.gf || !context?.syncGoogle || !context?.render || !context?.toast) throw new Error('La integración de pendientes no está disponible.');

  const file = await chooseExcel();
  if (!file) return;

  const XLSX = await ensureXLSX();
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('El Excel no contiene una hoja válida.');

  const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  if (!sourceRows.length) throw new Error('La matriz está vacía.');

  const listsResponse = await context.gf('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
  const lists = listsResponse.items || [];
  if (!lists.length) throw new Error('No encontré listas de Google Tasks.');

  const listByName = new Map(lists.map(list => [normalize(list.title), list]));
  const defaultList = lists[0];
  const existing = new Set((context.tasks || []).map(task => taskKey(task.title, task.due, task.list)));

  importRows = sourceRows.map((source, index) => {
    const title = String(pick(source, ['Pendiente', 'Tarea', 'Título', 'Titulo']) || '').trim();
    const dueRaw = pick(source, ['Fecha límite', 'Fecha limite', 'Fecha', 'Vencimiento']);
    const due = excelDate(dueRaw, XLSX);
    const requestedList = String(pick(source, [
      'Lista / Área de Google Tasks',
      'Lista / Area de Google Tasks',
      'Lista de Google Tasks',
      'Lista / Área',
      'Lista / Area',
      'Lista',
      'Google Tasks'
    ]) || '').trim();
    const notes = String(pick(source, ['Notas', 'Nota', 'Descripción', 'Descripcion']) || '').trim();
    const existingList = requestedList ? listByName.get(normalize(requestedList)) : defaultList;
    const needsListCreation = Boolean(requestedList && !existingList);
    const listName = existingList?.title || requestedList || defaultList.title;

    let error = '';
    if (!title) error = 'Falta el pendiente';
    else if (due === null) error = 'Fecha inválida';

    return {
      row: index + 2,
      title,
      due: due || '',
      notes,
      listId: existingList?.id || '',
      listName,
      requestedList,
      needsListCreation,
      error,
      imported: false,
      duplicate: !error && !needsListCreation && existing.has(taskKey(title, due, listName))
    };
  });

  const dialog = ensureDialog();
  dialog.querySelector('#taskExcelFileName').textContent = `Archivo: ${file.name}`;
  dialog.querySelector('#taskExcelSkipDuplicates').checked = true;
  renderPreview();
  dialog.showModal();
}

async function prepareMissingLists(rows, context, button) {
  const listsResponse = await context.gf('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
  const currentLists = listsResponse.items || [];
  const listByName = new Map(currentLists.map(list => [normalize(list.title), list]));

  const requiredNames = [...new Set(
    rows
      .filter(row => row.needsListCreation && row.listName)
      .map(row => row.listName.trim())
      .filter(Boolean)
  )];

  for (let i = 0; i < requiredNames.length; i += 1) {
    const name = requiredNames[i];
    const key = normalize(name);
    button.textContent = `Preparando lista ${i + 1} de ${requiredNames.length}…`;

    let list = listByName.get(key);
    if (!list) {
      try {
        list = await context.gf('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
          method: 'POST',
          body: JSON.stringify({ title: name })
        });
        listByName.set(key, list);
      } catch (error) {
        rows
          .filter(row => normalize(row.listName) === key)
          .forEach(row => {
            row.error = `No se pudo crear la lista “${name}”: ${error.message || 'error de Google Tasks'}`;
          });
        continue;
      }
    }

    rows
      .filter(row => normalize(row.listName) === key && !row.error)
      .forEach(row => {
        row.listId = list.id;
        row.listName = list.title || name;
        row.needsListCreation = false;
      });
  }
}

async function importPendingTasks() {
  const context = importContext;
  const dialog = ensureDialog();
  const button = dialog.querySelector('#taskExcelImport');
  const skipDuplicates = dialog.querySelector('#taskExcelSkipDuplicates').checked;
  const selectedRows = importRows.filter(row => !row.error && !row.imported && !(skipDuplicates && row.duplicate));
  if (!selectedRows.length || !context) return;

  button.disabled = true;
  let completed = 0;
  let failed = 0;

  try {
    await prepareMissingLists(selectedRows, context, button);

    const rows = selectedRows.filter(row => !row.error && row.listId);
    const listFailures = selectedRows.filter(row => row.error).length;
    failed += listFailures;

    if (!rows.length) {
      renderPreview();
      context.toast('No se pudo preparar ninguna lista para importar');
      return;
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        button.textContent = `Importando ${completed + failed + 1} de ${selectedRows.length}…`;
        const body = { title: row.title };
        if (row.due) body.due = `${row.due}T00:00:00.000Z`;
        if (row.notes) body.notes = row.notes;

        try {
          await context.gf(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(row.listId)}/tasks`, {
            method: 'POST',
            body: JSON.stringify(body)
          });
          row.imported = true;
          completed += 1;
        } catch (error) {
          failed += 1;
          row.error = error.message || 'No se pudo importar';
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(3, rows.length) }, worker));
    await context.syncGoogle();
    context.render();

    if (failed) {
      context.toast(`${completed} importados · ${failed} con error`);
      renderPreview();
      return;
    }

    dialog.close();
    context.toast(`${completed} pendiente${completed === 1 ? '' : 's'} importado${completed === 1 ? '' : 's'}`);
  } catch (error) {
    context.toast(error.message || 'No se pudo completar la importación');
    renderPreview();
  } finally {
    const remaining = importRows.filter(row => !row.error && !row.imported && !(skipDuplicates && row.duplicate));
    button.disabled = remaining.length === 0;
    button.textContent = remaining.length ? `Importar ${remaining.length} pendiente${remaining.length === 1 ? '' : 's'}` : 'Nada para importar';
  }
}
