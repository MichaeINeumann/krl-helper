import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sanitizeForAnalysis } from './diagnosticSanitizer';
import {
  classifyVariable,
  collectDeclarations,
  collectFunctionParameters,
  collectGlobalSourceDeclarations,
  collectProjectDatDeclarations,
  DiagnosticPrefixConfiguration,
  diagnosticSettingDefinitions,
  matchesAnyPrefix,
  normalizePrefixConfiguration
} from './diagnosticModel';
import {
  inferKrlTreeRoot,
  isConfigDat,
  isProjectDeclarationFile as isKrlDeclarationFile,
  normalizeProjectPath,
  scanProjectTree,
  scanProjectTreeSync,
  selectNearestPath
} from './projectScope';

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

interface ConfigScan {
  lastScanMs: number;
  configs: string[];
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
const configScanCache = new Map<string, ConfigScan>();
const projectDeclarationCache = new Map<string, ProjectDeclarationIndex>();
const projectDeclarationBuilds = new Map<string, Promise<ProjectDeclarationIndex>>();
const projectDeclarationRevisions = new Map<string, number>();

const configScanTtlMs = 5000;
const ignoredIdentifiers = new Set([
  'def', 'deffct', 'defdat', 'end', 'endfct', 'enddat', 'global', 'decl',
  'const', 'ext', 'public', 'private', 'extern', 'static', 'in', 'out', 'inout',
  'if', 'then', 'else', 'endif', 'switch', 'case', 'default', 'endswitch',
  'do', 'wait', 'for', 'to', 'step', 'endfor', 'while', 'endwhile', 'repeat',
  'until', 'loop', 'endloop', 'goto', 'return', 'exit', 'continue', 'halt',
  'ptp', 'lin', 'circ', 'sptp', 'slin', 'scirc', 'spl', 'spline', 'endspline',
  'ptp_rel', 'lin_rel', 'circ_rel', 'c_dis', 'c_vel', 'c_ori', 'c_ptp',
  'c_cp', 'c_spl', 'c_apx', 'c_aps',
  'pulse', 'trigger', 'when', 'distance', 'delay', 'prio', 'interrupt', 'on',
  'off', 'brake', 'resume', 'anin', 'anout', 'sec',
  'and', 'or', 'not', 'exor', 'b_and', 'b_or', 'b_not', 'b_exor', 'mod',
  'bool', 'char', 'int', 'real', 'enum', 'struc', 'signal', 'frame', 'pos',
  'e6pos', 'axis', 'e6axis', 'fdat', 'ldat', 'pdat', 'cpdat', 'apo', 'tool',
  'base', 'base_data', 'base_name', 'base_no', 'true', 'false',
  'bas', 'ini', 'set_cd_params', 'set_motionparamset', 'set_krlmsg',
  'clear_krlmsg', 'set_krldlg', 'clear_krldlg', 'cwrite', 'cread', 'swrite',
  'sread', 'swrite_ext', 'sread_ext', 'abs', 'acos', 'asin', 'atan2', 'cos',
  'exp', 'fract', 'round', 'sin', 'sqrt', 'tan', 'trunc', 'strclear', 'stradd',
  'strcopy', 'strcut', 'strfind', 'strlen', 'strtol', 'strtor', 'strtoupper',
  'strtolower'
]);
const inputAliasRegex = /\$IN\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/gi;
const outputAliasRegex = /\$OUT\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/gi;
const identifierRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

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
      configScanCache.clear();
      projectDeclarationCache.clear();
      projectDeclarationBuilds.clear();
      projectDeclarationRevisions.clear();
      for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'krl') {
          scheduleAnalysis(document);
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('krlHelper.diagnostics')) {
        return;
      }
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
  const localNames = new Set<string>();
  const globalNames = new Set<string>();
  const companionDat = findCompanionDat(sourcePath);
  if (companionDat) {
    const datText = await readProjectFileText(companionDat);
    if (datText) {
      collectDeclarations(datText, localNames);
      collectProjectDatDeclarations(companionDat, datText, globalNames);
    }
  }
  collectDeclarations(sourceText, localNames);
  collectFunctionParameters(sourceText, localNames);
  collectGlobalSourceDeclarations(sourceText, globalNames);

  const declarationRoot = findDeclarationProjectRoot(sourcePath, document);
  if (declarationRoot) {
    const projectDeclarations = await getProjectDeclarations(declarationRoot);
    for (const name of projectDeclarations.names) {
      globalNames.add(name);
    }
  }

  const configDat = findConfigDat(sourcePath, document);
  const dependencyPaths = [companionDat, configDat].filter((item): item is string => Boolean(item));
  updateDocumentDependencies(document.uri.toString(), dependencyPaths);

  const configuredAliases = configDat ? await readConfigAliases(configDat) : new Set<string>();
  if (configDat) {
    const configText = await readProjectFileText(configDat);
    if (configText) {
      collectDeclarations(configText, globalNames);
    }
  }

  const prefixConfiguration = readPrefixConfiguration();
  const sanitizedText = sanitizeForAnalysis(sourceText);
  const diagnostics: vscode.Diagnostic[] = [
    ...findIoAliasDiagnostics(sanitizedText, document, configuredAliases, prefixConfiguration),
    ...findUndeclaredDiagnostics(sanitizedText, document, localNames, globalNames, prefixConfiguration)
  ];
  diagnosticCollection?.set(document.uri, diagnostics);
}

function readPrefixConfiguration(): DiagnosticPrefixConfiguration {
  const configuration = vscode.workspace.getConfiguration('krlHelper.diagnostics');
  const rawValues = Object.fromEntries(diagnosticSettingDefinitions.map(definition => [
    definition.key,
    configuration.get<unknown>(definition.key, [...definition.defaultValue])
  ]));
  return normalizePrefixConfiguration(rawValues);
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
    configScanCache.clear();
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
  if (!filePath || !isKrlDeclarationFile(filePath)) {
    return;
  }
  fileCache.delete(filePath);
  configNameCache.delete(filePath);
  configScanCache.clear();
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
  const krlTreeRoot = inferKrlTreeRoot(sourcePath);

  if (krlTreeRoot && (!workspaceRoot || isPathInside(krlTreeRoot, workspaceRoot))) {
    return krlTreeRoot;
  }
  return workspaceRoot ?? krlTreeRoot;
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
      // The nearest $config.dat is added separately for the source being analyzed.
      if (isConfigDat(filePath)) {
        continue;
      }
      collectProjectDatDeclarations(filePath, text, names);
    } else {
      collectGlobalSourceDeclarations(text, names);
    }
  }
  return { names, files };
}

async function scanProjectDeclarationFiles(root: string): Promise<string[]> {
  return scanProjectTree(root, isKrlDeclarationFile);
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


function normalizePathKey(filePath: string): string {
  return normalizeProjectPath(filePath);
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

function findIoAliasDiagnostics(
  text: string,
  document: vscode.TextDocument,
  declaredAliases: Set<string>,
  configuration: DiagnosticPrefixConfiguration
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const definitions = [
    { regex: inputAliasRegex, prefixes: configuration.inputAliasPrefixes, label: 'Input' },
    { regex: outputAliasRegex, prefixes: configuration.outputAliasPrefixes, label: 'Output' }
  ];

  for (const { regex, prefixes, label } of definitions) {
    if (prefixes.length === 0) {
      continue;
    }
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const alias = match[1];
      const normalized = alias.toLowerCase();
      if (!matchesAnyPrefix(alias, prefixes) || declaredAliases.has(normalized)) {
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

function findUndeclaredDiagnostics(
  text: string,
  document: vscode.TextDocument,
  localNames: Set<string>,
  globalNames: Set<string>,
  configuration: DiagnosticPrefixConfiguration
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  identifierRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = identifierRegex.exec(text))) {
    const identifier = match[0];
    const normalized = identifier.toLowerCase();
    const scope = classifyVariable(identifier, configuration);
    if (hasNonVariablePrefix(text, match.index) || isMemberAccess(text, match.index)
        || isConfiguredIoAliasOperand(
          text,
          match.index,
          match.index + identifier.length,
          identifier,
          configuration
        )
        || isFunctionIdentifier(text, match.index + identifier.length) || !scope) {
      continue;
    }
    const declared = globalNames.has(normalized)
      || (scope === 'local' && localNames.has(normalized));
    if (ignoredIdentifiers.has(normalized) || declared) {
      continue;
    }
    const declarationSpace = scope === 'global'
      ? 'global project declarations'
      : 'the current module or visible project globals';
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + identifier.length)),
      `Variable '${identifier}' is not declared in ${declarationSpace}.`,
      vscode.DiagnosticSeverity.Error
    ));
  }
  return diagnostics;
}

function isSupportedSource(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.src' || extension === '.sub';
}

function hasNonVariablePrefix(text: string, offset: number): boolean {
  return offset > 0 && (text[offset - 1] === '$' || text[offset - 1] === '#');
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

function isFunctionIdentifier(text: string, endOffset: number): boolean {
  let offset = endOffset;
  while (offset < text.length && (text[offset] === ' ' || text[offset] === '\t')) {
    offset += 1;
  }
  return text[offset] === '(';
}

function isConfiguredIoAliasOperand(
  text: string,
  startOffset: number,
  endOffset: number,
  identifier: string,
  configuration: DiagnosticPrefixConfiguration
): boolean {
  let offset = endOffset;
  while (offset < text.length && (text[offset] === ' ' || text[offset] === '\t')) {
    offset += 1;
  }
  if (text[offset] !== ']') {
    return false;
  }

  offset = startOffset - 1;
  while (offset >= 0 && (text[offset] === ' ' || text[offset] === '\t')) {
    offset -= 1;
  }
  if (text[offset] !== '[') {
    return false;
  }

  offset -= 1;
  while (offset >= 0 && (text[offset] === ' ' || text[offset] === '\t')) {
    offset -= 1;
  }
  const systemNameEnd = offset + 1;
  while (offset >= 0 && /[A-Za-z]/.test(text[offset])) {
    offset -= 1;
  }
  const systemName = text.slice(offset + 1, systemNameEnd).toLowerCase();
  if (text[offset] !== '$') {
    return false;
  }
  const aliasPrefixes = systemName === 'in'
    ? configuration.inputAliasPrefixes
    : systemName === 'out' ? configuration.outputAliasPrefixes : [];
  return matchesAnyPrefix(identifier, aliasPrefixes);
}

function findCompanionDat(sourcePath: string): string | null {
  const directory = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const lowerCasePath = path.join(directory, `${baseName}.dat`);
  if (fs.existsSync(lowerCasePath)) {
    return lowerCasePath;
  }
  const upperCasePath = path.join(directory, `${baseName}.DAT`);
  if (fs.existsSync(upperCasePath)) {
    return upperCasePath;
  }
  try {
    const expectedName = `${baseName}.dat`.toLowerCase();
    const matchingEntry = fs.readdirSync(directory, { withFileTypes: true })
      .find(entry => entry.isFile() && entry.name.toLowerCase() === expectedName);
    return matchingEntry ? path.join(directory, matchingEntry.name) : null;
  } catch {
    return null;
  }
}

function findConfigDat(sourcePath: string, document: vscode.TextDocument): string | null {
  const krlTreeRoot = inferKrlTreeRoot(sourcePath);
  const candidates = krlTreeRoot
    ? getCachedConfigPaths(krlTreeRoot)
    : getConfigCandidates(document);
  if (krlTreeRoot) {
    const projectConfig = findProjectConfigDat(krlTreeRoot);
    if (projectConfig && !candidates.some(candidate => normalizePathKey(candidate) === normalizePathKey(projectConfig))) {
      candidates.push(projectConfig);
    }
  }
  return selectNearestPath(sourcePath, candidates);
}

function findProjectConfigDat(krlTreeRoot: string): string | null {
  let currentPath = krlTreeRoot;
  const components = ['System', '$config.dat'];
  for (const [index, component] of components.entries()) {
    const expectFile = index === components.length - 1;
    try {
      const matchingEntry = fs.readdirSync(currentPath, { withFileTypes: true }).find(entry =>
        entry.name.toLowerCase() === component.toLowerCase()
        && matchesFileSystemEntry(path.join(currentPath, entry.name), expectFile)
      );
      if (!matchingEntry) {
        return null;
      }
      currentPath = path.join(currentPath, matchingEntry.name);
    } catch {
      return null;
    }
  }
  return currentPath;
}

function matchesFileSystemEntry(entryPath: string, expectFile: boolean): boolean {
  try {
    const stats = fs.statSync(entryPath);
    return expectFile ? stats.isFile() : stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Config candidates for a source outside any `KRC/R1` tree.
 *
 * Scoped to the source's own workspace folder, matching how variable navigation roots such a
 * document. In a multi-root workspace a config in an unrelated folder must not satisfy a
 * diagnostic that Go to Definition cannot resolve.
 */
function getConfigCandidates(document: vscode.TextDocument): string[] {
  const ownFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const roots = ownFolder ? [ownFolder] : [];
  const candidates: string[] = [];
  for (const workspaceRoot of roots) {
    for (const candidate of getCachedConfigPaths(workspaceRoot)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function getCachedConfigPaths(root: string): string[] {
  const key = normalizePathKey(root);
  const now = Date.now();
  let scan = configScanCache.get(key);
  if (!scan || now - scan.lastScanMs > configScanTtlMs) {
    scan = { lastScanMs: now, configs: scanConfigPaths(root) };
    configScanCache.set(key, scan);
  }
  return [...scan.configs];
}

function scanConfigPaths(root: string): string[] {
  return scanProjectTreeSync(root, isConfigDat);
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
  const key = normalizePathKey(configPath);
  const openDocument = vscode.workspace.textDocuments.find(document =>
    document.uri.scheme === 'file' && normalizePathKey(document.uri.fsPath) === key
  );
  if (openDocument) {
    return parseConfigAliases(openDocument.getText());
  }
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
  return collectDeclarations(configText);
}
