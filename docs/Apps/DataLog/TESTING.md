# DataLog test plan

This plan complements the automated core tests. It must be completed against the deployed HTTPS page before a Stable release is considered.

## Supported-browser smoke test

Run each case in the current stable releases of Chrome, Edge, Firefox and Safari.

1. Open \`/docs/Apps/DataLog/\`; confirm the app loads and the storage status reads Ready.
2. Refresh the page; confirm the three starter templates remain available and no sample records have been fabricated.
3. Create a record for each starter template. Verify required-field errors, number validation, dates, checkboxes and long text.
4. Edit a record; verify its creation date remains unchanged and the update date changes.
5. Search by title and field value. Filter by template and date range. Reset filters.
6. Create a custom template with multiple fields; create records against it. Rename the template.
7. Attempt to delete a template that has linked records. The app must block the operation.
8. Attempt to remove a populated field or change its data type. The app must block the operation.
9. Export CSV. Open it in a spreadsheet application and verify commas, quotation marks, non-ASCII characters and line breaks.
10. Export JSON, clear the workspace, then restore the backup. Verify every record, template, value and date.
11. Try to restore malformed JSON, an unsupported backup version, duplicate identifiers and a record referencing a missing template. Each import must be rejected without changing current data.
12. Print a report and use the browser's Save as PDF destination. Verify long values remain readable and the report includes all selected records.
13. Reload while offline after the service worker has installed. Confirm the app shell opens and local records remain readable.
14. Open two tabs. Save a record in one tab, then refresh the other and confirm the database remains consistent.
15. Inspect the browser console and network panel. Confirm there are no unhandled exceptions and no requests carrying record values to third-party hosts.

## Data-integrity and failure tests

- Close the tab immediately after saving and reopen the workspace.
- Simulate storage being unavailable or quota-exceeded; confirm the user receives an explicit error and the UI does not claim a successful save.
- Restore a backup at the 25 MB import boundary and a backup containing a large but valid record set.
- Test an interrupted restore and verify that the IndexedDB transaction rolls back rather than leaving half of the imported data.
- Verify backup files can be retained and reopened after a new application release.
- Verify a service-worker update replaces the previous app shell and does not retain stale JavaScript indefinitely.

## Evidence to retain

For each browser, record the version, operating system, test date, pass/fail result and defect reference. Attach screenshots or screen recordings for UI defects and keep anonymised test backups for import/export regression.

## Current execution status

The Node.js core regression tests are automated in GitHub Actions. The browser, offline, IndexedDB quota, multi-tab and print checks above are manual release gates and have not been claimed as completed by this repository change.
