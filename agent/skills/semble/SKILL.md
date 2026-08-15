---
name: semble
description: Use Semble for natural-language semantic code search, related-code discovery, and locating implementation concepts across a repository.
---

Use Semble before broad grep/read exploration when the target is conceptual rather than an exact symbol or string.

```bash
semble search "natural-language query" . --top-k 10 --max-snippet-lines 20
semble find-related path/to/file.ts 42 .
```

Use the current repository path unless the user names another repository. Search `--content code` by default; use `docs`, `config`, or `all` only when the request needs them. Treat returned snippets as leads, then read the exact source section before editing. Use grep for exact text and LSP for symbols, references, definitions, and refactors.
