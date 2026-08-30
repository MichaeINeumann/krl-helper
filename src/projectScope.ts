import * as fs from 'fs';
import * as path from 'path';

/**
 * Shared project-scope rules for diagnostics and navigation.
 *
 * Diagnostics and Go to Definition must agree on which declarations are visible from a given
 * source file. When each provider answers that question with its own path normalization, project
 * root inference, nearest-config selection, or directory scan, the two drift apart and a
 * diagnostic can be suppressed without a matching definition target, or vice versa. Every rule
 * that both providers depend on therefore lives here and has exactly one implementation.
 */

export const ignoredDirectories = new Set(['.git', '.svn', '.vscode', 'node_modules', 'dist', 'out']);

export const configDatName = '$config.dat';

function pathImplementation(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Case-folds on Windows so that path comparisons match the platform's filesystem semantics. */
export function normalizeProjectPath(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalized = pathImplementation(platform).resolve(filePath);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isConfigDat(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === configDatName;
}

export function isProjectDeclarationFile(filePath: string): boolean {
  return /\.(?:src|sub|dat)$/i.test(filePath);
}

/**
 * Returns the `<...>/KRC/R1` directory a file belongs to, or null when it is outside such a tree.
 *
 * A path can contain more than one `KRC/R1` sequence, for example when a project is extracted
 * below another one. The innermost occurrence is the project that actually owns the file, so it is
 * the one both providers use.
 */
export function inferKrlTreeRoot(filePath: string): string | null {
  const parsed = path.parse(path.normalize(filePath));
  const segments = path.relative(parsed.root, path.normalize(filePath))
    .split(path.sep)
    .filter(segment => segment.length > 0);
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    if (segments[index].toLowerCase() === 'krc' && segments[index + 1]?.toLowerCase() === 'r1') {
      return path.join(parsed.root, ...segments.slice(0, index + 2));
    }
  }
  return null;
}

/** Uses the inferred controller tree whenever one owns the source, even for nested workspaces. */
export function projectRootForSource(sourcePath: string, workspaceRoot: string | null): string | null {
  return inferKrlTreeRoot(sourcePath) ?? workspaceRoot;
}

/** Number of path segments separating two paths, used to rank candidates by proximity. */
export function pathDistance(
  leftPath: string,
  rightPath: string,
  platform: NodeJS.Platform = process.platform
): number {
  const pathApi = pathImplementation(platform);
  const left = normalizeProjectPath(leftPath, platform).split(pathApi.sep).filter(part => part.length > 0);
  const right = normalizeProjectPath(rightPath, platform).split(pathApi.sep).filter(part => part.length > 0);
  let common = 0;
  const limit = Math.min(left.length, right.length);
  while (common < limit && left[common] === right[common]) {
    common += 1;
  }
  return left.length - common + (right.length - common);
}

/**
 * Picks the candidate closest to `sourcePath`.
 *
 * Ties are broken by normalized path so that both providers select the same candidate regardless
 * of the order in which their scans discovered them.
 */
export function selectNearestPath(
  sourcePath: string,
  candidates: readonly string[],
  platform: NodeJS.Platform = process.platform
): string | null {
  let nearest: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = pathDistance(sourcePath, candidate, platform);
    if (distance < nearestDistance
      || (distance === nearestDistance
        && nearest !== null
        && normalizeProjectPath(candidate, platform) < normalizeProjectPath(nearest, platform))) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Recursively collects files below `root` that satisfy `accept`.
 *
 * Symbolic links are followed for both directories and files, because KRL projects are commonly
 * assembled from linked controller shares. Every directory and accepted file is visited at most
 * once per scan, keyed by its real path, so aliases do not index the same physical file twice.
 */
export async function scanProjectTree(
  root: string,
  accept: (filePath: string) => boolean
): Promise<string[]> {
  const files: string[] = [];
  const visitedRealPaths = new Set<string>();
  const directories = [root];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      const realDirectory = normalizeProjectPath(await fs.promises.realpath(directory));
      if (visitedRealPaths.has(realDirectory)) {
        continue;
      }
      visitedRealPaths.add(realDirectory);
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
      entries.sort(compareProjectEntries);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      let directoryEntry = entry.isDirectory();
      let fileEntry = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = await fs.promises.stat(entryPath);
          directoryEntry = stats.isDirectory();
          fileEntry = stats.isFile();
        } catch {
          continue;
        }
      }
      if (directoryEntry) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          directories.push(entryPath);
        }
      } else if (fileEntry && accept(entryPath)) {
        try {
          const realFile = normalizeProjectPath(await fs.promises.realpath(entryPath));
          if (!visitedRealPaths.has(realFile)) {
            visitedRealPaths.add(realFile);
            files.push(entryPath);
          }
        } catch {
          continue;
        }
      }
    }
  }
  return files;
}

/** Synchronous counterpart to {@link scanProjectTree} for the cached `$config.dat` scan. */
export function scanProjectTreeSync(
  root: string,
  accept: (filePath: string) => boolean
): string[] {
  const files: string[] = [];
  const visitedRealPaths = new Set<string>();
  const directories = [root];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      const realDirectory = normalizeProjectPath(fs.realpathSync(directory));
      if (visitedRealPaths.has(realDirectory)) {
        continue;
      }
      visitedRealPaths.add(realDirectory);
      entries = fs.readdirSync(directory, { withFileTypes: true });
      entries.sort(compareProjectEntries);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      let directoryEntry = entry.isDirectory();
      let fileEntry = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = fs.statSync(entryPath);
          directoryEntry = stats.isDirectory();
          fileEntry = stats.isFile();
        } catch {
          continue;
        }
      }
      if (directoryEntry) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          directories.push(entryPath);
        }
      } else if (fileEntry && accept(entryPath)) {
        try {
          const realFile = normalizeProjectPath(fs.realpathSync(entryPath));
          if (!visitedRealPaths.has(realFile)) {
            visitedRealPaths.add(realFile);
            files.push(entryPath);
          }
        } catch {
          continue;
        }
      }
    }
  }
  return files;
}

function compareProjectEntries(left: fs.Dirent, right: fs.Dirent): number {
  return Number(left.isSymbolicLink()) - Number(right.isSymbolicLink())
    || left.name.localeCompare(right.name);
}
