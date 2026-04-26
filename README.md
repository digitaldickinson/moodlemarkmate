# Moodle Feedback Helper

A Chrome/Edge browser extension for Moodle markers. It matches student feedback files from a local folder, generates completed marking rubric documents, and uploads them directly into the Moodle grading interface — without leaving the page.

---

## Features

- **File matching** — select a local folder of feedback files once; the extension automatically surfaces files matching the current student's name as you move through the grading queue
- **Drag-and-drop or one-click upload** — matched files can be dragged onto Moodle's upload zone or injected with a single click
- **Marking form** — a modal rubric with click-to-select traffic light feedback (Pause / Reflect / Proceed), a grade selector mirrored from the Moodle page, and an overall comments field
- **DOCX generation** — on submission, the extension populates a `.docx` rubric template with the student name, selected feedback text, cell highlights, and comments, then uploads the completed document directly into Moodle
- **Rubric state persistence** — marking selections, grade, and comments are saved per student and restored automatically when you return to the same student
- **Permission persistence** — if folder access lapses after a browser restart, a prominent prompt guides you to reselect the folder

---

## Browser support

Chrome 99+ and Edge 99+ (Manifest V3).

---

## Installation

The extension is not published to the Chrome Web Store. Install it as an unpacked extension:

1. Download or clone this repository
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
3. Enable **Developer mode** (toggle, top right)
4. Click **Load unpacked** and select the repository folder
5. The Moodle Feedback Helper icon will appear in your toolbar

---

## Setup

1. Click the extension icon in the toolbar
2. Click **Choose folder** and select the folder containing your student feedback files
3. Navigate to any Moodle grading page — the panel will appear automatically in the bottom-right corner

The folder only needs to be selected once per browser session. After a browser restart, click the **Reselect folder** button that appears in the panel if access has lapsed.

---

## Usage

### Files tab

When you open a student's grading page, the **Files** tab searches the selected folder for files matching that student's name and lists any matches. Files can be:

- **Dragged** directly onto the Moodle file upload area
- **Uploaded** with the Upload → button, which simulates a drop into the Moodle upload zone

Click **Refresh** to re-scan if files have changed.

### Mark tab

Click **Open Marking Form** to open the rubric modal.

The modal contains:

- **Traffic light criteria** — click Pause, Reflect, or Proceed for each criterion. Pre-written feedback text appears for the selected level. An optional per-criterion note field is available via `+ note`
- **Grade** — mirrors the Moodle grade field. Selecting a value here updates the Moodle page directly
- **Overall comments** — free-text field appended to the generated document
- **Generate & Upload** — builds a completed `.docx` from the rubric template, populates it with the student name, selected feedback, and comments, then injects it into the Moodle feedback file upload zone. If the upload zone is not found, the document downloads as a file instead
- **Clear form** — resets all selections and comments for the current student

Closing the modal does not clear state. Selections are preserved if you switch to the Files tab and return, and are persisted across page reloads via `chrome.storage.local`.

---

## Rubric template

The extension ships with a default rubric template at `lib/mmfj2_rubric.docx`. To use a custom template, place a `.docx` file containing `rubric` or `template` in its filename inside the selected feedback folder. The extension will prefer the folder template over the bundled default.

The template must contain the placeholder tokens:

| Token | Replaced with |
|---|---|
| `[NAME]` | Student name extracted from the Moodle page |
| `[Comments]` | Overall comments from the marking form |

Traffic light cell highlights and grade band highlights are applied to the first and second tables in the document respectively.

---

## File structure

```
├── manifest.json       — MV3 extension manifest
├── background.js       — service worker: file reading, IDB, template serving
├── content.js          — injected into Moodle pages: panel, marking modal, DOCX generation
├── content.css         — panel and modal styles
├── popup.html          — folder selection UI
├── popup.js            — folder selection logic
├── icons/              — extension icons (16, 48, 64, 128px)
└── lib/
    ├── jszip.min.js    — bundled JSZip library (no CDN)
    └── mmfj2_rubric.docx — default rubric template
```

---

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Persist folder name and per-student marking state |
| `activeTab` | Read student name from the current Moodle grading page |
| `host_permissions: <all_urls>` | Inject the panel on any Moodle instance URL |

No data leaves the browser. File reading uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) — files are read locally and passed in memory to the content script via the extension service worker. No external network requests are made.

---

## Development notes

- File reading is performed in the **background service worker** (not the content script) to avoid a macOS/Edge restriction where content scripts cannot read file contents via the File System Access API even after folder selection
- The folder handle is stored in extension-origin IndexedDB by the popup, ensuring `queryPermission()` returns `granted` in the background
- `ArrayBuffer` objects are serialised as `Uint8Array` arrays when passed through Chrome's message channel (which uses JSON serialisation) and reconstructed on the receiving end
- The bundled template fallback is fetched in the background to bypass Moodle's Content Security Policy, which blocks `chrome-extension://` fetches from the page context
