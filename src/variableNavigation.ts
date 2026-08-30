import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sanitizeForAnalysis } from './diagnosticSanitizer';
import {
  classifyVariable,
  DiagnosticPrefixConfiguration,
  diagnosticSettingDefinitions,
  hasPublicDefdatHeader,
  isExplicitProjectGlobalDeclaration,
  normalizePrefixConfiguration
} from './diagnosticModel';
import {
  findKrlVariableReference,
  ParsedKrlVariableDeclaration,
  parseKrlVariableDeclarations
} from './variableParser';
import { parseKrlFunctions } from './functionParser';

type KrlProjectFileKind = 'source' | 'dat' | 'other';

interface IndexedKrlVariable extends ParsedKrlVariableDeclaration {
  uri: vscode.Uri;
  sourceId: string;
  fileKind: KrlProjectFileKind;
  directoryId: string;
  moduleName: string;
  configDat: boolean;
  publicDat: boolean;
  routineStartOffset?: number;
}

interface KrlRoutineRange {
  startOffset: number;
  endOffset: number;
}

interface CachedProjectVariables {
  revision: number;
  promise: Promise<IndexedKrlVariable[]>;
}

const ignoredDirectories = new Set(['.git', '.svn', '.vscode', 'node_modules', 'dist', 'out']);

export class KrlVariableDefinitionProvider implements vscode.DefinitionProvider, vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly projectCache = new Map<string, CachedProjectVariables>();
  private revision = 0;

  public constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{src,SRC,sub,SUB,dat,DAT}');
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
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('krlHelper.diagnostics')) {
          this.invalidate();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate())
    );
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Location[] | undefined> {
    const reference = findKrlVariableReference(document.getText(), document.offsetAt(position));
    if (!reference || token.isCancellationRequested) {
      return undefined;
    }
    const definitions = await this.visibleDefinitions(
      document,
      reference.name,
      reference.normalizedName,
      reference.startOffset
    );
    if (definitions.length === 0 || token.isCancellationRequested) {
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
    identifier: string,
    normalizedName: string,
    referenceOffset: number
  ): Promise<IndexedKrlVariable[]> {
    const currentSourceId = uriKey(document.uri);
    const currentDefinitions = indexDocument(document);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const projectRoot = inferKrlProjectRoot(document.uri) ?? workspaceFolder?.uri.fsPath;
    const projectDefinitions = projectRoot
      ? await this.projectVariables(projectRoot)
      : await siblingCompanionVariables(document);
    const foreignDefinitions = projectDefinitions.filter(definition => definition.sourceId !== currentSourceId);
    const indexedDefinitions = [...currentDefinitions, ...foreignDefinitions];
    const allDefinitions = indexedDefinitions.filter(definition => definition.normalizedName === normalizedName);
    const currentRoutine = findContainingRoutine(document.getText(), referenceOffset);
    const localDefinitions = allDefinitions.filter(definition => {
      if (isCompanionDefinition(document.uri, definition)) {
        return true;
      }
      if (definition.sourceId !== currentSourceId) {
        return false;
      }
      return !currentRoutine || definition.routineStartOffset === currentRoutine.startOffset;
    });
    const globalDefinitions = selectGlobalDefinitions(document.uri, allDefinitions, indexedDefinitions);
    const scope = classifyVariable(identifier, readPrefixConfiguration());
    const visible = scope === 'local'
      ? localDefinitions.length > 0 ? localDefinitions : globalDefinitions
      : scope === 'global'
        ? globalDefinitions
        : [...localDefinitions, ...globalDefinitions];
    return deduplicateDefinitions(visible);
  }

  private projectVariables(root: string): Promise<IndexedKrlVariable[]> {
    if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))) {
      return this.buildProjectVariables(root);
    }
    const key = normalizePath(root);
    const cached = this.projectCache.get(key);
    if (cached?.revision === this.revision) {
      return cached.promise;
    }
    const promise = this.buildProjectVariables(root);
    this.projectCache.set(key, { revision: this.revision, promise });
    return promise;
  }

  private async buildProjectVariables(root: string): Promise<IndexedKrlVariable[]> {
    const definitions: IndexedKrlVariable[] = [];
    for (const filePath of await scanProjectFiles(root)) {
      const uri = vscode.Uri.file(filePath);
      const openDocument = vscode.workspace.textDocuments.find(document =>
        document.uri.scheme === 'file' && normalizePath(document.uri.fsPath) === normalizePath(filePath)
      );
      let fileText: string;
      try {
        fileText = openDocument?.getText() ?? await fs.promises.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      definitions.push(...indexText(fileText, uri));
    }
    return definitions;
  }
}

export function initializeVariableNavigation(
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector
): void {
  const provider = new KrlVariableDefinitionProvider();
  context.subscriptions.push(
    provider,
    vscode.languages.registerDefinitionProvider(selector, provider)
  );
}

function indexDocument(document: vscode.TextDocument): IndexedKrlVariable[] {
  return indexText(document.getText(), document.uri);
}

function indexText(text: string, uri: vscode.Uri): IndexedKrlVariable[] {
  const metadata = fileMetadata(uri, text);
  const routines = findKrlRoutines(text);
  return parseKrlVariableDeclarations(text).map(declaration => ({
    ...declaration,
    ...metadata,
    routineStartOffset: routines.find(routine =>
      declaration.nameStartOffset >= routine.startOffset && declaration.nameStartOffset < routine.endOffset
    )?.startOffset
  }));
}

function fileMetadata(uri: vscode.Uri, text: string): Omit<IndexedKrlVariable, keyof ParsedKrlVariableDeclaration> {
  const extension = uri.scheme === 'file' ? path.extname(uri.fsPath).toLowerCase() : '';
  const fileKind: KrlProjectFileKind = extension === '.src' || extension === '.sub'
    ? 'source'
    : extension === '.dat' ? 'dat' : 'other';
  const filePath = uri.scheme === 'file' ? uri.fsPath : '';
  return {
    uri,
    sourceId: uriKey(uri),
    fileKind,
    directoryId: filePath ? normalizePath(path.dirname(filePath)) : '',
    moduleName: filePath ? path.basename(filePath, extension).toLowerCase() : '',
    configDat: fileKind === 'dat' && path.basename(filePath).toLowerCase() === '$config.dat',
    publicDat: fileKind === 'dat' && hasPublicDefdatHeader(text)
  };
}

function isCompanionDefinition(currentUri: vscode.Uri, definition: IndexedKrlVariable): boolean {
  if (currentUri.scheme !== 'file' || definition.fileKind !== 'dat') {
    return false;
  }
  const extension = path.extname(currentUri.fsPath).toLowerCase();
  if (extension !== '.src' && extension !== '.sub') {
    return false;
  }
  return definition.directoryId === normalizePath(path.dirname(currentUri.fsPath))
    && definition.moduleName === path.basename(currentUri.fsPath, extension).toLowerCase();
}

function selectGlobalDefinitions(
  currentUri: vscode.Uri,
  definitions: IndexedKrlVariable[],
  projectDefinitions: IndexedKrlVariable[]
): IndexedKrlVariable[] {
  const configDefinitions = projectDefinitions.filter(definition => definition.configDat);
  const nearestConfigId = selectNearestConfigId(currentUri, configDefinitions);
  return definitions.filter(definition => {
    if (definition.fileKind === 'source') {
      return isExplicitProjectGlobalDeclaration(definition);
    }
    if (definition.fileKind !== 'dat') {
      return false;
    }
    if (definition.configDat) {
      return nearestConfigId !== undefined && definition.sourceId === nearestConfigId;
    }
    return definition.publicDat && isExplicitProjectGlobalDeclaration(definition);
  });
}

function selectNearestConfigId(
  currentUri: vscode.Uri,
  definitions: IndexedKrlVariable[]
): string | undefined {
  const configIds = [...new Set(definitions.map(definition => definition.sourceId))];
  if (configIds.length === 0) {
    return undefined;
  }
  if (currentUri.scheme !== 'file') {
    return configIds[0];
  }
  let nearestId = configIds[0];
  let nearestDistance = pathDistance(currentUri.fsPath, configPathForId(nearestId, definitions));
  for (const configId of configIds.slice(1)) {
    const distance = pathDistance(currentUri.fsPath, configPathForId(configId, definitions));
    if (distance < nearestDistance) {
      nearestId = configId;
      nearestDistance = distance;
    }
  }
  return nearestId;
}

function configPathForId(sourceId: string, definitions: IndexedKrlVariable[]): string {
  return definitions.find(definition => definition.sourceId === sourceId)?.uri.fsPath ?? sourceId;
}

function deduplicateDefinitions(definitions: IndexedKrlVariable[]): IndexedKrlVariable[] {
  const seen = new Set<string>();
  return definitions.filter(definition => {
    const key = `${definition.sourceId}:${definition.nameStartOffset}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readPrefixConfiguration(): DiagnosticPrefixConfiguration {
  const configuration = vscode.workspace.getConfiguration('krlHelper.diagnostics');
  const rawValues = Object.fromEntries(diagnosticSettingDefinitions.map(definition => [
    definition.key,
    configuration.get<unknown>(definition.key, [...definition.defaultValue])
  ]));
  return normalizePrefixConfiguration(rawValues);
}

async function siblingCompanionVariables(document: vscode.TextDocument): Promise<IndexedKrlVariable[]> {
  if (document.uri.scheme !== 'file' || !/\.(?:src|sub)$/i.test(document.uri.fsPath)) {
    return [];
  }
  const directory = path.dirname(document.uri.fsPath);
  const expectedName = `${path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))}.dat`.toLowerCase();
  let matchingPath: string | undefined;
  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    matchingPath = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === expectedName)?.name;
  } catch {
    return [];
  }
  if (!matchingPath) {
    return [];
  }
  const filePath = path.join(directory, matchingPath);
  const uri = vscode.Uri.file(filePath);
  const openDocument = vscode.workspace.textDocuments.find(document => uriKey(document.uri) === uriKey(uri));
  try {
    const text = openDocument?.getText() ?? await fs.promises.readFile(filePath, 'utf8');
    return indexText(text, uri);
  } catch {
    return [];
  }
}

function findContainingRoutine(text: string, offset: number): KrlRoutineRange | undefined {
  return findKrlRoutines(text).find(routine => offset >= routine.startOffset && offset < routine.endOffset);
}

function findKrlRoutines(text: string): KrlRoutineRange[] {
  const sanitized = sanitizeForAnalysis(text);
  const definitions = parseKrlFunctions(text);
  return definitions.map((definition, index) => {
    const nextDefinitionOffset = definitions[index + 1]?.startOffset ?? text.length;
    const terminator = definition.kind === 'DEFFCT'
      ? /^[\t ]*ENDFCT\b[^\r\n]*/im
      : /^[\t ]*END\b[^\r\n]*/im;
    const searchText = sanitized.slice(definition.endOffset, nextDefinitionOffset);
    const match = terminator.exec(searchText);
    return {
      startOffset: definition.startOffset,
      endOffset: match ? definition.endOffset + match.index + match[0].length : nextDefinitionOffset
    };
  });
}

function inferKrlProjectRoot(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== 'file') {
    return undefined;
  }
  const parsedPath = path.parse(uri.fsPath);
  const segments = path.relative(parsedPath.root, uri.fsPath).split(path.sep).filter(Boolean);
  const krcIndex = segments.findIndex((segment, index) =>
    segment.toLowerCase() === 'krc' && segments[index + 1]?.toLowerCase() === 'r1'
  );
  if (krcIndex === -1) {
    return undefined;
  }
  return path.join(parsedPath.root, ...segments.slice(0, krcIndex + 2));
}

async function scanProjectFiles(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && /\.(?:src|sub|dat)$/i.test(entry.name)) {
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

function pathDistance(leftPath: string, rightPath: string): number {
  const left = path.normalize(leftPath).toLowerCase().split(path.sep).filter(Boolean);
  const right = path.normalize(rightPath).toLowerCase().split(path.sep).filter(Boolean);
  let common = 0;
  while (common < Math.min(left.length, right.length) && left[common] === right[common]) {
    common += 1;
  }
  return left.length - common + right.length - common;
}

function positionForOffset(definition: IndexedKrlVariable, offset: number): vscode.Position {
  return new vscode.Position(definition.line, Math.max(0, offset - definition.lineStartOffset));
}
