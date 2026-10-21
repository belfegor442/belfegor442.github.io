# ERROR-PREVENTION — own mistakes & patterns

## Historical (from prior sessions, keep applying)
1. PS 5.1 quoting: python inline in PS breaks — always write .py to %TEMP%\opencode\ and run file.
2. .NET File APIs resolve relative paths against process cwd, not shell cwd — use absolute paths.
3. LNK1104: cannot rebuild ws-server while prod process or `\ws-keepalive` task holds the exe — schtasks /end + /disable first.
4. Never `git add -A` in site-mobile (Brew files untracked on purpose).
5. Playwright XP logon: if #authUsername hidden (remembered tile), click #tileOther before typing user.
6. PS5.1 has no `&&`, no `Get-NetUDPConnection`, no `-SkipCertificateCheck` — use curl.exe -k.
7. Unicode output: sys.stdout.reconfigure(encoding="utf-8") in python tests; chcp 65001 for node checks.
8. Long commit messages via -F file (PS escapes) — commit_msg_*.txt in %TEMP%.

## Patterns to re-scan for in client code (this protocol)
- JSON.parse of network data without try/catch
- fetch without timeout (hanging UI on dead network)
- setInterval/setTimeout ids not cleared on teardown
- innerHTML without esc()
- addEventListener registered repeatedly without removal
