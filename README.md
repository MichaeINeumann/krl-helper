# KRL Helper

KRL Helper is a Visual Studio Code extension providing language support and productivity features for KUKA Robot Language (KRL).

## Features

- Syntax highlighting for `.src`, `.dat`, and `.sub` files.
- Separate, configurable syntax-color palettes for dark and light themes.
- Shared function parsing for local and global `DEF` and `DEFFCT` declarations.
- Document Outline, function hover, and **Go to Definition** for project routines and variables.
- Conversion of selected `PTP`, `LIN`, `SPTP`, and `SLIN` motion blocks into iiQKA-style folds.
- Line comments using `;`, including the standard VS Code **Toggle Line Comment** command and dedicated KRL Helper shortcuts.
- Configurable diagnostics for local variables, global variables, and `$IN[...]` / `$OUT[...]` aliases.
- Visibility-aware declaration indexing across module files, public DAT files, `$config.dat`, and global source declarations.

## Installation

### Visual Studio Marketplace

After the extension is published, open the Extensions view in Visual Studio Code, search for **KRL Helper**, and select **Install**.

### Local VSIX

For development or testing, build a VSIX and install it from the command line:

```bash
npm ci
npm run package
npx @vscode/vsce package
code --install-extension krl-helper-0.3.0.vsix
```

You can also use **Extensions: Install from VSIX...** from the Command Palette.

## Usage

Open a `.src`, `.dat`, or `.sub` file. Visual Studio Code automatically selects the KRL language mode.

The Outline view lists supported routine declarations. Hovering a user-defined function call shows its complete declaration, visibility, relative file path, and line number. **Go to Definition** returns all visible function or variable declarations, with declarations in the current document first.

For example:

```krl
DEF TestProgram()
  DECL BOOL bPartDetected
  DECL INT nCounter

  bPartDetected = FALSE
  nCounter = 0
END
```

Useful commands are available from the Command Palette:

- **KRL Helper: Open Settings** opens the **Dark Colors**, **Light Colors**, and **Diagnostics** tabs.
- **KRL Helper: Toggle Line Comment** toggles `;` comments on the selected lines.
- **KRL Helper: Convert Selection to iiQKA Fold** wraps a selected supported motion block in fold metadata.

For fold conversion, select only the motion block. Existing old `;FOLD` and `;ENDFOLD` lines are not removed automatically: delete those lines manually before selecting and converting the motion block. Tool and base indices are read from the selection where possible, then from the companion DAT file or `Global_Points.dat`. Display names are read from the nearest workspace `$config.dat`.

## Configuration

`krlHighlighting.applyCustomColors` enables or disables extension-managed KRL TextMate colors. It defaults to `true`, applies to all windows, and preserves unrelated TextMate rules.

### Syntax colors

Both palettes are stored together in the user setting `krlHighlighting.palettes`. Because that is normal VS Code configuration rather than extension state, custom colors survive extension updates, reinstalls, and a cleared extension storage, and they participate in Settings Sync.

Open **KRL Helper: Open Settings** to edit them. Every color accepts `#RGB`, `#RGBA`, `#RRGGBB`, and `#RRGGBBAA`, entered either through the picker or typed directly into the hex field. **Restore Defaults** changes the selected palette draft only; **Apply Colors** then saves both palettes in a single atomic write.

Managed rules are written only to User Settings and scoped with a distinct repeated exact-theme selector, so dark and light palettes stay available when VS Code windows use different themes. Existing single exact-theme overrides in Workspace and Workspace Folder settings coexist with those selectors and keep all unrelated rules; KRL Helper does not write profile-specific palettes into shared workspace files. The rules are recomputed from the stored palettes and skipped when nothing would change, which keeps concurrent windows and profiles from overwriting each other repeatedly. Palettes and extension-owned workspace rules from older extension versions are migrated automatically on first start.

#### Deprecated per-color settings

The following settings are deprecated. Their values are migrated once into `krlHighlighting.palettes` and are no longer read afterwards; use the settings editor instead.

| Setting | Token category |
| --- | --- |
| `krlHighlighting.colors.normalText` | Regular KRL text |
| `krlHighlighting.colors.comments` | Semicolon comments |
| `krlHighlighting.colors.blockComments` | Supported alternative block comments |
| `krlHighlighting.colors.strings` | String literals |
| `krlHighlighting.colors.numbers` | Numeric literals |
| `krlHighlighting.colors.programFlow` | Program-flow and declaration keywords |
| `krlHighlighting.colors.controlStructures` | General control structures |
| `krlHighlighting.colors.ifKeyword` | `IF` blocks |
| `krlHighlighting.colors.switchKeyword` | `SWITCH` blocks |
| `krlHighlighting.colors.doKeyword` | `DO` |
| `krlHighlighting.colors.waitKeyword` | `WAIT` |
| `krlHighlighting.colors.variableNames` | User variable names |
| `krlHighlighting.colors.setupCommands` | Setup commands |
| `krlHighlighting.colors.motionCommands` | Motion commands |
| `krlHighlighting.colors.mathFunctions` | Mathematical operators and functions |
| `krlHighlighting.colors.ioCommands` | I/O, trigger, and interrupt commands |
| `krlHighlighting.colors.typeDefinitions` | KRL data types |
| `krlHighlighting.colors.systemVariables` | `$`-prefixed system variables |
| `krlHighlighting.colors.listFunctions` | Boolean and enum values plus string/list functions |

### Diagnostics

The Diagnostics tab and native VS Code Settings expose four array settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `krlHelper.diagnostics.localVariablePrefixes` | `["b", "n"]` | Variables that prefer a local declaration and can fall back to a visible explicit `GLOBAL` declaration |
| `krlHelper.diagnostics.globalVariablePrefixes` | `["b_", "n_"]` | Variables that require a global declaration |
| `krlHelper.diagnostics.inputAliasPrefixes` | `["i_"]` | `$IN[...]` aliases that must exist in `$config.dat` |
| `krlHelper.diagnostics.outputAliasPrefixes` | `["o_"]` | `$OUT[...]` aliases that must exist in `$config.dat` |

Each Diagnostics field can be edited at **User** or **Workspace** scope. Workspace overrides take precedence; inherited values are marked in the editor. **Reset** removes only the selected scope's override. Prefixes are trimmed, deduplicated case-insensitively, and matched literally. An empty list disables that check.

Global prefixes are evaluated before local prefixes, so `b_Part` is global with the defaults even though it also starts with `b`. A one-character prefix matches only when followed by an uppercase letter, a digit, or `_`; KRL keywords are excluded from variable diagnostics.

Local declarations are taken from the current `.src` or `.sub`, its function parameters, and its same-named companion `.dat`. Global-prefixed variables are checked only against the global declaration space; a normal local declaration does not satisfy that check. Global declarations come from:

- every declaration in `$config.dat`;
- declarations with an explicit `GLOBAL` modifier in another DAT only when that DAT has a case-insensitive `DEFDAT <Name> PUBLIC` header; and
- explicit global declarations in project `.src` and `.sub` files.

KRL permits the DAT forms `DECL GLOBAL <type>`, `GLOBAL DECL <type>`, and `GLOBAL <type>`. All three participate in the same project-global visibility rules. A local-prefixed reference first uses a valid local declaration and otherwise falls back to a visible explicit `GLOBAL` declaration.

The diagnostics check declaration existence and visibility. They do not yet validate whether a prefix agrees with the declared KRL data type.

### Function and variable navigation

Function lookup is case-insensitive and supports `DEF`, `GLOBAL DEF`, `DEFFCT`, and `GLOBAL DEFFCT`. All functions in the current document are visible. From another `.src` or `.sub`, explicit global routines and the module entry routine whose name matches the source filename are visible. Other local helper routines remain private. Comments, known KRL built-ins, and unresolved calls produce no navigation result.

Variable **Go to Definition** uses the same visibility rules as diagnostics: current source declarations and parameters, the same-named companion DAT, `$config.dat`, public DAT declarations with an explicit `GLOBAL` modifier, and explicit global source declarations. Local-prefixed variables fall back to a visible project global only when no valid local declaration exists; prefix-classified global variables never fall back to a same-named local declaration. For individually opened files below a `KRC/R1` tree, navigation infers that tree as the project root. Both project indexes use unsaved open documents and refresh after file, editor, configuration, and workspace changes.

## Limitations

KRL Helper does not implement the complete KRL grammar and is not a replacement for the controller compiler, simulation, validation, or safety review.

Syntax recognition, symbol extraction, fold conversion, and diagnostics use heuristic, incrementally developed analysis. Valid code can therefore produce false positives or incomplete results, and invalid code may not be detected. Always validate robot programs with the appropriate engineering and controller tools before use.

## Disclaimer

KRL Helper is an independent, unofficial community project.

It is not affiliated with, endorsed by, sponsored by, or maintained by KUKA AG.

KUKA and KUKA Robot Language (KRL) are trademarks or product names of their respective owners.

## Support

KRL Helper is maintained as a personal open-source project on a best-effort basis. See [SUPPORT.md](SUPPORT.md) for support expectations, reporting guidance, and the full project disclaimer.

## Contributing

Issues and pull requests are welcome. Please use synthetic examples and do not submit customer, company, machine, production, or other confidential data.

## License

KRL Helper is available under the [MIT License](LICENSE).

## Repository

Source code and issue tracking are available at [github.com/MichaeINeumann/krl-helper](https://github.com/MichaeINeumann/krl-helper).
