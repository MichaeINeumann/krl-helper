import * as vscode from 'vscode';

export function toggleKrlLineComments(
  editor: vscode.TextEditor,
  editBuilder: vscode.TextEditorEdit
): void {
  const lineNumbers = selectedLineNumbers(editor.selections);
  const lines = lineNumbers
    .map(lineNumber => editor.document.lineAt(lineNumber))
    .filter(line => line.text.trim().length > 0);
  if (lines.length === 0) {
    return;
  }

  const shouldUncomment = lines.every(line => {
    const content = line.text.slice(line.firstNonWhitespaceCharacterIndex);
    return content.startsWith(';');
  });

  for (const line of lines) {
    const commentColumn = line.firstNonWhitespaceCharacterIndex;
    if (!shouldUncomment) {
      editBuilder.insert(new vscode.Position(line.lineNumber, commentColumn), '; ');
      continue;
    }

    const characterAfterMarker = line.text[commentColumn + 1];
    const markerLength = characterAfterMarker === ' ' || characterAfterMarker === '\t' ? 2 : 1;
    editBuilder.delete(new vscode.Range(
      line.lineNumber,
      commentColumn,
      line.lineNumber,
      commentColumn + markerLength
    ));
  }
}

function selectedLineNumbers(selections: readonly vscode.Selection[]): number[] {
  const lineNumbers = new Set<number>();
  for (const selection of selections) {
    const startLine = selection.start.line;
    const endLine = selection.end.character === 0 && selection.end.line > startLine
      ? selection.end.line - 1
      : selection.end.line;
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      lineNumbers.add(lineNumber);
    }
  }
  return [...lineNumbers].sort((left, right) => left - right);
}
