import * as vscode from 'vscode';
import {
  DiagnosticSettingKey,
  diagnosticSettingDefinitions,
  normalizePrefixList
} from './diagnosticModel';

const rulePrefix = 'KRL Helper: ';
const storageKey = 'krlHelper.syntaxColors';
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
  { label: 'TODO markers', key: 'todoMarkers', scope: 'keyword.other.todo.krl', darkFallback: '#F8F8F2', lightFallback: '#795E26' },
  { label: 'Fold starts', key: 'foldStarts', scope: 'keyword.other.fold.start.krl', darkFallback: '#66D9EF', lightFallback: '#005A9C' },
  { label: 'Fold ends', key: 'foldEnds', scope: 'keyword.other.fold.end.krl', darkFallback: '#F92672', lightFallback: '#A31515' },
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

export interface StoredPalettes {
  dark?: Record<string, string>;
  light?: Record<string, string>;
}

export interface CompletePalettes {
  dark: Record<string, string>;
  light: Record<string, string>;
}

export interface ThemeSelectionConfiguration {
  colorTheme: string;
  preferredDarkColorTheme: string;
  preferredLightColorTheme: string;
  preferredHighContrastColorTheme: string;
  preferredHighContrastLightColorTheme: string;
  autoDetectColorScheme: boolean;
  autoDetectHighContrast: boolean;
}

export interface ThemePaletteTarget {
  selector: string;
  palette: PaletteName;
}

interface PaletteConfiguration {
  update(section: string, value: unknown, target: vscode.ConfigurationTarget): Thenable<void>;
}

export interface PanelMessageTarget {
  webview: {
    postMessage(message: unknown): Thenable<boolean>;
  };
}

class PalettePersistenceError extends Error {}

function activePalette(): PaletteName {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}

export function themeSelectorForKind(
  kind: vscode.ColorThemeKind,
  configuration: ThemeSelectionConfiguration
): string {
  const highContrast = kind === vscode.ColorThemeKind.HighContrast
    || kind === vscode.ColorThemeKind.HighContrastLight;
  const light = kind === vscode.ColorThemeKind.Light
    || kind === vscode.ColorThemeKind.HighContrastLight;
  let themeName = configuration.colorTheme;

  if (highContrast && configuration.autoDetectHighContrast) {
    themeName = light
      ? configuration.preferredHighContrastLightColorTheme
      : configuration.preferredHighContrastColorTheme;
  } else if (configuration.autoDetectColorScheme) {
    themeName = light
      ? configuration.preferredLightColorTheme
      : configuration.preferredDarkColorTheme;
  }

  const normalizedName = themeName.trim();
  return normalizedName ? `[${normalizedName}]` : '';
}

export function themePaletteTargets(
  configuration: ThemeSelectionConfiguration,
  installedPalettes: Readonly<Record<string, PaletteName>>,
  fallbackSelector: string,
  fallbackPalette: PaletteName
): ThemePaletteTarget[] {
  const targets = new Map<string, PaletteName>();
  const addTarget = (name: string, hintedPalette: PaletteName): void => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }
    const installedPalette = installedPalettes[normalizedName]
      ?? installedPalettes[normalizedName.toLowerCase()];
    targets.set(`[${normalizedName}]`, installedPalette ?? hintedPalette);
  };

  addTarget(configuration.colorTheme, fallbackPalette);
  addTarget(configuration.preferredDarkColorTheme, 'dark');
  addTarget(configuration.preferredLightColorTheme, 'light');
  addTarget(configuration.preferredHighContrastColorTheme, 'dark');
  addTarget(configuration.preferredHighContrastLightColorTheme, 'light');
  if (fallbackSelector) {
    targets.set(fallbackSelector, fallbackPalette);
  }
  return [...targets].map(([selector, palette]) => ({ selector, palette }));
}

function legacyStoredColors(palette: PaletteName): Record<string, string> {
  const value = extensionContext?.globalState.get<StoredPalettes | Record<string, string>>(storageKey, {}) ?? {};
  if ('dark' in value || 'light' in value) {
    const paletteValue = (value as StoredPalettes)[palette];
    return validColors(paletteValue);
  }
  return palette === 'dark' ? validColors(value) : {};
}

function validColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const colors: Record<string, string> = {};
  for (const definition of colorDefinitions) {
    const color = (value as Record<string, unknown>)[definition.key];
    if (typeof color === 'string' && colorPattern.test(color)) {
      colors[definition.key] = color.toUpperCase();
    }
  }
  return colors;
}

function configuredPalettes(): StoredPalettes {
  const configured = vscode.workspace
    .getConfiguration('krlHighlighting')
    .inspect<unknown>('palettes')?.globalValue;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return {};
  }
  const palettes = configured as Record<string, unknown>;
  return {
    dark: validColors(palettes.dark),
    light: validColors(palettes.light)
  };
}

function configuredPaletteColors(palette: PaletteName): Record<string, string> {
  return configuredPalettes()[palette] ?? {};
}

function hasConfiguredPaletteSetting(): boolean {
  return vscode.workspace
    .getConfiguration('krlHighlighting')
    .inspect<unknown>('palettes')?.globalValue !== undefined;
}

function legacyConfiguredPaletteColors(palette: PaletteName): Record<string, string> {
  return validColors(vscode.workspace
    .getConfiguration('krlHighlighting.palettes')
    .inspect<unknown>(palette)?.globalValue);
}

function storedColors(palette: PaletteName): Record<string, string> {
  if (hasConfiguredPaletteSetting()) {
    return configuredPaletteColors(palette);
  }

  return {
    ...(palette === 'dark' ? legacyUserColors() : {}),
    ...legacyStoredColors(palette),
    ...legacyConfiguredPaletteColors(palette)
  };
}

/**
 * Reads the deprecated per-color `krlHighlighting.colors.*` settings. These are only consulted
 * once during migration; afterwards `krlHighlighting.palettes` is the single source of truth.
 */
export function legacyUserColors(): Record<string, string> {
  const configuration = vscode.workspace.getConfiguration('krlHighlighting.colors');
  const colors: Record<string, string> = {};
  for (const definition of colorDefinitions) {
    const inspected = configuration.inspect<unknown>(definition.key);
    const value = inspected?.globalValue;
    if (typeof value === 'string' && colorPattern.test(value)) {
      colors[definition.key] = value.toUpperCase();
    }
  }
  return colors;
}

export function mergeLegacyPaletteSources(
  nativeUserColors: Readonly<Record<string, string>>,
  stored: StoredPalettes,
  formerSettings: StoredPalettes
): CompletePalettes {
  return {
    dark: {
      ...validColors(nativeUserColors),
      ...validColors(stored.dark),
      ...validColors(formerSettings.dark)
    },
    light: {
      ...validColors(stored.light),
      ...validColors(formerSettings.light)
    }
  };
}

export function paletteMigrationValue(
  configuredValue: unknown,
  nativeUserColors: Readonly<Record<string, string>>,
  stored: StoredPalettes,
  formerSettings: StoredPalettes
): CompletePalettes | undefined {
  if (configuredValue !== undefined) {
    return undefined;
  }
  const migrated = mergeLegacyPaletteSources(nativeUserColors, stored, formerSettings);
  return Object.keys(migrated.dark).length > 0 || Object.keys(migrated.light).length > 0
    ? migrated
    : undefined;
}

export function validateSubmittedPalettes(value: unknown): CompletePalettes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const palettes = value as Record<string, unknown>;
  const normalized: CompletePalettes = { dark: {}, light: {} };
  for (const palette of ['dark', 'light'] as const) {
    const paletteValue = palettes[palette];
    if (!paletteValue || typeof paletteValue !== 'object' || Array.isArray(paletteValue)) {
      return undefined;
    }
    for (const definition of colorDefinitions) {
      const color = (paletteValue as Record<string, unknown>)[definition.key];
      if (typeof color !== 'string' || !colorPattern.test(color.trim())) {
        return undefined;
      }
      normalized[palette][definition.key] = color.trim().toUpperCase();
    }
  }
  return normalized;
}

export async function persistPalettes(
  palettes: CompletePalettes,
  configuration: PaletteConfiguration = vscode.workspace.getConfiguration('krlHighlighting')
): Promise<void> {
  try {
    await configuration.update('palettes', palettes, vscode.ConfigurationTarget.Global);
  } catch {
    throw new PalettePersistenceError('The palettes could not be saved. No palette changes were applied.');
  }
}

function configuredColor(definition: ColorDefinition, palette: PaletteName = activePalette()): string {
  const fallback = palette === 'light' ? definition.lightFallback : definition.darkFallback;
  const storedValue = storedColors(palette)[definition.key];
  if (typeof storedValue === 'string' && colorPattern.test(storedValue)) {
    return storedValue;
  }

  return fallback;
}

function paletteSettingsView(): CompletePalettes {
  return {
    dark: Object.fromEntries(colorDefinitions.map(definition => [
      definition.key,
      configuredColor(definition, 'dark').toUpperCase()
    ])),
    light: Object.fromEntries(colorDefinitions.map(definition => [
      definition.key,
      configuredColor(definition, 'light').toUpperCase()
    ]))
  };
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

/**
 * Rebuilds the extension-owned token color rules in the User layer.
 *
 * The target value is a pure function of the stored palettes and the configured themes, and the
 * write is skipped when it would not change anything. Synchronization therefore reaches its fixed
 * point in a single step, which is what keeps concurrent VS Code windows from writing back and
 * forth. See "Concurrency" in the module documentation of the settings editor.
 */
export async function synchronizeTokenColors(): Promise<void> {
  const editorConfiguration = vscode.workspace.getConfiguration('editor');
  const inspected = editorConfiguration.inspect<TokenColorCustomizations>('tokenColorCustomizations');
  const currentValue = inspected?.globalValue && typeof inspected.globalValue === 'object'
    ? inspected.globalValue
    : {};
  const enabled = vscode.workspace.getConfiguration('krlHighlighting').get<boolean>('applyCustomColors', true);
  const targets = configuredThemeTargets();
  const nextValue = updateCustomizationTargets(currentValue, enabled, targets);

  if (!valuesEqual(currentValue, nextValue)) {
    await editorConfiguration.update(
      'tokenColorCustomizations',
      nextValue,
      vscode.ConfigurationTarget.Global
    );
  }
  await cleanLegacyWorkspaceHelperRules();
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  return updateCustomizationTargets(currentValue, enabled, [{ selector: themeSelector, palette }]);
}

export function updateCustomizationTargets(
  currentValue: TokenColorCustomizations,
  enabled: boolean,
  targets: readonly ThemePaletteTarget[]
): TokenColorCustomizations {
  if (!enabled) {
    return removeAllHelperColors(currentValue);
  }

  const uniqueTargets = [...new Map(targets.map(target => [target.selector, target])).values()];
  const themedSelectors = new Set(uniqueTargets.map(target => target.selector).filter(Boolean));
  let nextValue: TokenColorCustomizations = themedSelectors.size > 0
    ? { ...removeConflictingHelperColors(currentValue, themedSelectors) }
    : { ...removeAllHelperColors(currentValue) };

  for (const target of uniqueTargets) {
    const activeRules = buildRules(target.palette);
    if (!target.selector) {
      nextValue.textMateRules = [
        ...rulesWithoutHelperColors(nextValue.textMateRules),
        ...activeRules
      ];
      continue;
    }
    const currentThemeValue = nextValue[target.selector] && typeof nextValue[target.selector] === 'object'
      ? nextValue[target.selector] as TokenColorCustomizations
      : {};
    nextValue[target.selector] = {
      ...currentThemeValue,
      textMateRules: [
        ...rulesWithoutHelperColors(currentThemeValue.textMateRules),
        ...activeRules
      ]
    };
  }
  return nextValue;
}

export function managedThemeSelector(selector: string): string {
  const match = /^\[([^\]]+)\]$/.exec(selector);
  if (!match) {
    return selector;
  }
  // VS Code treats multiple bracketed names as alternatives. Repeating the exact name therefore
  // matches only that theme while producing a different object key from a workspace's usual
  // single-name selector, so the two configuration layers are both retained during merging.
  return `[${match[1]}][${match[1]}]`;
}

function isManagedThemeSelector(selector: string): boolean {
  const match = /^\[([^\]]+)\]\[([^\]]+)\]$/.exec(selector);
  return !!match && match[1] === match[2];
}

function removeConflictingHelperColors(
  currentValue: TokenColorCustomizations,
  activeSelectors: ReadonlySet<string>
): TokenColorCustomizations {
  const usesManagedThemeSelectors = [...activeSelectors].some(isManagedThemeSelector);
  let nextValue = currentValue;
  if (Array.isArray(currentValue.textMateRules) && currentValue.textMateRules.some(isKrlRule)) {
    nextValue = {
      ...nextValue,
      textMateRules: rulesWithoutHelperColors(currentValue.textMateRules)
    };
  }

  for (const [key, value] of Object.entries(currentValue)) {
    if (!/^\[.+\]$/.test(key) || !value || typeof value !== 'object') {
      continue;
    }
    const themeValue = value as TokenColorCustomizations;
    const hasHelperRules = Array.isArray(themeValue.textMateRules) && themeValue.textMateRules.some(isKrlRule);
    const themeCount = key.match(/\[[^\]]+\]/g)?.length ?? 0;
    const managedSelector = isManagedThemeSelector(key);
    const legacySelector = usesManagedThemeSelectors && !managedSelector;
    if (hasHelperRules && (activeSelectors.has(key) || (!managedSelector && themeCount !== 1) || legacySelector)) {
      if (nextValue === currentValue) {
        nextValue = { ...currentValue };
      }
      nextValue[key] = {
        ...themeValue,
        textMateRules: rulesWithoutHelperColors(themeValue.textMateRules)
      };
    }
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
  const configuration = themeSelectionConfiguration();
  return themeSelectorForKind(vscode.window.activeColorTheme.kind, configuration);
}

function configuredThemeTargets(): ThemePaletteTarget[] {
  const configuration = themeSelectionConfiguration();
  const palette = activePalette();
  const targets = themePaletteTargets(
    configuration,
    installedThemePalettes(),
    themeSelectorForKind(vscode.window.activeColorTheme.kind, configuration),
    palette
  );
  // No theme name could be resolved, for example because every relevant workbench setting is
  // empty. An unscoped rule set still colors the active theme, so keep it as the fallback rather
  // than leaving KRL files without colors.
  return targets.length > 0
    ? targets.map(target => ({ ...target, selector: managedThemeSelector(target.selector) }))
    : [{ selector: '', palette }];
}

function themeSelectionConfiguration(): ThemeSelectionConfiguration {
  const workbenchConfiguration = vscode.workspace.getConfiguration('workbench');
  const windowConfiguration = vscode.workspace.getConfiguration('window');
  return {
    colorTheme: workbenchConfiguration.get<string>('colorTheme', ''),
    preferredDarkColorTheme: workbenchConfiguration.get<string>('preferredDarkColorTheme', ''),
    preferredLightColorTheme: workbenchConfiguration.get<string>('preferredLightColorTheme', ''),
    preferredHighContrastColorTheme: workbenchConfiguration.get<string>('preferredHighContrastColorTheme', ''),
    preferredHighContrastLightColorTheme: workbenchConfiguration.get<string>(
      'preferredHighContrastLightColorTheme', ''
    ),
    autoDetectColorScheme: windowConfiguration.get<boolean>('autoDetectColorScheme', false),
    autoDetectHighContrast: windowConfiguration.get<boolean>('autoDetectHighContrast', true)
  };
}

function installedThemePalettes(): Record<string, PaletteName> {
  const palettes: Record<string, PaletteName> = {};
  for (const extension of vscode.extensions.all) {
    const packageJson = extension.packageJSON as {
      contributes?: { themes?: Array<{ id?: unknown; label?: unknown; uiTheme?: unknown }> };
    };
    for (const theme of packageJson.contributes?.themes ?? []) {
      const palette = theme.uiTheme === 'vs' || theme.uiTheme === 'hc-light'
        ? 'light'
        : theme.uiTheme === 'vs-dark' || theme.uiTheme === 'hc-black' ? 'dark' : undefined;
      if (!palette) {
        continue;
      }
      for (const name of [theme.id, theme.label]) {
        if (typeof name === 'string' && name.trim()) {
          palettes[name] = palette;
          palettes[name.toLowerCase()] = palette;
        }
      }
    }
  }
  return palettes;
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

async function cleanLegacyWorkspaceLayer(
  configuration: vscode.WorkspaceConfiguration,
  target: vscode.ConfigurationTarget,
  value: TokenColorCustomizations | undefined
): Promise<void> {
  if (!value || typeof value !== 'object') {
    return;
  }
  const nextValue = removeAllHelperColors(value);
  if (!valuesEqual(value, nextValue)) {
    await configuration.update('tokenColorCustomizations', nextValue, target);
  }
}

/** Removes extension-owned rules written to shared settings by older versions. */
export async function cleanLegacyWorkspaceHelperRules(): Promise<void> {
  const workspaceConfiguration = vscode.workspace.getConfiguration('editor');
  await cleanLegacyWorkspaceLayer(
    workspaceConfiguration,
    vscode.ConfigurationTarget.Workspace,
    workspaceConfiguration.inspect<TokenColorCustomizations>('tokenColorCustomizations')?.workspaceValue
  );

  if (!vscode.workspace.workspaceFile) {
    return;
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderConfiguration = vscode.workspace.getConfiguration('editor', folder.uri);
    await cleanLegacyWorkspaceLayer(
      folderConfiguration,
      vscode.ConfigurationTarget.WorkspaceFolder,
      folderConfiguration.inspect<TokenColorCustomizations>('tokenColorCustomizations')?.workspaceFolderValue
    );
  }
}

/**
 * Folds historical user-level palette sources into the single `krlHighlighting.palettes` setting.
 *
 * Presence of the unified setting is the durable migration marker. This makes the migration
 * idempotent even after a reinstall or cleared extension state. Workspace-scoped legacy values
 * are deliberately not copied into the application-scoped palette.
 */
async function migrateLegacyPalettes(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('krlHighlighting');
  const migrated = paletteMigrationValue(
    configuration.inspect<unknown>('palettes')?.globalValue,
    legacyUserColors(),
    {
      dark: legacyStoredColors('dark'),
      light: legacyStoredColors('light')
    },
    {
      dark: legacyConfiguredPaletteColors('dark'),
      light: legacyConfiguredPaletteColors('light')
    }
  );
  if (migrated) {
    await configuration.update('palettes', migrated, vscode.ConfigurationTarget.Global);
  }
}

async function initializeTokenColors(): Promise<void> {
  await migrateLegacyPalettes();
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

interface DiagnosticSettingView {
  key: DiagnosticSettingKey;
  label: string;
  description: string;
  defaultValue: string[];
  userValue?: string[];
  workspaceValue?: string[];
  effectiveValue: string[];
}

interface DiagnosticSettingsView {
  hasWorkspace: boolean;
  settings: DiagnosticSettingView[];
}

function diagnosticSettingsView(): DiagnosticSettingsView {
  const configuration = vscode.workspace.getConfiguration('krlHelper.diagnostics');
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  return {
    hasWorkspace,
    settings: diagnosticSettingDefinitions.map(definition => {
      const inspected = configuration.inspect<unknown>(definition.key);
      const userValue = inspected?.globalValue === undefined
        ? undefined
        : normalizePrefixList(inspected.globalValue);
      const workspaceValue = inspected?.workspaceValue === undefined
        ? undefined
        : normalizePrefixList(inspected.workspaceValue);
      const defaultValue = normalizePrefixList(inspected?.defaultValue ?? [...definition.defaultValue]);
      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        defaultValue,
        userValue,
        workspaceValue,
        effectiveValue: workspaceValue ?? userValue ?? defaultValue
      };
    })
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function colorSettingsHtml(
  webview: vscode.Webview,
  initialPalette = activePalette(),
  diagnostics = diagnosticSettingsView()
): string {
  const scriptNonce = createNonce();
  const paletteSection = (palette: PaletteName, title: string, description: string): string => {
    const rows = colorDefinitions.map(definition => {
      const value = configuredColor(definition, palette).toUpperCase();
      const pickerValue = colorPickerValue(value);
      const defaultValue = (palette === 'light' ? definition.lightFallback : definition.darkFallback).toUpperCase();
      const inputId = `${palette}-${definition.key}-hex`;
      const errorId = `${inputId}-error`;
      return `<div class="row"><label for="${inputId}">${definition.label}</label><span class="control"><input type="color" data-color-picker data-palette="${palette}" data-key="${definition.key}" value="${pickerValue}" aria-label="${definition.label} color picker"><span class="hex-control"><input id="${inputId}" class="hex-input" type="text" data-color-input data-palette="${palette}" data-key="${definition.key}" data-default="${defaultValue}" value="${value}" maxlength="9" spellcheck="false" aria-describedby="${errorId}"><span id="${errorId}" class="color-error" data-color-error aria-live="polite"></span></span></span></div>`;
    }).join('');
    const hidden = palette === initialPalette ? '' : ' hidden';
    return `<section id="${palette}-panel" role="tabpanel" aria-labelledby="${palette}-tab"${hidden}><h2>${title}</h2><p>${description}</p><div class="panel">${rows}</div></section>`;
  };
  const palettes = paletteSection('dark', 'Dark colors', 'High-contrast defaults for dark editor backgrounds.')
    + paletteSection('light', 'Light colors', 'Contrast-optimized defaults for light editor backgrounds.');
  const diagnosticCards = diagnostics.settings.map(setting => {
    const initialScope = diagnostics.hasWorkspace ? 'workspace' : 'user';
    const initialValue = initialScope === 'workspace'
      ? setting.workspaceValue ?? setting.userValue ?? setting.defaultValue
      : setting.userValue ?? setting.defaultValue;
    return `<article class="diagnostic-card" data-diagnostic-card data-key="${setting.key}">
      <div class="diagnostic-heading"><div><h3>${escapeHtml(setting.label)}</h3><p>${escapeHtml(setting.description)}</p></div>
      <label>Scope <select data-diagnostic-scope><option value="user"${initialScope === 'user' ? ' selected' : ''}>User</option><option value="workspace"${initialScope === 'workspace' ? ' selected' : ''}${diagnostics.hasWorkspace ? '' : ' disabled'}>Workspace</option></select></label></div>
      <div class="inheritance" data-inheritance></div>
      <textarea rows="3" spellcheck="false" aria-label="${escapeHtml(setting.label)}; one prefix per line">${escapeHtml(initialValue.join('\n'))}</textarea>
      <div class="card-actions"><button type="button" class="secondary" data-diagnostic-reset>Reset</button><button type="button" data-diagnostic-save>Apply</button></div>
    </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KRL Helper Settings</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); max-width: 820px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 17px; margin: 22px 0 6px; }
    h3 { font-size: 15px; margin: 0 0 5px; }
    p { color: var(--vscode-descriptionForeground); margin: 0 0 22px; }
    .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border); margin-top: 22px; }
    button.tab { color: var(--vscode-foreground); background: transparent; border-bottom: 2px solid transparent; padding: 9px 18px; }
    button.tab:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    button.tab[aria-selected="true"] { color: var(--vscode-foreground); background: var(--vscode-editor-background); border-bottom-color: var(--vscode-focusBorder); }
    [role="tabpanel"][hidden], .actions[hidden] { display: none; }
    .panel, .diagnostic-card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 44px; padding: 5px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
    .row:last-child { border-bottom: 0; }
    .control { display: flex; align-items: center; gap: 12px; }
    input[type=color] { width: 58px; height: 30px; border: 1px solid var(--vscode-input-border); background: transparent; cursor: pointer; padding: 2px; }
    .hex-control { display: flex; flex-direction: column; min-width: 150px; }
    .hex-input { box-sizing: border-box; width: 150px; padding: 5px 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family); }
    .hex-input[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder); }
    .color-error { min-height: 15px; margin-top: 2px; color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); font-size: 11px; }
    .actions, .card-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
    button { border: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); padding: 8px 15px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { cursor: default; opacity: .55; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .diagnostic-card { margin: 12px 0; padding: 14px; }
    .diagnostic-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
    .diagnostic-heading p { margin-bottom: 8px; }
    select, textarea { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    select { margin-left: 7px; padding: 5px; }
    textarea { box-sizing: border-box; width: 100%; padding: 8px; resize: vertical; font-family: var(--vscode-editor-font-family); }
    .inheritance { min-height: 18px; margin: 2px 0 7px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .card-actions { margin-top: 9px; }
    #status { min-height: 20px; color: var(--vscode-testing-iconPassed); margin-top: 12px; text-align: right; }
    #status.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>KRL Helper Settings</h1>
  <p>Configure syntax palettes and diagnostic naming conventions for KRL files.</p>
  <div class="tabs" role="tablist" aria-label="KRL Helper settings">
    <button type="button" id="dark-tab" class="tab" role="tab" aria-controls="dark-panel" aria-selected="${initialPalette === 'dark'}" tabindex="${initialPalette === 'dark' ? '0' : '-1'}" data-panel="dark">Dark Colors</button>
    <button type="button" id="light-tab" class="tab" role="tab" aria-controls="light-panel" aria-selected="${initialPalette === 'light'}" tabindex="${initialPalette === 'light' ? '0' : '-1'}" data-panel="light">Light Colors</button>
    <button type="button" id="diagnostics-tab" class="tab" role="tab" aria-controls="diagnostics-panel" aria-selected="false" tabindex="-1" data-panel="diagnostics">Diagnostics</button>
  </div>
  ${palettes}
  <section id="diagnostics-panel" role="tabpanel" aria-labelledby="diagnostics-tab" hidden><h2>Diagnostics</h2><p>Enter one literal prefix per line. Values are trimmed and duplicates are removed case-insensitively.</p>${diagnosticCards}</section>
  <div id="color-actions" class="actions"><button type="button" id="reset" class="secondary">Restore Defaults</button><button type="button" id="save">Apply Colors</button></div>
  <div id="status" role="status"></div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const panelNames = ['dark', 'light', 'diagnostics'];
    const paletteNames = ['dark', 'light'];
    const tabs = [...document.querySelectorAll('[role=tab]')];
    const colorPattern = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const colorInputs = [...document.querySelectorAll('[data-color-input]')];
    const colorPickers = [...document.querySelectorAll('[data-color-picker]')];
    const diagnosticCards = [...document.querySelectorAll('[data-diagnostic-card]')];
    const dirtyColorKeys = new Set();
    let colorSavePending = false;
    let diagnosticState = ${serializeForScript(diagnostics)};
    let selectedPanel = '${initialPalette}';

    function matchingColorControl(controls, source) {
      return controls.find(candidate => candidate.dataset.palette === source.dataset.palette && candidate.dataset.key === source.dataset.key);
    }

    function pickerColor(value) {
      const hex = value.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        return '#' + hex.slice(0, 3).split('').map(character => character + character).join('');
      }
      return '#' + hex.slice(0, 6);
    }

    function setStatus(message, error = false) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.classList.toggle('error', error);
    }

    function validateColorInput(input) {
      const valid = colorPattern.test(input.value.trim());
      input.setAttribute('aria-invalid', String(!valid));
      input.parentElement.querySelector('[data-color-error]').textContent = valid
        ? ''
        : 'Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.';
      return valid;
    }

    function colorControlKey(control) {
      return control.dataset.palette + '.' + control.dataset.key;
    }

    function setColorControlsDisabled(disabled) {
      colorSavePending = disabled;
      for (const control of [...colorInputs, ...colorPickers]) control.disabled = disabled;
      for (const id of ['save', 'reset']) document.getElementById(id).disabled = disabled;
    }

    function renderPaletteColors(colors) {
      let preservedDirtyFields = 0;
      for (const input of colorInputs) {
        if (dirtyColorKeys.has(colorControlKey(input))) {
          preservedDirtyFields++;
          continue;
        }
        const value = colors?.[input.dataset.palette]?.[input.dataset.key];
        if (typeof value !== 'string' || !colorPattern.test(value)) continue;
        input.value = value.toUpperCase();
        matchingColorControl(colorPickers, input).value = pickerColor(value);
        validateColorInput(input);
      }
      return preservedDirtyFields;
    }

    function selectPanel(panel, moveFocus) {
      selectedPanel = panel;
      for (const name of panelNames) {
        const selected = name === panel;
        const tab = document.getElementById(name + '-tab');
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(name + '-panel').hidden = !selected;
      }
      document.getElementById('color-actions').hidden = panel === 'diagnostics';
      if (moveFocus) document.getElementById(panel + '-tab').focus();
      setStatus('');
    }

    function renderDiagnosticCard(card) {
      const setting = diagnosticState.settings.find(candidate => candidate.key === card.dataset.key);
      if (!setting) return;
      const scope = card.querySelector('[data-diagnostic-scope]').value;
      const textarea = card.querySelector('textarea');
      const inheritance = card.querySelector('[data-inheritance]');
      const reset = card.querySelector('[data-diagnostic-reset]');
      if (scope === 'workspace') {
        const inherited = setting.workspaceValue === undefined;
        const values = inherited ? (setting.userValue || setting.defaultValue) : setting.workspaceValue;
        textarea.value = values.join('\\n');
        inheritance.textContent = inherited
          ? (setting.userValue === undefined ? 'Inherited from default' : 'Inherited from User')
          : 'Workspace override';
        reset.disabled = inherited;
      } else {
        const inherited = setting.userValue === undefined;
        textarea.value = (inherited ? setting.defaultValue : setting.userValue).join('\\n');
        inheritance.textContent = inherited ? 'Using default' : 'User override';
        reset.disabled = inherited;
      }
    }

    for (const tab of tabs) {
      tab.addEventListener('click', () => selectPanel(tab.dataset.panel, false));
      tab.addEventListener('keydown', event => {
        const currentIndex = panelNames.indexOf(selectedPanel);
        let nextIndex;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % panelNames.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + panelNames.length) % panelNames.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = panelNames.length - 1;
        if (nextIndex !== undefined) {
          event.preventDefault();
          selectPanel(panelNames[nextIndex], true);
        }
      });
    }
    for (const picker of colorPickers) {
      picker.addEventListener('input', () => {
        const input = matchingColorControl(colorInputs, picker);
        input.value = picker.value.toUpperCase();
        dirtyColorKeys.add(colorControlKey(input));
        validateColorInput(input);
      });
    }
    for (const input of colorInputs) {
      input.addEventListener('input', () => {
        dirtyColorKeys.add(colorControlKey(input));
        if (validateColorInput(input)) {
          matchingColorControl(colorPickers, input).value = pickerColor(input.value.trim());
        }
      });
      input.addEventListener('blur', () => {
        input.value = input.value.trim().toUpperCase();
        validateColorInput(input);
      });
    }
    for (const card of diagnosticCards) {
      card.querySelector('[data-diagnostic-scope]').addEventListener('change', () => renderDiagnosticCard(card));
      card.querySelector('[data-diagnostic-save]').addEventListener('click', () => {
        const values = card.querySelector('textarea').value.split(/[\\n,]/).map(value => value.trim()).filter(Boolean);
        vscode.postMessage({ type: 'diagnosticUpdate', key: card.dataset.key, scope: card.querySelector('[data-diagnostic-scope]').value, values });
      });
      card.querySelector('[data-diagnostic-reset]').addEventListener('click', () => {
        vscode.postMessage({ type: 'diagnosticReset', key: card.dataset.key, scope: card.querySelector('[data-diagnostic-scope]').value });
      });
      renderDiagnosticCard(card);
    }
    document.getElementById('save').addEventListener('click', () => {
      if (colorSavePending) return;
      const invalidInputs = colorInputs.filter(input => !validateColorInput(input));
      if (invalidInputs.length > 0) {
        setStatus('Correct the invalid hexadecimal color values before applying the palettes.', true);
        invalidInputs[0].focus();
        return;
      }
      const colors = { dark: {}, light: {} };
      for (const input of colorInputs) colors[input.dataset.palette][input.dataset.key] = input.value.trim().toUpperCase();
      setColorControlsDisabled(true);
      setStatus('Applying colors...');
      vscode.postMessage({ type: 'save', colors });
    });
    document.getElementById('reset').addEventListener('click', () => {
      if (colorSavePending || !paletteNames.includes(selectedPanel)) return;
      for (const input of colorInputs.filter(candidate => candidate.dataset.palette === selectedPanel)) {
        input.value = input.dataset.default;
        matchingColorControl(colorPickers, input).value = pickerColor(input.value);
        validateColorInput(input);
        dirtyColorKeys.add(colorControlKey(input));
      }
      setStatus('Default colors loaded for the ' + selectedPanel + ' theme. Apply Colors to save.');
    });
    window.addEventListener('message', event => {
      if (event.data && event.data.type === 'saved') {
        dirtyColorKeys.clear();
        setColorControlsDisabled(false);
        setStatus(event.data.message || 'Colors applied.');
      } else if (event.data && event.data.type === 'saveError') {
        setColorControlsDisabled(false);
        setStatus(event.data.message || 'The palettes contain an invalid hexadecimal color.', true);
      } else if (event.data && event.data.type === 'palettesState') {
        const preservedDirtyFields = renderPaletteColors(event.data.colors);
        const message = event.data.message || 'Palettes refreshed from User Settings.';
        setStatus(preservedDirtyFields > 0
          ? message + ' Unsaved color edits were preserved.'
          : message);
      } else if (event.data && event.data.type === 'diagnosticsState') {
        diagnosticState = event.data.state;
        for (const card of diagnosticCards) renderDiagnosticCard(card);
        setStatus(event.data.message || '');
      }
    });
  </script>
</body>
</html>`;
}

export async function openColorSettings(context: vscode.ExtensionContext): Promise<void> {
  const existingPanel = colorPanel;
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    await existingPanel.webview.postMessage({ type: 'palettesState', colors: paletteSettingsView() });
    await existingPanel.webview.postMessage({ type: 'diagnosticsState', state: diagnosticSettingsView() });
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'krlHelperSettings',
    'KRL Helper Settings',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  colorPanel = panel;
  panel.webview.html = colorSettingsHtml(panel.webview);
  panel.onDidDispose(() => {
    if (colorPanel === panel) {
      colorPanel = undefined;
    }
  }, null, context.subscriptions);
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.type === 'save') {
      const colors = validateSubmittedPalettes(message.colors);
      if (!colors) {
        await postMessageToCurrentPanel(panel, colorPanel, {
          type: 'saveError',
          message: 'The palettes contain an invalid hexadecimal color. Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.'
        });
        return;
      }
      let palettesPersisted = false;
      try {
        await queueColorUpdate(async () => {
          await persistPalettes(colors);
          palettesPersisted = true;
          await synchronizeTokenColors();
        });
      } catch (error) {
        const message = error instanceof PalettePersistenceError
          ? error.message
          : palettesPersisted
            ? 'The palettes were saved, but the syntax colors could not be applied. Retry or reload VS Code.'
            : 'The palettes could not be saved. No palette changes were applied.';
        await postMessageToCurrentPanel(panel, colorPanel, { type: 'saveError', message });
        return;
      }
      await postMessageToCurrentPanel(panel, colorPanel, { type: 'saved' });
    } else if (message?.type === 'diagnosticUpdate' || message?.type === 'diagnosticReset') {
      const definition = diagnosticSettingDefinitions.find(candidate => candidate.key === message.key);
      const scope = message.scope === 'workspace' ? 'workspace' : message.scope === 'user' ? 'user' : undefined;
      if (!definition || !scope || (scope === 'workspace' && !(vscode.workspace.workspaceFolders?.length))) {
        return;
      }
      const target = scope === 'workspace'
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      const value = message.type === 'diagnosticReset' ? undefined : normalizePrefixList(message.values);
      await vscode.workspace.getConfiguration('krlHelper.diagnostics').update(definition.key, value, target);
      const action = message.type === 'diagnosticReset' ? 'reset' : 'updated';
      await postMessageToCurrentPanel(panel, colorPanel, {
        type: 'diagnosticsState',
        state: diagnosticSettingsView(),
        message: `${definition.label} ${action} for ${scope === 'workspace' ? 'Workspace' : 'User'}.`
      });
    }
  }, null, context.subscriptions);
}

export async function postMessageToCurrentPanel(
  sourcePanel: PanelMessageTarget,
  currentPanel: PanelMessageTarget | undefined,
  message: unknown
): Promise<boolean> {
  return sourcePanel === currentPanel
    ? sourcePanel.webview.postMessage(message)
    : false;
}

export function initializeColorSettings(context: vscode.ExtensionContext): void {
  extensionContext = context;
  context.subscriptions.push(
    vscode.commands.registerCommand('krlHelper.openColorSettings', () => openColorSettings(context)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('krlHighlighting')
        || event.affectsConfiguration('editor.tokenColorCustomizations')
        || event.affectsConfiguration('workbench.colorTheme')
        || event.affectsConfiguration('workbench.preferredDarkColorTheme')
        || event.affectsConfiguration('workbench.preferredLightColorTheme')
        || event.affectsConfiguration('workbench.preferredHighContrastColorTheme')
        || event.affectsConfiguration('workbench.preferredHighContrastLightColorTheme')) {
        synchronizeSafely();
      }
      if (event.affectsConfiguration('krlHelper.diagnostics')) {
        void colorPanel?.webview.postMessage({ type: 'diagnosticsState', state: diagnosticSettingsView() });
      }
      if (event.affectsConfiguration('krlHighlighting.palettes')) {
        void colorPanel?.webview.postMessage({
          type: 'palettesState',
          colors: paletteSettingsView(),
          message: 'Palettes refreshed from User Settings.'
        });
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      synchronizeSafely();
    })
  );
  void queueColorUpdate(() => initializeTokenColors());
}
