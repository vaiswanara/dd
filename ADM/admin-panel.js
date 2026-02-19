(function () {
  const ACTION_LOGS_STORAGE_KEY = 'adminActionLogs_v1';
  const ACTION_LOG_SEQ_STORAGE_KEY = 'adminActionLogSeq_v1';

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
    loaded: false,
    dirty: false,
    lastValidation: [],
    actionLogs: [],
    logSeq: 0
  };

  const els = {};
  const IS_ADM_PAGE = window.location.pathname.replace(/\\/g, '/').toLowerCase().includes('/adm/');
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
    return name ? `${name} (${p.person_id})` : p.person_id;
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

  function exportLogsCsv() {
    const rows = [['Timestamp', 'Status', 'Message']];
    for (const log of state.actionLogs) {
      rows.push([log.time, log.status === 'unsaved' ? 'Unsaved' : 'Saved', log.message]);
    }

    const csv = rows.map(cols => cols.map(toCsvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'admin-action-logs.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
      'admin-birth-place-id',
      'admin-phone',
      'admin-email',
      'admin-note',
      'admin-father-id',
      'admin-mother-id',
      'admin-spouse-id',
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
    state.pendingPhotoFile = null;
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

  function updatePhotoPreview() {
    const person = getSelectedPerson();
    if (!person) return;

    const mappedPath = photoPathForPerson(person.person_id);
    if (els.photoPath) els.photoPath.textContent = mappedPath || '-';

    if (!els.photoPreview) return;

    if (state.pendingPhotoUrl) {
      els.photoPreview.src = state.pendingPhotoUrl;
      els.photoPreview.classList.add('show');
      return;
    }

    if (mappedPath) {
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

    qs('admin-person-id').value = person.person_id || '';
    qs('admin-given-name').value = person.given_name || '';
    qs('admin-surname').value = person.surname || '';
    qs('admin-sex').value = person.sex || 'M';
    qs('admin-birth-date').value = person.birth_date || '';
    qs('admin-birth-place-id').value = person.birth_place_id || '';
    qs('admin-phone').value = contact.phone || '';
    qs('admin-email').value = contact.email || '';
    qs('admin-note').value = contact.note || '';
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
    updatePhotoPreview();
    renderRelationshipChips(person.person_id);
    setStatus(`Editing ${personLabel(person.person_id)}`, false);
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
    const birthPlaceId = normalizeId(qs('admin-birth-place-id').value || '');

    const fatherId = normalizeId(qs('admin-father-id').value || '');
    const motherId = normalizeId(qs('admin-mother-id').value || '');

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
    person.birth_place_id = birthPlaceId;

    const rel = ensureRelation(personId);
    rel.fid = fatherId;
    rel.mid = motherId;

    rel.spouses = new Set([...state.spouseDraft].filter(spouseId => spouseId !== personId && !!getPerson(spouseId)));
    for (const sid of rel.spouses) {
      ensureRelation(sid).spouses.add(personId);
    }

    const phone = String(qs('admin-phone').value || '').trim();
    const email = String(qs('admin-email').value || '').trim();
    const note = String(qs('admin-note').value || '').trim();

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
      birth_place_id: ''
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
    const deletedRef = shortPersonRef(id);
    const ok = window.confirm(`Delete person ${id}? This removes record and all linked relationships.`);
    if (!ok) return;

    state.persons = state.persons.filter(p => p.person_id !== id);
    state.contacts = state.contacts.filter(c => c.person_id !== id);
    state.relations.delete(id);

    for (const rel of state.relations.values()) {
      if (rel.fid === id) rel.fid = '';
      if (rel.mid === id) rel.mid = '';
      rel.spouses.delete(id);
    }

    state.selectedPersonId = state.persons.length ? state.persons[0].person_id : '';
    markDirty(true);
    refreshTreeFromDraft(state.selectedPersonId);
    renderEditor();
    setStatus(`Deleted ${id} and cleaned linked relationships.`, false);
    addLog(`Deleted person ${deletedRef} and cleaned linked relationships.`, true);
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
    qs('admin-spouse-id').value = '';
    markDirty(true);
    refreshTreeFromDraft(person.person_id);
    renderRelationshipChips(person.person_id);
    setStatus(`Added spouse relation: ${person.person_id} <-> ${spouseId}`, false);
    addLog(`Added spouse link ${shortPersonRef(person.person_id)} <-> ${shortPersonRef(spouseId)}.`, true);
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

  function onPhotoFileChange(e) {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    state.pendingPhotoFile = file;
    if (state.pendingPhotoUrl) {
      URL.revokeObjectURL(state.pendingPhotoUrl);
      state.pendingPhotoUrl = '';
    }
    if (file) {
      state.pendingPhotoUrl = URL.createObjectURL(file);
      setStatus(`Selected photo: ${file.name}`, false);
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
        birth_place_id: normalizeId(p.birth_place_id || '')
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

  function exportPersons() {
    if (!validateBeforeExport()) return;
    downloadJson('persons.json', sanitizePersons());
    setStatus('Downloaded persons.json', false);
    addLog('Downloaded persons.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after persons.json export.');
  }

  function exportFamilies() {
    if (!validateBeforeExport()) return;
    downloadJson('families.json', generateFamiliesFromRelations());
    setStatus('Downloaded families.json', false);
    addLog('Downloaded families.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after families.json export.');
  }

  function exportContacts() {
    if (!validateBeforeExport()) return;
    downloadJson('contacts.json', sanitizeContacts());
    setStatus('Downloaded contacts.json', false);
    addLog('Downloaded contacts.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after contacts.json export.');
  }

  function exportPhotos() {
    if (!validateBeforeExport()) return;
    downloadJson('photos.json', sanitizePhotos());
    setStatus('Downloaded photos.json', false);
    addLog('Downloaded photos.json.', false);
    markUnsavedLogsAsSaved('Marked unsaved actions as saved after photos.json export.');
  }

  function exportAll() {
    exportPersons();
    exportFamilies();
    exportContacts();
    exportPhotos();
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

    for (const p of state.persons) {
      const id = normalizeId(p.person_id);
      if (!id) {
        issues.push({ level: 'error', message: 'Person with empty person_id found.' });
        continue;
      }
      if (peopleIds.has(id)) dupIds.add(id);
      peopleIds.add(id);
      if (!/^I\d+$/i.test(id)) {
        issues.push({ level: 'warn', message: `Non-standard person ID format: ${id}` });
      }
    }

    for (const id of dupIds) {
      issues.push({ level: 'error', message: `Duplicate person_id detected: ${id}` });
    }

    for (const [id, rel] of state.relations.entries()) {
      if (!peopleIds.has(id)) continue;

      if (rel.fid) {
        if (!peopleIds.has(rel.fid)) issues.push({ level: 'error', message: `${id} has missing father: ${rel.fid}` });
        if (rel.fid === id) issues.push({ level: 'error', message: `${id} is linked as own father.` });
      }
      if (rel.mid) {
        if (!peopleIds.has(rel.mid)) issues.push({ level: 'error', message: `${id} has missing mother: ${rel.mid}` });
        if (rel.mid === id) issues.push({ level: 'error', message: `${id} is linked as own mother.` });
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
      const rel = ensureRelation(id) || { fid: '', mid: '', spouses: new Set() };
      const c = contactsById.get(id) || {};
      const fullName = `${String(p.given_name || '').trim()} ${String(p.surname || '').trim()}`.trim() || id;
      const placeObj = state.places && p.birth_place_id ? state.places[p.birth_place_id] : null;
      const place = placeObj && placeObj.place ? placeObj.place : '';

      out.set(id, {
        id,
        name: fullName,
        fid: rel.fid || '',
        mid: rel.mid || '',
        pids: [...rel.spouses].filter(pid => !!getPerson(pid)).sort(),
        Birth: String(p.birth_date || '').trim(),
        Death: '',
        Address: place,
        email: String(c.email || '').trim(),
        phone: String(c.phone || '').trim(),
        note: String(c.note || '').trim(),
        image_url: String(state.photos[id] || '').trim()
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
      if (id && (sex === 'M' || sex === 'F')) {
        window.genderMap.set(id, sex);
      }
    }

    return true;
  }

  function refreshTreeFromDraft(centerId) {
    const ok = syncRuntimeMapsFromDraft();
    if (!ok) return;

    const targetId = normalizeId(centerId || state.selectedPersonId || '');
    if (!targetId || !getPerson(targetId)) return;

    if (typeof window.lineageClick === 'function') {
      window.lineageClick(targetId);
      return;
    }

    const treeNode = document.querySelector(`#tree [data-n-id="${targetId}"]`);
    if (treeNode) treeNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    qs('admin-refresh-tree')?.addEventListener('click', function () {
      refreshTreeFromDraft(state.selectedPersonId);
      setStatus('Tree refreshed from current admin draft.', false);
    });
    qs('admin-delete-person')?.addEventListener('click', removeSelectedPerson);

    qs('admin-add-spouse')?.addEventListener('click', addSpouseFromInput);
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
    qs('admin-export-families')?.addEventListener('click', exportFamilies);
    qs('admin-export-contacts')?.addEventListener('click', exportContacts);
    qs('admin-export-photos')?.addEventListener('click', exportPhotos);
    qs('admin-export-all')?.addEventListener('click', exportAll);
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
  }

  function cacheElements() {
    els.panel = qs('admin-panel');
    els.overlay = qs('admin-panel-overlay');
    els.personPickerList = qs('admin-person-list');
    els.dirtyTag = qs('admin-dirty-tag');
    els.statusLine = qs('admin-status-line');
    els.childrenChipList = qs('admin-children-chip-list');
    els.spouseChipList = qs('admin-spouse-chip-list');
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
