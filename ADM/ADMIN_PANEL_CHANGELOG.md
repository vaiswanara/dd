# Admin Panel Change Log

Date: 2026-02-19
Project: `dfwa-Relatives-extension-Edit_logic`

## Scope
Implemented an admin-only editing workflow on `admin.html` without changing core runtime files like `app.js`.

## Files Added
- `admin-panel.css`
- `admin-panel.js`

## Files Updated
- `admin.html`

## Implemented Changes

### 1. Admin Editor Panel
- Added dedicated admin editor UI as a slide panel.
- Panel now opens from the **left side** for side-by-side tree editing.
- Added top-left `Admin Editor` button.

### 2. Admin-Only Layout
- Removed sidebar usage in admin mode (hidden via CSS).
- Added compact icon navigation under header (`Tree`, `Dashboard`, `Language`).
- Default page now opens in **Family Tree view** instead of Dashboard.

### 3. CRUD for People and Relationships
- Add person (auto ID generation like `I0001` pattern).
- Edit person details:
  - `given_name`, `surname`, `sex`, `birth_date`, `birth_place_id`
  - contact: `phone`, `email`, `note`
- Delete person with relationship cleanup.
- Relationship management:
  - Set/Clear father and mother
  - Add/Remove spouse
  - Add/Remove children
  - Add **multiple children** in one action

### 4. Live Tree Refresh
- Admin changes sync to runtime maps (`peopleMap`, `childrenMap`, `genderMap`).
- Tree redraws immediately after edits.
- Added manual `Refresh Tree Now` button.

### 5. Search and Selection Improvements
- Admin-side search suggestions reflect draft edits.
- `Load Modal Person` support:
  - Reads person ID from currently opened person modal and loads it into editor.

### 6. Validation
- Added `Validation` section with summary and issue list.
- Checks include:
  - duplicate/missing IDs
  - self-parent/self-spouse links
  - missing parent/spouse references
  - non-reciprocal spouse links
  - contact integrity warnings
  - photo mapping warnings
- Export is blocked when validation has `error` issues.

### 7. Export Workflow
- Added downloads for:
  - `persons.json`
  - `families.json`
  - `contacts.json`
  - `photos.json`
- Added combined export through `Download All`.

### 8. Photo Management
- Added `Photo` section in admin panel:
  - current photo path display
  - preview
  - select new image
  - apply/change mapping
  - remove mapping
  - download renamed image as person ID (example: `I0123.jpg`)
- `photos.json` mapping managed in-memory and exportable.

## Notes
- Since this is a static website, browser cannot directly write files to repo folders.
- Final publish workflow remains:
  1. Download JSON/image outputs from admin panel
  2. Replace files in repository (`json_data/*`, `photos.json`, `icons/*`)
  3. Commit and push to GitHub Pages
