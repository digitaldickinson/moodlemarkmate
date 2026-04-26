# Claude Code Brief: Moodle Feedback Helper — Marking Panel Extension

## Overview

Extend the existing **Moodle Feedback Helper** Chrome extension to add an in-page marking panel. When a marker is on a Moodle grading page, they can click a **Mark** tab in the existing panel, complete a clickable rubric and comment box in a modal overlay, hit **Generate & Upload**, and the extension builds a feedback DOCX in memory and injects it directly into the Moodle file upload zone — no local files, no separate tool, no upload step.

This brief covers all changes required across the existing extension files. Do not create new files unless specified. The existing `Files` tab behaviour must be unchanged.

---

## Existing codebase — what to know before touching anything

- `content.js` — injected into all Moodle pages. Detects student name from `h2` heading, builds the floating panel, messages `background.js` for file matches, injects files via `injectFileIntoMoodle()`.
- `background.js` — service worker. Holds the `FileSystemDirectoryHandle` in IndexedDB, reads matching files, returns ArrayBuffers to content script.
- `popup.js` / `popup.html` — extension popup. Handles folder selection only.
- `content.css` — styles for the floating panel.
- `manifest.json` — MV3. Permissions: `storage`, `activeTab`. `host_permissions`: `<all_urls>`.

**Key existing functions in `content.js` to reuse, not rewrite:**

- `extractStudentName()` — returns student name string from page h2
- `injectFileIntoMoodle(file)` — takes a `File` object, simulates drag/drop into Moodle upload zone, returns `true`/`false`
- `setStatus(msg, type)` — updates the status bar at the bottom of the panel
- `getMoodleDropZone()` — finds the Moodle upload target

---

## Dependencies to add

Add **JSZip** as a bundled extension resource — do not use a CDN, extensions should not make external network requests from content scripts.

1. Download `jszip.min.js` from `https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js` and save as `lib/jszip.min.js`.

2. Place the provided `MMFJ2_rubric.docx` template file in `lib/mmfj2_rubric.docx`. This is the base template — the extension populates it rather than building a DOCX from scratch.

3. In `manifest.json`, add both to `web_accessible_resources`:
```json
"web_accessible_resources": [
  {
    "resources": ["lib/jszip.min.js", "lib/mmfj2_rubric.docx"],
    "matches": ["<all_urls>"]
  }
]
```

4. In `manifest.json`, add `lib/jszip.min.js` to the content scripts `js` array, **before** `content.js`:
```json
"js": ["lib/jszip.min.js", "content.js"]
```

After this, `JSZip` is available as a global in `content.js`.

---

## Rubric data

Add the following constant to the **top of `content.js`**, before any functions. This is the MMFJ2 assignment rubric. It must be declared at module scope so both the panel builder and the DOCX generator can access it.

```javascript
const MFH_RUBRIC = {
  sections: [
    {
      id: 'script', title: 'Script',
      criteria: [
        { id: 'script_focus',     label: 'Story focus',
          pause:   'The script misses the key points of the story',
          reflect: 'Think about how you might develop the story to focus the script on the newsworthy part of the story',
          proceed: 'The script focusses on a key part of the story. Think about how the process helped you narrow down your focus.' },
        { id: 'script_interview', label: 'Script / interview connection',
          pause:   "The script and interview don't connect.",
          reflect: 'The script could be developed to work with the interview to tell the story more effectively.',
          proceed: 'The script and interview content work well together to tell the story.' },
        { id: 'script_style',     label: "Writing style ('said not read')",
          pause:   'The script is more suited to text on a page.',
          reflect: "The script could be developed to recognise the 'said not read' advice. Try and avoid too many commas or use of quotes.",
          proceed: 'A good script that reads well.' }
      ]
    },
    {
      id: 'broll', title: 'General Views (B-roll)',
      criteria: [
        { id: 'broll_technical', label: 'Technical quality',
          pause:   'Very poor technical quality – focus, exposure, white balance issues need to be addressed',
          reflect: 'There are occasional technical issues e.g. intermittent focus issues. Make sure you practise with manual settings.',
          proceed: 'Your B-roll is produced to a good technical standard. Reflect on the process and make sure you have a strategy for consistency.' },
        { id: 'broll_variety',   label: 'Shot variety',
          pause:   "There's no variety in your B-roll. You've included the required shots.",
          reflect: "You've included the required B-roll shots. But think about how you might use a mix of shots and different angles",
          proceed: "You've included the required shots, with an appropriate use of establishing and detail shots." },
        { id: 'broll_sound',     label: 'Sound',
          pause:   'Sound is missing or unusable.',
          reflect: 'Sound is missing in places or might have intermittent problems e.g. strong wind noise on certain shots.',
          proceed: 'Consistent use of sound across your B-roll.' }
      ]
    },
    {
      id: 'interview', title: 'Video Interview',
      criteria: [
        { id: 'int_sound',      label: 'Sound quality',
          pause:   'The sound quality is very poor. Parts of the interview are unintelligible, or the sound quality distracts from the content.',
          reflect: 'The sound quality is poor in places. Consider the placement of your mics or the environment in which you stage your interviews when shooting in future.',
          proceed: 'Good sound quality. Think about the setup you used and what helped capture the quality you needed.' },
        { id: 'int_framing',    label: 'Framing (MCU/MS)',
          pause:   "The framing is poor, it's not a recognizable MCU/MS. Go back to the guidance on the basic MCU framing.",
          reflect: 'The framing could be improved. Consider the position of the interviewee, where they are looking and the space in the frame.',
          proceed: 'A good MCU/MS framing.' },
        { id: 'int_background', label: 'Background',
          pause:   'The background is poorly chosen and distracts from the interview content.',
          reflect: 'Think about how the background could be improved to reinforce the story.',
          proceed: 'An interesting background that enhances the interview content.' }
      ]
    },
    {
      id: 'editing', title: 'Editing and Production',
      criteria: [
        { id: 'edit_quality', label: 'Edit quality',
          pause:   'There are consistent errors in the editing that distract from the overall story.',
          reflect: 'There are minor editing issues – gaps between cuts or shots that are too short. Make sure you leave time to check your work carefully.',
          proceed: 'Well edited with no noticeable gaps, flash frames and well-chosen images.' },
        { id: 'edit_audio',   label: 'Audio mix',
          pause:   'The audio is missing or poorly mixed in places. Parts of the script are drowned out.',
          reflect: 'The audio is well mixed but there are occasional gaps or errors in the balance between script and B-roll sound.',
          proceed: 'A well-balanced audio track.' }
      ]
    },
    {
      id: 'submission', title: 'Submission',
      criteria: [
        { id: 'sub_elements', label: 'Required elements',
          pause:   'Required elements are missing from the submission.',
          reflect: 'Some elements are incomplete.',
          proceed: 'All required elements present.' }
      ],
      checklist: [
        { id: 'chk_link',    label: 'Working link'         },
        { id: 'chk_shots',   label: 'Required shots'       },
        { id: 'chk_script',  label: 'Formatted script'     },
        { id: 'chk_graphic', label: 'Graphic element'      },
        { id: 'chk_hs',      label: 'Health & safety form' },
        { id: 'chk_contact', label: 'Contact details'      }
      ]
    }
  ],

  gradeBands: [
    { id: 'high_first',   label: 'High First',    range: '85–100%',
      package:    { desc: 'Exceptional production quality. Excellent use of visuals, sound, and graphics.',
                    progress: 'Continue to explore and practise techniques to push your technical and creative skills.' },
      reflection: { desc: 'Insightful, detailed analysis with excellent examples and robust citations.',
                    progress: 'Keep reading and engaging with industry debate to ensure you are aware of changes in industry practice.' },
      los:        { desc: 'Outstanding demonstration of outcomes, with advanced mastery of professional standards and technical tools.',
                    progress: 'Continue to explore opportunities to work above and beyond the criteria of assessments.' } },
    { id: 'first',        label: 'First',          range: '70–84%',
      package:    { desc: 'Strong production quality. Minor flaws but reflects a highly professional approach.',
                    progress: 'Focus on the details; explore sequences and transitions to increase polish and professional impact.' },
      reflection: { desc: 'Reflective and analytical, with clear examples and citations and a clear idea of how to apply your learning in future.',
                    progress: 'Include more industry examples and broaden your range of sources.' },
      los:        { desc: 'Relevant and consistent evidence of the learning outcomes, showing strong skills and understanding of standards.',
                    progress: 'Keep practising building your skills and understanding of how they are applied.' } },
    { id: 'upper_second', label: 'Upper Second',  range: '60–69%',
      package:    { desc: 'Good production quality with some inconsistencies in technical presentation (e.g., sound quality or occasional focus problems).',
                    progress: 'Address technical weaknesses and practise to improve quality.' },
      reflection: { desc: "Thoughtful evaluation, with a mix of relevant examples and some citations. But there's room to consider how the experience will inform future work.",
                    progress: 'Think about the range and relevance of the examples and citations.' },
      los:        { desc: "Clear evidence of the learning outcomes but some issues with consistency across the elements.",
                    progress: 'Reflect on areas of strength and weakness. Think about why you approached the assessment the way you did — not just what you did.' } },
    { id: 'second',       label: 'Second',         range: '50–59%',
      package:    { desc: 'Basic production quality, noticeable issues (e.g., poor lighting or framing).',
                    progress: 'Focus on practising the basics to ensure confidence and consistency in your editing, sound and picture quality.' },
      reflection: { desc: 'Descriptive, with limited analysis and few examples.',
                    progress: 'Provide examples that relate to the assessment and link them to professional practices.' },
      los:        { desc: 'Evidence of working towards the outcomes, but noticeable gaps in standards and technical execution.',
                    progress: 'Build confidence with more practice and consideration of production methods.' } },
    { id: 'third',        label: 'Third',          range: '40–49%',
      package:    { desc: 'Limited production quality, major technical flaws (e.g., poor editing).',
                    progress: 'Focus on the core technical skills like framing and sound. Set aside time to practise creating the core building blocks.' },
      reflection: { desc: 'Largely descriptive and generic. Lacks critical reflection, citations or examples that place this in an industry context.',
                    progress: 'Think about how your work reflects current practice. Think about industry examples and citations you can use to add context.' },
      los:        { desc: 'Basic evidence of outcomes, but inconsistent or with obvious gaps.',
                    progress: 'Revisit, practise and strengthen the basic skills and understanding of professional expectations.' } },
    { id: 'below',        label: 'Below Standard', range: '0–39%',
      package:    { desc: 'Very poor production quality, with critical issues or missing elements.',
                    progress: 'Learn and practise essential skills in sound, framing, and editing.' },
      reflection: { desc: 'Superficial or missing reflection, with no examples or citations.',
                    progress: 'Reflect on key decisions made during the assessment and explore resources to support learning.' },
      los:        { desc: 'Insufficient evidence of outcomes across the piece.',
                    progress: 'Engage in feedback and tutorials to build core competencies.' } }
  ]
};
```

---

## Changes to `content.js`

### 1. Panel structure — add tab strip to `buildPanel()`

Replace the current `#mfh-header` and `#mfh-body` structure. The panel now has:

- A header with title, tab strip (`Files` | `Mark`), and collapse button
- A body that shows either `#mfh-files-tab` or `#mfh-mark-tab` depending on active tab

The Files tab contains everything currently in `#mfh-body` (student row, file list, toolbar, status). No functional changes to the Files tab.

The Mark tab contains a single **Open Marking Form** button that opens the marking modal. Keep the mark tab minimal — the modal does the heavy lifting.

Tab switching hides/shows the respective tab divs. Active tab button gets a highlighted style. State persists for the session (if marker switches to Files and back, their rubric selections are not lost).

### 2. Marking state

Add a module-level state object immediately after `MFH_RUBRIC`:

```javascript
const mfhMarkState = {
  selections: {},  // criterionId → { level: 'pause'|'reflect'|'proceed', note: '' }
  checklist:  {},  // checklistItemId → boolean
  grades:     { package: null, reflection: null, los: null },
  comments:   ''
};
```

This is intentionally separate from the panel UI. Switching tabs does not reset it. Only a deliberate **Clear** action resets it.

### 3. Marking modal — `buildMarkingModal()`

Add a new function `buildMarkingModal()` that creates a full-screen overlay (`position: fixed; inset: 0; z-index: 2147483646`). It is appended to `document.body` separately from the panel.

The modal contains:

**Header bar** (full width, dark blue, matching panel style):
- Title: `📝 Marking Form — {studentName}`
- Right side: `✕ Close` button

**Scrollable body** (max-width 720px, centred, white, padding):

- **Suggested band indicator** — a single line below the header showing the current suggested grade band based on traffic light selections. Updates live as selections change. Label: `Suggested band (video):`. Logic: score each selection as proceed=2, reflect=1, pause=0. `pct = total / (answered * 2)`. Map pct to band label. Show `—` until at least one selection is made.

- **Section blocks** — one collapsible block per `MFH_RUBRIC.sections` entry. Each block has a section title header (click to collapse/expand) and a completion count badge (`2 / 3`).

  Inside each block, one row per criterion:
  - Criterion label
  - Three buttons: `🔴 Pause`, `🟡 Reflect`, `🟢 Proceed`
  - When one is selected: button highlights in its colour (red/amber/green), the pre-written feedback text appears below it in a coloured box (red/amber/green tint with left border)
  - A small `+ note` toggle that reveals a textarea for additional marker comment on that specific criterion
  
  For sections with a `checklist` array, render checkboxes below the criteria rows.

- **Grade band selector** — three columns (Video Package | Reflection | Learning Outcomes). In each column, six clickable band buttons (High First through Below Standard). Clicking one highlights it and shows the descriptor and "To progress" text below the buttons. Selections stored in `mfhMarkState.grades`.

- **Overall comments** — a textarea, full width, min 80px height. Label: `Overall comments`.

- **Action row**:
  - `Generate & Upload` button (primary, dark blue) — calls `generateAndUpload()`
  - `Clear form` button (secondary) — resets `mfhMarkState` and re-renders the modal body

**Modal close**: clicking `✕` or clicking the backdrop outside the modal content closes it. Does **not** clear state.

### 4. `generateAndUpload()` function

This is the core new function. It:

1. Gets student name from `extractStudentName()`.
2. Builds a DOCX as a `File` object using JSZip (see DOCX spec below).
3. Calls `await injectFileIntoMoodle(file)`.
4. If injection returns `true`: sets status `✓ Feedback document uploaded`, closes modal.
5. If injection returns `false`: sets status `✗ Drop zone not found — try dragging` (warn type), keeps modal open, and also triggers a browser download of the DOCX as fallback using `URL.createObjectURL`.

The filename must be: `{Moodle folder name}_assignsubmission_file_Feedback.docx` — matching the convention moodles.html uses. Since content.js doesn't have the Moodle folder name (it only has the display name from the h2), use the student name sanitised as: `studentName.replace(/\s+/g, '_') + '_assignsubmission_file_Feedback.docx'`.

### 5. DOCX generation — `buildFeedbackDocx(studentName)`

Returns a `Promise<File>`. Uses `lib/mmfj2_rubric.docx` as a base template rather than building a DOCX from scratch. This preserves the established document format and means the rubric text does not need to be reproduced in code.

**Loading the template:**

```javascript
const templateUrl = chrome.runtime.getURL('lib/mmfj2_rubric.docx');
const response    = await fetch(templateUrl);
const buffer      = await response.arrayBuffer();
const zip         = await JSZip.loadAsync(buffer);
const xmlStr      = await zip.file('word/document.xml').async('string');
```

**Step 1 — Text replacement:**

Parse `xmlStr` as an XML DOM. Walk all `w:t` text nodes and apply:
- `[NAME]` → student name
- `[Comments]` → value of the overall comments textarea (or empty string if blank)

Because Word sometimes splits placeholder text across multiple `w:t` elements within the same `w:r` or `w:p`, use the same `replaceInNodes()` approach from `mmfj2-marker.html` which concatenates node text, finds the placeholder span, and distributes the replacement back across the nodes.

**Step 2 — Traffic light cell highlighting:**

The template's first `w:tbl` is the traffic light table. Its rows map sequentially to criteria in `MFH_RUBRIC.sections`, in the order: Script (3 criteria), General Views (3), Video Interview (3), Editing and Production (2), Submission (1). Total: 12 data rows, plus a header row at index 0.

Criteria row index mapping (0-based within `w:tr` elements, skipping the header):
- Row 0–2: Script criteria
- Row 3–5: B-roll criteria
- Row 6–8: Interview criteria
- Row 9–10: Editing criteria
- Row 11: Submission criterion

For each criterion that has a selection in `mfhMarkState.selections`:
1. Find the corresponding `w:tr` by index (header = index 0, first criterion = index 1, etc.)
2. Get the `w:tc` elements in that row. Column mapping: index 1 = Pause, index 2 = Reflect, index 3 = Proceed (index 0 is the section label column)
3. On the selected column's `w:tc`, find or create `w:tcPr`, then find or create `w:shd` within it. Set attributes: `w:val="clear"`, `w:color="auto"`, `w:fill="{colour}"`
4. Colour values: pause → `FEE2E2`, reflect → `FEF3C7`, proceed → `DCFCE7`
5. Leave all other cells unstyled — do not add or modify their shading

**Step 3 — Grade band row highlighting:**

The template's second `w:tbl` is the grade band table. Its rows are: header row (index 0), then one row per band in order: High First, First, Upper Second, Second, Third, Below Standard (indices 1–6).

Band index mapping:
- `high_first` → row index 1
- `first` → row index 2
- `upper_second` → row index 3
- `second` → row index 4
- `third` → row index 5
- `below` → row index 6

For each of the three rubric columns (`package`, `reflection`, `los`), if a grade is selected in `mfhMarkState.grades`:
1. Find the row at the band's index
2. Find the `w:tc` at the column's position (index 1 = Video Package, 2 = Reflection, 3 = Evidence of LOs; index 0 is the band label column)
3. Add `w:shd` with `w:fill="DBEAFE"` to that cell's `w:tcPr`

If all three columns select the same band, all three content cells in that row get highlighted. If they differ, each cell is highlighted independently in its respective row.

**Step 4 — Repack and return:**

```javascript
const updatedXml = new XMLSerializer().serializeToString(dom);
zip.file('word/document.xml', updatedXml);
const blob = await zip.generateAsync({ type: 'blob' });
const safeName = studentName.replace(/[\\/:*?"<>|]/g, '_');
return new File([blob], `${safeName}_assignsubmission_file_Feedback.docx`,
  { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
```

**Important:** Do not modify any other files in the DOCX ZIP (styles, relationships, content types). Only `word/document.xml` is touched.

---

## Changes to `content.css`

Add styles for:

- `.mfh-tabs` — flex row, border-bottom, inside the header
- `.mfh-tab` — tab button, unselected state (muted)
- `.mfh-tab.active` — selected state (white text, no bottom border)
- `#mfh-mark-open-btn` — the "Open Marking Form" button inside the Mark tab, full width, standard dark blue
- `#mfh-modal-overlay` — fixed, inset 0, dark semi-transparent backdrop, z-index 2147483646, overflow-y auto
- `.mfh-modal-content` — white, max-width 720px, margin auto, border-radius 10px, padding 24px, position relative, margin-top/bottom 40px
- `.mfh-modal-header` — dark blue bar, flex, space-between, padding, border-radius top
- `.mfh-modal-close` — close button in header, white, no border
- `.mfh-criterion-row` — padding, border-bottom, last-child no border
- `.mfh-tl-btn` — pill button for Pause/Reflect/Proceed, unselected state grey
- `.mfh-tl-btn.pause.selected` — red tint
- `.mfh-tl-btn.reflect.selected` — amber tint  
- `.mfh-tl-btn.proceed.selected` — green tint
- `.mfh-tl-feedback` — coloured feedback box, hidden by default, shown on selection
- `.mfh-grade-btn` — grade band selector button, block, full width, selectable
- `.mfh-grade-btn.selected` — blue highlight
- `.mfh-grade-preview` — descriptor box shown below grade buttons on selection
- `.mfh-suggest-bar` — the suggested band indicator line below the modal header

All modal styles must be prefixed `mfh-` to avoid colliding with Moodle's own stylesheet. Use `!important` sparingly — only where Moodle's styles demonstrably override the panel (check against the existing panel CSS pattern for guidance).

---

## Changes to `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Moodle Feedback Helper",
  "version": "1.1",
  "description": "Match feedback files and complete marking rubrics for Moodle students.",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_popup": "popup.html",
    "default_title": "Moodle Feedback Helper"
  },
  "web_accessible_resources": [
    {
      "resources": ["lib/jszip.min.js", "lib/mmfj2_rubric.docx"],
      "matches": ["<all_urls>"]
    }
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["lib/jszip.min.js", "content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ]
}
```

---

## Acceptance criteria

- [ ] Panel shows `Files` and `Mark` tabs. Switching tabs shows/hides the correct content. Collapse button still works.
- [ ] Files tab behaviour is identical to the current version — no regressions.
- [ ] Mark tab shows an "Open Marking Form" button.
- [ ] Clicking it opens the modal overlay. Student name in modal header is pulled from the page automatically.
- [ ] Traffic light buttons select correctly, highlight in colour, and display pre-written feedback text.
- [ ] Section completion counters update as selections are made.
- [ ] Suggested band indicator updates live as more selections are made.
- [ ] `+ note` toggles open a textarea; entered text is stored in `mfhMarkState`.
- [ ] Grade band buttons select correctly and show the descriptor + "To progress" text.
- [ ] Overall comments textarea value is stored in `mfhMarkState`.
- [ ] Generate & Upload loads `lib/mmfj2_rubric.docx` via `chrome.runtime.getURL`, replaces `[NAME]` and `[Comments]`, highlights the correct traffic light cells and grade band cells, and produces a valid DOCX.
- [ ] Generated DOCX opens correctly in Word with no corruption errors.
- [ ] `injectFileIntoMoodle()` is called with the generated File. On success, status updates and modal closes.
- [ ] If drop zone not found, DOCX downloads as a file fallback and status shows a warning.
- [ ] Clear form resets all state and re-renders the modal body.
- [ ] Closing the modal (✕ or backdrop click) does not clear state — reopening shows previous selections.
- [ ] Extension loads without console errors on a standard Moodle grading page.
- [ ] No external network requests made by content scripts (JSZip and template are bundled locally).

---

## Out of scope for this version

- Loading rubric from a JSON file in the feedback folder (deferred to v1.2)
- Multi-assignment rubric switching
- Saving/restoring state across page navigations
- Popup UI changes
