# Kuka Code Helper

## Description
Kuka Code Helper is a Visual Studio Code extension that supports Kuka Robot Language (KRL). It helps in showing functions and methods in the outline.

## Features
- Highlight KRL functions and methods in the outline view.
- Support for both local and global functions and methods.
- Generate iiQKA motion folds (PTP/LIN/SPTP/SLIN) around selected KRL motion blocks.
- Syntax highlighting for KRL `.src`, `.dat` and `.sub` files.
- Native VS Code line-comment toggling for KRL using `;` (e.g. `Strg+#` with the standard German keybinding).
- Explicit KRL comment shortcuts for `Strg+/` and `Strg+#`, including the physical German `#` key.
- Adjustable KRL syntax colors in a dedicated editor with color pickers.
- Separate high-contrast palettes for light and dark VS Code themes, switched automatically with the active theme.
- Readable light-theme defaults use black text, dark red strings and dark blue variable names.
- Applies the active light or dark KRL default palette automatically after installation/startup unless custom colors already exist.
- Separate colors for general control structures, complete `IF` and `SWITCH` blocks, `DO`, `WAIT` and user variable names.
- KRL colors are applied with theme-specific, fully qualified scope rules and also work when a workspace contains its own token-color customizations.
- Stale KRL color rules are removed by managed scope, including unnamed rules and KRL selectors inside otherwise unrelated mixed rules.
- General undeclared-variable diagnostics remain active for KRL code but ignore semicolon comments, block comments and KUKA header directives such as `&COMMENT`, `&PARAM`, `&ACCESS` and `&REL`. Declarations are indexed project-wide: all declarations in project `.dat` files plus `GLOBAL` declarations in foreign `.src`/`.sub` files are recognized. Targeted validation of `$IN[...]` and `$OUT[...]` aliases against `$config.dat` also remains active.

## Installation
1. Download the `.vsix` file from the releases.
2. Open Visual Studio Code.
3. Go to Extensions view by clicking on the Extensions icon in the Sidebar.
4. Click on the three dots at the top-right corner of the Extensions view.
5. Choose `Install from VSIX...`.
6. Select the downloaded `.vsix` file.

## Usage
- Open a KRL file with a `.src` extension.
- Functions and methods will be displayed in the outline view.
- Use `KRL-HELPER: Syntaxfarben einstellen` from the command palette to open the dedicated color editor.
- Select the KRL motion block (without any `;FOLD` / `;ENDFOLD`) and run:
  - Command: `KRL-HELPER: Convert Selection to iiQKA Fold` (`kukaFoldTools.convertSelection`)
  - The selection is wrapped by the new iiQKA fold.
  - Tool/Base indices are detected in the selection (e.g. `$TOOL = TOOL_DATA[n]`, `$BASE = BASE_DATA[n]`, `BAS(#TOOL, n)`, `BAS(#BASE, n)`), otherwise looked up via `FDAT_ACT` in the companion `.dat` file (same basename).
- Tool/Base names are looked up from `$config.dat` in the workspace (prefers `KRC/R1/System/$config.dat` closest to the active file, otherwise falls back to any `$config.dat`). If empty, the names are omitted in the fold header.

### Example keybinding
Add this to your VS Code `keybindings.json`:
```json
{
  "key": "ctrl+alt+k",
  "command": "kukaFoldTools.convertSelection",
  "when": "editorTextFocus && editorLangId == 'krl'"
}
```

## Contributing
If you want to contribute to the development of this extension, feel free to open issues or submit pull requests on GitHub.

## Build from source

```bash
npm install
npm run compile
npx @vscode/vsce package
```

The build produces `dist/extension.js`. The VSIX packaging
command creates the installable extension package from the current version in
`package.json`.

## License
[MIT](https://github.com/MichaeINeumann/krl-helper/blob/HEAD/LICENSE)
