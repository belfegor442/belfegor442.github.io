# DataLog release checklist

## Required before Stable

### Build and quality
- [ ] GitHub Actions syntax checks pass.
- [ ] Core regression tests pass.
- [ ] No unresolved P0 or P1 defects.
- [ ] Browser console is free of uncaught application errors.
- [ ] Accessible keyboard navigation and focus handling are verified.

### Data integrity
- [ ] CRUD workflows are verified in every supported browser.
- [ ] Template changes preserve historical values.
- [ ] JSON backup and restore pass round-trip tests.
- [ ] Invalid and oversized backups are rejected without mutating data.
- [ ] CSV escaping and PDF/print output are reviewed.
- [ ] Browser storage failure and recovery behaviour are tested.
- [ ] Backup and restore compatibility is tested across application versions.

### Deployment and operations
- [ ] HTTPS deployment is confirmed.
- [ ] Offline application-shell cache and update behaviour are verified.
- [ ] A visible, accurate version number is maintained.
- [ ] Release notes describe data-format or behaviour changes.
- [ ] Rollback to the previous static release is documented.

### Product and security scope
- [ ] Documentation clearly states that records are local to one browser profile.
- [ ] No cloud sync, server-side access control or database encryption is implied.
- [ ] Privacy and storage limitations are visible to users.
- [ ] An owner is assigned for support, backups and security reports.

## Current decision

**Release status: BETA — not approved for Stable or business-critical production use.**

The current implementation is a local-first application. A Stable designation requires completed test evidence; the presence of automated tests alone is insufficient.
