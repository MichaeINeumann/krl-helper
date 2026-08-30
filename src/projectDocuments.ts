import * as fs from 'fs';
import * as vscode from 'vscode';
import { normalizeProjectPath } from './projectScope';

export interface OpenProjectDocumentIndex {
  find(filePath: string): Promise<vscode.TextDocument | undefined>;
}

/** Indexes open documents once so a project scan performs at most one realpath lookup per file. */
export async function createOpenProjectDocumentIndex(): Promise<OpenProjectDocumentIndex> {
  const documentsByPath = new Map<string, vscode.TextDocument>();
  const documentsByRealPath = new Map<string, vscode.TextDocument>();
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== 'file') {
      continue;
    }
    documentsByPath.set(normalizeProjectPath(document.uri.fsPath), document);
    const realPath = await normalizedRealPath(document.uri.fsPath);
    if (realPath && !documentsByRealPath.has(realPath)) {
      documentsByRealPath.set(realPath, document);
    }
  }

  return {
    async find(filePath: string): Promise<vscode.TextDocument | undefined> {
      const exactDocument = documentsByPath.get(normalizeProjectPath(filePath));
      if (exactDocument) {
        return exactDocument;
      }
      const realPath = await normalizedRealPath(filePath);
      return realPath ? documentsByRealPath.get(realPath) : undefined;
    }
  };
}

/** Stable physical identity used independently from the URI displayed by Go to Definition. */
export async function canonicalProjectPath(filePath: string): Promise<string> {
  return await normalizedRealPath(filePath) ?? normalizeProjectPath(filePath);
}

async function normalizedRealPath(filePath: string): Promise<string | undefined> {
  try {
    return normalizeProjectPath(await fs.promises.realpath(filePath));
  } catch {
    return undefined;
  }
}
