# DataLog

DataLog is a local-first browser application for structured records, reusable templates, numerical summaries and exports. It is served as a static application and does not require an application server or third-party JavaScript runtime.

## Current release state

**Version:** 1.0.0-beta  
**Release channel:** Beta / local-first  
**Production approval:** Not granted

The application implements a useful single-browser workflow. It is not a multi-user system and is not approved for regulated, confidential, safety-critical or business-critical records. A successful build and passing unit tests do not replace browser, security, recovery and real-world acceptance testing.

## Run

1. Serve this directory from an HTTPS static host (GitHub Pages is supported).
2. Open \`/docs/Apps/DataLog/\` in a current version of Chrome, Edge, Firefox or Safari.
3. Create or select a template, then add records.
4. Use **Settings & backups → Download JSON backup** to create a portable backup.

A local static server is also suitable for development. Opening the HTML file directly with a \`file://\` URL is not supported because browser storage and service-worker behaviour differ outside a web origin.

## Architecture

- \`index.html\`, \`styles.css\`: application shell, responsive UI and print layout.
- \`app.js\`: UI, IndexedDB persistence, dialogs, backup/restore, CSV and print workflows.
- \`core.js\`: dependency-free validation, filtering, aggregation, CSV and backup logic.
- \`sw.js\`: versioned offline application-shell cache.
- \`manifest.webmanifest\`: installable web-app metadata.
- \`tests/core.test.js\`: Node.js regression tests for the data utilities.
- \`.github/workflows/datalog.yml\`: syntax and regression checks on relevant changes.

## Data model

The IndexedDB database is named \`north-assembly-datalog\` and currently has version 1.

**Templates** define named fields. Each field has a stable key, label, type and required flag. Supported UI field types are short text, long text, number, date and checkbox.

**Records** contain an identifier, title, template identifier, event date, field values, creation timestamp and update timestamp.

The application validates required fields, numeric values, dates and template references before saving. It prevents deleting templates that are still referenced by records and prevents removing or changing the type of populated template fields through the editor.

## Backup and export

- JSON backup: versioned DataLog envelope containing all templates and records.
- JSON restore: validates the complete backup before replacing local data. Restore is destructive to the current local workspace and requires confirmation.
- CSV: exports a flat record table with dynamic columns for field keys. Values containing commas, quotes or line breaks are escaped.
- PDF: use **Print / Save PDF** and select the browser's Save as PDF destination. The browser print engine performs the PDF generation.

Keep backups outside the browser profile. A browser's site-data cleanup, profile removal, device loss or storage corruption can remove local records.

## Privacy and security boundaries

DataLog does not send record contents to a remote API. It has no accounts, server-side authorisation, multi-device synchronisation or built-in encryption of the browser database. Local browser-profile access therefore equals access to the data. The application must not be represented as secure storage for secrets or sensitive personal information.

The app shell has a restrictive Content Security Policy, does not load third-party scripts, escapes user-provided values before rendering HTML, and validates imported backups. These measures reduce attack surface but are not a security certification.

## Automated checks

Requirements: Node.js 22 or later.

\`\`\`sh
node --check docs/Apps/DataLog/core.js
node --check docs/Apps/DataLog/app.js
node --check docs/Apps/DataLog/sw.js
node --test docs/Apps/DataLog/tests/*.test.js
\`\`\`

## Release gate

Do not change the release channel to Stable until the checks in [TESTING.md](./TESTING.md) have been completed on supported browsers and the acceptance criteria in [RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md) are evidenced. The current code has not been exercised in a live browser session by this change.
