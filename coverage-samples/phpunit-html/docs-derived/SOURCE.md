# Source

- Source type: `self-authored fixture`
- Checked date: `2026-03-18`
- Format references:
  - `https://docs.phpunit.de/en/12.5/configuration.html`
  - `https://docs.phpunit.de/en/12.5/code-coverage.html`
  - `/Users/odinn/Projects/eyecov/eyecov-vscode/docs/COVERAGE_HTML_FORMAT.md`
- Localized: `n/a`

This bundle is a self-authored PHPUnit HTML fixture shaped to the current
PHPUnit / php-code-coverage HTML layout that EyeCov parses. I did not find a
clean current public raw HTML artifact worth vendoring directly, so this sample
uses the documented report structure plus EyeCov’s parser contract instead of
copying an upstream report.
