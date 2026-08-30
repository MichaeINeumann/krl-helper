import * as assert from 'assert';
import * as fs from 'fs';
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
      '  $IN[nIoIndex] = TRUE',
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
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("Variable 'nIoIndex' is not declared")));
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

  test('provides outline symbols for virtual KRL documents', async () => {
    const scheme = `krl-helper-test-${Date.now()}`;
    const uri = vscode.Uri.from({ scheme, path: '/virtual.src' });
    const provider = vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent: () => 'DEF VirtualRoutine()\nEND\n'
    });

    try {
      let document = await vscode.workspace.openTextDocument(uri);
      document = await vscode.languages.setTextDocumentLanguage(document, 'krl');
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', document.uri
      );

      assert.ok(symbols.some(symbol => symbol.name === 'DEF VirtualRoutine()'));
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      provider.dispose();
    }
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

  test('infers a standalone KRC project for function navigation', async () => {
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `krl-helper-functions-${Date.now()}`));
    const programUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program');
    const sourceUri = vscode.Uri.joinPath(programUri, 'standalone-main.src');
    const libraryUri = vscode.Uri.joinPath(programUri, 'standalone-library.src');
    const moduleUri = vscode.Uri.joinPath(programUri, 'standalonemodule.src');
    const freshLibraryUri = vscode.Uri.joinPath(programUri, 'fresh-library.src');
    await vscode.workspace.fs.createDirectory(programUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF StandaloneMain()',
      '  StandaloneGlobal()',
      '  StandaloneModule()',
      '  FreshGlobal()',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(libraryUri, Buffer.from('GLOBAL DEF StandaloneGlobal()\nEND\n'));
    await vscode.workspace.fs.writeFile(moduleUri, Buffer.from('DEF StandaloneModule()\nEND\n'));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      for (const [name, targetUri] of [
        ['StandaloneGlobal', libraryUri],
        ['StandaloneModule', moduleUri]
      ] as const) {
        const position = document.positionAt(document.getText().indexOf(name, name.length));
        const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeDefinitionProvider', sourceUri, position
        );
        assert.ok(definitions.some(definition => definition.uri.toString() === targetUri.toString()));
      }

      const freshPosition = document.positionAt(document.getText().indexOf('FreshGlobal'));
      const missingDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider', sourceUri, freshPosition
      );
      assert.ok(!missingDefinitions || missingDefinitions.length === 0);

      await vscode.workspace.fs.writeFile(freshLibraryUri, Buffer.from('GLOBAL DEF FreshGlobal()\nEND\n'));
      const freshDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', sourceUri, freshPosition
      );
      assert.ok(freshDefinitions.some(definition => definition.uri.toString() === freshLibraryUri.toString()));
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
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

  test('limits local variable definitions to the containing routine', async () => {
    const source = [
      'DEF First()',
      '  DECL BOOL bShared',
      '  DECL BOOL bFirstOnly',
      '  bShared = TRUE',
      'END',
      'DEF Second(BOOL bShared)',
      '  /*',
      '  END',
      '  */',
      '  bShared = FALSE',
      '  bFirstOnly = FALSE',
      'END',
      ''
    ].join('\n');

    try {
      const document = await vscode.workspace.openTextDocument({ language: 'krl', content: source });
      await vscode.window.showTextDocument(document);
      const sharedDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(lastIdentifierOffset(source, 'bShared'))
      );
      assert.strictEqual(sharedDefinitions.length, 1);
      assert.strictEqual(sharedDefinitions[0].range.start.line, 5);

      const outOfScopeDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        document.uri,
        document.positionAt(lastIdentifierOffset(source, 'bFirstOnly'))
      );
      assert.ok(!outOfScopeDefinitions || outOfScopeDefinitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('keeps variable navigation inside the enclosing KRC project', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const containerUri = vscode.Uri.joinPath(workspaceFolder.uri, `navigation-isolation-${Date.now()}`);
    const firstProgramUri = vscode.Uri.joinPath(containerUri, 'controller-a', 'KRC', 'R1', 'Program');
    const secondProgramUri = vscode.Uri.joinPath(containerUri, 'controller-b', 'KRC', 'R1', 'Program');
    const sourceUri = vscode.Uri.joinPath(firstProgramUri, 'main.src');
    const firstDatUri = vscode.Uri.joinPath(firstProgramUri, 'shared.dat');
    const secondDatUri = vscode.Uri.joinPath(secondProgramUri, 'shared.dat');
    const publicDat = Buffer.from('DEFDAT Shared PUBLIC\nDECL GLOBAL BOOL b_Isolated\nENDDAT\n');
    await vscode.workspace.fs.createDirectory(firstProgramUri);
    await vscode.workspace.fs.createDirectory(secondProgramUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from('DEF Main()\n  b_Isolated = TRUE\nEND\n'));
    await vscode.workspace.fs.writeFile(firstDatUri, publicDat);
    await vscode.workspace.fs.writeFile(secondDatUri, publicDat);

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'b_Isolated'))
      );
      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].uri.toString(), firstDatUri.toString());
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(containerUri, { recursive: true, useTrash: false });
    }
  });

  test('uses unsaved companion DAT declarations for standalone navigation', async () => {
    const directoryUri = vscode.Uri.file(path.join(os.tmpdir(), `krl-helper-companion-${Date.now()}`));
    const sourceUri = vscode.Uri.joinPath(directoryUri, 'standalone.src');
    const datUri = vscode.Uri.joinPath(directoryUri, 'standalone.dat');
    await vscode.workspace.fs.createDirectory(directoryUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from('DEF Standalone()\n  bUnsaved = TRUE\nEND\n'));
    await vscode.workspace.fs.writeFile(datUri, Buffer.from('DEFDAT Standalone\nENDDAT\n'));

    try {
      const datDocument = await vscode.workspace.openTextDocument(datUri);
      const datEditor = await vscode.window.showTextDocument(datDocument);
      assert.ok(await datEditor.edit(edit => edit.insert(new vscode.Position(1, 0), 'DECL BOOL bUnsaved\n')));
      assert.strictEqual(datDocument.isDirty, true);

      const sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(sourceDocument);
      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        sourceDocument.positionAt(lastIdentifierOffset(sourceDocument.getText(), 'bUnsaved'))
      );
      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].uri.toString(), datUri.toString());
      assert.strictEqual(definitions[0].range.start.line, 1);

      assert.ok(await datDocument.save());
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(directoryUri, { recursive: true, useTrash: false });
    }
  });

  test('uses public DAT GLOBAL declarations consistently for diagnostics and navigation', async () => {
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `krl-helper-krc-project-${Date.now()}`));
    const sourceUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program', 'external.src');
    const globalUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System', 'legacy-global.dat');
    const freshGlobalUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System', 'fresh-global.dat');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF External()',
      '  advanceStop(bAdvanceStop)',
      '  n_Counter = 1',
      '  bFreshGlobal = TRUE',
      '  b_Status = TRUE',
      '  bStillMissing = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(globalUri, Buffer.from([
      'DEFDAT LegacyGlobal PUBLIC',
      'GLOBAL BOOL bAdvanceStop=TRUE',
      'GLOBAL DECL INT n_Counter',
      'GLOBAL STRUC b_Status BOOL bReady',
      'ENDDAT',
      ''
    ].join('\n')));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bStillMissing'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bAdvanceStop'")));
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'n_Counter'")));
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("'b_Status'")));
      assert.ok(diagnostics.some(diagnostic => diagnostic.message ===
        "Variable 'bStillMissing' is not declared in the current module or visible project globals."
      ));

      const position = document.positionAt(lastIdentifierOffset(document.getText(), 'bAdvanceStop'));
      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', sourceUri, position
      );
      assert.ok(definitions.some(definition =>
        definition.uri.toString() === globalUri.toString() && definition.range.start.line === 1
      ));

      const alternatePosition = document.positionAt(lastIdentifierOffset(document.getText(), 'n_Counter'));
      const alternateDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', sourceUri, alternatePosition
      );
      assert.ok(alternateDefinitions.some(definition =>
        definition.uri.toString() === globalUri.toString() && definition.range.start.line === 2
      ));

      const typePosition = document.positionAt(lastIdentifierOffset(document.getText(), 'b_Status'));
      const typeDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider', sourceUri, typePosition
      );
      assert.ok(!typeDefinitions || typeDefinitions.length === 0);

      await vscode.workspace.fs.writeFile(freshGlobalUri, Buffer.from([
        'DEFDAT FreshGlobal PUBLIC',
        'DECL GLOBAL BOOL bFreshGlobal',
        'ENDDAT',
        ''
      ].join('\n')));
      const freshPosition = document.positionAt(lastIdentifierOffset(document.getText(), 'bFreshGlobal'));
      const freshDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider', sourceUri, freshPosition
      );
      assert.ok(freshDefinitions.some(definition =>
        definition.uri.toString() === freshGlobalUri.toString() && definition.range.start.line === 1
      ));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('does not import workspace configs into an external standalone file', async () => {
    const directoryUri = vscode.Uri.file(path.join(os.tmpdir(), `external-config-scope-${Date.now()}`));
    const sourceUri = vscode.Uri.joinPath(directoryUri, 'standalone.src');
    await vscode.workspace.fs.createDirectory(directoryUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Standalone()',
      '  b_Config = TRUE',
      '  bStillMissing = TRUE',
      'END',
      ''
    ].join('\n')));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bStillMissing'"))
      );
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("'b_Config'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'b_Config'))
      );
      assert.ok(!definitions || definitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(directoryUri, { recursive: true, useTrash: false });
    }
  });

  test('diagnostics and navigation agree on visibility inside a nested KRC R1 tree', async () => {
    // Both providers must select the same KRC/R1 occurrence. The inner tree owns the source, so a
    // global declared only in the outer tree must be unresolved for diagnostics and navigation
    // alike. The invariant asserted at the end is the property the two providers must share:
    // a name is diagnostic-clean exactly when Go to Definition resolves it.
    const outerUri = vscode.Uri.file(path.join(os.tmpdir(), `krl-helper-nested-${Date.now()}`));
    const innerUri = vscode.Uri.joinPath(outerUri, 'KRC', 'R1', 'Program', 'extracted');
    const sourceUri = vscode.Uri.joinPath(innerUri, 'KRC', 'R1', 'Program', 'nested.src');
    const innerGlobalUri = vscode.Uri.joinPath(innerUri, 'KRC', 'R1', 'System', 'inner.dat');
    const outerGlobalUri = vscode.Uri.joinPath(outerUri, 'KRC', 'R1', 'System', 'outer.dat');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(innerUri, 'KRC', 'R1', 'Program'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(innerUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(outerUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Nested()',
      '  bInnerGlobal = TRUE',
      '  bOuterGlobal = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(innerGlobalUri, Buffer.from(
      'DEFDAT Inner PUBLIC\nGLOBAL BOOL bInnerGlobal=TRUE\nENDDAT\n'
    ));
    await vscode.workspace.fs.writeFile(outerGlobalUri, Buffer.from(
      'DEFDAT Outer PUBLIC\nGLOBAL BOOL bOuterGlobal=TRUE\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bOuterGlobal'"))
      );

      for (const identifier of ['bInnerGlobal', 'bOuterGlobal']) {
        const position = document.positionAt(lastIdentifierOffset(document.getText(), identifier));
        const definitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
          'vscode.executeDefinitionProvider', sourceUri, position
        );
        const navigationResolves = (definitions?.length ?? 0) > 0;
        const diagnosticClean = !diagnostics.some(diagnostic =>
          diagnostic.message.includes(`'${identifier}'`)
        );
        assert.strictEqual(
          diagnosticClean,
          navigationResolves,
          `${identifier}: diagnostics and navigation disagree `
          + `(clean=${diagnosticClean}, resolves=${navigationResolves})`
        );
      }

      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bInnerGlobal'")));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      await vscode.workspace.fs.delete(outerUri, { recursive: true, useTrash: false });
    }
  });

  test('uses only the nearest $config.dat for standalone source globals', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const containerUri = vscode.Uri.joinPath(workspaceFolder.uri, `nearest-config-${Date.now()}`);
    const firstRootUri = vscode.Uri.joinPath(containerUri, 'first-project');
    const secondRootUri = vscode.Uri.joinPath(containerUri, 'second-project');
    const sourceUri = vscode.Uri.joinPath(firstRootUri, 'standalone.src');
    const firstConfigUri = vscode.Uri.joinPath(firstRootUri, 'KRC', 'R1', 'System', '$config.dat');
    const secondConfigUri = vscode.Uri.joinPath(secondRootUri, 'KRC', 'R1', 'System', '$config.dat');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(firstRootUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(secondRootUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Standalone()',
      '  bNearestConfig = TRUE',
      '  bRemoteConfig = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(firstConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bNearestConfig\nENDDAT\n'
    ));
    await vscode.workspace.fs.writeFile(secondConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bRemoteConfig\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bRemoteConfig'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bNearestConfig'")));

      const nearestDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bNearestConfig'))
      );
      assert.ok(nearestDefinitions.some(definition => definition.uri.toString() === firstConfigUri.toString()));

      const remoteDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bRemoteConfig'))
      );
      assert.ok(!remoteDefinitions || remoteDefinitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(containerUri, { recursive: true, useTrash: false });
    }
  });

  test('keeps a declaration-free nearest config authoritative for navigation', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const containerUri = vscode.Uri.joinPath(workspaceFolder.uri, `empty-nearest-config-${Date.now()}`);
    const nearbyRootUri = vscode.Uri.joinPath(containerUri, 'nearby');
    const remoteRootUri = vscode.Uri.joinPath(containerUri, 'remote');
    const sourceUri = vscode.Uri.joinPath(nearbyRootUri, 'standalone.src');
    const nearbyConfigUri = vscode.Uri.joinPath(nearbyRootUri, '$config.dat');
    const remoteConfigUri = vscode.Uri.joinPath(remoteRootUri, '$config.dat');
    await vscode.workspace.fs.createDirectory(nearbyRootUri);
    await vscode.workspace.fs.createDirectory(remoteRootUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(
      'DEF Standalone()\n  bMaskedConfig = TRUE\nEND\n'
    ));
    await vscode.workspace.fs.writeFile(nearbyConfigUri, Buffer.from('DEFDAT $CONFIG\nENDDAT\n'));
    await vscode.workspace.fs.writeFile(remoteConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bMaskedConfig\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bMaskedConfig'"))
      );
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("'bMaskedConfig'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bMaskedConfig'))
      );
      assert.ok(!definitions || definitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(containerUri, { recursive: true, useTrash: false });
    }
  });

  test('restricts inferred-project configs to the current KRC R1 tree', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const projectUri = vscode.Uri.joinPath(workspaceFolder.uri, `inferred-config-${Date.now()}`);
    const sourceUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program', 'standalone.src');
    const canonicalConfigUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System', '$config.dat');
    const shallowConfigUri = vscode.Uri.joinPath(projectUri, 'KRC', '$config.dat');
    const outsideGlobalUri = vscode.Uri.joinPath(projectUri, 'shared.dat');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Standalone()',
      '  bCanonicalConfig = TRUE',
      '  bShallowConfig = TRUE',
      '  bOutsideR1 = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(canonicalConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bCanonicalConfig\nENDDAT\n'
    ));
    await vscode.workspace.fs.writeFile(shallowConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bShallowConfig\nENDDAT\n'
    ));
    await vscode.workspace.fs.writeFile(outsideGlobalUri, Buffer.from(
      'DEFDAT Shared PUBLIC\nGLOBAL BOOL bOutsideR1\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bShallowConfig'"))
          && values.some(diagnostic => diagnostic.message.includes("'bOutsideR1'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bCanonicalConfig'")));
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("'bOutsideR1'")));

      const canonicalDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bCanonicalConfig'))
      );
      assert.ok(canonicalDefinitions.some(definition => definition.uri.toString() === canonicalConfigUri.toString()));

      const shallowDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bShallowConfig'))
      );
      assert.ok(!shallowDefinitions || shallowDefinitions.length === 0);

      const outsideDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bOutsideR1'))
      );
      assert.ok(!outsideDefinitions || outsideDefinitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('considers the nearest config after more than 50 unrelated configs', async function () {
    this.timeout(10000);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const containerUri = vscode.Uri.joinPath(workspaceFolder.uri, `many-configs-${Date.now()}`);
    const targetUri = vscode.Uri.joinPath(containerUri, 'a-target');
    const sourceUri = vscode.Uri.joinPath(targetUri, 'standalone.src');
    const canonicalConfigUri = vscode.Uri.joinPath(targetUri, 'KRC', 'R1', 'System', '$config.dat');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(targetUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(
      'DEF Standalone()\n  bCanonicalConfig = TRUE\n  bStillMissing = TRUE\nEND\n'
    ));
    await vscode.workspace.fs.writeFile(canonicalConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bCanonicalConfig\nENDDAT\n'
    ));
    await Promise.all(Array.from({ length: 55 }, async (_, index) => {
      const decoyUri = vscode.Uri.joinPath(
        containerUri,
        `z-decoy-${String(index).padStart(2, '0')}`,
        'nested',
        'remote',
        'config'
      );
      await vscode.workspace.fs.createDirectory(decoyUri);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(decoyUri, '$config.dat'),
        Buffer.from('DEFDAT $CONFIG\nENDDAT\n')
      );
    }));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bStillMissing'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bCanonicalConfig'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bCanonicalConfig'))
      );
      assert.ok(definitions.some(definition => definition.uri.toString() === canonicalConfigUri.toString()));
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(containerUri, { recursive: true, useTrash: false });
    }
  });

  test('prefers a nearby non-System $config.dat over a remote System config', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const containerUri = vscode.Uri.joinPath(workspaceFolder.uri, `mixed-config-${Date.now()}`);
    const nearbyRootUri = vscode.Uri.joinPath(containerUri, 'nearby');
    const remoteRootUri = vscode.Uri.joinPath(containerUri, 'remote');
    const sourceUri = vscode.Uri.joinPath(nearbyRootUri, 'standalone.src');
    const nearbyConfigUri = vscode.Uri.joinPath(nearbyRootUri, '$config.dat');
    const remoteConfigUri = vscode.Uri.joinPath(remoteRootUri, 'KRC', 'R1', 'System', '$config.dat');
    await vscode.workspace.fs.createDirectory(nearbyRootUri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(remoteRootUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Standalone()',
      '  bNearbyConfig = TRUE',
      '  bRemoteSystemConfig = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(nearbyConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bNearbyConfig\nENDDAT\n'
    ));
    await vscode.workspace.fs.writeFile(remoteConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bRemoteSystemConfig\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnostics(sourceUri);
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bNearbyConfig'")));

      const nearbyDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bNearbyConfig'))
      );
      assert.ok(nearbyDefinitions.some(definition => definition.uri.toString() === nearbyConfigUri.toString()));

      const remoteDefinitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bRemoteSystemConfig'))
      );
      assert.ok(!remoteDefinitions || remoteDefinitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(containerUri, { recursive: true, useTrash: false });
    }
  });

  test('discovers uppercase $CONFIG.DAT outside the workspace on case-sensitive filesystems', async () => {
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `uppercase-config-${Date.now()}`));
    const sourceUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program', 'standalone.src');
    const configUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System', '$CONFIG.DAT');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Standalone()',
      '  bUpperConfig = TRUE',
      '  bMissingConfig = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(configUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bUpperConfig\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bMissingConfig'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bUpperConfig'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bUpperConfig'))
      );
      assert.ok(definitions.some(definition => definition.uri.toString() === configUri.toString()));
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('keeps canonical config lookup inside a case-distinct inferred tree', async function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `case-distinct-config-${Date.now()}`));
    const foreignConfigUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System', '$config.dat');
    const sourceUri = vscode.Uri.joinPath(projectUri, 'krc', 'R1', 'Program', 'standalone.src');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System'));
    await vscode.workspace.fs.writeFile(foreignConfigUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bForeignConfig\nENDDAT\n'
    ));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'krc', 'R1', 'Program'));
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(
      'DEF Standalone()\n  bForeignConfig = TRUE\nEND\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bForeignConfig'"))
      );
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("'bForeignConfig'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bForeignConfig'))
      );
      assert.ok(!definitions || definitions.length === 0);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('discovers $config.dat through a symbolic-link directory', async function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `symlink-config-${Date.now()}`));
    const programUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program');
    const actualSystemUri = vscode.Uri.joinPath(projectUri, 'linked-system-target');
    const linkedSystemUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System');
    const sourceUri = vscode.Uri.joinPath(programUri, 'standalone.src');
    const configUri = vscode.Uri.joinPath(linkedSystemUri, '$config.dat');
    await vscode.workspace.fs.createDirectory(programUri);
    await vscode.workspace.fs.createDirectory(actualSystemUri);
    await fs.promises.symlink(actualSystemUri.fsPath, linkedSystemUri.fsPath, 'dir');
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      'DEF Standalone()',
      '  bLinkedConfig = TRUE',
      '  bMissingConfig = TRUE',
      'END',
      ''
    ].join('\n')));
    await vscode.workspace.fs.writeFile(configUri, Buffer.from(
      'DEFDAT $CONFIG\nDECL BOOL bLinkedConfig\nENDDAT\n'
    ));

    try {
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bMissingConfig'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bLinkedConfig'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bLinkedConfig'))
      );
      assert.ok(definitions.some(definition => definition.uri.toString() === configUri.toString()));
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('deduplicates a public DAT reached through a file symlink', async function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `symlink-file-${Date.now()}`));
    const programUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program');
    const systemUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System');
    const sourceUri = vscode.Uri.joinPath(programUri, 'standalone.src');
    const globalUri = vscode.Uri.joinPath(systemUri, 'shared.dat');
    const aliasUri = vscode.Uri.joinPath(systemUri, 'shared-alias.dat');
    await vscode.workspace.fs.createDirectory(programUri);
    await vscode.workspace.fs.createDirectory(systemUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(
      'DEF Standalone()\n  bLinkedFile = TRUE\n  bStillMissing = TRUE\nEND\n'
    ));
    await vscode.workspace.fs.writeFile(globalUri, Buffer.from(
      'DEFDAT Shared PUBLIC\nENDDAT\n'
    ));
    await fs.promises.symlink(globalUri.fsPath, aliasUri.fsPath, 'file');

    try {
      const aliasDocument = await vscode.workspace.openTextDocument(aliasUri);
      const aliasEditor = await vscode.window.showTextDocument(aliasDocument);
      assert.ok(await aliasEditor.edit(edit =>
        edit.insert(new vscode.Position(1, 0), 'GLOBAL BOOL bLinkedFile\n')
      ));
      assert.strictEqual(aliasDocument.isDirty, true);

      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bStillMissing'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bLinkedFile'")));
      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bLinkedFile'))
      );
      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].uri.toString(), aliasUri.toString());
      assert.ok(await aliasDocument.save());
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('uses unsaved config declarations from a discarded file-symlink alias', async function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const projectUri = vscode.Uri.file(path.join(os.tmpdir(), `symlink-config-file-${Date.now()}`));
    const programUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'Program');
    const systemUri = vscode.Uri.joinPath(projectUri, 'KRC', 'R1', 'System');
    const sourceUri = vscode.Uri.joinPath(programUri, 'standalone.src');
    const configUri = vscode.Uri.joinPath(systemUri, '$config.dat');
    const aliasUri = vscode.Uri.joinPath(systemUri, 'config-alias.dat');
    await vscode.workspace.fs.createDirectory(programUri);
    await vscode.workspace.fs.createDirectory(systemUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(
      'DEF Standalone()\n  bAliasConfig = TRUE\n  bStillMissing = TRUE\nEND\n'
    ));
    await vscode.workspace.fs.writeFile(configUri, Buffer.from('DEFDAT $CONFIG\nENDDAT\n'));
    await fs.promises.symlink(configUri.fsPath, aliasUri.fsPath, 'file');

    try {
      const aliasDocument = await vscode.workspace.openTextDocument(aliasUri);
      const aliasEditor = await vscode.window.showTextDocument(aliasDocument);
      assert.ok(await aliasEditor.edit(edit =>
        edit.insert(new vscode.Position(1, 0), 'DECL BOOL bAliasConfig\n')
      ));

      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'bStillMissing'"))
      );
      assert.ok(!diagnostics.some(diagnostic => diagnostic.message.includes("'bAliasConfig'")));

      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        document.positionAt(lastIdentifierOffset(document.getText(), 'bAliasConfig'))
      );
      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].uri.toString(), aliasUri.toString());
      assert.ok(await aliasDocument.save());
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
    }
  });

  test('excludes directives, KRL keywords, and I/O aliases from generic prefix diagnostics', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder);
    const configuration = vscode.workspace.getConfiguration('krlHelper.diagnostics');
    const sourceUri = vscode.Uri.joinPath(
      workspaceFolder.uri, 'KRC', 'R1', 'Program', `keyword-diagnostics-${Date.now()}.src`
    );
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from([
      '&ACCESS RVO',
      '&REL 1',
      'DEF KeywordDiagnostics(IN INT iCount, INOUT REAL rValue)',
      '  $IN[i_Configured] = TRUE',
      '  $IN[i_Missing] = TRUE',
      '  rValue = rValue + iCount',
      '  RETURN',
      'END',
      ''
    ].join('\n')));

    try {
      await configuration.update('localVariablePrefixes', ['a', 'i', 'r'], vscode.ConfigurationTarget.Global);
      await configuration.update('globalVariablePrefixes', [], vscode.ConfigurationTarget.Global);
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document);
      const diagnostics = await waitForDiagnosticCondition(sourceUri, values =>
        values.some(diagnostic => diagnostic.message.includes("'i_Missing'"))
      );
      const messages = diagnostics.map(diagnostic => diagnostic.message);

      for (const ignoredName of ['ACCESS', 'RVO', 'REL', 'IN', 'INT', 'INOUT', 'REAL', 'RETURN', 'i_Configured']) {
        assert.ok(!messages.some(message => message.includes(`'${ignoredName}'`)), `${ignoredName} should be ignored`);
      }
      const missingAliasMessages = messages.filter(message => message.includes("'i_Missing'"));
      assert.strictEqual(missingAliasMessages.length, 1);
      assert.ok(missingAliasMessages[0].includes('$config.dat'));
    } finally {
      await configuration.update('localVariablePrefixes', undefined, vscode.ConfigurationTarget.Global);
      await configuration.update('globalVariablePrefixes', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(sourceUri, { useTrash: false });
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
