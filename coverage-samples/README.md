# Coverage Samples

Runnable sample bundles for validating `node out/report.js` against every
supported coverage format without installing every producer stack.

Each sample directory contains:

- a self-authored coverage artifact with a normal filename
- a tiny matching source tree so EyeCov can resolve paths immediately
- `README.md` with the exact CLI command
- `SOURCE.md` with format references, freshness notes, and any localization notes

Samples live here instead of `test-workspace/` because they are primarily
CLI-validation inputs, not extension-demo assets.

These bundles are self-authored fixtures informed by current official docs,
maintained upstream projects, and public examples. They are kept runnable inside
this repo while preserving the relevant on-wire format shape, but they should
not be treated as verbatim vendored upstream artifacts.
