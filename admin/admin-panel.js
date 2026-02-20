(function () {
  const ACTION_LOGS_STORAGE_KEY = 'adminActionLogs_v1';
  const ACTION_LOG_SEQ_STORAGE_KEY = 'adminActionLogSeq_v1';
  const DATA_SCHEMA_VERSION = '1.1.0';
  const IMPORT_HELP_TEXT = 'Upload a JSON or CSV file, preview impact, then apply.';

  const state = {
    config: null,
    persons: [],
    families: [],
    contacts: [],
    places: {},
    photos: {},
    relations: new Map(),
    selectedPersonId: '',
    spouseDraft: new Set(),
    pendingPhotoFile: null,
    pendingPhotoUrl: '',
    pendingPhotoMeta: null,
    loaded: false,
    dirty: false,
    importDraft: null,
    lastValidation: [],
    actionLogs: [],
    logSeq: 0
  };

  const els = {};
  const IS_ADM_PAGE = /\/(?:adm|admin)(?:\/|$)/.test(window.location.pathname.replace(/\\/g, '/').toLowerCase());
  const BASE_PREFIX = IS_ADM_PAGE ? '../' : '';

  function qs(id) {
    return document.getElementById(id);
  }

  function withBase(path) {
    const raw = String(path || '').trim();
    if (!raw) return raw;
    if (/^(?:[a-z]+:|\/\/|\/)/i.test(raw)) return raw;
    return BASE_PREFIX + raw.replace(/^\.?\//, '');
  }

  function normalizeId(value) {
    return String(value || '').trim().toUpperCase();
  }

  function normalizeDeceased(value) {
    if (value === true || value === false) return value;
    const text = String(value || '').trim().toLowerCase();
    return text === 'true' || text === '1' || text === 'yes' || text === 'y';
  }

  function normalizeBirthDateType(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === 'approximate' ? 'approximate' : 'exact';
  }

  function birthDateTypeForSave(birthDate, birthDateType) {
    const hasBirthDate = !!String(birthDate || '').trim();
    if (!hasBirthDate) return '';
    return normalizeBirthDateType(birthDateType);
  }

  function sanitizeJyotisha(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      gothra: String(src.gothra || '').trim(),
      nakshatra: String(src.nakshatra || '').trim(),
      rashi: String(src.rashi || '').trim()
    };
  }

  function sanitizeDivorces(raw) {
    if (!Array.isArray(raw)) return [];
    const map = new Map();
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const spouseId = normalizeId(item.spouse_id);
      if (!spouseId) continue;
      const divorceDate = String(item.divorce_date || '').trim();
      map.set(spouseId, { spouse_id: spouseId, divorce_date: divorceDate });
    }
    return [...map.values()].sort((a, b) => a.spouse_id.localeCompare(b.spouse_id));
  }

  function inheritedGothraFromFather(fatherId) {
    const fid = normalizeId(fatherId);
    if (!fid) return '';
    const father = getPerson(fid);
    if (!father) return '';
    const fatherJyotisha = sanitizeJyotisha(father.jyotisha || {});
    return fatherJyotisha.gothra || '';
  }

  function gothraFromSpouse(spouseId) {
    const sid = normalizeId(spouseId);
    if (!sid) return '';
    const spouse = getPerson(sid);
    if (!spouse) return '';
    const spouseJyotisha = sanitizeJyotisha(spouse.jyotisha || {});
    return spouseJyotisha.gothra || '';
  }

  function upsertDivorceRecordForPerson(person, spouseId, divorceDate) {
    if (!person) return;
    const sid = normalizeId(spouseId);
    if (!sid) return;
    const entries = sanitizeDivorces(person.divorces || []);
    const filtered = entries.filter(x => x.spouse_id !== sid);
    filtered.push({ spouse_id: sid, divorce_date: String(divorceDate || '').trim() });
    person.divorces = sanitizeDivorces(filtered);
  }

  function removeDivorceRecordForPerson(person, spouseId) {
    if (!person) return;
    const sid = normalizeId(spouseId);
    if (!sid) return;
    const entries = sanitizeDivorces(person.divorces || []).filter(x => x.spouse_id !== sid);
    person.divorces = entries;
  }

  function sanitizeCustomObject(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const entries = Object.entries(raw);
    for (const [kRaw, vRaw] of entries) {
      const key = String(kRaw || '').trim();
      if (!key) continue;
      const val = String(vRaw == null ? '' : vRaw).trim();
      if (!val) continue;
      out[key] = val;
    }
    return out;
  }

  function isArchivedPerson(person) {
    if (!person) return false;
    const v = person.archived;
    if (v === true) return true;
    const t = String(v || '').trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes' || t === 'y';
  }

  function parseFlexibleDate(dateStr) {
    const raw = String(dateStr || '').trim();
    if (!raw) return null;
    const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
    if (!m) return null;

    const day = parseInt(m[1], 10);
    const mon = m[2].toUpperCase();
    let year = parseInt(m[3], 10);
    const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    if (months[mon] == null || Number.isNaN(day) || Number.isNaN(year)) return null;

    if (year < 100) {
      const currentYear = new Date().getFullYear() % 100;
      const pivot = currentYear + 10;
      year = year > pivot ? 1900 + year : 2000 + year;
    }

    const dt = new Date(year, months[mon], day);
    if (Number.isNaN(dt.getTime())) return null;
    if (dt.getFullYear() !== year || dt.getMonth() !== months[mon] || dt.getDate() !== day) return null;
    return dt;
  }

  function isValidPersonIdFormat(id) {
    return /^I\d+$/i.test(String(id || '').trim());
  }

  function validatePersonInputForSave(payload) {
    const out = [];
    const id = normalizeId(payload.personId);
    const birthRaw = String(payload.birthDate || '').trim();
    const deathRaw = String(payload.deathDate || '').trim();
    const isDeceased = !!payload.isDeceased;
    const birthDt = birthRaw ? parseFlexibleDate(birthRaw) : null;
    const deathDt = deathRaw ? parseFlexibleDate(deathRaw) : null;

    if (!isValidPersonIdFormat(id)) {
      out.push('Person ID format should be like I0001.');
    }
    if (birthRaw && !birthDt) {
      out.push(`Invalid birth date format: "${birthRaw}" (expected dd-MMM-yyyy or dd-MMM-yy).`);
    }
    if (deathRaw && !deathDt) {
      out.push(`Invalid death date format: "${deathRaw}" (expected dd-MMM-yyyy or dd-MMM-yy).`);
    }
    if (isDeceased && deathRaw && !deathDt) {
      out.push('Deceased person has invalid death date format.');
    }
    if (birthDt && deathDt && deathDt < birthDt) {
      out.push('Death date cannot be earlier than birth date.');
    }

    return out;
  }

  function parseImportJson(rawText) {
    const text = String(rawText || '').trim();
    if (!text) throw new Error('Import file is empty.');
    return JSON.parse(text);
  }

  function normalizeCsvHeader(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  function parseCsvRows(rawText) {
    const text = String(rawText == null ? '' : rawText);
    if (!text.trim()) throw new Error('Import file is empty.');

    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === ',') {
        row.push(cell);
        cell = '';
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
        if (ch === '\r' && next === '\n') i += 1;
        continue;
      }
      cell += ch;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  function parseCsvTable(rawText) {
    const rows = parseCsvRows(rawText);
    if (!rows.length) throw new Error('CSV has no rows.');

    const firstRow = rows[0].map((x, idx) => idx === 0 ? String(x || '').replace(/^\uFEFF/, '') : String(x || ''));
    const headers = firstRow.map(normalizeCsvHeader);
    if (!headers.some(Boolean)) throw new Error('CSV header row is empty.');

    const objects = [];
    for (let i = 1; i < rows.length; i += 1) {
      const cols = rows[i] || [];
      const obj = {};
      let hasValue = false;
      for (let c = 0; c < headers.length; c += 1) {
        const key = headers[c];
        if (!key) continue;
        const val = String(cols[c] == null ? '' : cols[c]).trim();
        if (val) hasValue = true;
        obj[key] = val;
      }
      if (hasValue) objects.push(obj);
    }

    return { headers, rows: objects };
  }

  function pickCsvValue(row, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        return String(row[key] == null ? '' : row[key]).trim();
      }
    }
    return '';
  }

  function parseCsvJsonObjectCell(value, label, rowNo) {
    const raw = String(value || '').trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON object`);
      }
      return parsed;
    } catch (err) {
      throw new Error(`Invalid ${label} in CSV row ${rowNo}: ${err.message}`);
    }
  }

  function parseCsvIdArrayCell(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    let items = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
      else items = raw.split(/[|;]/);
    } catch (_) {
      items = raw.split(/[|;]/);
    }
    return items.map(x => normalizeId(x)).filter(Boolean);
  }

  function detectImportTypeFromCsvHeaders(headers) {
    const set = new Set((headers || []).map(normalizeCsvHeader));
    const has = (h) => set.has(normalizeCsvHeader(h));
    const hasAny = (list) => list.some(has);

    if (has('person_id') && hasAny(['given_name', 'surname', 'sex', 'birth_date', 'deceased', 'death_date', 'custom_json', 'jyotisha_json', 'divorces_json', 'active_spouse_id'])) {
      return 'persons';
    }
    if (has('family_id') && hasAny(['husband_id', 'wife_id', 'children', 'children_json'])) {
      return 'families';
    }
    if (has('person_id') && hasAny(['phone', 'email', 'note'])) {
      return 'contacts';
    }
    if (has('person_id') && hasAny(['photo_path', 'path', 'photo', 'file', 'photo_file'])) {
      return 'photos';
    }

    return 'unknown';
  }

  function payloadFromCsvRows(rows, detectedType) {
    if (detectedType === 'persons') {
      return rows.map((row, idx) => {
        const rowNo = idx + 2;
        const divorcesRaw = pickCsvValue(row, ['divorces_json', 'divorces']);
        let divorces = [];
        if (divorcesRaw) {
          try {
            const parsed = JSON.parse(divorcesRaw);
            if (!Array.isArray(parsed)) throw new Error('divorces_json must be an array');
            divorces = sanitizeDivorces(parsed);
          } catch (err) {
            throw new Error(`Invalid divorces_json in CSV row ${rowNo}: ${err.message}`);
          }
        }

        return {
          person_id: normalizeId(pickCsvValue(row, ['person_id', 'id'])),
          given_name: pickCsvValue(row, ['given_name', 'first_name', 'firstname']),
          surname: pickCsvValue(row, ['surname', 'last_name', 'family_name']),
          sex: pickCsvValue(row, ['sex', 'gender']),
          birth_date: pickCsvValue(row, ['birth_date']),
          birth_date_type: pickCsvValue(row, ['birth_date_type']),
          deceased: normalizeDeceased(pickCsvValue(row, ['deceased'])),
          death_date: pickCsvValue(row, ['death_date']),
          archived: normalizeDeceased(pickCsvValue(row, ['archived'])),
          archived_at: pickCsvValue(row, ['archived_at']),
          birth_place_id: normalizeId(pickCsvValue(row, ['birth_place_id'])),
          birth_place_name: pickCsvValue(row, ['birth_place_name']),
          active_spouse_id: normalizeId(pickCsvValue(row, ['active_spouse_id'])),
          divorces,
          jyotisha: sanitizeJyotisha(parseCsvJsonObjectCell(pickCsvValue(row, ['jyotisha_json', 'jyotisha']), 'jyotisha_json', rowNo)),
          custom: sanitizeCustomObject(parseCsvJsonObjectCell(pickCsvValue(row, ['custom_json', 'custom']), 'custom_json', rowNo))
        };
      });
    }

    if (detectedType === 'families') {
      return rows.map(row => ({
        family_id: normalizeId(pickCsvValue(row, ['family_id', 'id'])),
        husband_id: normalizeId(pickCsvValue(row, ['husband_id'])),
        wife_id: normalizeId(pickCsvValue(row, ['wife_id'])),
        children: parseCsvIdArrayCell(pickCsvValue(row, ['children_json', 'children']))
      }));
    }

    if (detectedType === 'contacts') {
      return rows.map(row => ({
        person_id: normalizeId(pickCsvValue(row, ['person_id', 'id'])),
        phone: pickCsvValue(row, ['phone']),
        email: pickCsvValue(row, ['email']),
        note: pickCsvValue(row, ['note'])
      }));
    }

    if (detectedType === 'photos') {
      const out = {};
      for (const row of rows) {
        const id = normalizeId(pickCsvValue(row, ['person_id', 'id']));
        const path = pickCsvValue(row, ['photo_path', 'path', 'photo', 'file', 'photo_file']);
        if (!id || !path) continue;
        out[id] = path;
      }
      return out;
    }

    return null;
  }

  function parseImportFile(file, rawText) {
    const filename = String(file?.name || '').toLowerCase();
    const mime = String(file?.type || '').toLowerCase();
    const csvByName = filename.endsWith('.csv');
    const csvByMime = mime.includes('csv');

    if (csvByName || csvByMime) {
      const table = parseCsvTable(rawText);
      const detectedType = detectImportTypeFromCsvHeaders(table.headers);
      return {
        parsed: payloadFromCsvRows(table.rows, detectedType),
        detectedType,
        format: 'csv'
      };
    }

    const parsed = parseImportJson(rawText);
    return { parsed, detectedType: detectImportType(parsed), format: 'json' };
  }

  function detectImportType(payload) {
    if (Array.isArray(payload)) {
      if (!payload.length) return 'unknown';
      const isPersons = payload.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'person_id' in x && ('given_name' in x || 'surname' in x || 'sex' in x || 'birth_date' in x || 'custom' in x));
      if (isPersons) return 'persons';
      const isFamilies = payload.every(x => x && typeof x === 'object' && !Array.isArray(x) && ('family_id' in x || 'children' in x || 'husband_id' in x || 'wife_id' in x));
      if (isFamilies) return 'families';
      const isContacts = payload.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'person_id' in x && ('phone' in x || 'email' in x || 'note' in x));
      if (isContacts) return 'contacts';
      return 'unknown';
    }

    if (payload && typeof payload === 'object') {
      const keys = Object.keys(payload);
      if (!keys.length) return 'unknown';
      if ('schema_version' in payload) return 'schema';
      const looksLikePhotos = keys.every(k => isValidPersonIdFormat(k)) && keys.every(k => typeof payload[k] === 'string');
      if (looksLikePhotos) return 'photos';
    }
    return 'unknown';
  }

  function previewImport(payload, type, mode) {
    const safeMode = ['merge', 'replace', 'skip'].includes(mode) ? mode : 'merge';
    const lines = [`Type: ${type}`, `Mode: ${safeMode}`];

    const makeResult = (stats) => ({ type, mode: safeMode, stats, text: `${lines.join('\n')}\n${Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join('\n')}` });

    if (type === 'persons') {
      const existing = new Map(state.persons.map(p => [normalizeId(p.person_id), p]));
      let add = 0, upd = 0, skip = 0, invalid = 0;
      for (const row of payload) {
        const id = normalizeId(row.person_id);
        if (!id) { invalid += 1; continue; }
        if (!existing.has(id)) add += 1;
        else if (safeMode === 'skip') skip += 1;
        else upd += 1;
      }
      return makeResult({ incoming: payload.length, add, update: upd, skip, invalid });
    }
    if (type === 'families') {
      const existing = new Map(state.families.map(f => [normalizeId(f.family_id), f]));
      let add = 0, upd = 0, skip = 0, invalid = 0;
      for (const row of payload) {
        const fid = normalizeId(row.family_id);
        if (!fid) { invalid += 1; continue; }
        if (!existing.has(fid)) add += 1;
        else if (safeMode === 'skip') skip += 1;
        else upd += 1;
      }
      return makeResult({ incoming: payload.length, add, update: upd, skip, invalid });
    }
    if (type === 'contacts') {
      const existing = new Map(state.contacts.map(c => [normalizeId(c.person_id), c]));
      let add = 0, upd = 0, skip = 0, invalid = 0;
      for (const row of payload) {
        const id = normalizeId(row.person_id);
        if (!id) { invalid += 1; continue; }
        if (!existing.has(id)) add += 1;
        else if (safeMode === 'skip') skip += 1;
        else upd += 1;
      }
      return makeResult({ incoming: payload.length, add, update: upd, skip, invalid });
    }
    if (type === 'photos') {
      const entries = Object.entries(payload);
      let add = 0, upd = 0, skip = 0, invalid = 0;
      for (const [k, v] of entries) {
        const id = normalizeId(k);
        if (!id || typeof v !== 'string') { invalid += 1; continue; }
        if (!(id in state.photos)) add += 1;
        else if (safeMode === 'skip') skip += 1;
        else upd += 1;
      }
      return makeResult({ incoming: entries.length, add, update: upd, skip, invalid });
    }
    return makeResult({ incoming: 0, add: 0, update: 0, skip: 0, invalid: 0 });
  }

  function applyImport(payload, type, mode) {
    const safeMode = ['merge', 'replace', 'skip'].includes(mode) ? mode : 'merge';
    const stats = { add: 0, update: 0, skip: 0, invalid: 0 };

    if (type === 'persons') {
      const map = new Map(state.persons.map(p => [normalizeId(p.person_id), p]));
      for (const rowRaw of payload) {
        const row = rowRaw && typeof rowRaw === 'object' ? rowRaw : null;
        const id = normalizeId(row?.person_id);
        if (!id || !row) { stats.invalid += 1; continue; }
        const existing = map.get(id);
        const incoming = { ...row, person_id: id };
        if (!existing) {
          state.persons.push(incoming);
          ensureRelation(id);
          map.set(id, incoming);
          stats.add += 1;
        } else if (safeMode === 'skip') {
          stats.skip += 1;
        } else if (safeMode === 'replace') {
          Object.keys(existing).forEach(k => { delete existing[k]; });
          Object.assign(existing, incoming);
          ensureRelation(id);
          stats.update += 1;
        } else {
          Object.assign(existing, incoming);
          ensureRelation(id);
          stats.update += 1;
        }
      }
      buildRelationsFromFamilies();
      return stats;
    }

    if (type === 'families') {
      const map = new Map(state.families.map(f => [normalizeId(f.family_id), f]));
      for (const rowRaw of payload) {
        const row = rowRaw && typeof rowRaw === 'object' ? rowRaw : null;
        const id = normalizeId(row?.family_id);
        if (!id || !row) { stats.invalid += 1; continue; }
        const existing = map.get(id);
        const incoming = { ...row, family_id: id };
        if (!existing) {
          state.families.push(incoming);
          map.set(id, incoming);
          stats.add += 1;
        } else if (safeMode === 'skip') {
          stats.skip += 1;
        } else if (safeMode === 'replace') {
          Object.keys(existing).forEach(k => { delete existing[k]; });
          Object.assign(existing, incoming);
          stats.update += 1;
        } else {
          Object.assign(existing, incoming);
          stats.update += 1;
        }
      }
      buildRelationsFromFamilies();
      return stats;
    }

    if (type === 'contacts') {
      const map = new Map(state.contacts.map(c => [normalizeId(c.person_id), c]));
      for (const rowRaw of payload) {
        const row = rowRaw && typeof rowRaw === 'object' ? rowRaw : null;
        const id = normalizeId(row?.person_id);
        if (!id || !row) { stats.invalid += 1; continue; }
        const incoming = { ...row, person_id: id };
        const existing = map.get(id);
        if (!existing) {
          state.contacts.push(incoming);
          map.set(id, incoming);
          stats.add += 1;
        } else if (safeMode === 'skip') {
          stats.skip += 1;
        } else if (safeMode === 'replace') {
          Object.keys(existing).forEach(k => { delete existing[k]; });
          Object.assign(existing, incoming);
          stats.update += 1;
        } else {
          Object.assign(existing, incoming);
          stats.update += 1;
        }
      }
      return stats;
    }

    if (type === 'photos') {
      for (const [rawId, rawPath] of Object.entries(payload || {})) {
        const id = normalizeId(rawId);
        const path = String(rawPath || '').trim();
        if (!id || !path) { stats.invalid += 1; continue; }
        if (!(id in state.photos)) {
          state.photos[id] = path;
          stats.add += 1;
        } else if (safeMode === 'skip') {
          stats.skip += 1;
        } else {
          state.photos[id] = path;
          stats.update += 1;
        }
      }
      return stats;
    }

    return stats;
  }

  function resetImportUi() {
    state.importDraft = null;
    if (qs('admin-import-file')) qs('admin-import-file').value = '';
    if (qs('admin-import-target')) qs('admin-import-target').value = '';
    if (qs('admin-import-summary')) qs('admin-import-summary').textContent = IMPORT_HELP_TEXT;
    if (qs('admin-import-preview-box')) qs('admin-import-preview-box').textContent = '';
  }

  function toggleDeathDateField(isDeceased) {
    const wrap = qs('admin-death-date-wrap');
    const deathDateInput = qs('admin-death-date');
    if (!wrap) return;
    wrap.style.display = isDeceased ? '' : 'none';
    if (!isDeceased && deathDateInput) {
      deathDateInput.value = '';
    }
  }

  function ensureRelation(personId) {
    const id = normalizeId(personId);
    if (!id) return null;
    if (!state.relations.has(id)) {
      state.relations.set(id, { fid: '', mid: '', spouses: new Set() });
    }
    return state.relations.get(id);
  }

  function getPerson(personId) {
    const id = normalizeId(personId);
    return state.persons.find(p => p.person_id === id) || null;
  }

  function getContact(personId) {
    const id = normalizeId(personId);
    return state.contacts.find(c => c.person_id === id) || null;
  }

  function personLabel(personId) {
    const p = getPerson(personId);
    if (!p) return personId;
    const name = `${String(p.given_name || '').trim()} ${String(p.surname || '').trim()}`.trim();
    const base = name ? `${name} (${p.person_id})` : p.person_id;
    return isArchivedPerson(p) ? `${base} [ARCHIVED]` : base;
  }

  function shortPersonRef(personId) {
    const id = normalizeId(personId);
    if (!id) return '';
    const p = getPerson(id);
    if (!p) return `${id} (${id})`;
    const given = String(p.given_name || '').trim();
    const surname = String(p.surname || '').trim();
    const first = (given || surname || id).split(/\s+/).filter(Boolean)[0] || id;
    return `${first} (${id})`;
  }

  function sortedPersons() {
    return [...state.persons].sort((a, b) => {
      const archA = isArchivedPerson(a) ? 1 : 0;
      const archB = isArchivedPerson(b) ? 1 : 0;
      if (archA !== archB) return archA - archB;
      const nameA = `${a.given_name || ''} ${a.surname || ''}`.trim().toLowerCase();
      const nameB = `${b.given_name || ''} ${b.surname || ''}`.trim().toLowerCase();
      if (nameA === nameB) return a.person_id.localeCompare(b.person_id);
      return nameA.localeCompare(nameB);
    });
  }

  function getChildrenOf(personId) {
    const id = normalizeId(personId);
    const out = [];
    for (const [childId, rel] of state.relations.entries()) {
      if (rel.fid === id || rel.mid === id) out.push(childId);
    }
    return out.sort();
  }

  function markDirty(flag) {
    state.dirty = !!flag;
    if (els.dirtyTag) {
      els.dirtyTag.style.display = state.dirty ? 'inline-block' : 'none';
    }
  }

  async function loadData() {
    const config = await (await fetch(withBase('config.json'))).json();
    state.config = config;

    const [personsRes, familiesRes, contactsRes, placesRes, photosRes] = await Promise.all([
      fetch(withBase(config.data_files.persons)),
      fetch(withBase(config.data_files.families)),
      fetch(withBase(config.data_files.contacts)),
      fetch(withBase(config.data_files.places)),
      fetch(withBase(config.data_files.photos))
    ]);

    state.persons = await personsRes.json();
    state.families = await familiesRes.json();
    state.contacts = await contactsRes.json();
    state.places = await placesRes.json();
    state.photos = await photosRes.json();

    buildRelationsFromFamilies();
    state.loaded = true;
  }

  function buildRelationsFromFamilies() {
    state.relations.clear();

    for (const p of state.persons) {
      ensureRelation(p.person_id);
    }

    for (const fam of state.families) {
      const hid = normalizeId(fam.husband_id);
      const wid = normalizeId(fam.wife_id);

      if (hid && wid) {
        ensureRelation(hid).spouses.add(wid);
        ensureRelation(wid).spouses.add(hid);
      }

      const children = Array.isArray(fam.children) ? fam.children : [];
      for (const childRaw of children) {
        const childId = normalizeId(childRaw);
        if (!childId) continue;
        const rel = ensureRelation(childId);
        if (hid) rel.fid = hid;
        if (wid) rel.mid = wid;
      }
    }
  }

  function getSelectedPerson() {
    return getPerson(state.selectedPersonId);
  }

  function fillPersonList() {
    if (!els.personPickerList) return;
    els.personPickerList.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const p of sortedPersons()) {
      const opt = document.createElement('option');
      opt.value = p.person_id;
      opt.label = personLabel(p.person_id);
      frag.appendChild(opt);
    }
    els.personPickerList.appendChild(frag);
  }

  function setStatus(text, isError) {
    if (!els.statusLine) return;
    els.statusLine.textContent = text || '';
    els.statusLine.style.color = isError ? '#b91c1c' : '#4b5563';
  }

  function confirmDiscardToast(message) {
    return new Promise((resolve) => {
      const existing = qs('admin-confirm-toast');
      if (existing) existing.remove();

      const wrap = document.createElement('div');
      wrap.id = 'admin-confirm-toast';
      wrap.style.position = 'fixed';
      wrap.style.left = '50%';
      wrap.style.bottom = '28px';
      wrap.style.transform = 'translateX(-50%)';
      wrap.style.background = '#111827';
      wrap.style.color = '#fff';
      wrap.style.padding = '12px 14px';
      wrap.style.borderRadius = '12px';
      wrap.style.boxShadow = '0 10px 24px rgba(0,0,0,0.28)';
      wrap.style.zIndex = '8200';
      wrap.style.minWidth = '280px';
      wrap.style.maxWidth = '92vw';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '10px';

      const text = document.createElement('div');
      text.textContent = message || 'Are you sure?';
      text.style.fontSize = '13px';
      text.style.lineHeight = '1.35';

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.gap = '8px';

      const noBtn = document.createElement('button');
      noBtn.type = 'button';
      noBtn.textContent = 'No';
      noBtn.style.border = '1px solid #4b5563';
      noBtn.style.background = '#1f2937';
      noBtn.style.color = '#fff';
      noBtn.style.borderRadius = '8px';
      noBtn.style.padding = '6px 10px';
      noBtn.style.cursor = 'pointer';

      const yesBtn = document.createElement('button');
      yesBtn.type = 'button';
      yesBtn.textContent = 'Yes';
      yesBtn.style.border = '1px solid #ef4444';
      yesBtn.style.background = '#ef4444';
      yesBtn.style.color = '#fff';
      yesBtn.style.borderRadius = '8px';
      yesBtn.style.padding = '6px 10px';
      yesBtn.style.cursor = 'pointer';

      const close = (value) => {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(!!value);
      };

      noBtn.addEventListener('click', () => close(false));
      yesBtn.addEventListener('click', () => close(true));

      actions.appendChild(noBtn);
      actions.appendChild(yesBtn);
      wrap.appendChild(text);
      wrap.appendChild(actions);
      document.body.appendChild(wrap);
    });
  }

  function nowStamp() {
    return new Date().toLocaleString();
  }

  function addLog(message, unsaved) {
    state.logSeq += 1;
    state.actionLogs.unshift({
      id: state.logSeq,
      time: nowStamp(),
      message: String(message || '').trim(),
      status: unsaved ? 'unsaved' : 'saved'
    });
    if (state.actionLogs.length > 300) {
      state.actionLogs = state.actionLogs.slice(0, 300);
    }
    persistLogs();
    renderLogs();
  }

  function markUnsavedLogsAsSaved(reasonText) {
    let changed = 0;
    for (const log of state.actionLogs) {
      if (log.status === 'unsaved') {
        log.status = 'saved';
        changed += 1;
      }
    }
    if (changed > 0) {
      addLog(reasonText || `Marked ${changed} action(s) as saved.`, false);
    } else {
      renderLogs();
    }
  }

  function renderLogs() {
    const listEl = qs('admin-log-list');
    const summaryEl = qs('admin-log-summary');
    if (!listEl || !summaryEl) return;

    const total = state.actionLogs.length;
    const unsaved = state.actionLogs.filter(l => l.status === 'unsaved').length;
    const saved = total - unsaved;
    summaryEl.textContent = `Total: ${total} | Unsaved: ${unsaved} | Saved: ${saved}`;

    listEl.innerHTML = '';
    if (!total) {
      const empty = document.createElement('div');
      empty.className = 'admin-note';
      empty.textContent = 'No actions logged yet.';
      listEl.appendChild(empty);
      return;
    }

    for (const log of state.actionLogs) {
      const item = document.createElement('div');
      item.className = 'admin-log-item';
      item.innerHTML = `<div class="admin-log-top"><span class="admin-log-time">${log.time}</span><span class="admin-log-status ${log.status}">${log.status === 'unsaved' ? 'Unsaved' : 'Saved'}</span></div><div class="admin-log-message">${log.message}</div>`;
      listEl.appendChild(item);
    }
  }

  function toCsvCell(value) {
    const text = String(value == null ? '' : value);
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  function downloadCsv(filename, rows) {
    const csv = csvFromRows(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvFromRows(rows) {
    return (rows || []).map(cols => (cols || []).map(toCsvCell).join(',')).join('\r\n');
  }

  function exportLogsCsv() {
    const rows = [['Timestamp', 'Status', 'Message']];
    for (const log of state.actionLogs) {
      rows.push([log.time, log.status === 'unsaved' ? 'Unsaved' : 'Saved', log.message]);
    }

    downloadCsv('admin-action-logs.csv', rows);
    setStatus('Exported action logs CSV.', false);
    addLog('Exported action logs as CSV.', false);
  }

  function persistLogs() {
    try {
      localStorage.setItem(ACTION_LOGS_STORAGE_KEY, JSON.stringify(state.actionLogs));
      localStorage.setItem(ACTION_LOG_SEQ_STORAGE_KEY, String(state.logSeq));
    } catch (err) {
      console.warn('[AdminPanel] Failed to persist action logs:', err);
    }
  }

  function hydrateLogsFromStorage() {
    try {
      const rawLogs = localStorage.getItem(ACTION_LOGS_STORAGE_KEY);
      const rawSeq = localStorage.getItem(ACTION_LOG_SEQ_STORAGE_KEY);

      const parsed = rawLogs ? JSON.parse(rawLogs) : [];
      if (Array.isArray(parsed)) {
        state.actionLogs = parsed
          .filter(item => item && typeof item.message === 'string' && typeof item.time === 'string')
          .map(item => ({
            id: Number(item.id) || 0,
            time: String(item.time),
            message: String(item.message),
            status: item.status === 'unsaved' ? 'unsaved' : 'saved'
          }))
          .slice(0, 300);
      } else {
        state.actionLogs = [];
      }

      const maxId = state.actionLogs.reduce((m, item) => Math.max(m, Number(item.id) || 0), 0);
      const seqFromStorage = Number(rawSeq) || 0;
      state.logSeq = Math.max(maxId, seqFromStorage);
    } catch (err) {
      console.warn('[AdminPanel] Failed to load action logs from storage:', err);
      state.actionLogs = [];
      state.logSeq = 0;
    }
    renderLogs();
  }

  function clearEditorFields() {
    [
      'admin-person-id',
      'admin-given-name',
      'admin-surname',
      'admin-sex',
      'admin-birth-date',
      'admin-death-date',
      'admin-birth-place-id',
      'admin-birth-place-name',
      'admin-phone',
      'admin-email',
      'admin-note',
      'admin-custom-key',
      'admin-custom-value',
      'admin-jyotisha-gothra',
      'admin-jyotisha-nakshatra',
      'admin-jyotisha-rashi',
      'admin-father-id',
      'admin-mother-id',
      'admin-spouse-id',
      'admin-divorce-spouse-id',
      'admin-divorce-date',
      'admin-children-input',
      'admin-coparent-id'
    ].forEach(id => {
      const el = qs(id);
      if (!el) return;
      if (el.tagName === 'SELECT') {
        el.selectedIndex = 0;
      } else {
        el.value = '';
      }
    });

    if (els.childrenChipList) els.childrenChipList.innerHTML = '';
    if (els.spouseChipList) els.spouseChipList.innerHTML = '';
    if (els.customFieldsList) els.customFieldsList.innerHTML = '';
    if (qs('admin-divorce-history-list')) qs('admin-divorce-history-list').innerHTML = '';
    const fatherNameEl = qs('admin-parent-father-name');
    const motherNameEl = qs('admin-parent-mother-name');
    const fatherRemoveBtn = qs('admin-parent-father-remove');
    const motherRemoveBtn = qs('admin-parent-mother-remove');
    if (fatherNameEl) fatherNameEl.textContent = '-';
    if (motherNameEl) motherNameEl.textContent = '-';
    if (fatherRemoveBtn) fatherRemoveBtn.classList.add('hidden');
    if (motherRemoveBtn) motherRemoveBtn.classList.add('hidden');
    const photoInput = qs('admin-photo-file');
    if (photoInput) photoInput.value = '';
    if (els.photoPreview) {
      els.photoPreview.classList.remove('show');
      els.photoPreview.removeAttribute('src');
    }
    if (els.photoPath) els.photoPath.textContent = '-';
    const deceasedCheckbox = qs('admin-is-deceased');
    if (deceasedCheckbox) deceasedCheckbox.checked = false;
    const birthDateExact = qs('admin-birth-date-type-exact');
    const birthDateApprox = qs('admin-birth-date-type-approximate');
    if (birthDateExact) birthDateExact.checked = true;
    if (birthDateApprox) birthDateApprox.checked = false;
    toggleDeathDateField(false);
    state.pendingPhotoFile = null;
    state.pendingPhotoMeta = null;
    if (state.pendingPhotoUrl) {
      URL.revokeObjectURL(state.pendingPhotoUrl);
      state.pendingPhotoUrl = '';
    }
  }

  function updateParentDisplay(rel) {
    const fatherNameEl = qs('admin-parent-father-name');
    const motherNameEl = qs('admin-parent-mother-name');
    const fatherRemoveBtn = qs('admin-parent-father-remove');
    const motherRemoveBtn = qs('admin-parent-mother-remove');
    if (!fatherNameEl || !motherNameEl) return;

    if (!rel) {
      fatherNameEl.textContent = '-';
      motherNameEl.textContent = '-';
      if (fatherRemoveBtn) fatherRemoveBtn.classList.add('hidden');
      if (motherRemoveBtn) motherRemoveBtn.classList.add('hidden');
      return;
    }

    fatherNameEl.textContent = rel.fid && getPerson(rel.fid) ? shortPersonRef(rel.fid) : '-';
    motherNameEl.textContent = rel.mid && getPerson(rel.mid) ? shortPersonRef(rel.mid) : '-';
    if (fatherRemoveBtn) fatherRemoveBtn.classList.toggle('hidden', !rel.fid);
    if (motherRemoveBtn) motherRemoveBtn.classList.toggle('hidden', !rel.mid);
  }

  function renderRelationshipChips(personId) {
    const rel = ensureRelation(personId);
    if (!rel) return;

    const personRefHtml = (id) => {
      const ref = shortPersonRef(id);
      return `<span class="admin-chip-link" data-open-person="${id}">${ref}</span>`;
    };

    const parentText = (targetId) => {
      const targetRel = ensureRelation(targetId);
      if (!targetRel) return '';
      const parents = [];
      if (targetRel.fid && getPerson(targetRel.fid)) parents.push(personRefHtml(targetRel.fid));
      if (targetRel.mid && getPerson(targetRel.mid)) parents.push(personRefHtml(targetRel.mid));
      return parents.length ? ` | Parents: ${parents.join(', ')}` : '';
    };

    if (els.spouseChipList) {
      els.spouseChipList.innerHTML = '';
      const spouses = [...state.spouseDraft].sort();
      if (spouses.length === 0) {
        const item = document.createElement('div');
        item.className = 'admin-note';
        item.textContent = 'No spouse linked';
        els.spouseChipList.appendChild(item);
      } else {
        for (const sid of spouses) {
          const chip = document.createElement('div');
          chip.className = 'admin-chip';
          chip.innerHTML = `<span>${personRefHtml(sid)}${parentText(sid)}</span><button type="button" data-remove-spouse="${sid}">x</button>`;
          els.spouseChipList.appendChild(chip);
        }
      }
    }

    if (els.childrenChipList) {
      els.childrenChipList.innerHTML = '';
      const children = getChildrenOf(personId);
      if (children.length === 0) {
        const item = document.createElement('div');
        item.className = 'admin-note';
        item.textContent = 'No children linked';
        els.childrenChipList.appendChild(item);
      } else {
        for (const childId of children) {
          const childRel = ensureRelation(childId);
          const selectedAs = childRel.fid === personId ? 'Father' : (childRel.mid === personId ? 'Mother' : '');
          const chip = document.createElement('div');
          chip.className = 'admin-chip';
          chip.innerHTML = `<span>${personRefHtml(childId)} ${selectedAs ? '- ' + selectedAs : ''}${parentText(childId)}</span><button type="button" data-remove-child="${childId}">x</button>`;
          els.childrenChipList.appendChild(chip);
        }
      }
    }
  }

  function photoPathForPerson(personId) {
    const id = normalizeId(personId);
    return state.photos[id] || '';
  }

  function photoExtFromName(filename) {
    const name = String(filename || '').toLowerCase();
    if (name.endsWith('.png')) return 'png';
    if (name.endsWith('.webp')) return 'webp';
    if (name.endsWith('.jpeg')) return 'jpeg';
    return 'jpg';
  }

  function renderCustomFields(person) {
    if (!els.customFieldsList) return;
    els.customFieldsList.innerHTML = '';
    const custom = sanitizeCustomObject(person?.custom || {});
    const entries = Object.entries(custom);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-note';
      empty.textContent = 'No custom fields.';
      els.customFieldsList.appendChild(empty);
      return;
    }

    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of entries) {
      const row = document.createElement('div');
      row.className = 'admin-custom-row';
      const textWrap = document.createElement('div');
      textWrap.className = 'admin-custom-text';
      const keySpan = document.createElement('span');
      keySpan.className = 'admin-custom-key';
      keySpan.textContent = key;
      const sep = document.createTextNode(': ');
      const valSpan = document.createElement('span');
      valSpan.className = 'admin-custom-value';
      valSpan.textContent = value;
      textWrap.appendChild(keySpan);
      textWrap.appendChild(sep);
      textWrap.appendChild(valSpan);

      const editBtn = document.createElement('button');
      editBtn.className = 'admin-btn muted';
      editBtn.type = 'button';
      editBtn.setAttribute('data-edit-custom', key);
      editBtn.textContent = 'Edit';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'admin-btn danger';
      removeBtn.type = 'button';
      removeBtn.setAttribute('data-remove-custom', key);
      removeBtn.textContent = 'Remove';

      row.appendChild(textWrap);
      row.appendChild(editBtn);
      row.appendChild(removeBtn);
      els.customFieldsList.appendChild(row);
    }
  }

  function renderDivorceHistory(person) {
    const host = qs('admin-divorce-history-list');
    if (!host) return;
    host.innerHTML = '';
    const entries = sanitizeDivorces(person?.divorces || []);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-note';
      empty.textContent = 'No divorce records.';
      host.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'admin-chip';
      row.innerHTML = `<span>${shortPersonRef(entry.spouse_id)}${entry.divorce_date ? ` - Divorced: ${entry.divorce_date}` : ' - Divorced'}</span>`;
      host.appendChild(row);
    }
  }

  async function compressPhotoFile(file) {
    if (!file) return null;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Selected file is not an image.');
    }

    const srcUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not read image.'));
        el.src = srcUrl;
      });

      const maxSide = 1200;
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;
      const scale = Math.min(1, maxSide / Math.max(origW, origH));
      const outW = Math.max(1, Math.round(origW * scale));
      const outH = Math.max(1, Math.round(origH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported in this browser.');
      ctx.drawImage(img, 0, 0, outW, outH);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) reject(new Error('Image compression failed.'));
          else resolve(b);
        }, 'image/jpeg', 0.82);
      });

      const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
      const outFile = new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      return {
        file: outFile,
        originalBytes: Number(file.size || 0),
        compressedBytes: Number(blob.size || 0),
        width: outW,
        height: outH
      };
    } finally {
      URL.revokeObjectURL(srcUrl);
    }
  }

  function updatePhotoPreview() {
    const person = getSelectedPerson();
    if (!person) return;

    const mappedPath = photoPathForPerson(person.person_id);
    if (els.photoPath) els.photoPath.textContent = mappedPath || '-';

    if (!els.photoPreview) return;

    if (state.pendingPhotoUrl) {
      els.photoPreview.onerror = function () {
        els.photoPreview.classList.remove('show');
        els.photoPreview.removeAttribute('src');
        setStatus('Selected photo could not be previewed. Choose another image.', true);
      };
      els.photoPreview.src = state.pendingPhotoUrl;
      els.photoPreview.classList.add('show');
      return;
    }

    if (mappedPath) {
      els.photoPreview.onerror = function () {
        els.photoPreview.classList.remove('show');
        els.photoPreview.removeAttribute('src');
        setStatus(`Broken mapped image: ${mappedPath}`, true);
      };
      els.photoPreview.src = withBase(mappedPath);
      els.photoPreview.classList.add('show');
      return;
    }

    els.photoPreview.classList.remove('show');
    els.photoPreview.removeAttribute('src');
  }

  function renderEditor() {
    if (!state.loaded) return;
    fillPersonList();

    if (!state.selectedPersonId || !getPerson(state.selectedPersonId)) {
      state.selectedPersonId = state.persons.length ? state.persons[0].person_id : '';
    }

    const person = getSelectedPerson();
    if (!person) {
      clearEditorFields();
      setStatus('No person available. Add first record.', false);
      return;
    }

    const contact = getContact(person.person_id) || { phone: '', email: '', note: '' };
    const rel = ensureRelation(person.person_id);
    const isArchived = isArchivedPerson(person);

    qs('admin-person-id').value = person.person_id || '';
    qs('admin-given-name').value = person.given_name || '';
    qs('admin-surname').value = person.surname || '';
    qs('admin-sex').value = person.sex || 'M';
    qs('admin-birth-date').value = person.birth_date || '';
    const birthDateType = normalizeBirthDateType(person.birth_date_type || '');
    const birthDateExact = qs('admin-birth-date-type-exact');
    const birthDateApprox = qs('admin-birth-date-type-approximate');
    if (birthDateExact) birthDateExact.checked = birthDateType !== 'approximate';
    if (birthDateApprox) birthDateApprox.checked = birthDateType === 'approximate';
    const isDeceased = normalizeDeceased(person.deceased) || !!String(person.death_date || '').trim();
    const deceasedCheckbox = qs('admin-is-deceased');
    if (deceasedCheckbox) deceasedCheckbox.checked = isDeceased;
    qs('admin-death-date').value = person.death_date || '';
    toggleDeathDateField(isDeceased);
    qs('admin-birth-place-id').value = person.birth_place_id || '';
    qs('admin-birth-place-name').value = person.birth_place_name || '';
    const jyotisha = sanitizeJyotisha(person.jyotisha || {});
    qs('admin-jyotisha-gothra').value = jyotisha.gothra || '';
    qs('admin-jyotisha-nakshatra').value = jyotisha.nakshatra || '';
    qs('admin-jyotisha-rashi').value = jyotisha.rashi || '';
    qs('admin-phone').value = contact.phone || '';
    qs('admin-email').value = contact.email || '';
    qs('admin-note').value = contact.note || '';
    if (qs('admin-custom-key')) qs('admin-custom-key').value = '';
    if (qs('admin-custom-value')) qs('admin-custom-value').value = '';
    qs('admin-father-id').value = rel.fid || '';
    qs('admin-mother-id').value = rel.mid || '';
    updateParentDisplay(rel);

    state.spouseDraft = new Set(rel.spouses);
    state.pendingPhotoFile = null;
    const photoInput = qs('admin-photo-file');
    if (photoInput) photoInput.value = '';
    if (state.pendingPhotoUrl) {
      URL.revokeObjectURL(state.pendingPhotoUrl);
      state.pendingPhotoUrl = '';
    }
    state.pendingPhotoMeta = null;
    updatePhotoPreview();
    renderRelationshipChips(person.person_id);
    renderCustomFields(person);
    renderDivorceHistory(person);
    const deleteBtn = qs('admin-delete-person');
    if (deleteBtn) {
      deleteBtn.textContent = isArchived ? 'Restore Person' : 'Archive Person';
      deleteBtn.classList.toggle('danger', !isArchived);
      deleteBtn.classList.toggle('secondary', !!isArchived);
    }
    setStatus(`Editing ${personLabel(person.person_id)}${isArchived ? ' (archived record)' : ''}`, false);
  }

  function selectPerson(personId, openPanel) {
    const id = normalizeId(personId);
    if (!id || !getPerson(id)) {
      setStatus(`Person not found: ${id}`, true);
      return;
    }
    state.selectedPersonId = id;
    renderEditor();
    if (openPanel) showAdminPanel();
  }

  function parseIdList(raw) {
    const values = String(raw || '')
      .split(/[\s,;]+/)
      .map(v => normalizeId(v))
      .filter(Boolean);
    return [...new Set(values)];
  }

  function addSpouseLink(a, b) {
    const idA = normalizeId(a);
    const idB = normalizeId(b);
    if (!idA || !idB || idA === idB) return;
    ensureRelation(idA).spouses.add(idB);
    ensureRelation(idB).spouses.add(idA);
  }

  function removeSpouseLink(a, b) {
    const idA = normalizeId(a);
    const idB = normalizeId(b);
    if (!idA || !idB) return;
    ensureRelation(idA).spouses.delete(idB);
    ensureRelation(idB).spouses.delete(idA);
  }

  function savePersonChanges() {
    const person = getSelectedPerson();
    if (!person) return;

    const personId = person.person_id;
    const given = String(qs('admin-given-name').value || '').trim();
    const surname = String(qs('admin-surname').value || '').trim();
    const sex = normalizeId(qs('admin-sex').value || 'M');
    const birthDate = String(qs('admin-birth-date').value || '').trim();
    const birthDateType = qs('admin-birth-date-type-approximate')?.checked ? 'approximate' : 'exact';
    const isDeceased = !!qs('admin-is-deceased')?.checked;
    const deathDate = String(qs('admin-death-date').value || '').trim();
    const birthPlaceId = normalizeId(qs('admin-birth-place-id').value || '');
    const birthPlaceName = String(qs('admin-birth-place-name').value || '').trim();
    const jyotisha = sanitizeJyotisha({
      gothra: qs('admin-jyotisha-gothra')?.value || '',
      nakshatra: qs('admin-jyotisha-nakshatra')?.value || '',
      rashi: qs('admin-jyotisha-rashi')?.value || ''
    });

    const fatherId = normalizeId(qs('admin-father-id').value || '');
    const motherId = normalizeId(qs('admin-mother-id').value || '');
    if (!jyotisha.gothra && fatherId) {
      jyotisha.gothra = inheritedGothraFromFather(fatherId);
    }
    const spouseIdsForSave = [...state.spouseDraft].filter(spouseId => spouseId !== personId && !!getPerson(spouseId));
    let activeSpouseId = normalizeId(person.active_spouse_id || '');
    if (activeSpouseId && !spouseIdsForSave.includes(activeSpouseId)) activeSpouseId = '';
    if (!activeSpouseId && fatherId && spouseIdsForSave.includes(fatherId)) activeSpouseId = fatherId;
    if (!activeSpouseId && spouseIdsForSave.length === 1) {
      activeSpouseId = spouseIdsForSave[0];
    }
    if ((sex === 'F') && spouseIdsForSave.length) {
      const spouseGothra = gothraFromSpouse(activeSpouseId);
      if (spouseGothra) jyotisha.gothra = spouseGothra;
    }

    const saveErrors = validatePersonInputForSave({
      personId,
      birthDate,
      deathDate,
      isDeceased
    });
    if (saveErrors.length) {
      setStatus(saveErrors[0], true);
      return;
    }

    if (fatherId && fatherId === personId) {
      setStatus('Father cannot be same as person.', true);
      return;
    }
    if (motherId && motherId === personId) {
      setStatus('Mother cannot be same as person.', true);
      return;
    }
    if (fatherId && !getPerson(fatherId)) {
      setStatus(`Father ID not found: ${fatherId}`, true);
      return;
    }
    if (motherId && !getPerson(motherId)) {
      setStatus(`Mother ID not found: ${motherId}`, true);
      return;
    }

    person.given_name = given;
    person.surname = surname;
    person.sex = sex === 'F' ? 'F' : 'M';
    person.birth_date = birthDate;
    person.birth_date_type = birthDateTypeForSave(birthDate, birthDateType);
    person.deceased = isDeceased;
    person.death_date = isDeceased ? deathDate : '';
    person.birth_place_id = birthPlaceId;
    person.birth_place_name = birthPlaceName;
    person.jyotisha = jyotisha;
    person.active_spouse_id = activeSpouseId;

    const rel = ensureRelation(personId);
    rel.fid = fatherId;
    rel.mid = motherId;

    rel.spouses = new Set(spouseIdsForSave);
    for (const sid of rel.spouses) {
      ensureRelation(sid).spouses.add(personId);
    }

    const phone = String(qs('admin-phone').value || '').trim();
    const email = String(qs('admin-email').value || '').trim();
    const note = String(qs('admin-note').value || '').trim();
    const custom = sanitizeCustomObject(person.custom || {});

    const existingContact = getContact(personId);
    if (phone || email || note) {
      if (existingContact) {
        existingContact.phone = phone;
        existingContact.email = email;
        existingContact.note = note;
      } else {
        state.contacts.push({ person_id: personId, phone, email, note });
      }
    } else if (existingContact) {
      state.contacts = state.contacts.filter(c => c.person_id !== personId);
    }
    person.custom = custom;

    markDirty(true);
    refreshTreeFromDraft(personId);
    renderEditor();
    setStatus(`Saved edits for ${personId} in working draft.`, false);
    addLog(`Edited person ${shortPersonRef(personId)} details and relationships in draft.`, true);
  }

  function nextPersonId() {
    let max = 0;
    for (const p of state.persons) {
      const match = String(p.person_id || '').match(/^I(\d+)$/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
    }
    const next = String(max + 1).padStart(4, '0');
    return `I${next}`;
  }

  function addNewPerson() {
    const id = nextPersonId();
    state.persons.push({
      person_id: id,
      given_name: '',
      surname: '',
      sex: 'M',
      birth_date: '',
      birth_date_type: '',
      deceased: false,
      death_date: '',
      archived: false,
      archived_at: '',
      custom: {},
      birth_place_id: '',
      birth_place_name: '',
      active_spouse_id: '',
      divorces: [],
      jyotisha: {
        gothra: '',
        nakshatra: '',
        rashi: ''
      }
    });
    ensureRelation(id);
    state.selectedPersonId = id;
    markDirty(true);
    refreshTreeFromDraft(id);
    renderEditor();
    setStatus(`Created new person ${id}. Fill details and click Save Person.`, false);
    addLog(`Added new person ${shortPersonRef(id)}.`, true);
  }

  function removeSelectedPerson() {
    const person = getSelectedPerson();
    if (!person) return;

    const id = person.person_id;
    const archived = isArchivedPerson(person);

    if (archived) {
      const ok = window.confirm(`Restore archived person ${id}?`);
      if (!ok) return;
      person.archived = false;
      person.archived_at = '';
      state.selectedPersonId = id;
      markDirty(true);
      refreshTreeFromDraft(id);
      renderEditor();
      setStatus(`Restored ${id}.`, false);
      addLog(`Restored archived person ${shortPersonRef(id)}.`, true);
      return;
    }

    const ok = window.confirm(`Archive person ${id}? Record is kept and can be restored later.`);
    if (!ok) return;
    person.archived = true;
    person.archived_at = new Date().toISOString();

    const nextActive = sortedPersons().find(p => !isArchivedPerson(p) && p.person_id !== id);
    state.selectedPersonId = nextActive ? nextActive.person_id : id;
    markDirty(true);
    refreshTreeFromDraft(nextActive ? nextActive.person_id : '');
    renderEditor();
    setStatus(`Archived ${id}.`, false);
    addLog(`Archived person ${shortPersonRef(id)} (soft delete).`, true);
  }

  async function discardDraftChanges() {
    if (!state.dirty) {
      setStatus('No unsaved draft changes to discard.', false);
      return;
    }

    const ok = await confirmDiscardToast('Are you sure? Discard all unsaved draft changes and reload from source JSON files.');
    if (!ok) return;

    const prevSelectedId = normalizeId(state.selectedPersonId || '');
    try {
      await loadData();
      const targetId = prevSelectedId && getPerson(prevSelectedId)
        ? prevSelectedId
        : (sortedPersons()[0]?.person_id || '');
      state.selectedPersonId = targetId;
      markDirty(false);
      refreshTreeFromDraft(targetId);
      renderEditor();
      setStatus('Discarded unsaved draft changes and reloaded data.', false);
      addLog('Discarded unsaved draft changes and reloaded from JSON files.', false);
    } catch (err) {
      setStatus(`Failed to discard changes: ${err.message}`, true);
    }
  }

  function addSpouseFromInput() {
    const person = getSelectedPerson();
    if (!person) return;
    const spouseId = normalizeId(qs('admin-spouse-id').value || '');

    if (!spouseId) {
      setStatus('Enter spouse ID.', true);
      return;
    }
    if (spouseId === person.person_id) {
      setStatus('Person cannot be spouse of self.', true);
      return;
    }
    if (!getPerson(spouseId)) {
      setStatus(`Spouse not found: ${spouseId}`, true);
      return;
    }

    state.spouseDraft.add(spouseId);
    addSpouseLink(person.person_id, spouseId);
    removeDivorceRecordForPerson(person, spouseId);
    removeDivorceRecordForPerson(getPerson(spouseId), person.person_id);
    if (!normalizeId(person.active_spouse_id || '')) {
      person.active_spouse_id = spouseId;
    }
    qs('admin-spouse-id').value = '';
    markDirty(true);
    refreshTreeFromDraft(person.person_id);
    renderRelationshipChips(person.person_id);
    setStatus(`Added spouse relation: ${person.person_id} <-> ${spouseId}`, false);
    addLog(`Added spouse link ${shortPersonRef(person.person_id)} <-> ${shortPersonRef(spouseId)}.`, true);
  }

  function recordDivorceFromInput() {
    const person = getSelectedPerson();
    if (!person) return;

    const rel = ensureRelation(person.person_id);
    const linkedSpouses = [...rel.spouses].filter(id => !!getPerson(id));
    const spouseDraftIds = [...state.spouseDraft].filter(id => !!getPerson(id));

    let spouseId = normalizeId(qs('admin-divorce-spouse-id')?.value || '');
    if (!spouseId) {
      const activeSpouseId = normalizeId(person.active_spouse_id || '');
      if (activeSpouseId && linkedSpouses.includes(activeSpouseId)) {
        spouseId = activeSpouseId;
      } else if (linkedSpouses.length === 1) {
        spouseId = linkedSpouses[0];
      } else if (spouseDraftIds.length === 1) {
        spouseId = spouseDraftIds[0];
      }
    }
    const divorceDate = String(qs('admin-divorce-date')?.value || '').trim();

    if (!spouseId) {
      setStatus('Enter Divorce Spouse ID (or keep one active spouse linked).', true);
      return;
    }
    if (spouseId === person.person_id) {
      setStatus('Person cannot be divorced from self.', true);
      return;
    }
    if (!getPerson(spouseId)) {
      setStatus(`Spouse not found: ${spouseId}`, true);
      return;
    }
    if (divorceDate && !parseFlexibleDate(divorceDate)) {
      setStatus(`Invalid divorce date format: "${divorceDate}" (expected dd-MMM-yyyy or dd-MMM-yy).`, true);
      return;
    }

    if (!rel.spouses.has(spouseId)) {
      const alreadyDivorced = sanitizeDivorces(person.divorces || []).some(d => d.spouse_id === spouseId);
      if (alreadyDivorced) {
        setStatus(`Divorce already recorded with ${spouseId}.`, false);
      } else {
        setStatus(`No active spouse link with ${spouseId} to mark as divorced.`, true);
      }
      return;
    }

    state.spouseDraft.delete(spouseId);
    removeSpouseLink(person.person_id, spouseId);

    const spouseObj = getPerson(spouseId);
    if (spouseObj) {
      const spouseRel = ensureRelation(spouseId);
      const spouseRemaining = [...spouseRel.spouses].filter(id => !!getPerson(id));
      if (normalizeId(spouseObj.active_spouse_id || '') === person.person_id) {
        spouseObj.active_spouse_id = spouseRemaining.length === 1 ? spouseRemaining[0] : '';
      }
    }

    const currentActive = normalizeId(person.active_spouse_id || '');
    if (currentActive === spouseId) {
      const remaining = [...state.spouseDraft].filter(id => !!getPerson(id));
      person.active_spouse_id = remaining.length === 1 ? remaining[0] : '';
    }

    upsertDivorceRecordForPerson(person, spouseId, divorceDate);
    upsertDivorceRecordForPerson(getPerson(spouseId), person.person_id, divorceDate);

    if (qs('admin-divorce-spouse-id')) qs('admin-divorce-spouse-id').value = '';
    if (qs('admin-divorce-date')) qs('admin-divorce-date').value = '';

    markDirty(true);
    refreshTreeFromDraft(person.person_id);
    renderRelationshipChips(person.person_id);
    renderDivorceHistory(person);
    setStatus(`Recorded divorce: ${person.person_id} x ${spouseId}`, false);
    addLog(`Recorded divorce ${shortPersonRef(person.person_id)} x ${shortPersonRef(spouseId)}${divorceDate ? ` (${divorceDate})` : ''}.`, true);
  }

  function addChildrenFromInput() {
    const person = getSelectedPerson();
    if (!person) return;

    const raw = qs('admin-children-input').value;
    const childIds = parseIdList(raw);
    if (!childIds.length) {
      setStatus('Enter one or more child IDs.', true);
      return;
    }

    const coParentId = normalizeId(qs('admin-coparent-id').value || '');
    if (coParentId && !getPerson(coParentId)) {
      setStatus(`Co-parent not found: ${coParentId}`, true);
      return;
    }
    if (coParentId && coParentId === person.person_id) {
      setStatus('Co-parent cannot be same as selected person.', true);
      return;
    }

    const roleSelect = qs('admin-selected-role');
    const inferredRole = person.sex === 'F' ? 'mother' : (person.sex === 'M' ? 'father' : roleSelect.value);

    const success = [];
    const failed = [];

    for (const childId of childIds) {
      if (childId === person.person_id) {
        failed.push(`${childId} (self)`);
        continue;
      }
      if (!getPerson(childId)) {
        failed.push(`${childId} (missing)`);
        continue;
      }

      const rel = ensureRelation(childId);
      if (inferredRole === 'mother') {
        rel.mid = person.person_id;
        if (coParentId) rel.fid = coParentId;
      } else {
        rel.fid = person.person_id;
        if (coParentId) rel.mid = coParentId;
      }

      if (coParentId) {
        addSpouseLink(person.person_id, coParentId);
      }
      success.push(childId);
    }

    if (success.length) {
      if (coParentId && person.sex === 'F') {
        person.active_spouse_id = coParentId;
      }
      markDirty(true);
      refreshTreeFromDraft(person.person_id);
      renderRelationshipChips(person.person_id);
      setStatus(`Added/updated children: ${success.join(', ')}`, false);
      addLog(`Updated children for ${shortPersonRef(person.person_id)}: ${success.map(shortPersonRef).join(', ')}.`, true);
    }
    if (failed.length) {
      setStatus(`Some children skipped: ${failed.join(', ')}`, true);
    }

    qs('admin-children-input').value = '';
  }

  function clearFather() {
    qs('admin-father-id').value = '';
    markDirty(true);
    setStatus('Father link cleared in form. Click Save Person to persist.', false);
  }

  function clearMother() {
    qs('admin-mother-id').value = '';
    markDirty(true);
    setStatus('Mother link cleared in form. Click Save Person to persist.', false);
  }

  function onChipClicks(e) {
    const openPersonBtn = e.target.closest('[data-open-person]');
    if (openPersonBtn) {
      const openId = normalizeId(openPersonBtn.getAttribute('data-open-person'));
      if (openId && getPerson(openId)) {
        selectPerson(openId, true);
        refreshTreeFromDraft(openId);
        setStatus(`Loaded ${shortPersonRef(openId)} for editing.`, false);
      }
      return;
    }

    const removeSpouseBtn = e.target.closest('[data-remove-spouse]');
    if (removeSpouseBtn) {
      const sid = normalizeId(removeSpouseBtn.getAttribute('data-remove-spouse'));
      const person = getSelectedPerson();
      if (!person) return;

      state.spouseDraft.delete(sid);
      removeSpouseLink(person.person_id, sid);
      const currentActive = normalizeId(person.active_spouse_id || '');
      if (currentActive === sid) {
        const remaining = [...state.spouseDraft].filter(spouseId => !!getPerson(spouseId));
        person.active_spouse_id = remaining.length === 1 ? remaining[0] : '';
      }
      const spouseObj = getPerson(sid);
      if (spouseObj) {
        const spouseRel = ensureRelation(sid);
        const spouseRemaining = [...spouseRel.spouses].filter(spouseId => !!getPerson(spouseId));
        if (normalizeId(spouseObj.active_spouse_id || '') === person.person_id) {
          spouseObj.active_spouse_id = spouseRemaining.length === 1 ? spouseRemaining[0] : '';
        }
      }
      markDirty(true);
      renderRelationshipChips(person.person_id);
      setStatus(`Removed spouse relation with ${sid}`, false);
      return;
    }

    const removeChildBtn = e.target.closest('[data-remove-child]');
    if (removeChildBtn) {
      const childId = normalizeId(removeChildBtn.getAttribute('data-remove-child'));
      const person = getSelectedPerson();
      if (!person) return;

      const rel = ensureRelation(childId);
      let changed = false;
      if (rel.fid === person.person_id) {
        rel.fid = '';
        changed = true;
      }
      if (rel.mid === person.person_id) {
        rel.mid = '';
        changed = true;
      }

      if (changed) {
        markDirty(true);
        refreshTreeFromDraft(person.person_id);
        renderRelationshipChips(person.person_id);
        setStatus(`Removed child link to ${childId}`, false);
        addLog(`Removed child link ${shortPersonRef(person.person_id)} -> ${shortPersonRef(childId)}.`, true);
      }
      return;
    }
  }

  async function onPhotoFileChange(e) {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    state.pendingPhotoFile = null;
    state.pendingPhotoMeta = null;
    if (state.pendingPhotoUrl) {
      URL.revokeObjectURL(state.pendingPhotoUrl);
      state.pendingPhotoUrl = '';
    }

    if (!file) {
      updatePhotoPreview();
      return;
    }

    try {
      const processed = await compressPhotoFile(file);
      state.pendingPhotoFile = processed.file;
      state.pendingPhotoMeta = processed;
      state.pendingPhotoUrl = URL.createObjectURL(processed.file);
      const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
      setStatus(`Photo optimized: ${processed.width}x${processed.height}, ${kb(processed.originalBytes)} -> ${kb(processed.compressedBytes)} (JPEG).`, false);
    } catch (err) {
      state.pendingPhotoFile = file;
      state.pendingPhotoMeta = null;
      state.pendingPhotoUrl = URL.createObjectURL(file);
      setStatus(`Selected original photo (optimization skipped): ${file.name}. ${err.message || ''}`.trim(), true);
    }
    updatePhotoPreview();
  }

  function applyPhotoMapping() {
    const person = getSelectedPerson();
    if (!person) return;
    if (!state.pendingPhotoFile) {
      setStatus('Select a photo file first.', true);
      return;
    }

    const ext = photoExtFromName(state.pendingPhotoFile.name);
    const targetPath = `icons/${person.person_id}.${ext}`;
    state.photos[person.person_id] = targetPath;
    markDirty(true);
    refreshTreeFromDraft(person.person_id);
    updatePhotoPreview();
    setStatus(`Photo mapped to ${targetPath}. Download renamed image and photos.json.`, false);
    addLog(`Applied photo mapping for ${shortPersonRef(person.person_id)}: ${targetPath}.`, true);
  }

  function removePhotoMapping() {
    const person = getSelectedPerson();
    if (!person) return;
    delete state.photos[person.person_id];
    markDirty(true);
    refreshTreeFromDraft(person.person_id);
    updatePhotoPreview();
    setStatus(`Photo mapping removed for ${person.person_id}.`, false);
    addLog(`Removed photo mapping for ${shortPersonRef(person.person_id)}.`, true);
  }

  function downloadRenamedPhoto() {
    const person = getSelectedPerson();
    if (!person) return;
    if (!state.pendingPhotoFile) {
      setStatus('Select a photo first to download renamed image file.', true);
      return;
    }

    const ext = photoExtFromName(state.pendingPhotoFile.name);
    const filename = `${person.person_id}.${ext}`;
    const url = URL.createObjectURL(state.pendingPhotoFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded renamed image ${filename}. Put it into icons/ before publishing.`, false);
    addLog(`Downloaded renamed image file ${filename}.`, false);
  }

  function generateFamiliesFromRelations() {
    const famMap = new Map();

    function sexOf(personId) {
      const p = getPerson(personId);
      return p ? String(p.sex || '').toUpperCase() : '';
    }

    function getOrCreateFamily(husbandId, wifeId) {
      const hid = normalizeId(husbandId);
      const wid = normalizeId(wifeId);
      const key = `${hid}|${wid}`;
      if (!famMap.has(key)) {
        famMap.set(key, {
          family_id: '',
          husband_id: hid,
          wife_id: wid,
          marriage_date: '',
          marriage_place_id: '',
          children: []
        });
      }
      return famMap.get(key);
    }

    for (const [childId, rel] of state.relations.entries()) {
      if (!getPerson(childId)) continue;
      const fam = getOrCreateFamily(rel.fid, rel.mid);
      if (!fam.children.includes(childId)) fam.children.push(childId);
    }

    for (const [id, rel] of state.relations.entries()) {
      if (!getPerson(id)) continue;
      for (const spouseId of rel.spouses) {
        if (!getPerson(spouseId)) continue;
        if (id >= spouseId) continue;

        const sexA = sexOf(id);
        const sexB = sexOf(spouseId);

        let hid = id;
        let wid = spouseId;

        if (sexA === 'F' && sexB === 'M') {
          hid = spouseId;
          wid = id;
        } else if (sexA === 'M' && sexB === 'F') {
          hid = id;
          wid = spouseId;
        } else {
          const sorted = [id, spouseId].sort();
          hid = sorted[0];
          wid = sorted[1];
        }

        getOrCreateFamily(hid, wid);
      }
    }

    const out = [...famMap.values()]
      .filter(f => f.husband_id || f.wife_id || (f.children && f.children.length))
      .map(f => {
        f.children = (f.children || []).filter(cid => !!getPerson(cid)).sort();
        return f;
      })
      .sort((a, b) => {
        const keyA = `${a.husband_id}|${a.wife_id}`;
        const keyB = `${b.husband_id}|${b.wife_id}`;
        return keyA.localeCompare(keyB);
      });

    out.forEach((f, idx) => {
      f.family_id = `F${String(idx + 1).padStart(4, '0')}`;
    });

    return out;
  }

  function sanitizePersons() {
    return state.persons
      .map(p => ({
        person_id: normalizeId(p.person_id),
        given_name: String(p.given_name || '').trim(),
        surname: String(p.surname || '').trim(),
        sex: String(p.sex || 'M').toUpperCase() === 'F' ? 'F' : 'M',
        birth_date: String(p.birth_date || '').trim(),
        birth_date_type: birthDateTypeForSave(p.birth_date, p.birth_date_type),
        deceased: normalizeDeceased(p.deceased) || !!String(p.death_date || '').trim(),
        death_date: String(p.death_date || '').trim(),
        archived: isArchivedPerson(p),
        archived_at: String(p.archived_at || '').trim(),
        custom: sanitizeCustomObject(p.custom || {}),
        birth_place_id: normalizeId(p.birth_place_id || ''),
        birth_place_name: String(p.birth_place_name || '').trim(),
        active_spouse_id: normalizeId(p.active_spouse_id || ''),
        divorces: sanitizeDivorces(p.divorces || []),
        jyotisha: sanitizeJyotisha(p.jyotisha || {})
      }))
      .sort((a, b) => a.person_id.localeCompare(b.person_id));
  }

  function sanitizeContacts() {
    return state.contacts
      .filter(c => !!getPerson(c.person_id))
      .map(c => ({
        person_id: normalizeId(c.person_id),
        phone: String(c.phone || '').trim(),
        email: String(c.email || '').trim(),
        note: String(c.note || '').trim()
      }))
      .filter(c => c.phone || c.email || c.note)
      .sort((a, b) => a.person_id.localeCompare(b.person_id));
  }

  function sanitizePhotos() {
    const out = {};
    const ids = state.persons.map(p => normalizeId(p.person_id)).filter(Boolean);
    ids.sort();
    for (const id of ids) {
      const path = String(state.photos[id] || '').trim();
      if (path) out[id] = path;
    }
    return out;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function personsCsvRows() {
    const rows = [[
      'person_id',
      'given_name',
      'surname',
      'sex',
      'birth_date',
      'birth_date_type',
      'deceased',
      'death_date',
      'archived',
      'archived_at',
      'birth_place_id',
      'birth_place_name',
      'active_spouse_id',
      'divorces_json',
      'jyotisha_json',
      'custom_json'
    ]];
    for (const p of sanitizePersons()) {
      rows.push([
        p.person_id,
        p.given_name,
        p.surname,
        p.sex,
        p.birth_date,
        p.birth_date_type,
        p.deceased ? 'true' : 'false',
        p.death_date,
        p.archived ? 'true' : 'false',
        p.archived_at,
        p.birth_place_id,
        p.birth_place_name,
        p.active_spouse_id,
        JSON.stringify(sanitizeDivorces(p.divorces || [])),
        JSON.stringify(sanitizeJyotisha(p.jyotisha || {})),
        JSON.stringify(sanitizeCustomObject(p.custom || {}))
      ]);
    }
    return rows;
  }

  function familiesCsvRows() {
    const rows = [['family_id', 'husband_id', 'wife_id', 'children_json']];
    for (const f of generateFamiliesFromRelations()) {
      rows.push([
        String(f.family_id || ''),
        String(f.husband_id || ''),
        String(f.wife_id || ''),
        JSON.stringify(Array.isArray(f.children) ? f.children : [])
      ]);
    }
    return rows;
  }

  function contactsCsvRows() {
    const rows = [['person_id', 'phone', 'email', 'note']];
    for (const c of sanitizeContacts()) {
      rows.push([c.person_id, c.phone, c.email, c.note]);
    }
    return rows;
  }

  function photosCsvRows() {
    const rows = [['person_id', 'photo_path']];
    for (const [id, path] of Object.entries(sanitizePhotos())) {
      rows.push([id, path]);
    }
    return rows;
  }

  function buildZipTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${y}${m}${day}-${hh}${mm}${ss}`;
  }

  function buildSchemaManifest() {
    return {
      schema_version: DATA_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      files: {
        persons: 'persons.json',
        families: 'families.json',
        contacts: 'contacts.json',
        photos: 'photos.json'
      },
      notes: [
        'persons.json includes deceased (boolean) and death_date (string, optional).',
        'persons.json includes active_spouse_id and divorces (history of divorce records).',
        'Date format: dd-MMM-yyyy or dd-MMM-yy.'
      ]
    };
  }

  function exportPersons() {
    if (!validateBeforeExport()) return;
    downloadJson('persons.json', sanitizePersons());
    setStatus('Downloaded persons.json', false);
    addLog('Downloaded persons.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after persons.json export.');
  }

  function exportPersonsCsv() {
    if (!validateBeforeExport()) return;
    downloadCsv('persons.csv', personsCsvRows());
    setStatus('Downloaded persons.csv', false);
    addLog('Downloaded persons.csv.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after persons.csv export.');
  }

  function exportFamilies() {
    if (!validateBeforeExport()) return;
    downloadJson('families.json', generateFamiliesFromRelations());
    setStatus('Downloaded families.json', false);
    addLog('Downloaded families.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after families.json export.');
  }

  function exportFamiliesCsv() {
    if (!validateBeforeExport()) return;
    downloadCsv('families.csv', familiesCsvRows());
    setStatus('Downloaded families.csv', false);
    addLog('Downloaded families.csv.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after families.csv export.');
  }

  function exportContacts() {
    if (!validateBeforeExport()) return;
    downloadJson('contacts.json', sanitizeContacts());
    setStatus('Downloaded contacts.json', false);
    addLog('Downloaded contacts.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after contacts.json export.');
  }

  function exportContactsCsv() {
    if (!validateBeforeExport()) return;
    downloadCsv('contacts.csv', contactsCsvRows());
    setStatus('Downloaded contacts.csv', false);
    addLog('Downloaded contacts.csv.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after contacts.csv export.');
  }

  function exportPhotos() {
    if (!validateBeforeExport()) return;
    downloadJson('photos.json', sanitizePhotos());
    setStatus('Downloaded photos.json', false);
    addLog('Downloaded photos.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after photos.json export.');
  }

  function exportPhotosCsv() {
    if (!validateBeforeExport()) return;
    downloadCsv('photos.csv', photosCsvRows());
    setStatus('Downloaded photos.csv', false);
    addLog('Downloaded photos.csv.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after photos.csv export.');
  }

  function exportSchema() {
    downloadJson('schema.json', buildSchemaManifest());
    setStatus('Downloaded schema.json', false);
    addLog('Downloaded schema.json.', false);
  }

  async function exportAll() {
    if (!validateBeforeExport()) return;
    if (typeof window.JSZip === 'undefined') {
      setStatus('ZIP library not loaded. Please refresh and try again.', true);
      return;
    }

    const zip = new window.JSZip();
    zip.file('persons.json', JSON.stringify(sanitizePersons(), null, 2));
    zip.file('families.json', JSON.stringify(generateFamiliesFromRelations(), null, 2));
    zip.file('contacts.json', JSON.stringify(sanitizeContacts(), null, 2));
    zip.file('photos.json', JSON.stringify(sanitizePhotos(), null, 2));
    zip.file('schema.json', JSON.stringify(buildSchemaManifest(), null, 2));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const stamp = buildZipTimestamp();
    const filename = `VAMSHA-${stamp}.zip`;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(`Downloaded ${filename}`, false);
    addLog(`Downloaded ${filename} (persons, families, contacts, photos, schema).`, false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after ZIP export.');
  }

  async function exportAllCsv() {
    if (!validateBeforeExport()) return;
    if (typeof window.JSZip === 'undefined') {
      setStatus('ZIP library not loaded. Please refresh and try again.', true);
      return;
    }

    const zip = new window.JSZip();
    zip.file('persons.csv', csvFromRows(personsCsvRows()));
    zip.file('families.csv', csvFromRows(familiesCsvRows()));
    zip.file('contacts.csv', csvFromRows(contactsCsvRows()));
    zip.file('photos.csv', csvFromRows(photosCsvRows()));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const stamp = buildZipTimestamp();
    const filename = `VAMSHA-CSV-${stamp}.zip`;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(`Downloaded ${filename}`, false);
    addLog(`Downloaded ${filename} (persons, families, contacts, photos CSV).`, false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after CSV ZIP export.');
  }

  function showAdminPanel() {
    if (!state.loaded) return;
    if (els.panel) els.panel.classList.add('show');
    if (els.overlay) els.overlay.classList.add('show');
    renderEditor();
  }

  function hideAdminPanel() {
    if (els.panel) els.panel.classList.remove('show');
    if (els.overlay) els.overlay.classList.remove('show');
  }

  function readPersonIdFromModal() {
    const el = qs('person-modal-id');
    if (!el) return '';
    const text = el.textContent || '';
    const m = text.match(/I\d+/i);
    return m ? normalizeId(m[0]) : '';
  }

  function findTreeClickedId(target) {
    const attrs = ['data-n-id', 'data-id', 'node-id', 'data-node-id', 'id'];
    let node = target;

    while (node && node !== document.body) {
      for (const attr of attrs) {
        const val = node.getAttribute && node.getAttribute(attr);
        if (!val) continue;
        const m = String(val).match(/I\d+/i);
        if (m && getPerson(m[0])) {
          return normalizeId(m[0]);
        }
      }
      node = node.parentElement;
    }
    return '';
  }

  function runValidation() {
    const issues = [];
    const peopleIds = new Set();
    const dupIds = new Set();
    const peopleById = new Map();

    for (const p of state.persons) {
      const id = normalizeId(p.person_id);
      if (!id) {
        issues.push({ level: 'error', message: 'Person with empty person_id found.' });
        continue;
      }
      if (peopleIds.has(id)) dupIds.add(id);
      peopleIds.add(id);
      if (!/^I\d+$/i.test(id)) {
        issues.push({ level: 'error', message: `Invalid person ID format: ${id}` });
      }
      peopleById.set(id, p);

      const birthRaw = String(p.birth_date || '').trim();
      const deathRaw = String(p.death_date || '').trim();
      const isDeceased = normalizeDeceased(p.deceased) || !!deathRaw;
      const birthDt = birthRaw ? parseFlexibleDate(birthRaw) : null;
      const deathDt = deathRaw ? parseFlexibleDate(deathRaw) : null;

      if (birthRaw && !birthDt) {
        issues.push({ level: 'error', message: `${id} has invalid birth_date format: "${birthRaw}"` });
      }
      if (deathRaw && !deathDt) {
        issues.push({ level: 'error', message: `${id} has invalid death_date format: "${deathRaw}"` });
      }
      if (deathDt && birthDt && deathDt < birthDt) {
        issues.push({ level: 'error', message: `${id} death_date is before birth_date.` });
      }
      const now = new Date();
      if (birthDt && birthDt > now) {
        issues.push({ level: 'warn', message: `${id} birth_date is in the future.` });
      }
      if (deathDt && deathDt > now) {
        issues.push({ level: 'warn', message: `${id} death_date is in the future.` });
      }
      if (!normalizeDeceased(p.deceased) && deathRaw) {
        issues.push({ level: 'error', message: `${id} has death_date but deceased is false.` });
      }
      // death_date can be empty for deceased entries (intentionally allowed for future completion).
      if (p.custom != null && (typeof p.custom !== 'object' || Array.isArray(p.custom))) {
        issues.push({ level: 'warn', message: `${id} custom should be an object (custom: {}).` });
      }

      const divorces = sanitizeDivorces(p.divorces || []);
      for (const d of divorces) {
        if (d.spouse_id === id) {
          issues.push({ level: 'error', message: `${id} has invalid divorce record with self.` });
        }
      }
    }

    for (const id of dupIds) {
      issues.push({ level: 'error', message: `Duplicate person_id detected: ${id}` });
    }

    for (const [id, p] of peopleById.entries()) {
      const divorces = sanitizeDivorces(p.divorces || []);
      for (const d of divorces) {
        if (!peopleIds.has(d.spouse_id)) {
          issues.push({ level: 'error', message: `${id} has divorce record with missing spouse: ${d.spouse_id}` });
        }
      }
    }

    for (const [id, rel] of state.relations.entries()) {
      if (!peopleIds.has(id)) continue;

      if (rel.fid) {
        if (!peopleIds.has(rel.fid)) issues.push({ level: 'error', message: `${id} has missing father: ${rel.fid}` });
        if (rel.fid === id) issues.push({ level: 'error', message: `${id} is linked as own father.` });
        const father = peopleById.get(rel.fid);
        if (father && String(father.sex || '').toUpperCase() === 'F') {
          issues.push({ level: 'warn', message: `${id} father (${rel.fid}) has sex=F.` });
        }
      }
      if (rel.mid) {
        if (!peopleIds.has(rel.mid)) issues.push({ level: 'error', message: `${id} has missing mother: ${rel.mid}` });
        if (rel.mid === id) issues.push({ level: 'error', message: `${id} is linked as own mother.` });
        const mother = peopleById.get(rel.mid);
        if (mother && String(mother.sex || '').toUpperCase() === 'M') {
          issues.push({ level: 'warn', message: `${id} mother (${rel.mid}) has sex=M.` });
        }
      }
      if (rel.fid && rel.mid && rel.fid === rel.mid) {
        issues.push({ level: 'warn', message: `${id} has same ID for father and mother (${rel.fid}).` });
      }

      for (const sid of rel.spouses) {
        if (!peopleIds.has(sid)) {
          issues.push({ level: 'error', message: `${id} has missing spouse: ${sid}` });
          continue;
        }
        if (sid === id) {
          issues.push({ level: 'error', message: `${id} is linked as own spouse.` });
          continue;
        }
        const other = ensureRelation(sid);
        if (!other.spouses.has(id)) {
          issues.push({ level: 'warn', message: `Spouse link not reciprocal: ${id} -> ${sid}` });
        }
      }

      const divorces = sanitizeDivorces(peopleById.get(id)?.divorces || []);
      for (const d of divorces) {
        if (rel.spouses.has(d.spouse_id)) {
          issues.push({ level: 'warn', message: `${id} is marked divorced from ${d.spouse_id} but still has active spouse link.` });
        }
        const spouseObj = peopleById.get(d.spouse_id);
        if (spouseObj) {
          const spouseDivorces = sanitizeDivorces(spouseObj.divorces || []);
          if (!spouseDivorces.some(x => x.spouse_id === id)) {
            issues.push({ level: 'warn', message: `Divorce record not reciprocal: ${id} -> ${d.spouse_id}` });
          }
        }
      }
    }

    // Detect ancestry cycles through parent links (fid/mid graph).
    const parentIdsOf = (id) => {
      const rel = state.relations.get(id);
      if (!rel) return [];
      return [normalizeId(rel.fid), normalizeId(rel.mid)].filter(pid => !!pid && peopleIds.has(pid));
    };
    const visited = new Set();
    const inStack = new Set();
    const hasCycle = new Set();

    const dfs = (id) => {
      if (inStack.has(id)) {
        hasCycle.add(id);
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      inStack.add(id);
      for (const pid of parentIdsOf(id)) {
        dfs(pid);
      }
      inStack.delete(id);
    };

    for (const id of peopleIds) {
      dfs(id);
    }
    for (const id of hasCycle) {
      issues.push({ level: 'error', message: `Parent cycle detected involving ${id}.` });
    }

    const contactIds = new Set();
    for (const c of state.contacts) {
      const id = normalizeId(c.person_id);
      if (!id) {
        issues.push({ level: 'warn', message: 'Contact row with empty person_id found.' });
        continue;
      }
      if (!peopleIds.has(id)) {
        issues.push({ level: 'warn', message: `Contact points to missing person: ${id}` });
      }
      if (contactIds.has(id)) {
        issues.push({ level: 'warn', message: `Multiple contact rows found for person: ${id}` });
      }
      contactIds.add(id);
    }

    for (const [pid, path] of Object.entries(state.photos || {})) {
      const id = normalizeId(pid);
      const p = String(path || '').trim();
      if (!peopleIds.has(id)) {
        issues.push({ level: 'warn', message: `Photo mapping points to missing person: ${id}` });
      }
      if (p && !/^icons\/I\d+\.(jpg|jpeg|png|webp)$/i.test(p)) {
        issues.push({ level: 'warn', message: `Photo path format looks unusual for ${id}: ${p}` });
      }
    }

    state.lastValidation = issues;
    renderValidation(issues);
    return issues;
  }

  function renderValidation(issues) {
    const listEl = qs('admin-validation-list');
    const summaryEl = qs('admin-validation-summary');
    if (!listEl || !summaryEl) return;

    listEl.innerHTML = '';
    const errors = issues.filter(i => i.level === 'error').length;
    const warns = issues.filter(i => i.level === 'warn').length;

    if (!issues.length) {
      summaryEl.textContent = 'Validation passed. No issues found.';
      const ok = document.createElement('div');
      ok.className = 'admin-validation-item ok';
      ok.textContent = 'No issues found in current draft.';
      listEl.appendChild(ok);
      return;
    }

    summaryEl.textContent = `Validation found ${errors} error(s) and ${warns} warning(s).`;
    for (const issue of issues) {
      const item = document.createElement('div');
      item.className = `admin-validation-item ${issue.level}`;
      item.textContent = issue.message;
      listEl.appendChild(item);
    }
  }

  function validateBeforeExport() {
    const issues = runValidation();
    const errorCount = issues.filter(i => i.level === 'error').length;
    if (!errorCount) return true;
    setStatus(`Export blocked: ${errorCount} validation error(s). Fix them and retry.`, true);
    return false;
  }

  function buildRuntimePeopleMap() {
    const contactsById = new Map();
    for (const c of state.contacts) {
      contactsById.set(normalizeId(c.person_id), c);
    }

    const out = new Map();
    for (const p of state.persons) {
      const id = normalizeId(p.person_id);
      if (!id) continue;
      if (isArchivedPerson(p)) continue;
      const rel = ensureRelation(id) || { fid: '', mid: '', spouses: new Set() };
      const c = contactsById.get(id) || {};
      const fullName = `${String(p.given_name || '').trim()} ${String(p.surname || '').trim()}`.trim() || id;
      const placeObj = state.places && p.birth_place_id ? state.places[p.birth_place_id] : null;
      const place = String((placeObj && placeObj.place) || p.birth_place_name || '').trim();

      out.set(id, {
        id,
        name: fullName,
        fid: rel.fid || '',
        mid: rel.mid || '',
        pids: [...rel.spouses].filter(pid => !!getPerson(pid)).sort(),
        Birth: String(p.birth_date || '').trim(),
        Death: String(p.death_date || '').trim(),
        deceased: normalizeDeceased(p.deceased) || !!String(p.death_date || '').trim(),
        death_date: String(p.death_date || '').trim(),
        custom: sanitizeCustomObject(p.custom || {}),
        Address: place,
        email: String(c.email || '').trim(),
        phone: String(c.phone || '').trim(),
        note: String(c.note || '').trim(),
        image_url: withBase(String(state.photos[id] || '').trim())
      });
    }
    return out;
  }

  function syncRuntimeMapsFromDraft() {
    if (!window.peopleMap || !window.childrenMap || !window.genderMap) return false;

    const runtimePeople = buildRuntimePeopleMap();
    window.peopleMap.clear();
    window.childrenMap.clear();
    window.genderMap.clear();

    for (const [id, person] of runtimePeople.entries()) {
      window.peopleMap.set(id, person);
    }

    for (const [childId, rel] of state.relations.entries()) {
      if (!runtimePeople.has(childId)) continue;
      if (rel.fid && runtimePeople.has(rel.fid)) {
        if (!window.childrenMap.has(rel.fid)) window.childrenMap.set(rel.fid, []);
        window.childrenMap.get(rel.fid).push(childId);
      }
      if (rel.mid && runtimePeople.has(rel.mid)) {
        if (!window.childrenMap.has(rel.mid)) window.childrenMap.set(rel.mid, []);
        window.childrenMap.get(rel.mid).push(childId);
      }
    }

    for (const p of state.persons) {
      const id = normalizeId(p.person_id);
      const sex = String(p.sex || '').toUpperCase();
      if (id && runtimePeople.has(id) && (sex === 'M' || sex === 'F')) {
        window.genderMap.set(id, sex);
      }
    }

    return true;
  }

  function refreshTreeFromDraft(centerId) {
    const ok = syncRuntimeMapsFromDraft();
    if (!ok) return;

    let targetId = normalizeId(centerId || state.selectedPersonId || '');
    if (!targetId || !window.peopleMap || !window.peopleMap.has(targetId)) {
      const firstVisible = window.peopleMap && window.peopleMap.size ? window.peopleMap.keys().next().value : '';
      targetId = normalizeId(firstVisible);
    }
    if (!targetId || !window.peopleMap || !window.peopleMap.has(targetId)) return;

    if (typeof window.lineageClick === 'function') {
      window.lineageClick(targetId);
      return;
    }

    const treeNode = document.querySelector(`#tree [data-n-id="${targetId}"]`);
    if (treeNode) treeNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function buildQuickRelApi() {
    const quickUndoStack = [];

    const snapshotRelations = () => {
      const out = {};
      for (const [id, rel] of state.relations.entries()) {
        out[id] = {
          fid: rel.fid || '',
          mid: rel.mid || '',
          spouses: [...rel.spouses]
        };
      }
      return out;
    };

    const restoreRelations = (snap) => {
      state.relations.clear();
      for (const [id, rel] of Object.entries(snap || {})) {
        state.relations.set(id, {
          fid: normalizeId(rel.fid || ''),
          mid: normalizeId(rel.mid || ''),
          spouses: new Set((Array.isArray(rel.spouses) ? rel.spouses : []).map(normalizeId).filter(Boolean))
        });
      }
      for (const p of state.persons) {
        ensureRelation(p.person_id);
      }
    };

    const resolvePersonRef = (raw, fieldLabel) => {
      const input = String(raw || '').trim();
      if (!input) return { ok: true, id: '' };

      const normalized = normalizeId(input);
      if (normalized && getPerson(normalized)) {
        return { ok: true, id: normalized };
      }

      const q = input.toLowerCase();
      const candidates = state.persons.map(p => {
        const fullName = `${String(p.given_name || '').trim()} ${String(p.surname || '').trim()}`.trim();
        return { id: normalizeId(p.person_id), fullName, lower: fullName.toLowerCase() };
      }).filter(p => !!p.id && !!p.fullName);

      const exact = candidates.filter(c => c.lower === q);
      if (exact.length === 1) return { ok: true, id: exact[0].id };
      if (exact.length > 1) {
        return { ok: false, message: `${fieldLabel}: multiple matches for "${input}" (${exact.slice(0, 4).map(c => c.id).join(', ')}). Use ID.` };
      }

      const starts = candidates.filter(c => c.lower.startsWith(q));
      if (starts.length === 1) return { ok: true, id: starts[0].id };
      if (starts.length > 1) {
        return { ok: false, message: `${fieldLabel}: multiple matches for "${input}" (${starts.slice(0, 4).map(c => c.id).join(', ')}). Use ID.` };
      }

      const contains = candidates.filter(c => c.lower.includes(q));
      if (contains.length === 1) return { ok: true, id: contains[0].id };
      if (contains.length > 1) {
        return { ok: false, message: `${fieldLabel}: multiple matches for "${input}" (${contains.slice(0, 4).map(c => c.id).join(', ')}). Use ID.` };
      }

      return { ok: false, message: `${fieldLabel}: person not found for "${input}".` };
    };

    const refreshDraft = (focusId, logText) => {
      markDirty(true);
      refreshTreeFromDraft(focusId);
      if (els.panel && els.panel.classList.contains('show')) {
        renderEditor();
      }
      if (logText) addLog(logText, true);
      return { ok: true };
    };

    const withUndo = (focusId, logText, mutateFn) => {
      const before = snapshotRelations();
      const res = mutateFn();
      if (res && res.ok === false) return res;
      quickUndoStack.push(before);
      if (quickUndoStack.length > 80) quickUndoStack.shift();
      return refreshDraft(focusId, logText);
    };

    return {
      get: (personId) => {
        const id = normalizeId(personId);
        if (!id || !getPerson(id)) return null;
        const rel = ensureRelation(id) || { fid: '', mid: '', spouses: new Set() };
        const childRoleMap = {};
        const children = getChildrenOf(id);
        for (const cid of children) {
          const cr = ensureRelation(cid);
          if (cr.fid === id) childRoleMap[cid] = 'father';
          else if (cr.mid === id) childRoleMap[cid] = 'mother';
        }
        return {
          id,
          parents: { fid: rel.fid || '', mid: rel.mid || '' },
          spouses: [...rel.spouses].filter(sid => !!getPerson(sid)).sort(),
          children,
          childRoles: childRoleMap
        };
      },
      resolveRef: (raw, label) => resolvePersonRef(raw, label || 'Person'),
      label: (personId) => {
        const id = normalizeId(personId);
        if (!id) return '';
        return shortPersonRef(id);
      },
      saveDraft: (personId, draft) => {
        const id = normalizeId(personId);
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        const d = draft || {};
        const parentDraft = d.parents || {};
        const fid = normalizeId(parentDraft.fid || '');
        const mid = normalizeId(parentDraft.mid || '');
        if (fid && (fid === id || !getPerson(fid))) return { ok: false, message: `Invalid father: ${fid}` };
        if (mid && (mid === id || !getPerson(mid))) return { ok: false, message: `Invalid mother: ${mid}` };

        const spouseIds = [...new Set((Array.isArray(d.spouses) ? d.spouses : []).map(normalizeId).filter(Boolean))];
        for (const sid of spouseIds) {
          if (sid === id) return { ok: false, message: 'Spouse cannot be self.' };
          if (!getPerson(sid)) return { ok: false, message: `Spouse not found: ${sid}` };
        }

        const childIds = [...new Set((Array.isArray(d.children) ? d.children : []).map(normalizeId).filter(Boolean))];
        for (const cid of childIds) {
          if (cid === id) return { ok: false, message: 'Child cannot be self.' };
          if (!getPerson(cid)) return { ok: false, message: `Child not found: ${cid}` };
        }

        return withUndo(id, `Quick edit: saved staged relationship changes for ${shortPersonRef(id)}.`, () => {
          const rel = ensureRelation(id);
          rel.fid = fid;
          rel.mid = mid;

          for (const [pid, prel] of state.relations.entries()) {
            if (pid === id) continue;
            prel.spouses.delete(id);
          }
          rel.spouses = new Set(spouseIds);
          for (const sid of spouseIds) {
            ensureRelation(sid).spouses.add(id);
          }

          for (const [cid, cr] of state.relations.entries()) {
            if (cr.fid === id) cr.fid = '';
            if (cr.mid === id) cr.mid = '';
          }
          const roles = d.childRoles || {};
          const parentPerson = getPerson(id);
          const inferred = String(parentPerson?.sex || '').toUpperCase() === 'F' ? 'mother' : 'father';
          for (const cid of childIds) {
            const cr = ensureRelation(cid);
            const role = String(roles[cid] || inferred).toLowerCase();
            if (role === 'mother') cr.mid = id;
            else cr.fid = id;
          }

          if (id === state.selectedPersonId) {
            state.spouseDraft = new Set(rel.spouses);
          }
          return { ok: true };
        });
      },
      setParents: (personId, fatherId, motherId) => {
        const id = normalizeId(personId);
        const fidRes = resolvePersonRef(fatherId, 'Father');
        if (!fidRes.ok) return { ok: false, message: fidRes.message };
        const midRes = resolvePersonRef(motherId, 'Mother');
        if (!midRes.ok) return { ok: false, message: midRes.message };
        const fid = fidRes.id;
        const mid = midRes.id;
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        if (fid && fid === id) return { ok: false, message: 'Father cannot be same as person.' };
        if (mid && mid === id) return { ok: false, message: 'Mother cannot be same as person.' };
        if (fid && !getPerson(fid)) return { ok: false, message: `Father not found: ${fid}` };
        if (mid && !getPerson(mid)) return { ok: false, message: `Mother not found: ${mid}` };
        return withUndo(id, `Quick edit: updated parents for ${shortPersonRef(id)}.`, () => {
          const rel = ensureRelation(id);
          rel.fid = fid;
          rel.mid = mid;
          return { ok: true };
        });
      },
      clearParent: (personId, parentType) => {
        const id = normalizeId(personId);
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        return withUndo(id, `Quick edit: cleared ${parentType} for ${shortPersonRef(id)}.`, () => {
          const rel = ensureRelation(id);
          if (parentType === 'father') rel.fid = '';
          if (parentType === 'mother') rel.mid = '';
          return { ok: true };
        });
      },
      addSpouse: (personId, spouseId) => {
        const id = normalizeId(personId);
        const sidRes = resolvePersonRef(spouseId, 'Spouse');
        if (!sidRes.ok) return { ok: false, message: sidRes.message };
        const sid = sidRes.id;
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        if (!sid) return { ok: false, message: 'Enter spouse ID.' };
        if (sid === id) return { ok: false, message: 'Person cannot be spouse of self.' };
        if (!getPerson(sid)) return { ok: false, message: `Spouse not found: ${sid}` };
        return withUndo(id, `Quick edit: added spouse link ${shortPersonRef(id)} <-> ${shortPersonRef(sid)}.`, () => {
          addSpouseLink(id, sid);
          if (id === state.selectedPersonId) state.spouseDraft.add(sid);
          return { ok: true, message: `Added spouse ${shortPersonRef(sid)}.` };
        });
      },
      removeSpouse: (personId, spouseId) => {
        const id = normalizeId(personId);
        const sidRes = resolvePersonRef(spouseId, 'Spouse');
        if (!sidRes.ok) return { ok: false, message: sidRes.message };
        const sid = sidRes.id;
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        if (!sid) return { ok: false, message: 'Enter spouse ID.' };
        return withUndo(id, `Quick edit: removed spouse link ${shortPersonRef(id)} <-> ${shortPersonRef(sid)}.`, () => {
          removeSpouseLink(id, sid);
          if (id === state.selectedPersonId) state.spouseDraft.delete(sid);
          return { ok: true };
        });
      },
      addChild: (personId, childId, roleRaw) => {
        const id = normalizeId(personId);
        const cidRes = resolvePersonRef(childId, 'Child');
        if (!cidRes.ok) return { ok: false, message: cidRes.message };
        const cid = cidRes.id;
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        if (!cid) return { ok: false, message: 'Enter child ID.' };
        if (cid === id) return { ok: false, message: 'Person cannot be own child.' };
        if (!getPerson(cid)) return { ok: false, message: `Child not found: ${cid}` };
        return withUndo(id, `Quick edit: linked child ${shortPersonRef(cid)} to ${shortPersonRef(id)}.`, () => {
          const parent = getPerson(id);
          const rel = ensureRelation(cid);
          const role = String(roleRaw || 'auto').toLowerCase();
          if (role === 'father') {
            rel.fid = id;
          } else if (role === 'mother') {
            rel.mid = id;
          } else {
            const sex = String(parent.sex || '').toUpperCase();
            if (sex === 'F') rel.mid = id;
            else rel.fid = id;
          }
          return { ok: true };
        });
      },
      removeChild: (personId, childId) => {
        const id = normalizeId(personId);
        const cidRes = resolvePersonRef(childId, 'Child');
        if (!cidRes.ok) return { ok: false, message: cidRes.message };
        const cid = cidRes.id;
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        if (!cid) return { ok: false, message: 'Enter child ID.' };
        return withUndo(id, `Quick edit: removed child link ${shortPersonRef(id)} -> ${shortPersonRef(cid)}.`, () => {
          const rel = ensureRelation(cid);
          let changed = false;
          if (rel.fid === id) {
            rel.fid = '';
            changed = true;
          }
          if (rel.mid === id) {
            rel.mid = '';
            changed = true;
          }
          if (!changed) return { ok: false, message: `${cid} is not linked as child of ${id}.` };
          return { ok: true };
        });
      },
      undoLast: (focusId) => {
        const id = normalizeId(focusId);
        if (!id || !getPerson(id)) return { ok: false, message: 'Selected person not found.' };
        if (!quickUndoStack.length) return { ok: false, message: 'No quick edits to undo.' };
        const snap = quickUndoStack.pop();
        restoreRelations(snap);
        if (id === state.selectedPersonId) {
          const rel = ensureRelation(id);
          state.spouseDraft = new Set(rel.spouses);
        }
        return refreshDraft(id, `Quick edit: undo for ${shortPersonRef(id)}.`);
      }
    };
  }

  function wireAdminSearchOverride() {
    const searchInput = qs('search-input');
    const suggestions = qs('search-suggestions');
    if (!searchInput || !suggestions) return;

    searchInput.addEventListener('input', function (e) {
      e.stopImmediatePropagation();

      const query = String(searchInput.value || '').trim().toLowerCase();
      suggestions.innerHTML = '';
      if (query.length < 2) {
        suggestions.style.display = 'none';
        return;
      }

      const matches = [];
      for (const p of sortedPersons()) {
        const name = `${String(p.given_name || '').trim()} ${String(p.surname || '').trim()}`.trim();
        const hay = `${name} ${p.person_id}`.toLowerCase();
        if (hay.includes(query)) matches.push(p);
        if (matches.length >= 20) break;
      }

      for (const p of matches) {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `<strong>${personLabel(p.person_id).replace(` (${p.person_id})`, '') || p.person_id}</strong><span style="font-size: 0.85em; color: #888; float: right;">${p.person_id}</span>`;
        item.addEventListener('click', function () {
          state.selectedPersonId = p.person_id;
          refreshTreeFromDraft(p.person_id);
          if (typeof window.showTreePage === 'function') window.showTreePage();
          searchInput.value = '';
          suggestions.innerHTML = '';
          suggestions.style.display = 'none';
          if (els.panel && els.panel.classList.contains('show')) renderEditor();
        });
        suggestions.appendChild(item);
      }
      suggestions.style.display = matches.length ? 'block' : 'none';
    }, true);

    document.addEventListener('click', function (e) {
      if (e.target === searchInput || searchInput.contains(e.target) || suggestions.contains(e.target)) return;
      suggestions.style.display = 'none';
    });
  }

  function bindEvents() {
    qs('nav-admin')?.addEventListener('click', function (e) {
      e.preventDefault();
      showAdminPanel();
    });

    qs('admin-launch-btn')?.addEventListener('click', showAdminPanel);
    qs('admin-close-panel')?.addEventListener('click', hideAdminPanel);
    qs('admin-panel-overlay')?.addEventListener('click', hideAdminPanel);

    qs('admin-load-person')?.addEventListener('click', function () {
      const id = normalizeId(qs('admin-person-pick').value || '');
      selectPerson(id, true);
    });

    qs('admin-open-modal-person')?.addEventListener('click', function () {
      const id = readPersonIdFromModal();
      if (!id) {
        setStatus('No active person in modal. Open person details first.', true);
        return;
      }
      selectPerson(id, true);
    });

    qs('admin-add-person')?.addEventListener('click', addNewPerson);
    qs('admin-save-person')?.addEventListener('click', savePersonChanges);
    qs('admin-is-deceased')?.addEventListener('change', function () {
      const checked = !!qs('admin-is-deceased')?.checked;
      toggleDeathDateField(checked);
    });
    qs('admin-refresh-tree')?.addEventListener('click', function () {
      refreshTreeFromDraft(state.selectedPersonId);
      setStatus('Tree refreshed from current admin draft.', false);
    });
    qs('admin-discard-changes')?.addEventListener('click', function () {
      discardDraftChanges();
    });
    qs('admin-delete-person')?.addEventListener('click', removeSelectedPerson);

    qs('admin-add-spouse')?.addEventListener('click', addSpouseFromInput);
    qs('admin-record-divorce')?.addEventListener('click', recordDivorceFromInput);
    qs('admin-add-children')?.addEventListener('click', addChildrenFromInput);

    qs('admin-clear-father')?.addEventListener('click', clearFather);
    qs('admin-clear-mother')?.addEventListener('click', clearMother);
    qs('admin-parent-father-remove')?.addEventListener('click', function () {
      clearFather();
      updateParentDisplay({ fid: '', mid: normalizeId(qs('admin-mother-id')?.value || '') });
    });
    qs('admin-parent-mother-remove')?.addEventListener('click', function () {
      clearMother();
      updateParentDisplay({ fid: normalizeId(qs('admin-father-id')?.value || ''), mid: '' });
    });

    qs('admin-export-persons')?.addEventListener('click', exportPersons);
    qs('admin-export-persons-csv')?.addEventListener('click', exportPersonsCsv);
    qs('admin-export-families')?.addEventListener('click', exportFamilies);
    qs('admin-export-families-csv')?.addEventListener('click', exportFamiliesCsv);
    qs('admin-export-contacts')?.addEventListener('click', exportContacts);
    qs('admin-export-contacts-csv')?.addEventListener('click', exportContactsCsv);
    qs('admin-export-photos')?.addEventListener('click', exportPhotos);
    qs('admin-export-photos-csv')?.addEventListener('click', exportPhotosCsv);
    qs('admin-export-schema')?.addEventListener('click', exportSchema);
    qs('admin-export-all')?.addEventListener('click', exportAll);
    qs('admin-export-all-csv')?.addEventListener('click', exportAllCsv);
    qs('admin-import-file')?.addEventListener('change', async function (e) {
      const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      if (!file) {
        state.importDraft = null;
        if (qs('admin-import-target')) qs('admin-import-target').value = '';
        if (qs('admin-import-summary')) qs('admin-import-summary').textContent = IMPORT_HELP_TEXT;
        if (qs('admin-import-preview-box')) qs('admin-import-preview-box').textContent = '';
        return;
      }
      try {
        const text = await file.text();
        const parsedResult = parseImportFile(file, text);
        state.importDraft = { filename: file.name, parsed: parsedResult.parsed, detectedType: parsedResult.detectedType, format: parsedResult.format, preview: null };
        if (qs('admin-import-target')) qs('admin-import-target').value = parsedResult.detectedType;
        if (qs('admin-import-summary')) {
          qs('admin-import-summary').textContent = parsedResult.detectedType === 'unknown'
            ? `Could not detect import type for ${file.name}.`
            : `Detected ${parsedResult.detectedType} from ${file.name} (${parsedResult.format.toUpperCase()}).`;
        }
        if (qs('admin-import-preview-box')) qs('admin-import-preview-box').textContent = '';
      } catch (err) {
        state.importDraft = null;
        if (qs('admin-import-target')) qs('admin-import-target').value = 'invalid';
        if (qs('admin-import-summary')) qs('admin-import-summary').textContent = `Invalid import file: ${err.message}`;
        if (qs('admin-import-preview-box')) qs('admin-import-preview-box').textContent = '';
      }
    });
    qs('admin-import-preview')?.addEventListener('click', function () {
      if (!state.importDraft) {
        setStatus('Select a JSON or CSV file first.', true);
        return;
      }
      const mode = String(qs('admin-import-mode')?.value || 'merge');
      const type = state.importDraft.detectedType;
      if (!type || type === 'unknown' || type === 'invalid' || type === 'schema') {
        setStatus('Unsupported import type. Use persons/families/contacts/photos JSON or CSV.', true);
        return;
      }
      const preview = previewImport(state.importDraft.parsed, type, mode);
      state.importDraft.preview = preview;
      if (qs('admin-import-summary')) qs('admin-import-summary').textContent = `Preview ready for ${type} (${mode}).`;
      if (qs('admin-import-preview-box')) qs('admin-import-preview-box').textContent = preview.text;
      setStatus('Import preview generated.', false);
    });
    qs('admin-import-apply')?.addEventListener('click', function () {
      if (!state.importDraft) {
        setStatus('Select and preview a JSON or CSV import first.', true);
        return;
      }
      const mode = String(qs('admin-import-mode')?.value || 'merge');
      const type = state.importDraft.detectedType;
      if (!type || type === 'unknown' || type === 'invalid' || type === 'schema') {
        setStatus('Unsupported import type. Use persons/families/contacts/photos JSON or CSV.', true);
        return;
      }
      const stats = applyImport(state.importDraft.parsed, type, mode);
      const changed = (stats.add + stats.update) > 0;
      if (changed) {
        markDirty(true);
        if (!state.selectedPersonId || !getPerson(state.selectedPersonId)) {
          const first = sortedPersons()[0];
          state.selectedPersonId = first ? first.person_id : '';
        }
        refreshTreeFromDraft(state.selectedPersonId);
        renderEditor();
      }
      const summary = `Applied ${type} import (${mode}): add=${stats.add}, update=${stats.update}, skip=${stats.skip}, invalid=${stats.invalid}`;
      if (qs('admin-import-summary')) qs('admin-import-summary').textContent = summary;
      if (qs('admin-import-preview-box')) qs('admin-import-preview-box').textContent = summary;
      setStatus(summary, false);
      addLog(summary, changed);
    });
    qs('admin-import-clear')?.addEventListener('click', function () {
      resetImportUi();
      setStatus('Import selection cleared.', false);
    });
    qs('admin-run-validation')?.addEventListener('click', function () {
      runValidation();
      setStatus('Validation completed.', false);
      addLog('Ran validation check.', false);
    });
    qs('admin-photo-file')?.addEventListener('change', onPhotoFileChange);
    qs('admin-photo-apply')?.addEventListener('click', applyPhotoMapping);
    qs('admin-photo-remove')?.addEventListener('click', removePhotoMapping);
    qs('admin-photo-download')?.addEventListener('click', downloadRenamedPhoto);
    qs('admin-refresh-logs')?.addEventListener('click', function () {
      renderLogs();
      setStatus('Logs refreshed.', false);
    });
    qs('admin-export-logs-csv')?.addEventListener('click', exportLogsCsv);
    qs('admin-clear-logs')?.addEventListener('click', function () {
      const ok = window.confirm('Clear all action logs?');
      if (!ok) return;
      state.actionLogs = [];
      state.logSeq = 0;
      persistLogs();
      renderLogs();
      setStatus('All action logs cleared.', false);
      addLog('Cleared action logs.', false);
    });
    qs('icon-logs')?.addEventListener('click', function () {
      showAdminPanel();
      const section = qs('admin-logs-section');
      if (section && els.panel) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      renderLogs();
    });

    qs('admin-spouse-chip-list')?.addEventListener('click', onChipClicks);
    qs('admin-children-chip-list')?.addEventListener('click', onChipClicks);
    qs('admin-custom-add')?.addEventListener('click', function () {
      const person = getSelectedPerson();
      if (!person) return;
      const key = String(qs('admin-custom-key')?.value || '').trim();
      const value = String(qs('admin-custom-value')?.value || '').trim();
      if (!key) {
        setStatus('Custom key is required.', true);
        return;
      }
      if (!value) {
        setStatus('Custom value is required.', true);
        return;
      }
      const custom = sanitizeCustomObject(person.custom || {});
      custom[key] = value;
      person.custom = custom;
      qs('admin-custom-key').value = '';
      qs('admin-custom-value').value = '';
      markDirty(true);
      renderCustomFields(person);
      refreshTreeFromDraft(person.person_id);
      setStatus(`Custom field saved: ${key}`, false);
      addLog(`Updated custom field "${key}" for ${shortPersonRef(person.person_id)}.`, true);
    });
    qs('admin-custom-clear')?.addEventListener('click', function () {
      if (qs('admin-custom-key')) qs('admin-custom-key').value = '';
      if (qs('admin-custom-value')) qs('admin-custom-value').value = '';
      setStatus('Custom field inputs cleared.', false);
    });
    qs('admin-custom-fields-list')?.addEventListener('click', function (e) {
      const person = getSelectedPerson();
      if (!person) return;
      const editBtn = e.target.closest('[data-edit-custom]');
      if (editBtn) {
        const key = String(editBtn.getAttribute('data-edit-custom') || '');
        const custom = sanitizeCustomObject(person.custom || {});
        if (qs('admin-custom-key')) qs('admin-custom-key').value = key;
        if (qs('admin-custom-value')) qs('admin-custom-value').value = custom[key] || '';
        return;
      }
      const removeBtn = e.target.closest('[data-remove-custom]');
      if (removeBtn) {
        const key = String(removeBtn.getAttribute('data-remove-custom') || '');
        const custom = sanitizeCustomObject(person.custom || {});
        if (Object.prototype.hasOwnProperty.call(custom, key)) {
          delete custom[key];
          person.custom = custom;
          markDirty(true);
          renderCustomFields(person);
          refreshTreeFromDraft(person.person_id);
          setStatus(`Removed custom field: ${key}`, false);
          addLog(`Removed custom field "${key}" for ${shortPersonRef(person.person_id)}.`, true);
        }
      }
    });

    qs('tree')?.addEventListener('click', function (e) {
      const id = findTreeClickedId(e.target);
      if (id) {
        state.selectedPersonId = id;
        if (els.panel && els.panel.classList.contains('show')) {
          renderEditor();
        }
      }
    }, true);

    window.openAdminForPerson = function (personId) {
      selectPerson(personId, true);
    };

    window.adminQuickRel = buildQuickRelApi();
  }

  function cacheElements() {
    els.panel = qs('admin-panel');
    els.overlay = qs('admin-panel-overlay');
    els.personPickerList = qs('admin-person-list');
    els.dirtyTag = qs('admin-dirty-tag');
    els.statusLine = qs('admin-status-line');
    els.childrenChipList = qs('admin-children-chip-list');
    els.spouseChipList = qs('admin-spouse-chip-list');
    els.customFieldsList = qs('admin-custom-fields-list');
    els.photoPreview = qs('admin-photo-preview');
    els.photoPath = qs('admin-photo-path');
  }

  function setIconActive(target) {
    const treeBtn = qs('icon-tree');
    const dashBtn = qs('icon-dashboard');
    if (treeBtn) treeBtn.classList.toggle('active', target === 'tree');
    if (dashBtn) dashBtn.classList.toggle('active', target === 'dashboard');
  }

  function forceTreeDefaultView() {
    let tries = 0;
    const maxTries = 40;
    const timer = setInterval(function () {
      tries += 1;
      if (typeof window.showTreePage === 'function') {
        window.showTreePage();
        setIconActive('tree');
        clearInterval(timer);
        return;
      }
      if (tries >= maxTries) clearInterval(timer);
    }, 150);
  }

  function wireViewButtonState() {
    if (typeof window.showTreePage === 'function') {
      const originalTree = window.showTreePage;
      window.showTreePage = function () {
        const result = originalTree.apply(this, arguments);
        setIconActive('tree');
        return result;
      };
    }

    if (typeof window.showDashboard === 'function') {
      const originalDash = window.showDashboard;
      window.showDashboard = function () {
        const result = originalDash.apply(this, arguments);
        setIconActive('dashboard');
        return result;
      };
    }
  }

  function init() {
    cacheElements();
    bindEvents();
    hydrateLogsFromStorage();

    loadData()
      .then(() => {
        state.selectedPersonId = state.persons.length ? state.persons[0].person_id : '';
        markDirty(false);
        syncRuntimeMapsFromDraft();
        wireAdminSearchOverride();
        wireViewButtonState();
        forceTreeDefaultView();
        runValidation();
        renderEditor();
        addLog('Admin panel loaded.', false);
      })
      .catch(err => {
        setStatus(`Failed to load admin data: ${err.message}`, true);
        console.error('[AdminPanel]', err);
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
