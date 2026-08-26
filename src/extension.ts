import * as vscode from 'vscode';
import { initializeColorSettings } from './colorSettings';
import { initializeDiagnostics } from './diagnostics';
import { toggleKrlLineComments } from './commentToggle';
import { convertSelectionToIiqkaFold } from './foldConversion';
import { FunctionSymbolProvider } from './functionSymbolProvider';
import { initializeFunctionNavigation } from './functionNavigation';
import { initializeVariableNavigation } from './variableNavigation';

const krlDocumentSelector: vscode.DocumentSelector = { language: 'krl' };
const krlNavigationSelector: vscode.DocumentSelector = [
  { language: 'krl', scheme: 'file' },
  { language: 'krl', scheme: 'untitled' }
];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(krlDocumentSelector, new FunctionSymbolProvider()),
    vscode.commands.registerCommand('kukaFoldTools.convertSelection', convertSelectionToIiqkaFold),
    vscode.commands.registerTextEditorCommand('krlHelper.toggleLineComment', toggleKrlLineComments)
  );

  initializeColorSettings(context);
  initializeDiagnostics(context);
  initializeFunctionNavigation(context, krlNavigationSelector);
  initializeVariableNavigation(context, krlNavigationSelector);
}

export function deactivate(): void {
  // All resources are owned by the extension context and disposed by VS Code.
}
