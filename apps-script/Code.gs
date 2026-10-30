/**
 * Coaching Tracker - Google Apps Script backend
 * Standalone script (script.google.com) in your own account; it opens the sheet by SHEET_ID.
 * Deploy as Web App: Execute as "Me", Who has access "Anyone".
 * The app talks to this script; the coaching sheet stays the single source of truth.
 */

const CONFIG = {
  SHEET_ID: '1P9cWJR0G9RlPo3cWk3I6udxeziASxLUTibesH33CV2g',   // the coaching sheet (from its URL)
  TOKEN: 'CHANGE-ME-TO-A-LONG-RANDOM-STRING',   // same value goes into the app settings
  SHEET_TRAINING: 'Training',
  SHEET_WEIGH: 'Dagelijkse weging ',             // note: trailing space in the coach's tab name
  SHEET_MEASURE: 'Lichaam metingen',
  SHEET_CHECKIN: 'Wekelijkse checking',
  SHEET_INFO: 'Info',
  SHEET_APPLOG: 'App log',                       // created by the app for check-in history + meta
  TRAINING_HEADER_ROW: 2,
  TRAINING_FIRST_WEEK_COL: 5,                    // column E = week 1 (Danny's layout: 6)
  TRAINING_COLS: { equipment: 1, notes: 0, name: 2, sets: 3, reps: 4 },   // 1-based; 0 = not present (Danny: equipment 1, notes 2, name 3, sets 4, reps 5)
  TRAINING_MAX_WEEKS: 60,
  WEIGH_FIRST_WEEK_ROW: 6,                       // row 6 = week 1 weights, row 7 = sleep, 5 rows per week
  WEIGH_ROWS_PER_WEEK: 5,
  WEIGH_FIRST_DAY_COL: 2,                        // column B = Monday
  WEIGH_MAX_WEEKS: 70,
  SKIN_FIRST_ROW: 6,                             // skinfold table: M = date, N..T = 7 sites, U = fat%
  SKIN_DATE_COL: 13,
  SKIN_MAX_ROWS: 60,
  MEASURE_LABEL_ROW: 2,                          // "Week 1:", "Week 4:" ... in C, E, G, ...
  MEASURE_ROWS: { chest: 6, waist: 7, armR: 8, armL: 9, legR: 10, legL: 11, sleep: 14, steps: 16 },
  CHECKIN_CELLS: { feel: 'C6', energy: 'C9', stress: 'C12', hunger: 'C15', training: 'C18', note: 'B21' },
};

function doGet(e) { return handle(e.parameter || {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) {}
  return handle(Object.assign({}, e.parameter || {}, body));
}

function handle(p) {
  try {
    if (p.token !== CONFIG.TOKEN) return json({ ok: false, error: 'unauthorized' });
    const action = p.action || 'all';
    const fn = ACTIONS[action];
    if (!fn) return json({ ok: false, error: 'unknown action ' + action });
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try { return json({ ok: true, data: fn(p) }); } finally { lock.releaseLock(); }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
let _ss = null;
const ss = () => _ss || (_ss = SpreadsheetApp.openById(CONFIG.SHEET_ID));
const sh = name => {
  let s = ss().getSheetByName(name);
  if (!s) s = ss().getSheets().find(x => x.getName().trim().toLowerCase() === String(name).trim().toLowerCase());
  if (!s) throw new Error('Tab not found: ' + name + ' (tabs: ' + ss().getSheets().map(x => x.getName()).join(', ') + ')');
  return s;
};
const shOpt = name => { try { return sh(name); } catch (e) { return null; } };

/* ------------------------------------------------------------------ READ ALL */
const ACTIONS = {
  all() { return { meta: readMeta(), program: readProgram(), days: readDays(), skinfolds: readSkinfolds(), measurements: readMeasurements(), checkins: readCheckins() }; },
  saveLog(p) { return writeLog(p); },
  saveDays(p) { return writeDays(p); },
  saveCheckin(p) { return writeCheckin(p); },
  saveMeasurement(p) { return writeMeasurement(p); },
  saveSkinfold(p) { return writeSkinfold(p); },
  saveMeta(p) { return writeMeta(p); },
};

function readMeta() {
  const info = sh(CONFIG.SHEET_INFO).getRange('I4:J12').getValues();
  const meta = { name: '', age: null, sex: '', height: null, startDate: '' };
  info.forEach(([k, v]) => {
    const key = String(k || '').toLowerCase();
    if (key === 'client') meta.name = String(v || '');
    if (key === 'leeftijd') meta.age = Number(v) || null;
    if (key === 'geslacht') meta.sex = String(v || '');
    if (key === 'lengte') meta.height = Number(v) || null;
  });
  const log = appLog();
  const sd = log.getRange('B1').getValue();
  if (sd instanceof Date) meta.startDate = iso(sd); else if (sd) meta.startDate = String(sd);
  return meta;
}
function writeMeta(p) {
  const log = appLog();
  log.getRange('A1').setValue('startDate');
  log.getRange('B1').setValue(p.startDate || '');
  return readMeta();
}

/** Training tab: blocks of consecutive rows with a Sets value; week N lives in column 4+N. */
function readProgram() {
  const s = sh(CONFIG.SHEET_TRAINING);
  const lastRow = Math.min(s.getLastRow(), 200);
  const lastCol = Math.min(s.getLastColumn(), CONFIG.TRAINING_FIRST_WEEK_COL + CONFIG.TRAINING_MAX_WEEKS - 1);
  const vals = s.getRange(1, 1, lastRow, lastCol).getValues();
  const blocks = []; let cur = null; let letter = 0;
  for (let r = CONFIG.TRAINING_HEADER_ROW; r < lastRow; r++) {   // r is 0-based index, row number = r+1
    const C = CONFIG.TRAINING_COLS; const row = vals[r]; const sets = row[C.sets - 1]; const name = row[C.name - 1];
    const hasSets = sets !== '' && sets !== null && !isNaN(Number(sets)) && Number(sets) > 0;
    if (!hasSets) { if (cur) { if (cur.exercises.length) blocks.push(cur); cur = null; } continue; }
    if (!cur) { cur = { id: String.fromCharCode(65 + letter), name: 'Workout ' + String.fromCharCode(65 + letter), exercises: [] }; letter++; }
    if (!name) continue;                                           // template row without an exercise
    const cells = {};
    for (let c = CONFIG.TRAINING_FIRST_WEEK_COL - 1; c < lastCol; c++) { const v = row[c]; if (v !== '' && v !== null) cells[c - CONFIG.TRAINING_FIRST_WEEK_COL + 2] = String(v); }
    const equipment = [C.equipment ? row[C.equipment - 1] : '', C.notes ? row[C.notes - 1] : ''].map(x => String(x || '').trim()).filter(Boolean).join(' · ');
    cur.exercises.push({ id: cur.id + '-r' + (r + 1), row: r + 1, name: String(name).trim(), equipment,
      sets: Number(sets), reps: String(row[C.reps - 1] || '').replace(/reps/i, '').replace(/^x\s*/i, '').trim(), cells });
  }
  if (cur && cur.exercises.length) blocks.push(cur);
  return blocks;
}
/** p.cells = { "<row>": "45kg x 12-12-12 (note)" }, p.week = N */
function writeLog(p) {
  const s = sh(CONFIG.SHEET_TRAINING);
  const col = CONFIG.TRAINING_FIRST_WEEK_COL + Number(p.week) - 1;
  const hdr = s.getRange(CONFIG.TRAINING_HEADER_ROW, col).getValue();
  if (!hdr) s.getRange(CONFIG.TRAINING_HEADER_ROW, col).setValue('Week ' + p.week);
  Object.keys(p.cells || {}).forEach(row => s.getRange(Number(row), col).setValue(p.cells[row]));
  return { written: Object.keys(p.cells || {}).length };
}

/** Weigh tab: week w -> weights row 6+5(w-1), sleep row +1, Monday..Sunday in B..H */
function readDays() {
  const s = sh(CONFIG.SHEET_WEIGH);
  const n = Math.min(CONFIG.WEIGH_MAX_WEEKS, Math.ceil((s.getLastRow() - CONFIG.WEIGH_FIRST_WEEK_ROW + 1) / CONFIG.WEIGH_ROWS_PER_WEEK));
  const out = {};
  if (n <= 0) return out;
  const vals = s.getRange(CONFIG.WEIGH_FIRST_WEEK_ROW, CONFIG.WEIGH_FIRST_DAY_COL, n * CONFIG.WEIGH_ROWS_PER_WEEK, 7).getValues();
  for (let w = 0; w < n; w++) {
    const kgRow = vals[w * CONFIG.WEIGH_ROWS_PER_WEEK], slRow = vals[w * CONFIG.WEIGH_ROWS_PER_WEEK + 1];
    if (!kgRow) break;
    for (let d = 0; d < 7; d++) { const kg = num(kgRow[d]), sleep = num(slRow ? slRow[d] : null); if (kg != null || sleep != null) out[(w + 1) + '_' + d] = { week: w + 1, day: d, kg, sleep }; }
  }
  return out;
}
/** p.days = [{week, day(0-6), kg, sleep}] */
function writeDays(p) {
  const s = sh(CONFIG.SHEET_WEIGH);
  (p.days || []).forEach(d => {
    const r = CONFIG.WEIGH_FIRST_WEEK_ROW + (Number(d.week) - 1) * CONFIG.WEIGH_ROWS_PER_WEEK;
    const c = CONFIG.WEIGH_FIRST_DAY_COL + Number(d.day);
    s.getRange(r, c).setValue(d.kg == null ? '' : Number(d.kg));
    s.getRange(r + 1, c).setValue(d.sleep == null ? '' : Number(d.sleep));
  });
  return { written: (p.days || []).length };
}

/** Skinfold table on the weigh tab: M = date, N..T = chest, axilla, tricep, back, abd, hip, quad, U = fat% */
function readSkinfolds() {
  const s = sh(CONFIG.SHEET_WEIGH); if (s.getLastColumn() < CONFIG.SKIN_DATE_COL) return {};
  const vals = s.getRange(CONFIG.SKIN_FIRST_ROW, CONFIG.SKIN_DATE_COL, CONFIG.SKIN_MAX_ROWS, 9).getValues();
  const keys = ['sChest', 'sAxilla', 'sTricep', 'sBack', 'sAbd', 'sHip', 'sQuad'];
  const out = {};
  vals.forEach((row, i) => {
    const d = row[0]; if (!(d instanceof Date)) return;
    const rec = { date: iso(d), row: CONFIG.SKIN_FIRST_ROW + i };
    keys.forEach((k, j) => rec[k] = num(row[j + 1]));
    const fat = num(row[8]); rec.fat = fat != null ? (fat <= 1 ? Math.round(fat * 1000) / 10 : fat) : null;
    out[rec.date] = rec;
  });
  return out;
}
function writeSkinfold(p) {
  const s = sh(CONFIG.SHEET_WEIGH);
  const existing = readSkinfolds(); let row = existing[p.date] ? existing[p.date].row : null;
  if (!row) { const dates = s.getRange(CONFIG.SKIN_FIRST_ROW, CONFIG.SKIN_DATE_COL, CONFIG.SKIN_MAX_ROWS, 1).getValues(); row = CONFIG.SKIN_FIRST_ROW + dates.findIndex(r => !(r[0] instanceof Date)); if (row < CONFIG.SKIN_FIRST_ROW) throw new Error('Skinfold table full'); }
  const vals = [new Date(p.date + 'T00:00:00'), p.sChest, p.sAxilla, p.sTricep, p.sBack, p.sAbd, p.sHip, p.sQuad].map((v, i) => i === 0 ? v : (v == null ? '' : Number(v)));
  s.getRange(row, CONFIG.SKIN_DATE_COL, 1, 8).setValues([vals]);
  if (p.fat != null) s.getRange(row, CONFIG.SKIN_DATE_COL + 8).setValue(Number(p.fat) / 100);
  return { row };
}

/** Lichaam metingen: labels "Week N:" in row 2 at C, E, G, ...; circumference rows 6-11 */
function readMeasurements() {
  const s = shOpt(CONFIG.SHEET_MEASURE); if (!s) return {};
  const lastCol = s.getLastColumn();
  const labels = s.getRange(CONFIG.MEASURE_LABEL_ROW, 1, 1, lastCol).getValues()[0];
  const block = s.getRange(1, 1, 20, lastCol).getValues();
  const out = {};
  labels.forEach((lab, c) => {
    const m = String(lab || '').match(/(\d+)/); if (!m) return;
    const rec = { week: Number(m[1]), col: c + 1 };
    Object.keys(CONFIG.MEASURE_ROWS).forEach(k => rec[k] = num(block[CONFIG.MEASURE_ROWS[k] - 1][c]));
    const has = ['chest', 'waist', 'armR', 'armL', 'legR', 'legL'].some(k => rec[k] != null && rec[k] !== 0);
    if (has) out['w' + rec.week] = rec;
  });
  return out;
}
/** p = {week, chest, waist, armR, armL, legR, legL, steps} -> writes to the column whose label matches week (or creates next label) */
function writeMeasurement(p) {
  let s = shOpt(CONFIG.SHEET_MEASURE);
  if (!s) { s = ss().insertSheet(CONFIG.SHEET_MEASURE); s.getRange('B2').setValue('Meting:'); s.getRange('B4').setValue('Weekgemiddelde in KG');
    const labels = { chest: 'Borst omtrek', waist: 'Buik omtrek navel hoogte', armR: 'Rechter arm omtrek', armL: 'Linker arm omtrek', legR: 'Rechter been omtrek', legL: 'Linker been omtrek', sleep: 'Gemiddeld uren slaap', steps: 'Gemiddeld aantal stappen per dag' };
    Object.keys(labels).forEach(k => s.getRange(CONFIG.MEASURE_ROWS[k], 2).setValue(labels[k])); }
  const lastCol = Math.max(s.getLastColumn(), 3);
  const labels = s.getRange(CONFIG.MEASURE_LABEL_ROW, 1, 1, lastCol + 2).getValues()[0];
  let col = -1, lastLabelCol = 1;
  labels.forEach((lab, c) => { const m = String(lab || '').match(/(\d+)/); if (!m) return; lastLabelCol = c + 1; if (Number(m[1]) === Number(p.week)) col = c + 1; });
  if (col < 0) { col = lastLabelCol + 2; s.getRange(CONFIG.MEASURE_LABEL_ROW, col).setValue('Week ' + p.week + ':'); }
  ['chest', 'waist', 'armR', 'armL', 'legR', 'legL', 'steps'].forEach(k => { if (p[k] != null && p[k] !== '') s.getRange(CONFIG.MEASURE_ROWS[k], col).setValue(Number(p[k])); });
  return { col };
}

/** Weekly check-in: current answers in the coach's tab, history in the App log tab */
function readCheckins() {
  const log = appLog(); const out = {};
  const last = log.getLastRow(); if (last < 4) return out;
  log.getRange(4, 1, last - 3, 9).getValues().forEach(r => { if (!r[0]) return; out['w' + r[0]] = { week: Number(r[0]), date: r[1] instanceof Date ? iso(r[1]) : String(r[1] || ''), feel: num(r[2]), energy: num(r[3]), stress: num(r[4]), hunger: num(r[5]), training: num(r[6]), note: String(r[7] || '') }; });
  return out;
}
function writeCheckin(p) {
  const s = shOpt(CONFIG.SHEET_CHECKIN);
  if (s) Object.keys(CONFIG.CHECKIN_CELLS).forEach(k => { if (p[k] != null) s.getRange(CONFIG.CHECKIN_CELLS[k]).setValue(p[k]); });
  const log = appLog(); const last = log.getLastRow();
  const rows = last >= 4 ? log.getRange(4, 1, last - 3, 1).getValues() : [];
  let row = -1; rows.forEach((r, i) => { if (Number(r[0]) === Number(p.week)) row = 4 + i; });
  if (row < 0) row = Math.max(4, last + 1);
  log.getRange(row, 1, 1, 8).setValues([[Number(p.week), p.date || iso(new Date()), p.feel, p.energy, p.stress, p.hunger, p.training, p.note || '']]);
  return { row };
}

/* ------------------------------------------------------------------ helpers */
function appLog() {
  let s = ss().getSheetByName(CONFIG.SHEET_APPLOG);
  if (!s) { s = ss().insertSheet(CONFIG.SHEET_APPLOG); s.getRange('A1').setValue('startDate'); s.getRange('A3:H3').setValues([['week', 'date', 'feel', 'energy', 'stress', 'hunger', 'training', 'note']]); }
  return s;
}
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v || null;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return null; const f = parseFloat(m[0]); return isNaN(f) || f === 0 ? null : f;
}
function iso(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Run once from the editor to verify access and see what the app will read. */
function selfTest() { Logger.log(JSON.stringify(ACTIONS.all(), null, 1).slice(0, 3000)); }
