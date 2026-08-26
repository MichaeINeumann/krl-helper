import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sanitizeForAnalysis } from './diagnosticSanitizer';

interface CachedText {
  mtimeMs: number;
  text: string;
}
interface CachedNames {
  mtimeMs: number;
  names: Set<string>;
}

interface DependencyState {
  paths: Set<string>;
}

interface WorkspaceScan {
  lastScanMs: number;
  systemConfigs: string[];
  anyConfigs: string[];
}

interface ProjectDeclarationIndex {
  names: Set<string>;
  files: string[];
}

let diagnosticCollection: vscode.DiagnosticCollection | undefined;

let workspaceRoots: string[] = [];
const debounceTimers = new Map<string, NodeJS.Timeout>();
const fileCache = new Map<string, CachedText>();
const configNameCache = new Map<string, CachedNames>();
const dependencyState = new Map<string, DependencyState>();
const dependentsByPath = new Map<string, Set<string>>();
const fileWatchers = new Map<string, fs.FSWatcher>();
const workspaceScanCache = new Map<string, WorkspaceScan>();
const projectDeclarationCache = new Map<string, ProjectDeclarationIndex>();
const projectDeclarationBuilds = new Map<string, Promise<ProjectDeclarationIndex>>();
const projectDeclarationRevisions = new Map<string, number>();

const maxConfigCandidates = 50;
const workspaceScanTtlMs = 5000;
const ignoredDirectories = new Set(['.git', '.svn', '.vscode', 'node_modules', 'dist', 'out']);
const declarationKeywords = new Set([
  'decl', 'global', 'const', 'static', 'public', 'private', 'extern', 'signal',
  'enum', 'struct', 'char', 'int', 'bool', 'real', 'string', 'double', 'float',
  'axis', 'e6pos', 'frame', 'pos', 'orient', 'in', 'out', 'inout'
]);
const ignoredIdentifiers = new Set([
  'bool', 'bas', 'base', 'base_data', 'base_name', 'base_no', 'not', 'true',
  'false', 'if', 'then', 'else', 'endif', 'for', 'to', 'step', 'endfor',
  'while', 'endwhile', 'repeat', 'until', 'switch', 'case', 'default',
  'endswitch', 'return', 'def', 'deffct', 'defdat', 'end', 'brake', 'b', 'n'
]);
const inputAliasRegex = /\$IN\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/gi;
const outputAliasRegex = /\$OUT\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/gi;
const identifierRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const systemFileNames = [
  '$config.dat',
  'user.dat',
  'user_state.dat',
  'user_loca.dat',
  'Global_Points.dat'
];

export function initializeDiagnostics(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('krl-helper');
  context.subscriptions.push(diagnosticCollection);

  refreshWorkspaceRoots();
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === 'krl') {
      scheduleAnalysis(document);
    }
  }

  const projectWatcher = vscode.workspace.createFileSystemWatcher('**/*.{src,SRC,dat,DAT,sub,SUB}');
  context.subscriptions.push(
    projectWatcher,
    projectWatcher.onDidCreate(uri => handleProjectFileChange(uri.fsPath)),
    projectWatcher.onDidChange(uri => handleProjectFileChange(uri.fsPath)),
    projectWatcher.onDidDelete(uri => handleProjectFileChange(uri.fsPath)),
    vscode.workspace.onDidOpenTextDocument(document => {
      if (document.languageId === 'krl') {
        invalidateProjectIndexForPath(document.uri.scheme === 'file' ? document.uri.fsPath : '');
        scheduleAnalysis(document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId === 'krl') {
        const changedPath = event.document.uri.scheme === 'file' ? event.document.uri.fsPath : '';
        invalidateProjectIndexForPath(changedPath);
        scheduleProjectDocumentsForPath(changedPath);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      const documentUri = document.uri.toString();
      const timer = debounceTimers.get(documentUri);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(documentUri);
      }
      removeDocumentDependencies(documentUri);
      diagnosticCollection?.delete(document.uri);
      if (document.languageId === 'krl' && document.uri.scheme === 'file') {
        invalidateProjectIndexForPath(document.uri.fsPath);
        scheduleProjectDocumentsForPath(document.uri.fsPath);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refreshWorkspaceRoots();
      workspaceScanCache.clear();
      projectDeclarationCache.clear();
      projectDeclarationBuilds.clear();
      projectDeclarationRevisions.clear();
      for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'krl') {
          scheduleAnalysis(document);
        }
      }
    })
  );
}

function refreshWorkspaceRoots(): void {
  workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}

function scheduleAnalysis(document: vscode.TextDocument): void {
  const documentUri = document.uri.toString();
  const previousTimer = debounceTimers.get(documentUri);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(documentUri);
    const currentDocument = vscode.workspace.textDocuments.find(item => item.uri.toString() === documentUri) ?? document;
    void analyzeDocument(currentDocument);
  }, 200);
  debounceTimers.set(documentUri, timer);
}

async function analyzeDocument(document: vscode.TextDocument): Promise<void> {
  const sourcePath = document.uri.scheme === 'file' ? document.uri.fsPath : null;
  if (!sourcePath || !isSupportedSource(sourcePath)) {
    diagnosticCollection?.delete(document.uri);
    return;
  }

  const sourceText = document.getText();
  const declaredNames = new Set<string>();
  const companionDat = findCompanionDat(sourcePath);
  if (companionDat) {
    const datText = await readCachedText(companionDat);
    if (datText) {
      collectDeclarations(datText, declaredNames);
    }
  }
  collectDeclarations(sourceText, declaredNames);
  collectFunctionParameters(sourceText, declaredNames);

  const declarationRoot = findDeclarationProjectRoot(sourcePath, document);
  if (declarationRoot) {
    const projectDeclarations = await getProjectDeclarations(declarationRoot);
    for (const name of projectDeclarations.names) {
      declaredNames.add(name);
    }
  }

  const configDat = findConfigDat(sourcePath);
  const systemFiles = configDat ? findSystemFiles(path.dirname(configDat)) : [];
  const dependencyPaths = [companionDat, ...systemFiles].filter((item): item is string => Boolean(item));
  updateDocumentDependencies(document.uri.toString(), dependencyPaths);

  const configuredAliases = configDat ? await readConfigAliases(configDat) : new Set<string>();
  for (const systemFile of systemFiles) {
    const systemText = await readCachedText(systemFile);
    if (systemText) {
      collectDeclarations(systemText, declaredNames);
    }
  }

  const sanitizedText = sanitizeForAnalysis(sourceText);
  const diagnostics: vscode.Diagnostic[] = [
    ...findIoAliasDiagnostics(sanitizedText, document, configuredAliases),
    ...findUndeclaredDiagnostics(sanitizedText, document, declaredNames)
  ];
  diagnosticCollection?.set(document.uri, diagnostics);
}

function updateDocumentDependencies(documentUri: string, paths: string[]): void {
  const oldPaths = dependencyState.get(documentUri)?.paths ?? new Set<string>();
  const newPaths = new Set(paths);

  for (const oldPath of oldPaths) {
    if (!newPaths.has(oldPath)) {
      unsubscribeDependency(documentUri, oldPath);
    }
  }
  for (const newPath of newPaths) {
    if (!oldPaths.has(newPath)) {
      subscribeDependency(documentUri, newPath);
    }
  }
  dependencyState.set(documentUri, { paths: newPaths });
}

function removeDocumentDependencies(documentUri: string): void {
  const state = dependencyState.get(documentUri);
  if (!state) {
    return;
  }
  for (const dependencyPath of state.paths) {
    unsubscribeDependency(documentUri, dependencyPath);
  }
  dependencyState.delete(documentUri);
}

function subscribeDependency(documentUri: string, dependencyPath: string): void {
  const dependents = dependentsByPath.get(dependencyPath) ?? new Set<string>();
  dependents.add(documentUri);
  dependentsByPath.set(dependencyPath, dependents);
  ensureFileWatcher(dependencyPath);
}

function unsubscribeDependency(documentUri: string, dependencyPath: string): void {
  const dependents = dependentsByPath.get(dependencyPath);
  if (!dependents) {
    return;
  }
  dependents.delete(documentUri);
  if (dependents.size === 0) {
    dependentsByPath.delete(dependencyPath);
    const watcher = fileWatchers.get(dependencyPath);
    if (watcher) {
      watcher.close();
      fileWatchers.delete(dependencyPath);
    }
  }
}

function ensureFileWatcher(filePath: string): void {
  if (fileWatchers.has(filePath)) {
    return;
  }
  try {
    const watcher = fs.watch(filePath, { persistent: false }, eventType => handleDependencyChange(filePath, eventType));
    fileWatchers.set(filePath, watcher);
  } catch {
    // The next document edit retries discovery and watcher creation.
  }
}

function handleDependencyChange(filePath: string, eventType: string): void {
  fileCache.delete(filePath);
  configNameCache.delete(filePath);
  if (eventType === 'rename') {
    const watcher = fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      fileWatchers.delete(filePath);
    }
    workspaceScanCache.clear();
  }

  const dependents = dependentsByPath.get(filePath);
  if (!dependents) {
    return;
  }
  for (const documentUri of dependents) {
    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === documentUri);
    if (document) {
      scheduleAnalysis(document);
    }
  }
}

function handleProjectFileChange(filePath: string): void {
  if (!filePath || !isProjectDeclarationFile(filePath)) {
    return;
  }
  fileCache.delete(filePath);
  configNameCache.delete(filePath);
  workspaceScanCache.clear();
  invalidateProjectIndexForPath(filePath);
  scheduleProjectDocumentsForPath(filePath);
}

function invalidateProjectIndexForPath(filePath: string): void {
  if (!filePath) {
    return;
  }
  const roots = new Set<string>([
    ...projectDeclarationCache.keys(),
    ...projectDeclarationBuilds.keys()
  ]);
  for (const root of roots) {
    if (isPathInside(filePath, root)) {
      projectDeclarationCache.delete(root);
      projectDeclarationBuilds.delete(root);
      projectDeclarationRevisions.set(root, (projectDeclarationRevisions.get(root) ?? 0) + 1);
    }
  }
}

function scheduleProjectDocumentsForPath(filePath: string): void {
  if (!filePath) {
    return;
  }
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== 'krl' || document.uri.scheme !== 'file' || !isSupportedSource(document.uri.fsPath)) {
      continue;
    }
    const root = findDeclarationProjectRoot(document.uri.fsPath, document);
    if (root && isPathInside(filePath, root)) {
      scheduleAnalysis(document);
    }
  }
}

function findDeclarationProjectRoot(sourcePath: string, document: vscode.TextDocument): string | null {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
    ?? workspaceRoots.find(root => isPathInside(sourcePath, root))
    ?? null;
  const krcProjectRoot = findProjectRoot(sourcePath);

  if (krcProjectRoot && (!workspaceRoot || isPathInside(krcProjectRoot, workspaceRoot))) {
    return krcProjectRoot;
  }
  return workspaceRoot ?? krcProjectRoot;
}

async function getProjectDeclarations(root: string): Promise<ProjectDeclarationIndex> {
  const cacheKey = normalizePathKey(root);
  const cached = projectDeclarationCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const activeBuild = projectDeclarationBuilds.get(cacheKey);
  if (activeBuild) {
    return activeBuild;
  }

  const revision = projectDeclarationRevisions.get(cacheKey) ?? 0;
  const build = buildProjectDeclarationIndex(root);
  projectDeclarationBuilds.set(cacheKey, build);
  try {
    const result = await build;
    if ((projectDeclarationRevisions.get(cacheKey) ?? 0) !== revision) {
      return getProjectDeclarations(root);
    }
    projectDeclarationCache.set(cacheKey, result);
    return result;
  } finally {
    if (projectDeclarationBuilds.get(cacheKey) === build) {
      projectDeclarationBuilds.delete(cacheKey);
    }
  }
}

async function buildProjectDeclarationIndex(root: string): Promise<ProjectDeclarationIndex> {
  const names = new Set<string>();
  const files = await scanProjectDeclarationFiles(root);
  for (const filePath of files) {
    const text = await readProjectFileText(filePath);
    if (!text) {
      continue;
    }
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.dat') {
      collectDeclarations(text, names);
    } else {
      collectGlobalDeclarations(text, names);
    }
  }
  return { names, files };
}

async function scanProjectDeclarationFiles(root: string): Promise<string[]> {
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
        continue;
      }
      if (entry.isFile()) {
        const filePath = path.join(directory, entry.name);
        if (isProjectDeclarationFile(filePath)) {
          files.push(filePath);
        }
      }
    }
  }
  return files;
}

async function readProjectFileText(filePath: string): Promise<string | null> {
  const key = normalizePathKey(filePath);
  const openDocument = vscode.workspace.textDocuments.find(document =>
    document.uri.scheme === 'file' && normalizePathKey(document.uri.fsPath) === key
  );
  if (openDocument) {
    return openDocument.getText();
  }
  return readCachedText(filePath);
}

function collectGlobalDeclarations(text: string, target: Set<string>): void {
  const lines = stripLineComments(text).split(/\r?\n/);
  for (const line of lines) {
    if (!/\bGLOBAL\b/i.test(line) || /\bDEF(?:FCT)?\b/i.test(line) || !isDeclarationLine(line)) {
      continue;
    }
    collectDeclarationLine(line, target);
  }
}

function isProjectDeclarationFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.dat' || extension === '.src' || extension === '.sub';
}

function normalizePathKey(filePath: string): string {
  const normalized = path.resolve(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInside(candidatePath: string, root: string): boolean {
  const candidate = normalizePathKey(candidatePath);
  const normalizedRoot = normalizePathKey(root);
  if (candidate === normalizedRoot) {
    return true;
  }
  const relative = path.relative(normalizedRoot, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function findIoAliasDiagnostics(text: string, document: vscode.TextDocument, declaredAliases: Set<string>): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const definitions = [
    { regex: inputAliasRegex, prefix: 'i_', label: 'Input' },
    { regex: outputAliasRegex, prefix: 'o_', label: 'Output' }
  ];

  for (const { regex, prefix, label } of definitions) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const alias = match[1];
      const normalized = alias.toLowerCase();
      if (!normalized.startsWith(prefix) || declaredAliases.has(normalized)) {
        continue;
      }
      const aliasOffset = match.index + match[0].indexOf(alias);
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(document.positionAt(aliasOffset), document.positionAt(aliasOffset + alias.length)),
        `${label} '${alias}' is not declared in $config.dat.`,
        vscode.DiagnosticSeverity.Error
      ));
    }
  }
  return diagnostics;
}

function findUndeclaredDiagnostics(text: string, document: vscode.TextDocument, declaredNames: Set<string>): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  identifierRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = identifierRegex.exec(text))) {
    const identifier = match[0];
    const normalized = identifier.toLowerCase();
    if (isSystemVariable(text, match.index) || isMemberAccess(text, match.index) || !isTrackedIdentifier(identifier)) {
      continue;
    }
    if (ignoredIdentifiers.has(normalized) || declaredNames.has(normalized)) {
      continue;
    }
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + identifier.length)),
      `Variable '${identifier}' is not declared in the current module or project declarations.`,
      vscode.DiagnosticSeverity.Error
    ));
  }
  return diagnostics;
}

function collectDeclarations(text: string, target: Set<string>): void {
  const lines = stripLineComments(text).split(/\r?\n/);
  for (const line of lines) {
    if (isDeclarationLine(line)) {
      collectDeclarationLine(line, target);
    }
  }
}

function collectDeclarationLine(line: string, target: Set<string>): void {
  const identifiers = line.split('=')[0].match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  for (const identifier of identifiers) {
    const normalized = identifier.toLowerCase();
    if (!declarationKeywords.has(normalized)) {
      target.add(normalized);
    }
  }
}

function collectFunctionParameters(text: string, target: Set<string>): void {
  const withoutComments = stripLineComments(text);
  const functionRegex = /\bDEF(?:FCT)?\b[^(]*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = functionRegex.exec(withoutComments))) {
    const identifiers = match[1].match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
    for (const identifier of identifiers) {
      const normalized = identifier.toLowerCase();
      if (!declarationKeywords.has(normalized)) {
        target.add(normalized);
      }
    }
  }
}

function stripLineComments(text: string): string {
  return text.replace(/;.*$/gm, '');
}

function isSupportedSource(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.src' || extension === '.sub';
}

function isTrackedIdentifier(identifier: string): boolean {
  if (identifier.length < 2) {
    return false;
  }
  const prefix = identifier[0];
  if (prefix !== 'b' && prefix !== 'B' && prefix !== 'n' && prefix !== 'N') {
    return false;
  }
  const secondCharacter = identifier[1];
  return secondCharacter === '_' || /[A-Z0-9]/.test(secondCharacter);
}

function isSystemVariable(text: string, offset: number): boolean {
  return offset > 0 && text[offset - 1] === '$';
}

function isMemberAccess(text: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character !== ' ' && character !== '\t') {
      return character === '.';
    }
  }
  return false;
}

function isDeclarationLine(line: string): boolean {
  if (/\bDECL\b/i.test(line)) {
    return true;
  }
  if (!/\bGLOBAL\b/i.test(line) || /\bDEF(?:FCT)?\b/i.test(line)) {
    return false;
  }
  return /\b(BOOL|INT|REAL|CHAR|STRING|DOUBLE|FLOAT|AXIS|E6POS|FRAME|POS|ORIENT)\b/i.test(line);
}

function findCompanionDat(sourcePath: string): string | null {
  const directory = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const lowerCasePath = path.join(directory, `${baseName}.dat`);
  if (fs.existsSync(lowerCasePath)) {
    return lowerCasePath;
  }
  const upperCasePath = path.join(directory, `${baseName}.DAT`);
  return fs.existsSync(upperCasePath) ? upperCasePath : null;
}

function findConfigDat(sourcePath: string): string | null {
  const projectRoot = findProjectRoot(sourcePath);
  if (projectRoot) {
    const directPath = path.join(projectRoot, 'KRC', 'R1', 'System', '$config.dat');
    if (fs.existsSync(directPath)) {
      return directPath;
    }
  }

  const systemCandidates = getConfigCandidates(true);
  if (systemCandidates.length > 0) {
    return nearestPath(sourcePath, systemCandidates);
  }
  const anyCandidates = getConfigCandidates(false);
  return anyCandidates.length > 0 ? nearestPath(sourcePath, anyCandidates) : null;
}

function findSystemFiles(systemDirectory: string): string[] {
  const files: string[] = [];
  for (const fileName of systemFileNames) {
    const filePath = resolveFileCaseInsensitive(systemDirectory, fileName);
    if (filePath) {
      files.push(filePath);
    }
  }
  return Array.from(new Set(files));
}

function resolveFileCaseInsensitive(directory: string, fileName: string): string | null {
  const exactPath = path.join(directory, fileName);
  if (fs.existsSync(exactPath)) {
    return exactPath;
  }
  const lowerName = fileName.toLowerCase();
  if (lowerName !== fileName) {
    const lowerPath = path.join(directory, lowerName);
    if (fs.existsSync(lowerPath)) {
      return lowerPath;
    }
  }
  const upperName = fileName.toUpperCase();
  if (upperName !== fileName) {
    const upperPath = path.join(directory, upperName);
    if (fs.existsSync(upperPath)) {
      return upperPath;
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const matchingEntry = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === lowerName);
  return matchingEntry ? path.join(directory, matchingEntry.name) : null;
}

function findProjectRoot(filePath: string): string | null {
  const normalized = path.normalize(filePath);
  const parsed = path.parse(normalized);
  const parts = normalized.slice(parsed.root.length).split(path.sep).filter(part => part.length > 0);
  let krcIndex = -1;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toLowerCase() === 'krc' && parts[index + 1]?.toLowerCase() === 'r1') {
      krcIndex = index;
      break;
    }
  }
  if (krcIndex !== -1) {
    return path.join(parsed.root, ...parts.slice(0, krcIndex));
  }
  return null;
}

function getConfigCandidates(systemOnly: boolean): string[] {
  const now = Date.now();
  const candidates: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    let scan = workspaceScanCache.get(workspaceRoot);
    if (!scan || now - scan.lastScanMs > workspaceScanTtlMs) {
      const systemConfigs: string[] = [];
      const anyConfigs: string[] = [];
      scanWorkspaceForConfigs(workspaceRoot, systemConfigs, anyConfigs);
      scan = { lastScanMs: now, systemConfigs, anyConfigs };
      workspaceScanCache.set(workspaceRoot, scan);
    }
    const source = systemOnly ? scan.systemConfigs : scan.anyConfigs;
    for (const candidate of source) {
      candidates.push(candidate);
      if (candidates.length >= maxConfigCandidates) {
        return candidates;
      }
    }
  }
  return candidates;
}

function scanWorkspaceForConfigs(root: string, systemConfigs: string[], anyConfigs: string[]): void {
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          directories.push(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || entry.name.toLowerCase() !== '$config.dat') {
        continue;
      }
      const configPath = path.join(directory, entry.name);
      anyConfigs.push(configPath);
      if (isSystemConfig(configPath)) {
        systemConfigs.push(configPath);
      }
      if (anyConfigs.length >= maxConfigCandidates && systemConfigs.length >= maxConfigCandidates) {
        return;
      }
    }
  }
}

function isSystemConfig(filePath: string): boolean {
  const normalized = path.normalize(filePath).toLowerCase();
  const suffix = path.sep + ['krc', 'r1', 'system', '$config.dat'].join(path.sep);
  return normalized.endsWith(suffix);
}

function pathDistance(leftPath: string, rightPath: string): number {
  const left = path.normalize(leftPath).split(path.sep).filter(part => part.length > 0);
  const right = path.normalize(rightPath).split(path.sep).filter(part => part.length > 0);
  let common = 0;
  const limit = Math.min(left.length, right.length);
  while (common < limit && left[common] === right[common]) {
    common += 1;
  }
  return (left.length - common) + (right.length - common);
}

function nearestPath(sourcePath: string, candidates: string[]): string {
  let nearest = candidates[0];
  let nearestDistance = pathDistance(sourcePath, nearest);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = pathDistance(sourcePath, candidate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }
  return nearest;
}

async function readCachedText(filePath: string): Promise<string | null> {
  return (await readCachedFile(filePath))?.text ?? null;
}

async function readCachedFile(filePath: string): Promise<CachedText | null> {
  try {
    const stats = await fs.promises.stat(filePath);
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached;
    }
    const text = await fs.promises.readFile(filePath, 'utf8');
    const value = { mtimeMs: stats.mtimeMs, text };
    fileCache.set(filePath, value);
    return value;
  } catch {
    return null;
  }
}

async function readConfigAliases(configPath: string): Promise<Set<string>> {
  const cachedFile = await readCachedFile(configPath);
  if (!cachedFile) {
    return new Set<string>();
  }
  const cachedNames = configNameCache.get(configPath);
  if (cachedNames && cachedNames.mtimeMs === cachedFile.mtimeMs) {
    return cachedNames.names;
  }
  const names = parseConfigAliases(cachedFile.text);
  configNameCache.set(configPath, { mtimeMs: cachedFile.mtimeMs, names });
  return names;
}

function parseConfigAliases(configText: string): Set<string> {
  const names = new Set<string>();
  const lines = stripLineComments(configText).split(/\r?\n/);
  for (const line of lines) {
    if (!/\bDECL\b/i.test(line)) {
      continue;
    }
    const aliases = line.match(/\b[iIoO]_[A-Za-z0-9_]+\b/g) ?? [];
    for (const alias of aliases) {
      names.add(alias.toLowerCase());
    }
  }
  return names;
}
