// background.js — MV3 service worker
// Retrieves the stored FileSystemDirectoryHandle from extension IndexedDB,
// finds files matching the student name, and returns their binary data
// to the content script via message passing.

'use strict';

// ─── Extension-origin IndexedDB ─────────────────────────────────────────────
// The popup writes here; the service worker reads from the same origin.

const IDB = {
  DB_NAME: 'MoodleFeedbackHelper',
  STORE: 'handles',

  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this.STORE);
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
  },

  async get(key) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(key);
      req.onsuccess = e => res(e.target.result ?? null);
      req.onerror = e => rej(e.target.error);
    });
  },

  async save(key, value) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(value, key);
      tx.oncomplete = res;
      tx.onerror = e => rej(e.target.error);
    });
  },
};

// ─── File matching ───────────────────────────────────────────────────────────

function fileMatchesStudent(filename, studentName) {
  // Normalise: lowercase, strip extension, collapse separators to spaces
  const file = filename.toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-,.]+/g, ' ')
    .trim();

  const parts = studentName.toLowerCase().trim().split(/\s+/);

  // Fuzzy: match if ANY significant name part (3+ chars) appears in the
  // normalised filename. Covers:
  //   Harrison Andrews.docx  → "harrison" present ✓
  //   Harrison.docx          → "harrison" present ✓
  //   Andrews.docx           → "andrews"  present ✓
  //   Andrews_Harrison.docx  → normalised to "andrews harrison", both present ✓
  //   H_Andrews.docx         → "andrews"  present ✓  (short initials ignored)
  if (parts.some(p => p.length >= 3 && file.includes(p))) return true;

  // Edge case: all name parts are very short (1–2 chars) — require ALL to match
  if (parts.every(p => file.includes(p))) return true;

  return false;
}

// ─── Template finder ─────────────────────────────────────────────────────────
// Looks for a .docx file containing 'rubric' or 'template' in its name.

async function getTemplateFile() {
  // Try the selected feedback folder first
  const handle = await IDB.get('feedbackDir');
  if (handle) {
    let perm;
    try { perm = await handle.queryPermission({ mode: 'read' }); }
    catch {}

    if (perm === 'granted') {
      try {
        for await (const [name, fHandle] of handle.entries()) {
          if (fHandle.kind !== 'file') continue;
          const lower = name.toLowerCase();
          if (!lower.endsWith('.docx')) continue;
          if (lower.includes('rubric') || lower.includes('template')) {
            const file   = await fHandle.getFile();
            const buffer = await file.arrayBuffer();
            return { buffer: Array.from(new Uint8Array(buffer)), name };
          }
        }
      } catch (err) {
        console.error('[MFH BG] Folder template read error:', err);
      }
    }
  }

  // Fall back to the bundled template — fetched here in the background so
  // the page's Content-Security-Policy cannot block the chrome-extension:// URL.
  try {
    const url  = chrome.runtime.getURL('lib/mmfj2_rubric.docx');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    return { buffer: Array.from(new Uint8Array(buffer)), name: 'mmfj2_rubric.docx' };
  } catch (err) {
    console.error('[MFH BG] Bundled template load error:', err);
    return { error: 'not_found' };
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

async function getMatchingFiles(studentName) {
  const handle = await IDB.get('feedbackDir');
  if (!handle) return { error: 'no_folder' };

  // Check permission — can only query (not request) from a service worker
  let perm;
  try {
    perm = await handle.queryPermission({ mode: 'read' });
  } catch {
    return { error: 'no_folder' };
  }

  if (perm !== 'granted') {
    // Permission lapsed (e.g. browser restart) — user must re-select in popup
    return { error: 'need_permission' };
  }

  const files = [];
  try {
    for await (const [name, fHandle] of handle.entries()) {
      if (fHandle.kind === 'file' && fileMatchesStudent(name, studentName)) {
        const file = await fHandle.getFile();
        const buffer = await file.arrayBuffer();
        files.push({ name, type: file.type || 'application/octet-stream', buffer: Array.from(new Uint8Array(buffer)) });
      }
    }
  } catch (err) {
    console.error('[FeedbackHelper] Error reading directory:', err);
    return { error: 'read_error' };
  }

  return { files };
}

// ─── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getFiles' && msg.studentName) {
    getMatchingFiles(msg.studentName).then(sendResponse);
    return true;
  }
  if (msg.action === 'getTemplate') {
    getTemplateFile().then(sendResponse);
    return true;
  }
  if (msg.action === 'saveHandle' && msg.handle) {
    IDB.save('feedbackDir', msg.handle)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.action === 'openPopup') {
    chrome.action.openPopup().catch(() => {});
    return;
  }
});
