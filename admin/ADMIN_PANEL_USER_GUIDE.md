# VAMSHA VRUKSHA Admin Panel Guide

This document explains:
- what the admin panel does,
- what logic is implemented,
- how admins should use it safely,
- and common workflows for daily operations.

---

## 1. Purpose

The admin panel is a **draft editor** for family tree data.  
Admins can edit people, relationships, photos, custom fields, run validations, import JSON data, and export clean JSON files.

Main goals:
- update family data without touching code,
- reduce mistakes with validation rules,
- keep recoverability (soft delete/archive),
- support future expansion (`custom` fields, schema manifest).

---

## 2. Data Files Used

The panel works with these JSON files:
- `json_data/persons.json`
- `json_data/families.json`
- `json_data/contacts.json`
- `json_data/photos.json`

Optional metadata in ZIP export:
- `schema.json`

---

## 3. High-Level Workflow (Recommended)

1. Open admin page.
2. Load/select person.
3. Edit details, relationships, custom fields, photos.
4. Run **Validation**.
5. Fix issues (especially errors).
6. Export:
   - single files when needed, or
   - **Download All 4** for ZIP package.
7. Replace production JSON files with exported versions.

---

## 4. Sections and How to Use

## 4.1 Pick Person
- Search/select person by ID (or from modal/tree context).
- `Add New Person` creates next ID.
- `Archive Person` / `Restore Person` does soft-delete toggle.

---

## 4.2 Person Details
- Edit core fields: name, sex, birth date/place, contact note.
- `Deceased` checkbox:
  - if checked, death date input appears,
  - death date can be empty (allowed),
  - invalid date format is blocked by validation/save checks.

---

## 4.3 Custom Fields (Collapsible)

Stored in person object as:
```json
"custom": {
  "key1": "value1",
  "key2": "value2"
}
```

Usage:
- Add key + value, click `Add/Update Field`.
- Use `Edit` to load existing field into inputs.
- Use `Remove` to delete specific key.

Display:
- Custom fields are also shown in person details modal (visitor/admin page).

---

## 4.4 Photo

Upload behavior:
- image is auto-optimized on selection:
  - resized (max side 1200px),
  - compressed to JPEG for efficient size.
- status shows original vs optimized size.

Actions:
- `Apply Photo Mapping` updates `photos.json` mapping.
- `Download Renamed Image` gives `Ixxxx.jpg` file.
- `Remove Photo` removes mapping.

Broken image handling:
- broken mapped/preview image is detected,
- fallback avatar/initials is shown in tree/modal.

---

## 4.5 Parents / Spouse / Children

Main relationship editor in panel:
- set father/mother IDs,
- add/remove spouse IDs,
- add/update child links (with role and optional co-parent).

Chips are simplified to person references for clarity.

---

## 4.6 Quick Relationship Edit (Inside Person Modal)

From person modal (long-press or profile):
- edit parents/spouse/children inline,
- supports ID or name input,
- supports child role (`auto/father/mother`),
- has staged mode:
  - `Save Changes`
  - `Discard`
  - `Undo Step`
  - unsaved indicator and close-confirmation.

This avoids switching between modal and admin panel for small relationship edits.

---

## 4.7 Validation (Collapsible)

Run before export.

Checks include:
- invalid/duplicate person IDs,
- missing parent/spouse references,
- self-parent/self-spouse errors,
- circular parent links (cycle detection),
- invalid birth/death date formats,
- impossible dates (death before birth),
- death date present while deceased is false,
- contact/photo reference consistency,
- custom field type sanity (`custom` must be object).

Export is blocked if there are validation **errors**.

---

## 4.8 Apply + Export

Single exports:
- `persons.json`
- `families.json`
- `contacts.json`
- `photos.json`
- `schema.json`

Bundle export:
- `Download All 4` creates ZIP:
  - `VAMSHA-YYYYMMDD-HHMMSS.zip`
  - includes persons/families/contacts/photos + schema.

---

## 4.9 Import + Merge (Collapsible)

Upload one JSON file and apply with strategy.

Supported types:
- persons
- families
- contacts
- photos

Conflict strategy:
- `Merge` (recommended): update existing + add new.
- `Replace`: replace existing matching records.
- `Skip`: keep existing records, only add new.

Flow:
1. Upload JSON.
2. Confirm detected type.
3. Select strategy.
4. Click `Preview Import`.
5. Review add/update/skip/invalid counts.
6. Click `Apply Import`.
7. Run validation.
8. Export updated files.

---

## 5. Soft Delete (Archive) Logic

No hard delete from UI now.

Archive behavior:
- person is marked:
  - `"archived": true`
  - `"archived_at": "<ISO timestamp>"`
- hidden from active runtime tree/visitor view,
- can be restored anytime.

Restore behavior:
- sets archived false and clears archived timestamp.

---

## 6. Schema & Future Expansion

Schema metadata is exported via `schema.json` with:
- `schema_version`
- generation timestamp
- file map + notes

This helps future migrations and compatibility tracking.

---

## 7. Admin Safety Rules

- Always run validation before export.
- Prefer ZIP export for full update sessions.
- Keep backup of previous JSON before replacing live files.
- Use archive instead of delete for uncertain removals.
- Use preview before applying imports.
- Resolve validation errors first; warnings should also be reviewed.

---

## 8. Quick Troubleshooting

Images disappear:
- check photo paths in `photos.json`,
- ensure icon files exist in `icons/`,
- re-apply photo mapping if needed.

Import not applying:
- ensure JSON is valid,
- ensure detected type is supported,
- run Preview to confirm counts.

Export blocked:
- run Validation section and fix all `error` items.

---

## 9. Suggested Daily Admin Checklist

1. Load target person(s).
2. Make edits.
3. Run Validation.
4. Fix errors.
5. Export ZIP.
6. Update production JSON files.
7. Keep dated backup of prior data.

