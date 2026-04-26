// popup.js
// The popup page is a real browsing context — a button click counts as a
// user gesture, so showDirectoryPicker() works here directly with no tricks.
// The handle goes into the extension-origin IndexedDB, which background.js
// already reads from. We then ping the content script to refresh its panel.

'use strict';

// ─── Extension-origin IndexedDB (shared with background.js) ─────────────────

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

// ─── UI helpers ──────────────────────────────────────────────────────────────

const btn      = document.getElementById('select-btn');
const statusEl = document.getElementById('status-msg');
const folderEl = document.getElementById('folder-display');

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// Restore saved folder name on popup open
chrome.storage.local.get(['folderName'], result => {
  if (result.folderName) {
    folderEl.textContent = `📁 ${result.folderName}`;
  }
});

// Query the active tab's content script for the current student name
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'getStudentName' }, response => {
    if (chrome.runtime.lastError) return; // content script not running (not a grading page)
    const row = document.getElementById('student-row');
    const nameEl = document.getElementById('student-name');
    if (response?.name) {
      nameEl.textContent = response.name;
      row.classList.remove('none');
    }
  });
});

// ─── Folder selection ────────────────────────────────────────────────────────

btn.addEventListener('click', async () => {
  btn.disabled = true;
  setStatus('Opening picker…');

  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });

    // Persist in extension IDB so background.js can read it
    await IDB.save('feedbackDir', handle);

    // Store the name for display purposes (handles aren't in storage.local)
    chrome.storage.local.set({ folderName: handle.name });
    folderEl.textContent = `📁 ${handle.name}`;
    setStatus('✓ Folder selected', 'ok');

    // Tell the content script to refresh if it's running on the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'refresh' }).catch(() => {
        // Content script isn't running (not a grading page) — that's fine.
        // The handle is saved; it'll be picked up on next grading page load.
      });
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      setStatus('');
    } else {
      setStatus('Could not open folder picker.', 'error');
      console.error('[MFH]', e);
    }
  } finally {
    btn.disabled = false;
  }
});
