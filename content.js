(() => {
  'use strict';

  if (document.getElementById('mfh-panel')) return;

  // ─── Marking state ─────────────────────────────────────────────────────

  const mfhMarkState = {
    cellSelections: {},   // 'tableIdx:rowIdx:cellIdx' → true
    checkboxStates: {},   // 'tableIdx:rowIdx:cellIdx:cbIdx' → boolean
    comments: '',
    grade: ''
  };

  let mfhCachedTables  = null;
  let mfhStudentName   = null;
  let mfhFolderName    = null;

  // ─── State persistence ─────────────────────────────────────────────────

  function saveMarkState() {
    if (!mfhStudentName) return;
    try {
      chrome.storage.local.set({ [`mfh_state_${mfhStudentName}`]: {
        cellSelections: mfhMarkState.cellSelections,
        checkboxStates: mfhMarkState.checkboxStates,
        comments:       mfhMarkState.comments,
        grade:          mfhMarkState.grade,
      }});
    } catch {}
  }

  const saveMarkStateDebounced = (() => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(saveMarkState, 400); };
  })();

  function loadMarkState(name) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([`mfh_state_${name}`], result => {
          if (!chrome.runtime.lastError) {
            const saved = result[`mfh_state_${name}`];
            if (saved) {
              mfhMarkState.cellSelections = saved.cellSelections ?? {};
              mfhMarkState.checkboxStates = saved.checkboxStates ?? {};
              mfhMarkState.comments       = saved.comments ?? '';
              mfhMarkState.grade          = saved.grade ?? '';
            }
          }
          resolve();
        });
      } catch { resolve(); }
    });
  }

  function clearMarkState() {
    mfhMarkState.cellSelections = {};
    mfhMarkState.checkboxStates = {};
    mfhMarkState.comments = '';
    mfhMarkState.grade = '';
    if (mfhStudentName) {
      try { chrome.storage.local.remove(`mfh_state_${mfhStudentName}`); } catch {}
    }
  }

  // ─── Student name detection ────────────────────────────────────────────

  function extractStudentName() {
    for (const h2 of document.querySelectorAll('h2')) {
      const m = h2.textContent.match(/Grading\s+for\s+(.+)/i);
      if (m) return m[1].trim();
    }
    return null;
  }

  // ─── Background messaging ──────────────────────────────────────────────

  function safeSendMessage(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response ?? null);
        });
      } catch { resolve(null); }
    });
  }

  function requestFiles(studentName) {
    return safeSendMessage({ action: 'getFiles', studentName })
      .then(r => r ?? { error: 'context_invalidated' });
  }

  // ─── Moodle drop-zone injection ────────────────────────────────────────

  function getMoodleDropZone() {
    const selectors = [
      '.assignfeedback_file .filemanager',
      '[data-region="file-upload-drop-zone"]',
      '.filemanager .fm-empty-container',
      '.filemanager .fp-content',
      '.moodle-filepicker',
      '.fp-content',
    ];
    return selectors.map(s => document.querySelector(s)).find(Boolean) ?? null;
  }

  async function injectFileIntoMoodle(file) {
    const zone = getMoodleDropZone();
    if (!zone) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    return true;
  }

  // ─── Panel UI ──────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  function setStatus(msg, type = 'info') {
    const el = $('mfh-status');
    if (el) { el.textContent = msg; el.dataset.type = type; }
  }

  function fileIcon(name) {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    return {
      pdf: '📄', doc: '📝', docx: '📝', odt: '📝',
      txt: '📃', rtf: '📃',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
      mp3: '🎵', m4a: '🎵', wav: '🎵',
      mp4: '🎬', mov: '🎬',
      zip: '📦',
    }[ext] ?? '📎';
  }

  function renderFiles(files) {
    const list = $('mfh-file-list');
    if (!list) return;
    list.innerHTML = '';

    if (!files.length) {
      list.innerHTML = '<div class="mfh-empty">No matching files found</div>';
      return;
    }

    files.forEach(({ name, type, buffer }) => {
      const file = new File([new Uint8Array(buffer)], name, { type });

      const row = document.createElement('div');
      row.className = 'mfh-file';
      row.draggable = true;
      row.title = 'Drag onto Moodle upload area, or click Upload →';
      row.innerHTML = `
        <span class="mfh-file-icon">${fileIcon(name)}</span>
        <span class="mfh-file-name" title="${name}">${name}</span>
        <button class="mfh-inject-btn" title="Send to upload area">Upload →</button>
      `;

      row.addEventListener('dragstart', e => {
        e.dataTransfer.items.add(file);
        e.dataTransfer.effectAllowed = 'copy';
        row.classList.add('mfh-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('mfh-dragging'));

      row.querySelector('.mfh-inject-btn').addEventListener('click', async e => {
        e.stopPropagation();
        setStatus('Sending to upload area…');
        const ok = await injectFileIntoMoodle(file);
        setStatus(
          ok ? '✓ File sent to upload area' : '✗ Drop zone not found — try dragging',
          ok ? 'ok' : 'warn'
        );
      });

      list.appendChild(row);
    });
  }

  async function refresh() {
    const studentName = extractStudentName();
    if (!studentName) { setStatus('No student name detected', 'warn'); return; }

    $('mfh-student').textContent = studentName;
    setStatus('Searching…');

    const result = await requestFiles(studentName);

    if (result.error === 'context_invalidated') {
      setStatus('Extension reloaded — please reload this page', 'warn');
      return;
    }
    if (result.error === 'no_folder') {
      setStatus('No folder selected — click 📁 to select', 'warn');
      return;
    }
    if (result.error === 'need_permission') {
      const label = mfhFolderName ? `"${mfhFolderName}" ` : '';
      setStatus(`${label}access expired — reselect folder`, 'warn');
      const list = $('mfh-file-list');
      if (list) {
        list.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'mfh-reselect-btn';
        btn.textContent = '📁 Reselect folder';
        btn.addEventListener('click', openFolderPicker);
        list.appendChild(btn);
      }
      return;
    }
    if (result.error) {
      setStatus(`Error: ${result.error}`, 'error');
      return;
    }

    renderFiles(result.files);
    const n = result.files.length;
    setStatus(n ? `${n} file${n > 1 ? 's' : ''} found` : 'No matching files', n ? 'ok' : 'warn');
  }

  // ─── Folder selection ──────────────────────────────────────────────────
  // File reading is done by the background service worker using a handle
  // saved by popup.js. The background and popup share the same extension
  // origin so queryPermission() returns 'granted' there. Content scripts
  // run in the page origin and cannot reliably read files on macOS/Edge.

  function setFolderDisplay(name) {
    const el = $('mfh-folder-name');
    if (el) el.textContent = name || 'No folder selected';
  }

  async function openFolderPicker() {
    const btn = $('mfh-folder-btn');
    if (btn) btn.disabled = true;
    setStatus('Opening folder picker…');
    try {
      await safeSendMessage({ action: 'openPopup' });
      setStatus('Select folder in the popup that just opened', 'info');
    } catch {
      setStatus('Click the extension icon 📎 in the toolbar to select a folder', 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─── Panel builder ─────────────────────────────────────────────────────

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'mfh-panel';
    panel.innerHTML = `
      <div id="mfh-header">
        <span class="mfh-title">📎 Feedback Helper</span>
        <div class="mfh-tabs">
          <button class="mfh-tab active" data-tab="files">Files</button>
          <button class="mfh-tab" data-tab="mark">Mark</button>
        </div>
        <button id="mfh-collapse" title="Collapse">−</button>
      </div>
      <div id="mfh-body">
        <div id="mfh-files-tab">
          <div id="mfh-student-row">
            <span class="mfh-label">Student</span>
            <span id="mfh-student">—</span>
          </div>
          <div id="mfh-folder-row">
            <span class="mfh-label">Folder</span>
            <span id="mfh-folder-name" class="mfh-folder-name-display">No folder selected</span>
            <button id="mfh-folder-btn" title="Select feedback folder">📁</button>
          </div>
          <div id="mfh-file-list"></div>
          <div id="mfh-toolbar">
            <button id="mfh-refresh-btn" title="Refresh file list">↺ Refresh</button>
          </div>
          <div id="mfh-status"></div>
        </div>
        <div id="mfh-mark-tab" style="display:none">
          <button id="mfh-mark-open-btn">Open Marking Form</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelectorAll('.mfh-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.mfh-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $('mfh-files-tab').style.display = tab === 'files' ? '' : 'none';
        $('mfh-mark-tab').style.display  = tab === 'mark'  ? '' : 'none';
      });
    });

    let collapsed = false;
    $('mfh-collapse').addEventListener('click', () => {
      collapsed = !collapsed;
      $('mfh-body').style.display = collapsed ? 'none' : '';
      $('mfh-collapse').textContent = collapsed ? '+' : '−';
    });

    $('mfh-refresh-btn').addEventListener('click', refresh);
    $('mfh-folder-btn').addEventListener('click', openFolderPicker);
    $('mfh-mark-open-btn').addEventListener('click', () => buildMarkingModal());

    makeDraggable(panel, $('mfh-header'));
  }

  function makeDraggable(panel, handle) {
    let ox = 0, oy = 0, startX = 0, startY = 0;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', e => {
      if (e.target.closest('.mfh-tabs') || e.target.id === 'mfh-collapse') return;
      startX = e.clientX; startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      handle.style.cursor = 'grabbing';

      const move = ev => {
        panel.style.left   = `${ox + ev.clientX - startX}px`;
        panel.style.top    = `${oy + ev.clientY - startY}px`;
        panel.style.right  = 'auto';
        panel.style.bottom = 'auto';
      };
      const up = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ─── Template table loading ────────────────────────────────────────────

  const W   = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

  // Returns [{label, initialChecked}] for every checkbox in the cell (may be empty).
  // Handles modern SDT checkboxes and legacy FORMCHECKBOX fldChar fields.
  // A single merged cell can contain multiple checkboxes.
  function extractCellCheckboxes(cell) {
    // Modern SDT content-control checkboxes
    const sdtCbs = [];
    for (const sdt of cell.getElementsByTagNameNS('*', 'sdt')) {
      const sdtPr = sdt.getElementsByTagNameNS('*', 'sdtPr')[0];
      if (!sdtPr) continue;
      const cbEl = sdtPr.getElementsByTagNameNS(W14, 'checkbox')[0];
      if (!cbEl) continue;
      const checkedEl     = cbEl.getElementsByTagNameNS(W14, 'checked')[0];
      const initialChecked = (checkedEl?.getAttributeNS(W14, 'val') ?? '0') === '1';
      const content = sdt.getElementsByTagNameNS('*', 'sdtContent')[0];
      let label = '';
      if (content) {
        for (const t of content.getElementsByTagNameNS('*', 't')) {
          if (!'☐☑☒'.includes(t.textContent.trim())) label += t.textContent;
        }
      }
      sdtCbs.push({ label: label.trim(), initialChecked });
    }
    if (sdtCbs.length > 0) return sdtCbs;

    // Legacy FORMCHECKBOX fields — walk runs in order so we can collect labels
    const legacyCbs = [];
    const runs = Array.from(cell.getElementsByTagNameNS(W, 'r'));
    let i = 0;
    while (i < runs.length) {
      const fldChar = runs[i].getElementsByTagNameNS(W, 'fldChar')[0];
      if (fldChar && fldChar.getAttributeNS(W, 'fldCharType') === 'begin') {
        const ffData = fldChar.getElementsByTagNameNS(W, 'ffData')[0];
        const cbBox  = ffData?.getElementsByTagNameNS(W, 'checkBox')[0];
        if (cbBox) {
          const defEl = cbBox.getElementsByTagNameNS(W, 'default')[0];
          const chkEl = cbBox.getElementsByTagNameNS(W, 'checked')[0];
          const initialChecked = chkEl
            ? chkEl.getAttributeNS(W, 'val') !== '0'
            : defEl?.getAttributeNS(W, 'val') === '1';
          // Skip to fldChar(end)
          i++;
          while (i < runs.length) {
            const fc = runs[i].getElementsByTagNameNS(W, 'fldChar')[0];
            if (fc && fc.getAttributeNS(W, 'fldCharType') === 'end') { i++; break; }
            i++;
          }
          // Collect label text until the next checkbox begin
          let label = '';
          while (i < runs.length) {
            const nextFc = runs[i].getElementsByTagNameNS(W, 'fldChar')[0];
            if (nextFc && nextFc.getAttributeNS(W, 'fldCharType') === 'begin') break;
            for (const t of runs[i].getElementsByTagNameNS(W, 't')) label += t.textContent;
            i++;
          }
          legacyCbs.push({ label: label.trim(), initialChecked });
          continue;
        }
      }
      i++;
    }
    return legacyCbs;
  }

  async function loadTemplateBuffer() {
    const result = await safeSendMessage({ action: 'getTemplate' });
    if (Array.isArray(result?.buffer)) return new Uint8Array(result.buffer);
    throw new Error('Template unavailable — select a feedback folder containing a rubric .docx');
  }

  async function loadTemplateTables() {
    if (mfhCachedTables) return mfhCachedTables;

    const buffer = await loadTemplateBuffer();
    const zip    = await JSZip.loadAsync(buffer);
    const xmlStr = await zip.file('word/document.xml').async('string');
    const dom    = new DOMParser().parseFromString(xmlStr, 'application/xml');

    const tables = Array.from(dom.getElementsByTagNameNS('*', 'tbl'));

    mfhCachedTables = tables.map(tbl => {
      const rows = Array.from(tbl.getElementsByTagNameNS('*', 'tr'))
        .filter(row => row.parentNode === tbl);
      return rows.map(row => {
        const cells = Array.from(row.getElementsByTagNameNS('*', 'tc'))
          .filter(tc => tc.parentNode === row);
        return cells.map(cell => {
          const gridSpan = cell.getElementsByTagNameNS('*', 'gridSpan')[0];
          const colspan  = gridSpan
            ? parseInt(gridSpan.getAttributeNS(W, 'val') || '1', 10)
            : 1;
          const checkboxes = extractCellCheckboxes(cell);
          const text = checkboxes.length > 0
            ? ''
            : Array.from(cell.getElementsByTagNameNS('*', 't')).map(t => t.textContent).join('').trim();
          return { text, colspan, checkboxes };
        });
      });
    });

    return mfhCachedTables;
  }

  // ─── Marking modal ─────────────────────────────────────────────────────

  function buildMarkingModal() {
    const existing = document.getElementById('mfh-modal-overlay');
    if (existing) { existing.style.display = ''; return; }

    const studentName = extractStudentName() ?? '(unknown student)';

    const overlay = document.createElement('div');
    overlay.id = 'mfh-modal-overlay';
    overlay.innerHTML = `
      <div class="mfh-modal-content" id="mfh-modal-box">
        <div class="mfh-modal-header">
          <span>📝 Marking Form — ${studentName}</span>
          <button class="mfh-modal-close" id="mfh-modal-close-btn">✕ Close</button>
        </div>
        <div id="mfh-modal-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    renderModalBody();

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });
    document.getElementById('mfh-modal-close-btn').addEventListener('click', closeModal);
  }

  function closeModal() {
    const overlay = document.getElementById('mfh-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function renderModalBody() {
    const body = document.getElementById('mfh-modal-body');
    if (!body) return;
    body.innerHTML = '';

    body.appendChild(buildMoodleGradeBox());

    const tablesWrap = document.createElement('div');
    tablesWrap.id = 'mfh-tables-wrap';
    tablesWrap.innerHTML = '<p class="mfh-loading">Loading rubric…</p>';
    body.appendChild(tablesWrap);

    loadTemplateTables()
      .then(tables => {
        tablesWrap.innerHTML = '';
        if (!tables.length) {
          tablesWrap.innerHTML = '<p class="mfh-loading">No tables found in template.</p>';
          return;
        }
        tables.forEach((rows, tblIdx) => {
          tablesWrap.appendChild(buildRubricTable(tblIdx, rows));
        });
      })
      .catch(err => {
        tablesWrap.innerHTML = `<p class="mfh-loading mfh-loading--error">Could not load template: ${err.message}</p>`;
      });

    const commentsDiv = document.createElement('div');
    commentsDiv.className = 'mfh-comments-section';
    commentsDiv.innerHTML = '<label class="mfh-comments-label" for="mfh-overall-comments">Overall comments</label>';
    const commentsTA = document.createElement('textarea');
    commentsTA.id = 'mfh-overall-comments';
    commentsTA.className = 'mfh-overall-comments';
    commentsTA.value = mfhMarkState.comments;
    commentsTA.addEventListener('input', () => { mfhMarkState.comments = commentsTA.value; saveMarkStateDebounced(); });
    commentsDiv.appendChild(commentsTA);
    body.appendChild(commentsDiv);

    const actionRow = document.createElement('div');
    actionRow.className = 'mfh-action-row';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'mfh-upload-btn';
    uploadBtn.textContent = 'Generate & Upload';
    uploadBtn.addEventListener('click', generateAndUpload);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'mfh-clear-btn';
    clearBtn.textContent = 'Clear form';
    clearBtn.addEventListener('click', () => {
      clearMarkState();
      syncGradeToMoodle('');
      renderModalBody();
    });

    actionRow.appendChild(uploadBtn);
    actionRow.appendChild(clearBtn);
    body.appendChild(actionRow);
  }

  function buildRubricTable(tblIdx, rows) {
    const wrap = document.createElement('div');
    wrap.className = 'mfh-rubric-table-wrap';

    const table = document.createElement('table');
    table.className = 'mfh-rubric-table';

    rows.forEach((cells, rowIdx) => {
      const tr = document.createElement('tr');
      cells.forEach(({ text, colspan, checkboxes }, cellIdx) => {
        const td = document.createElement('td');
        if (colspan > 1) td.colSpan = colspan;

        if (checkboxes && checkboxes.length > 0) {
          td.className = 'mfh-rubric-cell mfh-rubric-cell--checkbox';
          checkboxes.forEach(({ label, initialChecked }, cbIdx) => {
            const cbKey = `${tblIdx}:${rowIdx}:${cellIdx}:${cbIdx}`;
            const checkLabel = document.createElement('label');
            checkLabel.className = 'mfh-rubric-checkbox-label';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'mfh-rubric-checkbox';
            cb.checked = mfhMarkState.checkboxStates[cbKey] ?? initialChecked;
            cb.addEventListener('change', () => { mfhMarkState.checkboxStates[cbKey] = cb.checked; saveMarkState(); });
            checkLabel.appendChild(cb);
            if (label) {
              const span = document.createElement('span');
              span.textContent = label;
              checkLabel.appendChild(span);
            }
            td.appendChild(checkLabel);
          });
        } else {
          const key = `${tblIdx}:${rowIdx}:${cellIdx}`;
          td.className = 'mfh-rubric-cell';
          td.textContent = text;
          if (mfhMarkState.cellSelections[key]) td.classList.add('selected');
          td.addEventListener('click', () => {
            if (mfhMarkState.cellSelections[key]) {
              delete mfhMarkState.cellSelections[key];
              td.classList.remove('selected');
            } else {
              mfhMarkState.cellSelections[key] = true;
              td.classList.add('selected');
            }
            saveMarkState();
          });
        }

        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    wrap.appendChild(table);
    return wrap;
  }

  // ─── Grade sync ────────────────────────────────────────────────────────

  function syncGradeToMoodle(value) {
    const moodleSelect = document.getElementById('feedback_grade');
    if (!moodleSelect) return;
    moodleSelect.value = value;
    moodleSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function buildMoodleGradeBox() {
    const wrapper = document.createElement('div');
    wrapper.className = 'mfh-grade-box';

    const label = document.createElement('label');
    label.className = 'mfh-grade-box-label';
    label.htmlFor = 'mfh-grade-input';
    label.textContent = 'Grade';
    wrapper.appendChild(label);

    const moodleSelect = document.getElementById('feedback_grade');

    if (moodleSelect && moodleSelect.options.length > 0) {
      const sel = document.createElement('select');
      sel.id = 'mfh-grade-input';
      sel.className = 'mfh-grade-select';

      Array.from(moodleSelect.options).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.textContent;
        sel.appendChild(o);
      });

      sel.value = mfhMarkState.grade || moodleSelect.value || '';
      sel.addEventListener('change', () => {
        mfhMarkState.grade = sel.value;
        syncGradeToMoodle(sel.value);
        saveMarkState();
      });

      wrapper.appendChild(sel);
    } else {
      const input = document.createElement('input');
      input.type = 'number';
      input.id = 'mfh-grade-input';
      input.className = 'mfh-grade-select';
      input.min = '0';
      input.max = '100';
      input.placeholder = '0–100';
      input.value = mfhMarkState.grade;
      input.addEventListener('input', () => {
        mfhMarkState.grade = input.value;
        syncGradeToMoodle(input.value);
        saveMarkStateDebounced();
      });
      wrapper.appendChild(input);
    }

    return wrapper;
  }

  // ─── DOCX generation ───────────────────────────────────────────────────

  async function buildFeedbackDocx(studentName) {
    const buffer   = await loadTemplateBuffer();
    const zip      = await JSZip.loadAsync(buffer);
    const xmlStr   = await zip.file('word/document.xml').async('string');
    const dom      = new DOMParser().parseFromString(xmlStr, 'application/xml');

    replaceInNodes(dom, '[NAME]',     studentName);
    replaceInNodes(dom, '[Comments]', mfhMarkState.comments);
    applyCellHighlights(dom);
    applyCheckboxStates(dom);

    const updatedXml = new XMLSerializer().serializeToString(dom);
    zip.file('word/document.xml', updatedXml);
    const blob = await zip.generateAsync({ type: 'blob' });
    const safeName = studentName.replace(/[\\/:*?"<>|]/g, '_');
    return new File(
      [blob],
      `${safeName}_assignsubmission_file_Feedback.docx`,
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    );
  }

  function replaceInNodes(dom, placeholder, replacement) {
    const paragraphs = dom.getElementsByTagNameNS('*', 'p');
    for (const para of paragraphs) {
      const nodes    = para.getElementsByTagNameNS('*', 't');
      const combined = Array.from(nodes).map(n => n.textContent).join('');
      if (!combined.includes(placeholder)) continue;
      const replaced = combined.replace(placeholder, replacement);
      if (nodes.length > 0) {
        nodes[0].textContent = replaced;
        for (let i = 1; i < nodes.length; i++) nodes[i].textContent = '';
      }
    }
  }

  function applyCellHighlights(dom) {
    const tables = Array.from(dom.getElementsByTagNameNS('*', 'tbl'));

    for (const [key, selected] of Object.entries(mfhMarkState.cellSelections)) {
      if (!selected) continue;
      const [tblIdx, rowIdx, cellIdx] = key.split(':').map(Number);
      if (tblIdx >= tables.length) continue;

      const tbl   = tables[tblIdx];
      const rows  = Array.from(tbl.getElementsByTagNameNS('*', 'tr')).filter(r => r.parentNode === tbl);
      if (rowIdx >= rows.length) continue;

      const cells = Array.from(rows[rowIdx].getElementsByTagNameNS('*', 'tc')).filter(c => c.parentNode === rows[rowIdx]);
      if (cellIdx >= cells.length) continue;

      setCellShading(cells[cellIdx], 'FFFF00');
    }
  }

  function applyCheckboxStates(dom) {
    const tables = Array.from(dom.getElementsByTagNameNS('*', 'tbl'));

    for (const [key, checked] of Object.entries(mfhMarkState.checkboxStates)) {
      const [tblIdx, rowIdx, cellIdx, cbIdx] = key.split(':').map(Number);
      if (tblIdx >= tables.length) continue;
      const tbl   = tables[tblIdx];
      const rows  = Array.from(tbl.getElementsByTagNameNS('*', 'tr')).filter(r => r.parentNode === tbl);
      if (rowIdx >= rows.length) continue;
      const cells = Array.from(rows[rowIdx].getElementsByTagNameNS('*', 'tc')).filter(c => c.parentNode === rows[rowIdx]);
      if (cellIdx >= cells.length) continue;
      setCheckboxState(cells[cellIdx], cbIdx ?? 0, checked);
    }
  }

  // Sets the state of the Nth checkbox (cbIdx) within a cell.
  function setCheckboxState(cell, cbIdx, checked) {
    // Modern SDT checkboxes — target by index
    const sdts = Array.from(cell.getElementsByTagNameNS('*', 'sdt')).filter(sdt => {
      const sdtPr = sdt.getElementsByTagNameNS('*', 'sdtPr')[0];
      return sdtPr?.getElementsByTagNameNS(W14, 'checkbox')[0];
    });
    if (sdts.length > 0) {
      const sdt    = sdts[cbIdx] ?? sdts[0];
      const sdtPr  = sdt.getElementsByTagNameNS('*', 'sdtPr')[0];
      const cbEl   = sdtPr.getElementsByTagNameNS(W14, 'checkbox')[0];
      const chkEl  = cbEl.getElementsByTagNameNS(W14, 'checked')[0];
      if (chkEl) chkEl.setAttributeNS(W14, 'w14:val', checked ? '1' : '0');
      const content = sdt.getElementsByTagNameNS('*', 'sdtContent')[0];
      if (content) {
        for (const t of content.getElementsByTagNameNS('*', 't')) {
          if ('☐☑☒'.includes(t.textContent)) t.textContent = checked ? '☑' : '☐';
        }
      }
      return;
    }

    // Legacy FORMCHECKBOX — find the Nth one
    let cbCount = 0;
    for (const fldChar of cell.getElementsByTagNameNS(W, 'fldChar')) {
      if (fldChar.getAttributeNS(W, 'fldCharType') !== 'begin') continue;
      const ffData = fldChar.getElementsByTagNameNS(W, 'ffData')[0];
      if (!ffData) continue;
      const cbBox = ffData.getElementsByTagNameNS(W, 'checkBox')[0];
      if (!cbBox) continue;
      if (cbCount === cbIdx) {
        let defEl = cbBox.getElementsByTagNameNS(W, 'default')[0];
        if (!defEl) {
          defEl = cell.ownerDocument.createElementNS(W, 'w:default');
          cbBox.appendChild(defEl);
        }
        defEl.setAttributeNS(W, 'w:val', checked ? '1' : '0');
        cbBox.getElementsByTagNameNS(W, 'checked')[0]?.remove();
        return;
      }
      cbCount++;
    }
  }

  function setCellShading(tc, fill) {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    let tcPr = tc.getElementsByTagNameNS(W, 'tcPr')[0];
    if (!tcPr) {
      tcPr = tc.ownerDocument.createElementNS(W, 'w:tcPr');
      tc.insertBefore(tcPr, tc.firstChild);
    }
    let shd = tcPr.getElementsByTagNameNS(W, 'shd')[0];
    if (!shd) {
      shd = tc.ownerDocument.createElementNS(W, 'w:shd');
      tcPr.appendChild(shd);
    }
    shd.setAttributeNS(W, 'w:val',   'clear');
    shd.setAttributeNS(W, 'w:color', 'auto');
    shd.setAttributeNS(W, 'w:fill',  fill);
  }

  // ─── Generate & Upload ─────────────────────────────────────────────────

  async function generateAndUpload() {
    const studentName = extractStudentName() ?? 'Student';
    setStatus('Building feedback document…');

    let file;
    try {
      file = await buildFeedbackDocx(studentName);
    } catch (err) {
      setStatus(`✗ DOCX error: ${err.message}`, 'error');
      return;
    }

    const ok = await injectFileIntoMoodle(file);
    if (ok) {
      setStatus('✓ Feedback document uploaded', 'ok');
      closeModal();
    } else {
      setStatus('✗ Drop zone not found — try dragging', 'warn');
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }
  }

  // ─── Message listener ──────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'refresh') {
      try {
        chrome.storage.local.get(['folderName'], result => {
          if (!chrome.runtime.lastError && result?.folderName) {
            mfhFolderName = result.folderName;
            setFolderDisplay(result.folderName);
          }
        });
      } catch {}
      refresh();
      return;
    }
    if (msg.action === 'getStudentName') {
      sendResponse({ name: extractStudentName() });
      return true;
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────

  async function init() {
    mfhStudentName = extractStudentName();
    if (!mfhStudentName) return;

    await loadMarkState(mfhStudentName);

    buildPanel();

    try {
      chrome.storage.local.get(['folderName'], result => {
        if (!chrome.runtime.lastError && result?.folderName) {
          mfhFolderName = result.folderName;
          setFolderDisplay(result.folderName);
        }
      });
    } catch {}

    await refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
