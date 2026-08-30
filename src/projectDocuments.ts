import * as fs from 'fs';
import * as vscode from 'vscode';
import { normalizeProjectPath } from './projectScope';

/** Finds an open document for a scanned file, including a document opened through a symlink alias. */
export async function findOpenProjectDocument(filePath: string): Promise<vscode.TextDocument | undefined> {
  const fileDocuments = vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'file');
  const normalizedPath = normalizeProjectPath(filePath);
  const exactDocument = fileDocuments.find(document =>
    normalizeProjectPath(document.uri.fsPath) === normalizedPath
  );
  if (exactDocument) {
    return exactDocument;
  }

  const realPath = await normalizedRealPath(filePath);
  if (!realPath) {
    return undefined;
  }
  for (const document of fileDocuments) {
    if (await normalizedRealPath(document.uri.fsPath) === realPath) {
      return document;
    }
  }
  return undefined;
}

async function normalizedRealPath(filePath: string): Promise<string | undefined> {
  try {
    return normalizeProjectPath(await fs.promises.realpath(filePath));
  } catch {
    return undefined;
  }
}
