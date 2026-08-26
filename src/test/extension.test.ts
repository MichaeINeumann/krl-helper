import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

suite('KRL Helper', () => {
  test('test environment is available', () => {
    assert.strictEqual(true, true);
  });

  test('toggle line comment uses the KRL semicolon marker', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'krl',
      content: 'DEF comment_test()\nEND'
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    await vscode.commands.executeCommand('editor.action.commentLine');

    assert.strictEqual(document.lineAt(0).text, '; DEF comment_test()');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('dedicated KRL shortcut command toggles selected lines', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'krl',
      content: '  DEF comment_test()\n  END'
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 1, document.lineAt(1).text.length);

    await vscode.commands.executeCommand('krlHelper.toggleLineComment');
    assert.strictEqual(document.getText(), '  ; DEF comment_test()\n  ; END');

    await vscode.commands.executeCommand('krlHelper.toggleLineComment');
    assert.strictEqual(document.getText(), '  DEF comment_test()\n  END');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('publishes diagnostics for an undeclared KRL variable', async () => {
    const fileName = `krl-helper-diagnostics-${Date.now()}.src`;
    const uri = vscode.Uri.file(path.join(os.tmpdir(), fileName));
    const contents = Buffer.from('DEF DiagnosticTest()\n  IF TRUE B_AND TRUE THEN\n    BRAKE\n  ENDIF\n  bMissing = TRUE\nEND\n', 'utf8');
    await vscode.workspace.fs.writeFile(uri, contents);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      assert.strictEqual(document.languageId, 'krl');
      await vscode.window.showTextDocument(document);

      const diagnostics = await waitForDiagnostics(uri);

      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("Variable 'bMissing' is not declared")));
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'BRAKE'") || diagnostic.message.includes("'B_AND'")));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    }
  });

  test('updates open-document diagnostics when prefix configuration changes', async () => {
    const configuration = vscode.workspace.getConfiguration('krlHelper.diagnostics');
    const fileName = `krl-helper-diagnostics-config-${Date.now()}.src`;
    const uri = vscode.Uri.file(path.join(os.tmpdir(), fileName));
    await vscode.workspace.fs.writeFile(uri, Buffer.from('DEF DiagnosticConfigTest()\n  bMissing = TRUE\nEND\n'));

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      assert.ok((await waitForDiagnostics(uri)).some(diagnostic => diagnostic.message.includes("'bMissing'")));

      await configuration.update('localVariablePrefixes', [], vscode.ConfigurationTarget.Global);
      await configuration.update('globalVariablePrefixes', [], vscode.ConfigurationTarget.Global);
      const diagnostics = await waitForDiagnosticCondition(uri, values =>
        !values.some(diagnostic => diagnostic.message.includes("'bMissing'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bMissing'")));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      await configuration.update('localVariablePrefixes', undefined, vscode.ConfigurationTarget.Global);
      await configuration.update('globalVariablePrefixes', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    }
  });

  test('provides outline, hover, and definitions for unsaved local functions', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'krl',
      content: [
        'DEFFCT BOOL LocalCheck(INT nValue)',
        '  RETURN TRUE',
        'ENDFCT',
        'DEF Main()',
        '  IF localcheck(1) THEN',
        '  ENDIF',
        'END'
      ].join('\n')
    });
    await vscode.window.showTextDocument(document);
    const callPosition = new vscode.Position(4, 7);

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider', document.uri
    );
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', document.uri, callPosition
    );
    const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider', document.uri, callPosition
    );

    assert.ok(symbols.some(symbol => symbol.name === 'DEFFCT BOOL LocalCheck(INT nValue)'));
    assert.ok(hovers.some(hover => hover.contents.some(content =>
      typeof content !== 'string' && content.value.includes('DEFFCT BOOL LocalCheck(INT nValue)')
    )));
    assert.ok(definitions.some(definition => definition instanceof vscode.Location
      && definition.range.start.line === 0));

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('limits ambiguous function hover details while definitions remain available', async () => {
    const definitionLines = Array.from({ length: 7 }, (_, index) => `GLOBAL DEF Ambiguous(INT nValue${index})`);
    const document = await vscode.workspace.openTextDocument({
      language: 'krl',
      content: [...definitionLines, 'DEF Caller()', '  ambiguous(1)', 'END'].join('\n')
    });
    await vscode.window.showTextDocument(document);
    const callPosition = document.positionAt(document.getText().lastIndexOf('ambiguous'));
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', document.uri, callPosition
    );
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', document.uri, callPosition
    );
    const hoverText = hovers.flatMap(hover => hover.contents)
      .map(content => typeof content === 'string' ? content : content.value)
      .join('\n');

    assert.ok(hoverText.includes('2 more definition(s).'));
    assert.strictEqual((hoverText.match(/GLOBAL DEF Ambiguous/g) ?? []).length, 5);
    assert.strictEqual(definitions.length, 7);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('applies DAT and source visibility rules in a KRL project', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const uri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      'KRC', 'R1', 'Program', 'diagnostic-visibility.src'
    );
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const diagnostics = await waitForDiagnosticCondition(uri, values =>
      values.some(diagnostic => diagnostic.message.includes("'i_Missing'"))
    );
    const messages = diagnostics.map(diagnostic => diagnostic.message);

    for (const missingName of ['b_LocalOnlyGlobal', 'b_Private', 'b_PublicNonGlobal', 'i_Missing', 'o_Missing']) {
      assert.ok(messages.some(message => message.includes(`'${missingName}'`)), `${missingName} should be reported`);
    }
    for (const visibleName of ['bLocalOk', 'bCompanion', 'nParam', 'b_Config', 'b_Public', 'n_SourceGlobal', 'i_Configured']) {
      assert.ok(!messages.some(message => message.includes(`'${visibleName}'`)), `${visibleName} should be visible`);
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('resolves foreign global functions and excludes foreign local functions', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'KRC', 'R1', 'Program', 'navigation-main.src');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const sharedPosition = document.positionAt(document.getText().lastIndexOf('sharedroutine'));
    const sharedDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', uri, sharedPosition
    );
    const sharedHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, sharedPosition
    );
    assert.strictEqual(sharedDefinitions.length, 2);
    assert.ok(sharedDefinitions.some(definition => definition.uri.toString() === uri.toString()));
    assert.ok(sharedDefinitions.some(definition => definition.uri.path.endsWith('/navigation-library.src')));
    const sharedHoverText = sharedHovers.flatMap(hover => hover.contents)
      .map(content => typeof content === 'string' ? content : content.value)
      .join('\n');
    assert.ok(sharedHoverText.includes('DEF SharedRoutine(INT nValue)'));
    assert.ok(sharedHoverText.includes('GLOBAL DEF SharedRoutine(INT nValue)'));
    assert.ok(sharedHoverText.includes('navigation-library.src'));

    const globalPosition = document.positionAt(document.getText().indexOf('ForeignGlobalOnly'));
    const globalDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', uri, globalPosition
    );
    assert.strictEqual(globalDefinitions.length, 1);
    assert.ok(globalDefinitions[0].uri.path.endsWith('/navigation-library.src'));

    const privatePosition = document.positionAt(document.getText().indexOf('ForeignPrivateOnly'));
    const privateDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
      'vscode.executeDefinitionProvider', uri, privatePosition
    );
    assert.ok(!privateDefinitions || privateDefinitions.length === 0);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('uses Workspace diagnostic overrides before User values and resets scopes independently', async () => {
    const configuration = vscode.workspace.getConfiguration('krlHelper.diagnostics');
    try {
      await configuration.update('outputAliasPrefixes', ['user_'], vscode.ConfigurationTarget.Global);
      await configuration.update('outputAliasPrefixes', ['workspace_'], vscode.ConfigurationTarget.Workspace);
      assert.deepStrictEqual(
        vscode.workspace.getConfiguration('krlHelper.diagnostics').get('outputAliasPrefixes'),
        ['workspace_']
      );

      await configuration.update('outputAliasPrefixes', undefined, vscode.ConfigurationTarget.Workspace);
      assert.deepStrictEqual(
        vscode.workspace.getConfiguration('krlHelper.diagnostics').get('outputAliasPrefixes'),
        ['user_']
      );
    } finally {
      await configuration.update('outputAliasPrefixes', undefined, vscode.ConfigurationTarget.Workspace);
      await configuration.update('outputAliasPrefixes', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

async function waitForDiagnostics(uri: vscode.Uri): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length > 0) {
      return diagnostics;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri);
}

async function waitForDiagnosticCondition(
  uri: vscode.Uri,
  predicate: (diagnostics: readonly vscode.Diagnostic[]) => boolean
): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (predicate(diagnostics)) {
      return diagnostics;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri);
}
