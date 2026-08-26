# KRL Helper

KRL Helper is a Visual Studio Code extension providing language support and productivity features for KUKA Robot Language (KRL).

## Features

- Syntax highlighting for `.src`, `.dat`, and `.sub` files.
- Separate, configurable syntax-color palettes for dark and light themes.
- Document Outline entries for local and global `DEF` and `DEFFCT` declarations.
- Conversion of selected `PTP`, `LIN`, `SPTP`, and `SLIN` motion blocks into iiQKA-style folds.
- Line comments using `;`, including the standard VS Code **Toggle Line Comment** command and dedicated KRL Helper shortcuts.
- Heuristic diagnostics for undeclared variables in `.src` and `.sub` files.
- Project-wide declaration indexing across KRL source and data files.
- Awareness of local declarations, companion DAT declarations, project DAT declarations, and `GLOBAL` declarations in other source files.
- Targeted diagnostics for `$IN[...]` and `$OUT[...]` aliases that follow the `i_` and `o_` naming conventions but are missing from `$config.dat`.

## Installation

### Visual Studio Marketplace

After the extension is published, open the Extensions view in Visual Studio Code, search for **KRL Helper**, and select **Install**.

### Local VSIX

For development or testing, build a VSIX and install it from the command line:

```bash
npm ci
npm run package
npx @vscode/vsce package
code --install-extension krl-helper-0.1.0.vsix
```

You can also use **Extensions: Install from VSIX...** from the Command Palette.

## Usage

Open a `.src`, `.dat`, or `.sub` file. Visual Studio Code automatically selects the KRL language mode.

The Outline view lists supported routine declarations. For example:

```krl
DEF TestProgram()
  DECL BOOL bPartDetected
  DECL INT nCounter

  bPartDetected = FALSE
  nCounter = 0
END
```

Useful commands are available from the Command Palette:

- **KRL Helper: Configure Syntax Colors** opens the dark/light palette editor.
- **KRL Helper: Toggle Line Comment** toggles `;` comments on the selected lines.
- **KRL Helper: Convert Selection to iiQKA Fold** wraps a selected supported motion block in fold metadata.

For fold conversion, select only the motion block without existing `;FOLD` or `;ENDFOLD` lines. Tool and base indices are read from the selection where possible, then from the companion DAT file or `Global_Points.dat`. Display names are read from the nearest workspace `$config.dat`.

## Configuration

`krlHighlighting.applyCustomColors` enables or disables extension-managed KRL TextMate colors. It defaults to `true` and preserves unrelated TextMate rules.

The following settings accept CSS-style hexadecimal colors such as `#C0C0C0` or `#001080`:

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

The color editor stores separate light and dark palettes and switches them with the active VS Code theme.

## Limitations

KRL Helper does not implement the complete KRL grammar and is not a replacement for the controller compiler, simulation, validation, or safety review.

Syntax recognition, symbol extraction, fold conversion, and diagnostics use heuristic, incrementally developed analysis. Valid code can therefore produce false positives or incomplete results, and invalid code may not be detected. Always validate robot programs with the appropriate engineering and controller tools before use.

## Disclaimer

KRL Helper is an independent, unofficial community project.

It is not affiliated with, endorsed by, sponsored by, or maintained by KUKA AG.

KUKA and KUKA Robot Language (KRL) are trademarks or product names of their respective owners.

## Contributing

Issues and pull requests are welcome. Please use synthetic examples and do not submit customer, company, machine, production, or other confidential data.

## License

KRL Helper is available under the [MIT License](LICENSE).

## Repository

Source code and issue tracking are available at [github.com/MichaeINeumann/krl-helper](https://github.com/MichaeINeumann/krl-helper).
