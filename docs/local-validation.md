# Local validation

`npm run validate:local` runs asset preparation, `check` and the complete serial Chromium/WebGL suite. It requires a Node.js version supported by the project and its locked dependencies, installed dependencies matching `package-lock.json`, the matching Playwright Chromium version and a working WebGL environment.

Each invocation creates a unique `latticefolk-validation-*` output directory under the system temporary directory. The stable checkout lock is `.local-validation/running.lock`, opened exclusively. An existing lock causes the invocation to fail; only the invocation that acquired the lock removes it when finished.

After asset preparation, the command records the Git HEAD/tree and a manifest of tracked or nonignored source files with SHA-256 checksums. It writes the source snapshot and tracked-file patch before running `check` and the browser suite. A source change during validation sets `sourceUnchanged` to false and fails the result.

The browser suite uses one worker and the managed server's dedicated `data/latticefolk.e2e.sqlite`, with existing-server reuse disabled. The command compares the regular `data/latticefolk.sqlite` save and its WAL/SHM files before and after `check` and browser execution; any difference sets `regularSaveUnchanged` to false and fails the result.

Each step records its command, timestamps and exit code, while writing stdout and stderr to its log and the console. A failed step stops subsequent steps and produces a failed result. Focused `.only` tests are rejected. Browser JSON statistics must include executed passing cases with no unexpected, flaky or skipped results or global errors. Automatic failure screenshots, retained failure traces, explicit screenshots, attachments and HTML use the same run's output directory.

Standalone Playwright commands create a fresh temporary output root by default. An explicit `PLAYWRIGHT_HTML_OUTPUT_DIR`, or its lower-priority `PLAYWRIGHT_HTML_REPORT` alias, selects the HTML directory; its parent also holds `test-results/` across worker reloads. Local validation sets both HTML variables, JSON and the official `--output` option to the same run's fresh temporary root.

The output directory contains `result.json`, `source-manifest.json`, `source/`, `working.patch`, step logs, `playwright.json`, `playwright-report/` and the same run's `test-results/` when available. `result.json` contains the overall `result` (`in_progress`, `passed` or `failed`), step results, source/save checks and available browser statistics. Failures include an `error` message and a nonzero process exit code. The status line uses `[local-validation] <result>: <output-directory>`.
