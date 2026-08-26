import * as vscode from 'vscode';

export class FunctionSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(document: vscode.TextDocument): vscode.SymbolInformation[] {
    const symbols: vscode.SymbolInformation[] = [];
    const functionRegexes = [
      { regex: /GLOBAL\s+DEF\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Function, isGlobal: true },
      { regex: /GLOBAL\s+DEFFCT\s+\w+\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Function, isGlobal: true },
      { regex: /DEF\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Method, isGlobal: false },
      { regex: /DEFFCT\s+\w+\s+\w+\s*\(.*\)/g, kind: vscode.SymbolKind.Function, isGlobal: false }
    ];
    const text = document.getText();

    for (const { regex, kind, isGlobal } of functionRegexes) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        const matchText = match[0];
        const range = new vscode.Range(
          document.positionAt(match.index),
          document.positionAt(match.index + matchText.length)
        );
        symbols.push(new vscode.SymbolInformation(
          matchText,
          isGlobal ? vscode.SymbolKind.Namespace : kind,
          isGlobal ? 'Global' : '',
          new vscode.Location(document.uri, range)
        ));
      }
    }

    return symbols;
  }
}
