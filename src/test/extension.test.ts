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
    const contents = Buffer.from('DEF diagnostic_test()\n  b_missing = TRUE\nEND\n', 'utf8');
    await vscode.workspace.fs.writeFile(uri, contents);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      assert.strictEqual(document.languageId, 'krl');
      await vscode.window.showTextDocument(document);

      const diagnostics = await waitForDiagnostics(uri);

      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes("Variable 'b_missing' is not declared")));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      await vscode.workspace.fs.delete(uri, { useTrash: false });
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
