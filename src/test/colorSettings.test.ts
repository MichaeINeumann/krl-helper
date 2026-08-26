import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  colorSettingsHtml,
  removeAllHelperColors,
  TextMateRule,
  TokenColorCustomizations,
  updateCustomizationValue
} from '../colorSettings';

const helperPrefix = 'KRL Helper: ';

suite('KRL syntax color configuration', () => {
  test('replaces stale helper colors with the selected light palette', () => {
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

    assert.strictEqual(helperForeground(updated, undefined, 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(updated, '[Light Test Theme]', 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(updated, '[Dark Test Theme]', 'Regular text'), undefined);
    assert.strictEqual(helperForeground(updated, '[Dark Test Theme][Light Test Theme]', 'Regular text'), undefined);
    assert.ok(rulesAt(updated).includes(foreignGeneralRule));
    assert.ok(rulesAt(updated, '[Light Test Theme]').includes(foreignThemeRule));
  });

  test('switching themes always rebuilds the complete active palette', () => {
    const light = updateCustomizationValue({}, true, '[Light Test Theme]', 'light');
    const dark = updateCustomizationValue(light, true, '[Dark Test Theme]', 'dark');
    const lightAgain = updateCustomizationValue(dark, true, '[Light Test Theme]', 'light');

    assert.strictEqual(helperForeground(dark, undefined, 'Regular text'), '#C0C0C0');
    assert.strictEqual(helperForeground(dark, '[Dark Test Theme]', 'Regular text'), '#C0C0C0');
    assert.strictEqual(helperForeground(dark, '[Light Test Theme]', 'Regular text'), undefined);
    assert.strictEqual(helperForeground(lightAgain, undefined, 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(lightAgain, '[Light Test Theme]', 'Regular text'), '#000000');
    assert.strictEqual(helperForeground(lightAgain, '[Dark Test Theme]', 'Regular text'), undefined);
    assert.strictEqual(helperRulesAt(lightAgain).length, 19);
    assert.strictEqual(helperRulesAt(lightAgain, '[Light Test Theme]').length, 19);
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

  test('color editor renders separate accessible tabs and palette defaults', () => {
    const html = colorSettingsHtml({ cspSource: 'test-source' } as vscode.Webview, 'light');

    assert.ok(html.includes('role="tablist"'));
    assert.ok(html.includes('id="dark-tab" class="tab" role="tab"'));
    assert.ok(html.includes('id="light-tab" class="tab" role="tab"'));
    assert.ok(html.includes('id="dark-panel" role="tabpanel" aria-labelledby="dark-tab" hidden'));
    assert.ok(html.includes('id="light-panel" role="tabpanel" aria-labelledby="light-tab"><h2>Light theme</h2>'));
    assert.ok(html.includes('data-palette="dark" data-key="normalText" data-default="#C0C0C0"'));
    assert.ok(html.includes('data-palette="light" data-key="normalText" data-default="#000000"'));
    assert.ok(html.includes("type: 'reset', palette: selectedPalette"));
  });
});

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
