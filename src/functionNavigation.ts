import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  findKrlFunctionCall,
  ParsedKrlFunction,
  parseKrlFunctions,
  selectVisibleKrlFunctions
} from './functionParser';

interface IndexedKrlFunction extends ParsedKrlFunction {
  uri: vscode.Uri;
  sourceId: string;
}

interface CachedProjectFunctions {
  revision: number;
  promise: Promise<IndexedKrlFunction[]>;
}

const ignoredDirectories = new Set(['.git', '.svn', '.vscode', 'node_modules', 'dist', 'out']);

export class KrlFunctionNavigationProvider implements vscode.HoverProvider, vscode.DefinitionProvider, vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly projectCache = new Map<string, CachedProjectFunctions>();
  private revision = 0;

  public constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{src,SRC,sub,SUB}');
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => this.invalidate()),
      watcher.onDidChange(() => this.invalidate()),
      watcher.onDidDelete(() => this.invalidate()),
      vscode.workspace.onDidOpenTextDocument(document => {
        if (document.languageId === 'krl') {
          this.invalidate();
        }
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'krl') {
          this.invalidate();
        }
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (document.languageId === 'krl') {
          this.invalidate();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(() => this.invalidate()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate())
    );
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const call = findKrlFunctionCall(document.getText(), document.offsetAt(position));
    if (!call || token.isCancellationRequested) {
      return undefined;
    }
    const definitions = await this.visibleDefinitions(document, call.normalizedName);
    if (definitions.length === 0 || token.isCancellationRequested) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    const displayed = definitions.slice(0, 5);
    displayed.forEach((definition, index) => {
      if (index > 0) {
        markdown.appendMarkdown('\n\n---\n\n');
      }
      const visibility = definition.global ? 'Global' : 'Local';
      const location = `${this.relativePath(definition.uri)}:${definition.line + 1}`;
      markdown.appendMarkdown(`**${visibility}** — \`${escapeMarkdownCode(location)}\`\n\n`);
      markdown.appendCodeblock(definition.signature, 'krl');
    });
    if (definitions.length > displayed.length) {
      markdown.appendMarkdown(`\n\n_${definitions.length - displayed.length} more definition(s)._`);
    }
    const range = new vscode.Range(
      document.positionAt(call.startOffset),
      document.positionAt(call.endOffset)
    );
    return new vscode.Hover(markdown, range);
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Location[] | undefined> {
    const call = findKrlFunctionCall(document.getText(), document.offsetAt(position));
    if (!call || token.isCancellationRequested) {
      return undefined;
    }
    const definitions = await this.visibleDefinitions(document, call.normalizedName);
    if (token.isCancellationRequested || definitions.length === 0) {
      return undefined;
    }
    return definitions.map(definition => new vscode.Location(
      definition.uri,
      new vscode.Range(
        positionForOffset(definition, definition.nameStartOffset),
        positionForOffset(definition, definition.nameEndOffset)
      )
    ));
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.projectCache.clear();
  }

  private invalidate(): void {
    this.revision += 1;
    this.projectCache.clear();
  }

  private async visibleDefinitions(
    document: vscode.TextDocument,
    normalizedName: string
  ): Promise<IndexedKrlFunction[]> {
    const currentDefinitions = parseKrlFunctions(document.getText())
      .filter(definition => definition.normalizedName === normalizedName)
      .map(definition => ({ ...definition, uri: document.uri, sourceId: uriKey(document.uri) }));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return currentDefinitions;
    }

    const currentKey = uriKey(document.uri);
    const projectDefinitions = await this.projectFunctions(workspaceFolder.uri.fsPath);
    const foreignGlobals = projectDefinitions.filter(definition => definition.sourceId !== currentKey);
    foreignGlobals.sort((left, right) => {
      const pathOrder = this.relativePath(left.uri).localeCompare(this.relativePath(right.uri));
      return pathOrder || left.line - right.line;
    });
    return selectVisibleKrlFunctions([...currentDefinitions, ...foreignGlobals], currentKey, normalizedName);
  }

  private projectFunctions(root: string): Promise<IndexedKrlFunction[]> {
    const key = normalizePath(root);
    const cached = this.projectCache.get(key);
    if (cached?.revision === this.revision) {
      return cached.promise;
    }
    const promise = this.buildProjectFunctions(root);
    this.projectCache.set(key, { revision: this.revision, promise });
    return promise;
  }

  private async buildProjectFunctions(root: string): Promise<IndexedKrlFunction[]> {
    const definitions: IndexedKrlFunction[] = [];
    for (const filePath of await scanSourceFiles(root)) {
      const uri = vscode.Uri.file(filePath);
      const openDocument = vscode.workspace.textDocuments.find(document =>
        document.uri.scheme === 'file' && normalizePath(document.uri.fsPath) === normalizePath(filePath)
      );
      let text: string;
      try {
        text = openDocument?.getText() ?? await fs.promises.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      definitions.push(...parseKrlFunctions(text).map(definition => ({
        ...definition,
        uri,
        sourceId: uriKey(uri)
      })));
    }
    return definitions;
  }

  private relativePath(uri: vscode.Uri): string {
    if (uri.scheme !== 'file') {
      return uri.toString(true);
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? path.relative(folder.uri.fsPath, uri.fsPath) || path.basename(uri.fsPath) : path.basename(uri.fsPath);
  }
}

export function initializeFunctionNavigation(
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector
): void {
  const provider = new KrlFunctionNavigationProvider();
  context.subscriptions.push(
    provider,
    vscode.languages.registerHoverProvider(selector, provider),
    vscode.languages.registerDefinitionProvider(selector, provider)
  );
}

async function scanSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          directories.push(path.join(directory, entry.name));
        }
      } else if (entry.isFile() && /\.(?:src|sub)$/i.test(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  }
  return files;
}

function normalizePath(filePath: string): string {
  const normalized = path.resolve(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function uriKey(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? normalizePath(uri.fsPath) : uri.toString();
}

function positionForOffset(definition: IndexedKrlFunction, offset: number): vscode.Position {
  const character = offset - definition.lineStartOffset;
  return new vscode.Position(definition.line, Math.max(0, character));
}

function escapeMarkdownCode(value: string): string {
  return value.replace(/`/g, '\\`');
}
