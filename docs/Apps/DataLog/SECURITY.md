# DataLog security notes

## Data classification

Treat information saved in DataLog as browser-local information, not encrypted or access-controlled storage. Do not place passwords, API keys, payment details, health information, regulated personal data or other secrets in this application.

## Current protections

- No third-party JavaScript libraries or analytics are loaded by the application.
- A Content Security Policy restricts script, style, image and connection sources to the same origin (with data images permitted).
- User-provided content is HTML-escaped before it is inserted into rendered views.
- Imported backup files are size-limited and structurally validated before a restore is attempted.
- IndexedDB writes and restore operations use read-write transactions.
- Templates with linked records cannot be deleted, and populated fields cannot be removed or have their data type changed through the editor.

## Known limitations

- The IndexedDB database is not encrypted by DataLog.
- There is no login, user isolation, role-based authorisation or server-side access control.
- Records do not synchronise between devices or browser profiles.
- Browser profile access, malware, extensions with page access, device compromise or browser storage cleanup may expose or destroy data.
- The application has not undergone an independent penetration test or formal security assessment.

## Reporting

Report suspected security issues privately to the North Assembly project maintainer. Do not publish personal information or production data in issue reports. Include the affected version, browser, reproduction steps and a minimal test case.
