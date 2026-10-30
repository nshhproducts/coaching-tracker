// Mock of the Apps Script API, backed by the seed JSON parsed from the xlsx. For frontend testing only.
const http = require('http'); const fs = require('fs'); const path = require('path');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'seed.json'), 'utf8'));
const TOKEN = 'test';
const program = seed.program.map(w => ({ id: w.id, name: w.name, exercises: w.exercises.map((e, i) => ({ id: w.id + '-r' + (10 + i), row: 10 + i, name: e.name, equipment: e.equipment, sets: e.sets, reps: e.reps, cells: {} })) }));
Object.values(seed.logs).forEach(l => { const w = program.find(x => x.id === l.workout); Object.entries(l.entries).forEach(([eid, e]) => { const idx = +eid.split('-')[1] - 1; w.exercises[idx].cells[l.week] = e.note ?? e.raw; }); });
const days = {}; Object.entries(seed.weights).forEach(([iso, v]) => { const st = new Date('2026-08-24'); const d = Math.round((new Date(iso) - st) / 864e5); days[(Math.floor(d / 7) + 1) + '_' + (d % 7)] = { week: Math.floor(d / 7) + 1, day: d % 7, kg: v.kg, sleep: v.sleep }; });
const state = { meta: { name: 'Nick Shagen', age: 27, sex: 'Man', height: 180, startDate: '' }, program, days, skinfolds: {}, measurements: {}, checkins: {} };
const writes = [];
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
    const send = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (p.token !== TOKEN) return send({ ok: false, error: 'unauthorized' });
    writes.push(p);
    switch (p.action) {
      case 'all': return send({ ok: true, data: state });
      case 'saveLog': Object.entries(p.cells).forEach(([row, text]) => { program.forEach(w => w.exercises.forEach(e => { if (e.row === +row) e.cells[p.week] = text; })); }); return send({ ok: true, data: { written: 1 } });
      case 'saveDays': p.days.forEach(d => state.days[d.week + '_' + d.day] = d); return send({ ok: true, data: {} });
      case 'saveCheckin': state.checkins['w' + p.week] = p; return send({ ok: true, data: {} });
      case 'saveMeasurement': state.measurements['w' + p.week] = p; return send({ ok: true, data: {} });
      case 'saveSkinfold': state.skinfolds[p.date] = p; return send({ ok: true, data: {} });
      case 'saveMeta': state.meta.startDate = p.startDate; return send({ ok: true, data: state.meta });
      case '__writes': return send(writes);
      default: return send({ ok: false, error: 'unknown ' + p.action });
    }
  });
}).listen(8787, () => console.log('mock api on 8787'));
