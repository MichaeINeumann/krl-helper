# Changelog

## 0.3.0

### Features

- Direct hexadecimal color entry with validation and paste support in the KRL Helper settings editor
- Dedicated dark and light syntax colors for `SIGNAL` declarations, including the keyword and declared signal name

### Fixes

- Persist custom dark and light syntax palettes in VS Code user settings so they survive extension updates, reinstalls, and cleared extension storage, and participate in Settings Sync
- Keep theme-scoped palette rules synchronized across VS Code theme changes and multiple open windows
- Preserve KRL colors beneath existing Workspace and Workspace Folder theme customizations without writing profile-specific palettes into shared settings

### Deprecations

- The per-color `krlHighlighting.colors.*` settings are deprecated. Existing values are migrated once into `krlHighlighting.palettes`; use **KRL Helper: Open Settings** to change syntax colors.
- `krlHighlighting.applyCustomColors` is now application-scoped. It always controlled a single user-level value, so a per-workspace override was never actually isolated.

## 0.2.0

### Features

- Unified **KRL Helper Settings** editor with Dark Colors, Light Colors, and Diagnostics tabs
- User- and workspace-scoped prefix settings for local variables, global variables, input aliases, and output aliases
- Visibility-aware local and global declaration analysis for module DAT files, `$config.dat`, public DAT files, and global source declarations
- Case-insensitive project function index with hover and Go to Definition, including same-named module entry routines
- Go to Definition for visible local, companion-DAT, parameter, and project-global variables
- Shared `DEF` / `DEFFCT` parser for Outline and function navigation, including unsaved documents

### Documentation

- Clarified that old `;FOLD` and `;ENDFOLD` lines must be deleted manually before iiQKA fold conversion

## 0.1.0

Initial public Marketplace-ready release.

### Features

- KRL syntax highlighting for SRC, DAT, and SUB files
- Configurable dark and light syntax-color palettes
- Document Outline support for local and global routines
- Conversion of selected motion blocks into iiQKA-style folds
- Standard and dedicated KRL line-comment commands
- Heuristic undeclared-variable diagnostics
- Project-wide declaration indexing with local and global visibility handling
- Targeted `$IN[...]` and `$OUT[...]` alias diagnostics using `$config.dat`
