# Local validation

Run `npm run validate:local` with compatible Node, project dependencies and Playwright Chromium already installed. The command runs asset preparation, `npm run check` and the complete serial Chromium suite.

Each run creates an independent `latticefolk-validation-*` directory under the operating system temporary directory. The console prints its path. It contains `result.json`, `source-manifest.json`, `source/`, `working.patch`, command logs, `playwright.json`, `playwright-report/` and the current run's `test-results/` when generated. Selected implementation files and their path-limited tracked-file patch are captured before the check and browser commands. Snapshots use the source, server, test, script, documentation, asset and GitHub configuration directories plus named root configuration/license files and the tracked dialogue seed/example JSONL inputs. Dependency, result, runtime, Git metadata and credential files are excluded; the root `.env.example` remains a configuration sample.

A stable checkout-specific lock lives under the temporary directory's `latticefolk-validation-locks/` hierarchy. Its JSON records the owning PID and output directory. For a lock remaining after an interrupted process, confirm that PID has exited before manually removing the lock. An older `.local-validation/running.lock` also blocks the command until its owning process has exited and that lock is handled. Concurrent runs against the same checkout require separate source and database isolation.

The browser server uses `data/latticefolk.e2e.sqlite`, one worker and a fresh managed server. Results, HTML and JSON output paths are passed explicitly to that browser run. A normal player save is compared before and after validation.

A nonzero command exit, missing or incomplete browser results, failing/skipped/flaky cases, changed source or a changed normal save produces exit code 1. Available logs and results stay in the run directory for diagnosis. Browser initialization errors remain failures of that run.
