# Historical source snapshot archive

Preserves 77 source entries from 31 local historical source ZIPs and one independent diagnostic script, deduplicated into 46 byte-exact source objects. Of these, 37 were absent from the repository before this archival operation and 9 existing Git blobs are reused and anchored in this tree.

These intermediate candidates and diagnostic scripts are not validated fixes or replacements for active development. The `.txt` suffix prevents archived TypeScript from entering compilation and test discovery. The manifest records original relative paths, source-container names, SHA-256, Git blob SHA, archive paths and prior exact commit locations where available.

Validation: local source byte count, SHA-256 and Git blob hashes; exact remote object lookup and historical commit-tree matching; high-confidence credential/private-key pattern check. No build, unit test, browser test or CI validation was performed. Follow CONTRIBUTING.md before adopting a candidate.

This preservation-only change adds only this archive directory. No binary files or ZIP containers are uploaded. Existing runtime source files and active work are unchanged.
