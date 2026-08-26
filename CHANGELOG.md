# Change Log

## 0.0.29

- Uses the stored light and dark palettes as the only source for extension-managed TextMate rules, preventing stale generated rules from being imported back into both palettes.
- Rebuilds the complete active palette deterministically on every theme change and removes the configuration feedback loop that could restore stale colors.
- Migrates generated rules from global, workspace and workspace-folder settings without touching unrelated TextMate rules.
- Splits the syntax-color editor into accessible light and dark tabs with a separate default reset for each palette.

## 0.0.28

- Resets stale generated syntax-color state once so a light theme starts with black normal text instead of inherited dark-theme gray.
- Applies the stored light or dark palette directly on theme changes without first importing stale rules from the newly selected theme.
- Also reacts explicitly to changes of `workbench.colorTheme` and reapplies colors when a KRL editor becomes active.

## 0.0.27

- Loads existing effective KRL TextMate colors before synchronizing extension-managed rules.
- Shows the currently configured colors when the syntax color editor is opened or revealed again.
- Refreshes the color editor after theme and relevant configuration changes without replacing unrelated TextMate rules.
- Adds a dedicated KRL line-comment command with explicit `Ctrl+/`, `Ctrl+#` and German-layout scan-code bindings.
- Improves light-theme defaults with black normal text, dark red strings and dark blue variable names.
- Initializes the active KRL default palette automatically after VS Code startup while preserving existing user colors.
- Delays the single first-start color synchronization until theme initialization is stable.
- Reads and updates the window-scoped token-color configuration without an invalid document resource.
- Uses the valid `MichaeINeumann` publisher identifier so the extension can be packaged and installed normally.

## 0.0.26

- Adds a project-wide KRL declaration index for undeclared-variable diagnostics.
- Scans `.dat`, `.src` and `.sub` files recursively inside the current KRL project/workspace.
- Treats declarations from project `.dat` files as project-visible and indexes only `GLOBAL` declarations from foreign `.src`/`.sub` files, so local variables from unrelated programs do not hide real errors.
- Rebuilds the declaration index when KRL files are created, changed, deleted, opened, edited or closed. Unsaved open KRL files are read directly from the editor.
- Keeps the existing companion-DAT, system-file and `$config.dat` alias checks.

## 0.0.25

- Adds a VS Code language configuration for KRL.
- Registers `;` as the KRL line-comment marker so the standard **Toggle Line Comment** command works (for example `Strg+#` with the usual German VS Code keybinding).
- Keeps the existing diagnostics behavior while running diagnostics directly in the extension process, removing the runtime Language Client/Server package dependency.
- Leaves syntax highlighting, outline and iiQKA fold conversion behavior unchanged.

## 0.0.24

- Uses one configurable color for the complete `IF` / `THEN` / `ELSE` / `ENDIF` block.
- Uses one configurable color for the complete `SWITCH` / `CASE` / `DEFAULT` / `ENDSWITCH` block.
- Keeps the scope-based stale-rule cleanup from version 0.0.23.
- Leaves the language server and all non-highlighting functions unchanged.

## 0.0.23

- Removes stale extension-managed KRL color scopes even when their rule name does not start with `KRL Helper:`.
- Preserves non-KRL selectors from mixed TextMate rules while removing only the managed KRL selectors.
- Cleans managed KRL scopes from inactive theme-specific customization blocks so they cannot become active again after a theme switch.
- Leaves the version 0.0.21 language-server diagnostics unchanged.

## 0.0.22

- Applies KRL colors at the effective global, workspace or workspace-folder setting level instead of always writing only to the global level.
- Adds active-theme-specific color rules and fully qualified KRL scope selectors so theme rules cannot override `IF`, `SWITCH`, `DO`, `WAIT` and variable colors.
- Disables semantic highlighting for KRL by default so the configurable TextMate colors remain authoritative.
- Leaves the version 0.0.21 language-server diagnostics unchanged.

## 0.0.21

- Keeps general undeclared-variable diagnostics enabled.
- Suppresses diagnostics only inside semicolon comments, supported block comments and KUKA header directives such as `&COMMENT` and `&PARAM`.
- Preserves comment syntax highlighting and exact diagnostic offsets.

## 0.0.20

- Adds separate color settings for control structures, `IF`, `SWITCH`, `DO`, `WAIT` and user variable names.
- Uses high-contrast default colors for all new categories in light themes.
- Temporarily disabled general undeclared-variable diagnostics while investigating false positives in comments.
- Kept the targeted `$IN[...]` / `$OUT[...]` alias validation against `$config.dat` active.

## 0.0.19

- Dedicated color settings editor with native color pickers.
- Separate, automatically selected palettes for light and dark themes.
- Simplified VS Code configuration schema for broader compatibility.
- Fixes missing KRL color settings in the graphical settings editor.

## 0.0.18

- KRL syntax highlighting for `.src`, `.dat` and `.sub` files.
- Charcoal color defaults matching KUKA WorkVisual-style syntax categories.
- Configurable KRL colors under `KRL Syntax Highlighting` in the VS Code settings.
- Existing outline, language server and iiQKA fold conversion functions are unchanged.

All notable changes to the "krl-helper" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
