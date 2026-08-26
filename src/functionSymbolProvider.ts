import * as vscode from 'vscode';
import { parseKrlFunctions } from './functionParser';

export class FunctionSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    return parseKrlFunctions(document.getText()).map(definition => {
      const range = new vscode.Range(
        document.positionAt(definition.startOffset),
        document.positionAt(definition.endOffset)
      );
      const selectionRange = new vscode.Range(
        document.positionAt(definition.nameStartOffset),
        document.positionAt(definition.nameEndOffset)
      );
      return new vscode.DocumentSymbol(
        definition.signature,
        definition.global ? 'Global' : 'Local',
        vscode.SymbolKind.Function,
        range,
        selectionRange
      );
    });
  }
}
