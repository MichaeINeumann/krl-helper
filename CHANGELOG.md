# Changelog

## 0.3.0

### Fixes

- Persist custom dark and light syntax palettes in VS Code user settings so they survive extension updates and participate in Settings Sync
- Add direct hexadecimal color entry with validation and paste support to the KRL Helper settings editor
- Keep theme-scoped palette rules synchronized across VS Code theme changes and multiple open windows

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
