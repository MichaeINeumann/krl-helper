import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  colorSettingsHtml,
  hasTopLevelHelperColors,
  persistPalettes,
  removeAllHelperColors,
  TextMateRule,
  themeSelectorForKind,
  TokenColorCustomizations,
  updateCustomizationValue,
  validateSubmittedPalettes
} from '../colorSettings';

const helperPrefix = 'KRL Helper: ';

suite('KRL syntax color configuration', () => {
  test('selects the effective automatic light, dark, and high-contrast themes', () => {
    const configuration = {
      colorTheme: 'Static Theme',
      preferredDarkColorTheme: 'Automatic Dark',
      preferredLightColorTheme: 'Automatic Light',
      preferredHighContrastColorTheme: 'Automatic High Contrast',
      preferredHighContrastLightColorTheme: 'Automatic High Contrast Light',
      autoDetectColorScheme: true,
      autoDetectHighContrast: true
    };

    assert.strictEqual(
      themeSelectorForKind(vscode.ColorThemeKind.Light, configuration),
      '[Automatic Light]'
    );
    assert.strictEqual(
      themeSelectorForKind(vscode.ColorThemeKind.Dark, configuration),
      '[Automatic Dark]'
    );
    assert.strictEqual(
      themeSelectorForKind(vscode.ColorThemeKind.HighContrastLight, configuration),
      '[Automatic High Contrast Light]'
    );
    assert.strictEqual(
      themeSelectorForKind(vscode.ColorThemeKind.Dark, {
        ...configuration,
        autoDetectColorScheme: false,
        autoDetectHighContrast: false
      }),
      '[Static Theme]'
    );
  });

  test('replaces active helper colors while preserving a different single-theme palette', () => {
    const foreignGeneralRule: TextMateRule = {
      scope: 'source.krl keyword.control.if.krl',
      settings: { foreground: '#123456' }
    };
    const foreignThemeRule: TextMateRule = {
      scope: 'source.krl',
      settings: { foreground: '#654321' }
    };
    const customizations: TokenColorCustomizations = {
      textMateRules: [foreignGeneralRule, helperRule('Regular text', '#C0C0C0')],
      '[Dark Test Theme]': { textMateRules: [helperRule('Regular text', '#C0C0C0')] },
      '[Dark Test Theme][Light Test Theme]': { textMateRules: [helperRule('Regular text', '#C0C0C0')] },
      '[Light Test Theme]': { textMateRules: [foreignThemeRule] }
    };

    const updated = updateCustomizationValue(customizations, true, '[Light Test Theme]', 'light');

    assert.strictEqual(helperForeground(updated, undefined, 'Regular text'), undefined);
    assert.strictEqual(helperForeground(updated, '[Light Test Theme]', 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(updated, '[Dark Test Theme]', 'Regular text'), '#C0C0C0');
    assert.strictEqual(helperForeground(updated, '[Dark Test Theme][Light Test Theme]', 'Regular text'), undefined);
    assert.ok(rulesAt(updated).includes(foreignGeneralRule));
    assert.ok(rulesAt(updated, '[Light Test Theme]').includes(foreignThemeRule));
  });

  test('switching themes always rebuilds the complete active palette', () => {
    const light = updateCustomizationValue({}, true, '[Light Test Theme]', 'light');
    const dark = updateCustomizationValue(light, true, '[Dark Test Theme]', 'dark');
    const lightAgain = updateCustomizationValue(dark, true, '[Light Test Theme]', 'light');

    assert.strictEqual(helperForeground(dark, undefined, 'Regular text'), undefined);
    assert.strictEqual(helperForeground(dark, '[Dark Test Theme]', 'Regular text'), '#C0C0C0');
    assert.strictEqual(helperForeground(dark, '[Light Test Theme]', 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(lightAgain, undefined, 'Regular text'), undefined);
    assert.strictEqual(helperForeground(lightAgain, '[Light Test Theme]', 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(lightAgain, '[Dark Test Theme]', 'Regular text'), '#C0C0C0');
    assert.strictEqual(helperRulesAt(lightAgain).length, 0);
    assert.strictEqual(helperRulesAt(lightAgain, '[Light Test Theme]').length, 19);
    assert.strictEqual(helperRulesAt(lightAgain, '[Dark Test Theme]').length, 19);
  });

  test('synchronizing the same theme repeatedly is idempotent', () => {
    const firstUpdate = updateCustomizationValue({}, true, '[Light Test Theme]', 'light');
    const secondUpdate = updateCustomizationValue(firstUpdate, true, '[Light Test Theme]', 'light');

    assert.deepStrictEqual(secondUpdate, firstUpdate);
  });

  test('preserves unrelated rules even when they use managed KRL scopes', () => {
    const generalRule: TextMateRule = {
      name: 'My KRL colors',
      scope: ['source.other', 'source.krl keyword.control.wait.krl'],
      settings: { foreground: '#112233' }
    };
    const combinedThemeRule: TextMateRule = {
      scope: 'source.krl variable.other.user.krl',
      settings: { foreground: '#445566' }
    };
    const customizations: TokenColorCustomizations = {
      textMateRules: [generalRule],
      '[Dark Test Theme][Light Test Theme]': {
        textMateRules: [combinedThemeRule],
        semanticHighlighting: false
      }
    };

    const updated = updateCustomizationValue(customizations, true, '[Light Test Theme]', 'light');

    assert.ok(rulesAt(updated).includes(generalRule));
    assert.ok(rulesAt(updated, '[Dark Test Theme][Light Test Theme]').includes(combinedThemeRule));
    assert.strictEqual(
      (updated['[Dark Test Theme][Light Test Theme]'] as TokenColorCustomizations).semanticHighlighting,
      false
    );
  });

  test('disabling custom colors removes only extension-owned rules', () => {
    const foreignRule: TextMateRule = {
      scope: 'source.krl',
      settings: { foreground: '#123456' }
    };
    const customizations: TokenColorCustomizations = {
      textMateRules: [foreignRule, helperRule('Regular text', '#C0C0C0')],
      '[Light Test Theme]': {
        textMateRules: [foreignRule, helperRule('Regular text', '#000000')]
      }
    };

    const updated = updateCustomizationValue(customizations, false, '[Light Test Theme]', 'light');

    assert.deepStrictEqual(rulesAt(updated), [foreignRule]);
    assert.deepStrictEqual(rulesAt(updated, '[Light Test Theme]'), [foreignRule]);
  });

  test('legacy cleanup leaves configurations without helper rules untouched', () => {
    const customizations: TokenColorCustomizations = {
      textMateRules: [{ scope: 'source.krl', settings: { foreground: '#123456' } }],
      '[Test Theme]': { semanticHighlighting: false }
    };

    const cleaned = removeAllHelperColors(customizations);

    assert.strictEqual(cleaned, customizations);
  });

  test('recognizes only stale top-level helper rules as external synchronization conflicts', () => {
    const themedOnly: TokenColorCustomizations = {
      '[Dark Test Theme]': { textMateRules: [helperRule('Regular text', '#C0C0C0')] }
    };

    assert.strictEqual(hasTopLevelHelperColors(themedOnly), false);
    assert.strictEqual(hasTopLevelHelperColors({
      ...themedOnly,
      textMateRules: [helperRule('Regular text', '#C0C0C0')]
    }), true);
  });

  test('reads update-stable palettes from VS Code user configuration', async () => {
    const configuration = vscode.workspace.getConfiguration('krlHighlighting.palettes');
    const previousValue = configuration.inspect<Record<string, string>>('dark')?.globalValue;

    try {
      await configuration.update('dark', { normalText: '#123456' }, vscode.ConfigurationTarget.Global);
      const updated = updateCustomizationValue({}, true, '[Dark Test Theme]', 'dark');

      assert.strictEqual(helperForeground(updated, undefined, 'Regular text'), undefined);
      assert.strictEqual(helperForeground(updated, '[Dark Test Theme]', 'Regular text'), '#123456');
    } finally {
      await configuration.update('dark', previousValue, vscode.ConfigurationTarget.Global);
    }
  });

  test('keeps distinct user-selected comment colors across dark and light theme synchronization', async () => {
    const configuration = vscode.workspace.getConfiguration('krlHighlighting.palettes');
    const previousDark = configuration.inspect<Record<string, string>>('dark')?.globalValue;
    const previousLight = configuration.inspect<Record<string, string>>('light')?.globalValue;
    const darkPalette = completePalettes('#112233').dark;
    const lightPalette = completePalettes('#DDEEFF').light;
    darkPalette.comments = '#FFFF00';
    lightPalette.comments = '#FF0000';

    try {
      await configuration.update('dark', darkPalette, vscode.ConfigurationTarget.Global);
      await configuration.update('light', lightPalette, vscode.ConfigurationTarget.Global);
      const overwrittenByOlderWindow: TokenColorCustomizations = {
        textMateRules: [helperRule('Comments', '#00FF00')],
        '[Dark Test Theme]': { textMateRules: [helperRule('Comments', '#00FF00')] },
        '[Light Test Theme]': { textMateRules: [] }
      };

      const dark = updateCustomizationValue(overwrittenByOlderWindow, true, '[Dark Test Theme]', 'dark');
      const light = updateCustomizationValue(dark, true, '[Light Test Theme]', 'light');

      assert.strictEqual(helperForeground(light, undefined, 'Comments'), undefined);
      assert.strictEqual(helperForeground(light, '[Dark Test Theme]', 'Comments'), '#FFFF00');
      assert.strictEqual(helperForeground(light, '[Light Test Theme]', 'Comments'), '#FF0000');
    } finally {
      await configuration.update('dark', previousDark, vscode.ConfigurationTarget.Global);
      await configuration.update('light', previousLight, vscode.ConfigurationTarget.Global);
    }
  });

  test('validates complete palettes without silently discarding invalid hex values', () => {
    const colors = completePalettes('#abc');
    const normalized = validateSubmittedPalettes(colors);

    assert.ok(normalized);
    assert.strictEqual(normalized.dark.normalText, '#ABC');
    assert.strictEqual(normalized.light.variableNames, '#ABC');

    colors.light.variableNames = '001080';
    assert.strictEqual(validateSubmittedPalettes(colors), undefined);
  });

  test('restores both User Settings values when the second palette write fails', async () => {
    const previous = completePalettes('#112233');
    const next = completePalettes('#445566');
    const values: Record<string, unknown> = { dark: previous.dark, light: previous.light };
    let rejectNextLightWrite = true;
    const configuration = {
      inspect: <T>(section: string): { globalValue?: T } => ({ globalValue: values[section] as T }),
      update: async (section: string, value: unknown): Promise<void> => {
        if (section === 'light' && rejectNextLightWrite) {
          rejectNextLightWrite = false;
          throw new Error('synthetic write failure');
        }
        values[section] = value;
      }
    };

    await assert.rejects(
      persistPalettes(next, configuration),
      /previous User Settings values were restored/
    );
    assert.deepStrictEqual(values, previous);
  });

  test('reports a recoverable partial palette write when rollback also fails', async () => {
    const previous = completePalettes('#112233');
    const next = completePalettes('#445566');
    const configuration = {
      inspect: <T>(section: string): { globalValue?: T } => ({
        globalValue: previous[section as keyof typeof previous] as T
      }),
      update: async (section: string, value: unknown): Promise<void> => {
        if (section === 'light' || value === previous.dark) {
          throw new Error('synthetic write failure');
        }
      }
    };

    await assert.rejects(
      persistPalettes(next, configuration),
      /only partially saved.*Review the KRL palette values/
    );
  });

  test('settings editor renders color and diagnostics tabs with palette defaults', () => {
    const extension = vscode.extensions.getExtension('MichaeINeumann.krl-helper');
    assert.ok(extension);
    const properties = extension.packageJSON.contributes.configuration.properties;
    assert.strictEqual(properties['krlHighlighting.palettes.dark'].scope, 'application');
    assert.strictEqual(properties['krlHighlighting.palettes.light'].scope, 'application');

    const html = colorSettingsHtml({ cspSource: 'test-source' } as vscode.Webview, 'light');

    assert.ok(html.includes('role="tablist"'));
    assert.ok(html.includes('id="dark-tab" class="tab" role="tab"'));
    assert.ok(html.includes('id="light-tab" class="tab" role="tab"'));
    assert.ok(html.includes('id="diagnostics-tab" class="tab" role="tab"'));
    assert.ok(html.includes('id="dark-panel" role="tabpanel" aria-labelledby="dark-tab" hidden'));
    assert.ok(html.includes('id="light-panel" role="tabpanel" aria-labelledby="light-tab"><h2>Light colors</h2>'));
    assert.ok(html.includes('id="diagnostics-panel" role="tabpanel" aria-labelledby="diagnostics-tab" hidden'));
    assert.ok(html.includes('data-color-picker data-palette="dark" data-key="normalText"'));
    assert.ok(html.includes('data-color-input data-palette="dark" data-key="normalText" data-default="#C0C0C0"'));
    assert.ok(html.includes('data-color-input data-palette="light" data-key="normalText" data-default="#000000"'));
    assert.ok(html.includes('Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.'));
    assert.ok(html.includes("event.data.type === 'saveError'"));
    assert.ok(html.includes('data-key="localVariablePrefixes"'));
    assert.ok(html.includes('<option value="user"'));
    assert.ok(html.includes('<option value="workspace"'));
    assert.ok(html.includes("type: 'reset', palette: selectedPanel"));
    assert.ok(html.includes("type: 'diagnosticReset'"));
    const script = /<script nonce="[^"]+">([\s\S]+)<\/script>/.exec(html)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
  });
});

function completePalettes(color: string): { dark: Record<string, string>; light: Record<string, string> } {
  const keys = [
    'normalText', 'comments', 'blockComments', 'strings', 'numbers', 'programFlow',
    'controlStructures', 'ifKeyword', 'switchKeyword', 'doKeyword', 'waitKeyword',
    'variableNames', 'setupCommands', 'motionCommands', 'mathFunctions', 'ioCommands',
    'typeDefinitions', 'systemVariables', 'listFunctions'
  ];
  const palette = (): Record<string, string> => Object.fromEntries(keys.map(key => [key, color]));
  return { dark: palette(), light: palette() };
}

function helperRule(label: string, foreground: string): TextMateRule {
  return {
    name: `${helperPrefix}${label}`,
    scope: 'source.krl',
    settings: { foreground }
  };
}

function rulesAt(customizations: TokenColorCustomizations, themeSelector?: string): TextMateRule[] {
  const container = themeSelector
    ? customizations[themeSelector] as TokenColorCustomizations | undefined
    : customizations;
  return Array.isArray(container?.textMateRules) ? container.textMateRules : [];
}

function helperRulesAt(customizations: TokenColorCustomizations, themeSelector?: string): TextMateRule[] {
  return rulesAt(customizations, themeSelector)
    .filter(rule => typeof rule.name === 'string' && rule.name.startsWith(helperPrefix));
}

function helperForeground(
  customizations: TokenColorCustomizations,
  themeSelector: string | undefined,
  label: string
): string | undefined {
  return rulesAt(customizations, themeSelector)
    .find(rule => rule.name === `${helperPrefix}${label}`)
    ?.settings?.foreground;
}
