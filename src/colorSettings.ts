import * as vscode from 'vscode';

const rulePrefix = 'KRL Helper: ';
const storageKey = 'krlHelper.syntaxColors';
const deterministicMigrationKey = 'krlHelper.syntaxColorsDeterministic.v4';
const colorPattern = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type TextMateScope = string | readonly string[];

interface ColorDefinition {
  label: string;
  key: string;
  scope: TextMateScope;
  darkFallback: string;
  lightFallback: string;
}

export interface TextMateRule {
  name?: string;
  scope?: TextMateScope;
  settings?: {
    foreground?: string;
  };
}

export interface TokenColorCustomizations {
  textMateRules?: TextMateRule[];
  [key: string]: unknown;
}

const colorDefinitions: readonly ColorDefinition[] = [
  { label: 'Regular text', key: 'normalText', scope: 'source.krl', darkFallback: '#C0C0C0', lightFallback: '#000000' },
  { label: 'Comments', key: 'comments', scope: 'comment.line.semicolon.krl', darkFallback: '#00FF00', lightFallback: '#59636D' },
  { label: 'Alternative block comments', key: 'blockComments', scope: 'comment.block.alternative.krl', darkFallback: '#75715E', lightFallback: '#59636D' },
  { label: 'Strings', key: 'strings', scope: ['string.quoted.double.krl', 'string.quoted.single.krl'], darkFallback: '#FFFFFF', lightFallback: '#A31515' },
  { label: 'Numbers', key: 'numbers', scope: 'constant.numeric.krl', darkFallback: '#AE81FF', lightFallback: '#003C3C' },
  { label: 'Program flow and declarations', key: 'programFlow', scope: 'keyword.control.flow.krl', darkFallback: '#F92672', lightFallback: '#0E6683' },
  { label: 'Control structures', key: 'controlStructures', scope: 'keyword.control.structure.krl', darkFallback: '#F92672', lightFallback: '#7A1F5C' },
  { label: 'IF / THEN / ELSE / ENDIF', key: 'ifKeyword', scope: 'keyword.control.if.krl', darkFallback: '#66D9EF', lightFallback: '#005A9C' },
  { label: 'SWITCH / CASE / DEFAULT / ENDSWITCH', key: 'switchKeyword', scope: 'keyword.control.switch.krl', darkFallback: '#AE81FF', lightFallback: '#6A2C91' },
  { label: 'DO keyword', key: 'doKeyword', scope: 'keyword.control.do.krl', darkFallback: '#FF8000', lightFallback: '#8A3B00' },
  { label: 'WAIT keyword', key: 'waitKeyword', scope: 'keyword.control.wait.krl', darkFallback: '#E8ED12', lightFallback: '#6E5700' },
  { label: 'Variable names', key: 'variableNames', scope: 'variable.other.user.krl', darkFallback: '#C0C0C0', lightFallback: '#001080' },
  { label: 'Setup commands', key: 'setupCommands', scope: ['support.function.setup.krl', 'keyword.other.setup.krl', 'keyword.other.preprocessor.krl'], darkFallback: '#FFC042', lightFallback: '#830104' },
  { label: 'Motion commands', key: 'motionCommands', scope: ['keyword.control.motion.krl', 'constant.other.motion-blending.krl'], darkFallback: '#FF8000', lightFallback: '#B43A00' },
  { label: 'Math and functions', key: 'mathFunctions', scope: ['keyword.operator.logical.krl', 'support.function.math.krl'], darkFallback: '#FFC042', lightFallback: '#5757C8' },
  { label: 'I/O commands', key: 'ioCommands', scope: ['keyword.control.io.krl', 'support.function.io.krl'], darkFallback: '#FFC042', lightFallback: '#006B9F' },
  { label: 'Type definitions', key: 'typeDefinitions', scope: 'storage.type.krl', darkFallback: '#FFC042', lightFallback: '#0E6683' },
  { label: 'System variables', key: 'systemVariables', scope: 'variable.other.system.krl', darkFallback: '#E8ED12', lightFallback: '#0000FF' },
  { label: 'List functions', key: 'listFunctions', scope: ['constant.language.boolean.krl', 'constant.other.enum.krl', 'support.function.list.krl'], darkFallback: '#FFC042', lightFallback: '#0E6683' }
];

let extensionContext: vscode.ExtensionContext | undefined;
let colorPanel: vscode.WebviewPanel | undefined;
let colorUpdateQueue: Promise<void> = Promise.resolve();

export type PaletteName = 'dark' | 'light';

interface StoredPalettes {
  dark?: Record<string, string>;
  light?: Record<string, string>;
}

function activePalette(): PaletteName {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}

function storedColors(palette: PaletteName): Record<string, string> {
  const value = extensionContext?.globalState.get<StoredPalettes | Record<string, string>>(storageKey, {}) ?? {};
  if ('dark' in value || 'light' in value) {
    const paletteValue = (value as StoredPalettes)[palette];
    return paletteValue && typeof paletteValue === 'object' ? paletteValue : {};
  }
  return palette === 'dark' ? value as Record<string, string> : {};
}

function storedPalettes(): StoredPalettes {
  const value = extensionContext?.globalState.get<StoredPalettes | Record<string, string>>(storageKey, {}) ?? {};
  if ('dark' in value || 'light' in value) {
    const stored = value as StoredPalettes;
    return {
      dark: stored.dark && typeof stored.dark === 'object' ? { ...stored.dark } : {},
      light: stored.light && typeof stored.light === 'object' ? { ...stored.light } : {}
    };
  }
  return { dark: { ...value as Record<string, string> }, light: {} };
}

function configuredColor(definition: ColorDefinition, palette: PaletteName = activePalette()): string {
  const fallback = palette === 'light' ? definition.lightFallback : definition.darkFallback;
  const storedValue = storedColors(palette)[definition.key];
  if (typeof storedValue === 'string' && colorPattern.test(storedValue)) {
    return storedValue;
  }

  const value = palette === 'dark'
    ? vscode.workspace.getConfiguration('krlHighlighting.colors').get<string>(definition.key, fallback)
    : fallback;
  return colorPattern.test(value) ? value : fallback;
}

function defaultColors(palette: PaletteName): Record<string, string> {
  return Object.fromEntries(colorDefinitions.map(definition => [
    definition.key,
    palette === 'light' ? definition.lightFallback : definition.darkFallback
  ]));
}

function buildRules(
  palette: PaletteName = activePalette(),
  definitions: readonly ColorDefinition[] = colorDefinitions
): TextMateRule[] {
  return definitions.map(definition => ({
    name: `${rulePrefix}${definition.label}`,
    scope: contextualKrlScope(definition.scope),
    settings: {
      foreground: configuredColor(definition, palette)
    }
  }));
}

function contextualKrlScope(scope: TextMateScope): TextMateScope {
  return splitScopeSelectors(scope).map(value => value === 'source.krl' ? value : `source.krl ${value}`);
}

function isKrlRule(rule: TextMateRule): boolean {
  return typeof rule.name === 'string' && rule.name.startsWith(rulePrefix);
}

export async function synchronizeTokenColors(): Promise<void> {
  const editorConfiguration = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfiguration.inspect<TokenColorCustomizations>('tokenColorCustomizations');
  const layer = activeConfigurationLayer(inspected);
  const enabled = vscode.workspace.getConfiguration('krlHighlighting').get<boolean>('applyCustomColors', true);
  const nextValue = updateCustomizationValue(layer.value, enabled);

  if (JSON.stringify(layer.value) !== JSON.stringify(nextValue)) {
    await editorConfiguration.update(
      'tokenColorCustomizations',
      nextValue,
      layer.target
    );
  }
}

interface ConfigurationLayer {
  target: vscode.ConfigurationTarget;
  value: TokenColorCustomizations;
}

interface InspectedTokenColors {
  globalValue?: TokenColorCustomizations;
  workspaceValue?: TokenColorCustomizations;
  workspaceFolderValue?: TokenColorCustomizations;
}

function activeConfigurationLayer(inspected: InspectedTokenColors | undefined): ConfigurationLayer {
  if (inspected?.workspaceFolderValue && typeof inspected.workspaceFolderValue === 'object') {
    return { target: vscode.ConfigurationTarget.WorkspaceFolder, value: inspected.workspaceFolderValue };
  }
  if (inspected?.workspaceValue && typeof inspected.workspaceValue === 'object') {
    return { target: vscode.ConfigurationTarget.Workspace, value: inspected.workspaceValue };
  }
  const globalValue = inspected?.globalValue && typeof inspected.globalValue === 'object'
    ? inspected.globalValue
    : {};
  return { target: vscode.ConfigurationTarget.Global, value: globalValue };
}

function rulesWithoutHelperColors(rules: unknown): TextMateRule[] {
  const existingRules = Array.isArray(rules) ? rules as TextMateRule[] : [];
  return existingRules.filter(rule => !isKrlRule(rule));
}

function splitScopeSelectors(scope: TextMateScope | undefined): string[] {
  if (!scope) {
    return [];
  }
  const values = typeof scope === 'string' ? [scope] : [...scope];
  return values
    .flatMap(value => value.split(','))
    .map(value => value.trim().replace(/\s+/g, ' '))
    .filter(value => value.length > 0);
}

export function updateCustomizationValue(
  currentValue: TokenColorCustomizations,
  enabled: boolean,
  themeSelector = activeThemeSelector(),
  palette: PaletteName = activePalette()
): TokenColorCustomizations {
  const nextValue: TokenColorCustomizations = { ...removeAllHelperColors(currentValue) };

  if (!enabled) {
    return nextValue;
  }

  const activeRules = buildRules(palette);
  nextValue.textMateRules = [
    ...rulesWithoutHelperColors(nextValue.textMateRules),
    ...activeRules
  ];
  if (themeSelector) {
    const currentThemeValue = nextValue[themeSelector] && typeof nextValue[themeSelector] === 'object'
      ? nextValue[themeSelector] as TokenColorCustomizations
      : {};
    nextValue[themeSelector] = {
      ...currentThemeValue,
      textMateRules: [
        ...rulesWithoutHelperColors(currentThemeValue.textMateRules),
        ...activeRules
      ]
    };
  }
  return nextValue;
}

export function removeAllHelperColors(currentValue: TokenColorCustomizations): TokenColorCustomizations {
  let nextValue = currentValue;
  if (Array.isArray(currentValue.textMateRules) && currentValue.textMateRules.some(isKrlRule)) {
    nextValue = {
      ...nextValue,
      textMateRules: rulesWithoutHelperColors(currentValue.textMateRules)
    };
  }
  for (const [key, value] of Object.entries(currentValue)) {
    if (/^\[.+\]$/.test(key) && value && typeof value === 'object') {
      const themeValue = value as TokenColorCustomizations;
      if (Array.isArray(themeValue.textMateRules) && themeValue.textMateRules.some(isKrlRule)) {
        if (nextValue === currentValue) {
          nextValue = { ...currentValue };
        }
        nextValue[key] = {
          ...themeValue,
          textMateRules: rulesWithoutHelperColors(themeValue.textMateRules)
        };
      }
    }
  }
  return nextValue;
}

function activeThemeSelector(): string {
  const themeName = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', '').trim();
  return themeName ? `[${themeName}]` : '';
}

function queueColorUpdate(task: () => Promise<void>): Promise<void> {
  const nextUpdate = colorUpdateQueue.then(task, task);
  colorUpdateQueue = nextUpdate.catch(error => {
    console.error('KRL Helper: Syntax colors could not be updated.', error);
  });
  return nextUpdate;
}

function synchronizeSafely(): void {
  void queueColorUpdate(() => synchronizeTokenColors());
}

async function migrateLegacyHelperRules(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(deterministicMigrationKey, false)) {
    return;
  }

  const editorConfiguration = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfiguration.inspect<TokenColorCustomizations>('tokenColorCustomizations');
  const layers: readonly { target: vscode.ConfigurationTarget; value?: TokenColorCustomizations }[] = [
    { target: vscode.ConfigurationTarget.Global, value: inspected?.globalValue },
    { target: vscode.ConfigurationTarget.Workspace, value: inspected?.workspaceValue },
    { target: vscode.ConfigurationTarget.WorkspaceFolder, value: inspected?.workspaceFolderValue }
  ];

  for (const layer of layers) {
    if (!layer.value || typeof layer.value !== 'object') {
      continue;
    }
    const cleanedValue = removeAllHelperColors(layer.value);
    if (JSON.stringify(layer.value) !== JSON.stringify(cleanedValue)) {
      await editorConfiguration.update('tokenColorCustomizations', cleanedValue, layer.target);
    }
  }

  await context.globalState.update(deterministicMigrationKey, true);
}

async function initializeTokenColors(context: vscode.ExtensionContext): Promise<void> {
  await migrateLegacyHelperRules(context);
  await synchronizeTokenColors();
}

function colorPickerValue(value: string): string {
  const full = /^#([0-9a-fA-F]{6})/.exec(value);
  if (full) {
    return `#${full[1]}`;
  }

  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])/.exec(value);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : '#FFFFFF';
}

function createNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function colorSettingsHtml(webview: vscode.Webview, initialPalette = activePalette()): string {
  const scriptNonce = createNonce();
  const paletteSection = (palette: PaletteName, title: string, description: string): string => {
    const rows = colorDefinitions.map(definition => {
      const value = colorPickerValue(configuredColor(definition, palette));
      const defaultValue = colorPickerValue(palette === 'light' ? definition.lightFallback : definition.darkFallback);
      return `<label class="row"><span>${definition.label}</span><span class="control"><input type="color" data-palette="${palette}" data-key="${definition.key}" data-default="${defaultValue}" value="${value}"><code>${value.toUpperCase()}</code></span></label>`;
    }).join('');
    const hidden = palette === initialPalette ? '' : ' hidden';
    return `<section id="${palette}-panel" role="tabpanel" aria-labelledby="${palette}-tab"${hidden}><h2>${title}</h2><p>${description}</p><div class="panel">${rows}</div></section>`;
  };
  const palettes = paletteSection(
    'dark',
    'Dark theme',
    'High-contrast defaults for dark editor backgrounds.'
  ) + paletteSection(
    'light',
    'Light theme',
    'Contrast-optimized defaults for light editor backgrounds.'
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KRL Syntax Colors</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); max-width: 760px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 17px; margin: 22px 0 6px; }
    p { color: var(--vscode-descriptionForeground); margin: 0 0 22px; }
    .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border); margin-top: 22px; }
    button.tab { color: var(--vscode-foreground); background: transparent; border-bottom: 2px solid transparent; padding: 9px 18px; }
    button.tab:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    button.tab[aria-selected="true"] { color: var(--vscode-foreground); background: var(--vscode-editor-background); border-bottom-color: var(--vscode-focusBorder); }
    [role="tabpanel"][hidden] { display: none; }
    .panel { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 44px; padding: 5px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
    .row:last-child { border-bottom: 0; }
    .control { display: flex; align-items: center; gap: 12px; }
    input[type=color] { width: 58px; height: 30px; border: 1px solid var(--vscode-input-border); background: transparent; cursor: pointer; padding: 2px; }
    code { min-width: 72px; color: var(--vscode-foreground); }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
    button { border: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); padding: 8px 15px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    #status { min-height: 20px; color: var(--vscode-testing-iconPassed); margin-top: 12px; text-align: right; }
  </style>
</head>
<body>
  <h1>KRL Syntax Colors</h1>
  <p>These colors apply only to KRL files with .src, .dat, and .sub extensions. The matching palette is selected automatically when the theme changes.</p>
  <div class="tabs" role="tablist" aria-label="Color palette">
    <button type="button" id="dark-tab" class="tab" role="tab" aria-controls="dark-panel" aria-selected="${initialPalette === 'dark'}" tabindex="${initialPalette === 'dark' ? '0' : '-1'}" data-palette="dark">Dark</button>
    <button type="button" id="light-tab" class="tab" role="tab" aria-controls="light-panel" aria-selected="${initialPalette === 'light'}" tabindex="${initialPalette === 'light' ? '0' : '-1'}" data-palette="light">Light</button>
  </div>
  ${palettes}
  <div class="actions"><button type="button" id="reset" class="secondary">Restore Defaults</button><button type="button" id="save">Apply Colors</button></div>
  <div id="status" role="status"></div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const paletteNames = ['dark', 'light'];
    const tabs = [...document.querySelectorAll('[role=tab]')];
    const inputs = [...document.querySelectorAll('input[type=color]')];
    let selectedPalette = '${initialPalette}';

    function selectPalette(palette, moveFocus) {
      selectedPalette = palette;
      for (const name of paletteNames) {
        const selected = name === palette;
        const tab = document.getElementById(name + '-tab');
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(name + '-panel').hidden = !selected;
      }
      if (moveFocus) {
        document.getElementById(palette + '-tab').focus();
      }
      document.getElementById('status').textContent = '';
    }

    for (const tab of tabs) {
      tab.addEventListener('click', () => selectPalette(tab.dataset.palette, false));
      tab.addEventListener('keydown', event => {
        const currentIndex = paletteNames.indexOf(selectedPalette);
        let nextIndex;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % paletteNames.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + paletteNames.length) % paletteNames.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = paletteNames.length - 1;
        if (nextIndex !== undefined) {
          event.preventDefault();
          selectPalette(paletteNames[nextIndex], true);
        }
      });
    }
    for (const input of inputs) {
      input.addEventListener('input', () => { input.nextElementSibling.textContent = input.value.toUpperCase(); });
    }
    document.getElementById('save').addEventListener('click', () => {
      const colors = { dark: {}, light: {} };
      for (const input of inputs) {
        colors[input.dataset.palette][input.dataset.key] = input.value.toUpperCase();
      }
      vscode.postMessage({ type: 'save', colors });
    });
    document.getElementById('reset').addEventListener('click', () => {
      vscode.postMessage({ type: 'reset', palette: selectedPalette });
    });
    window.addEventListener('message', event => {
      if (event.data && event.data.type === 'saved') {
        document.getElementById('status').textContent = 'Colors applied.';
      } else if (event.data && event.data.type === 'reset' && paletteNames.includes(event.data.palette)) {
        for (const input of inputs.filter(candidate => candidate.dataset.palette === event.data.palette)) {
          const value = event.data.colors[input.dataset.key] || input.dataset.default;
          input.value = value;
          input.nextElementSibling.textContent = value.toUpperCase();
        }
        const label = event.data.palette === 'light' ? 'light' : 'dark';
        document.getElementById('status').textContent = 'Default colors restored for the ' + label + ' theme.';
      }
    });
  </script>
</body>
</html>`;
}

export async function openColorSettings(context: vscode.ExtensionContext): Promise<void> {
  if (colorPanel) {
    colorPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  colorPanel = vscode.window.createWebviewPanel(
    'krlHelperColorSettings',
    'KRL Syntax Colors',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  colorPanel.webview.html = colorSettingsHtml(colorPanel.webview);
  colorPanel.onDidDispose(() => { colorPanel = undefined; }, null, context.subscriptions);
  colorPanel.webview.onDidReceiveMessage(async message => {
    if (message?.type === 'save' && message.colors && typeof message.colors === 'object') {
      const colors: StoredPalettes = { dark: {}, light: {} };
      for (const palette of ['dark', 'light'] as const) {
        const paletteValues = message.colors[palette];
        if (!paletteValues || typeof paletteValues !== 'object') {
          continue;
        }
        for (const definition of colorDefinitions) {
          const value = paletteValues[definition.key];
          if (typeof value === 'string' && colorPattern.test(value)) {
            colors[palette]![definition.key] = value.toUpperCase();
          }
        }
      }
      await queueColorUpdate(async () => {
        await context.globalState.update(storageKey, colors);
        await synchronizeTokenColors();
      });
      await colorPanel?.webview.postMessage({ type: 'saved' });
    } else if (message?.type === 'reset' && (message.palette === 'dark' || message.palette === 'light')) {
      const palette = message.palette as PaletteName;
      const colors = defaultColors(palette);
      await queueColorUpdate(async () => {
        const palettes = storedPalettes();
        palettes[palette] = colors;
        await context.globalState.update(storageKey, palettes);
        await synchronizeTokenColors();
      });
      await colorPanel?.webview.postMessage({ type: 'reset', palette, colors });
    }
  }, null, context.subscriptions);
}

export function initializeColorSettings(context: vscode.ExtensionContext): void {
  extensionContext = context;
  context.subscriptions.push(
    vscode.commands.registerCommand('krlHelper.openColorSettings', () => openColorSettings(context)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('krlHighlighting')) {
        synchronizeSafely();
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      synchronizeSafely();
    })
  );
  void queueColorUpdate(() => initializeTokenColors(context));
}
