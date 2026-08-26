import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

suite('KRL Helper', () => {
  test('test environment is available', () => {
    assert.strictEqual(true, true);
  });

  test('declares the KRL semicolon comment marker', async () => {
    const extension = vscode.extensions.getExtension('MichaeINeumann.krl-helper');
    assert.ok(extension);

    const contents = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(
      extension.extensionUri,
      'language-configuration.json'
    ));
    const configuration = JSON.parse(Buffer.from(contents).toString('utf8')) as {
      comments?: { lineComment?: string };
    };

    assert.strictEqual(configuration.comments?.lineComment, ';');
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
    const contents = Buffer.from([
      'DEF DiagnosticTest()',
      '  IF TRUE B_AND TRUE THEN',
      '    BRAKE',
      '  ENDIF',
      '  bMissing = #NOTIFY',
      'END',
      ''
    ].join('\n'), 'utf8');
    await vscode.workspace.fs.writeFile(uri, contents);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      assert.strictEqual(document.languageId, 'krl');
      await vscode.window.showTextDocument(document);

      const diagnostics = await waitForDiagnostics(uri);

      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("Variable 'bMissing' is not declared")));
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'BRAKE'") || diagnostic.message.includes("'B_AND'")));
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'NOTIFY'")));
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
    for (const visibleName of [
      'bLocalOk', 'nTolerance', 'bCompanion', 'nParam', 'b_Config', 'b_Public',
      'n_SourceGlobal', 'i_Configured'
    ]) {
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

    const modulePosition = document.positionAt(document.getText().indexOf('r_mvHome'));
    const moduleDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', uri, modulePosition
    );
    const moduleHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, modulePosition
    );
    const moduleHoverText = moduleHovers.flatMap(hover => hover.contents)
      .map(content => typeof content === 'string' ? content : content.value)
      .join('\n');
    assert.strictEqual(moduleDefinitions.length, 1);
    assert.ok(moduleDefinitions[0].uri.path.endsWith('/r_mvhome.src'));
    assert.ok(moduleHoverText.includes('**Module**'));
    assert.ok(moduleHoverText.includes('DEF r_mvHome(bnHalt :IN)'));

    const internalPosition = document.positionAt(document.getText().indexOf('HomeInternalOnly'));
    const internalDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
      'vscode.executeDefinitionProvider', uri, internalPosition
    );
    assert.ok(!internalDefinitions || internalDefinitions.length === 0);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('resolves visible local, companion DAT, parameter, and project variables', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const uri = vscode.Uri.joinPath(
      workspaceFolder.uri, 'KRC', 'R1', 'Program', 'diagnostic-visibility.src'
    );
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const expectedDefinitions = [
      { name: 'bLocalOk', suffix: '/diagnostic-visibility.src', line: 1 },
      { name: 'nTolerance', suffix: '/diagnostic-visibility.src', line: 2 },
      { name: 'bCompanion', suffix: '/diagnostic-visibility.dat', line: 1 },
      { name: 'nParam', suffix: '/diagnostic-visibility.src', line: 0 },
      { name: 'b_Config', suffix: '/System/$config.dat', line: 1 },
      { name: 'b_Public', suffix: '/shared.dat', line: 1 },
      { name: 'n_SourceGlobal', suffix: '/navigation-library.src', line: 0 },
      { name: 'i_Configured', suffix: '/System/$config.dat', line: 2 }
    ];
    for (const expected of expectedDefinitions) {
      const position = document.positionAt(lastIdentifierOffset(document.getText(), expected.name));
      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', uri, position
      );
      assert.ok(definitions.length > 0, `${expected.name} should have a definition`);
      assert.ok(definitions.some(definition =>
        definition.uri.path.endsWith(expected.suffix) && definition.range.start.line === expected.line
      ), `${expected.name} should resolve to ${expected.suffix}:${expected.line + 1}`);
    }

    for (const name of ['b_LocalOnlyGlobal', 'b_Private', 'b_PublicNonGlobal']) {
      const position = document.positionAt(lastIdentifierOffset(document.getText(), name));
      const definitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider', uri, position
      );
      assert.ok(!definitions || definitions.length === 0, `${name} should not resolve outside its scope`);
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('navigates to a legacy public DAT global without accepting it as locally visible', async () => {
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `krl-helper-krc-project-${Date.now()}`));
    const sourceUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program', 'external.src');
    const globalUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System', 'legacy-global.dat');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF External()',
      '  advanceStop(bAdvanceStop)',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(globalUri, Buffer.from([
      'DEFDAT LegacyGlobal PUBLIC',
      'GLOBAL BOOL bAdvanceStop=TRUE',
      'ENDDAT',
      ''
    ].join('\n')));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bAdvanceStop'"))
      );
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("'bAdvanceStop'")));

      const position = document.positionAt(lastIdentifierOffset(document.getText(), 'bAdvanceStop'));
      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', sourceUri, position
      );
      assert.ok(definitions.some(definition =>
        definition.uri.toString() === globalUri.toString() && definition.range.start.line === 1
      ));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
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

function lastIdentifierOffset(text: string, identifier: string): number {
  const matches = [...text.matchAll(new RegExp(`\\b${identifier}\\b`, 'g'))];
  return matches.at(-1)?.index ?? -1;
}
