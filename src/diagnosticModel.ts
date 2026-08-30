import * as path from 'path';
import { sanitizeForAnalysis } from './diagnosticSanitizer';
import { ParsedKrlVariableDeclaration, parseKrlVariableDeclarations } from './variableParser';

export const diagnosticSettingDefinitions = [
  {
    key: 'localVariablePrefixes',
    fullKey: 'krlHelper.diagnostics.localVariablePrefixes',
    label: 'Local variable prefixes',
    description: 'Variables that need a visible declaration, preferring the current module before explicit project globals.',
    defaultValue: ['b', 'n']
  },
  {
    key: 'globalVariablePrefixes',
    fullKey: 'krlHelper.diagnostics.globalVariablePrefixes',
    label: 'Global variable prefixes',
    description: 'Variables that must be declared in a project-wide global declaration space.',
    defaultValue: ['b_', 'n_']
  },
  {
    key: 'inputAliasPrefixes',
    fullKey: 'krlHelper.diagnostics.inputAliasPrefixes',
    label: 'Input alias prefixes',
    description: 'Aliases used inside $IN[...] that must be declared in $config.dat.',
    defaultValue: ['i_']
  },
  {
    key: 'outputAliasPrefixes',
    fullKey: 'krlHelper.diagnostics.outputAliasPrefixes',
    label: 'Output alias prefixes',
    description: 'Aliases used inside $OUT[...] that must be declared in $config.dat.',
    defaultValue: ['o_']
  }
] as const;

export type DiagnosticSettingKey = typeof diagnosticSettingDefinitions[number]['key'];

export interface DiagnosticPrefixConfiguration {
  localVariablePrefixes: string[];
  globalVariablePrefixes: string[];
  inputAliasPrefixes: string[];
  outputAliasPrefixes: string[];
}

export type VariableScope = 'local' | 'global';

export function normalizePrefixList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const prefix = candidate.trim();
    const normalized = prefix.toLowerCase();
    if (!prefix || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(prefix);
  }
  return result;
}

export function normalizePrefixConfiguration(
  value: Partial<Record<DiagnosticSettingKey, unknown>>
): DiagnosticPrefixConfiguration {
  return {
    localVariablePrefixes: normalizePrefixList(value.localVariablePrefixes),
    globalVariablePrefixes: normalizePrefixList(value.globalVariablePrefixes),
    inputAliasPrefixes: normalizePrefixList(value.inputAliasPrefixes),
    outputAliasPrefixes: normalizePrefixList(value.outputAliasPrefixes)
  };
}

export function hasLiteralPrefix(identifier: string, prefix: string): boolean {
  if (!identifier.toLowerCase().startsWith(prefix.toLowerCase())) {
    return false;
  }
  if (prefix.length !== 1) {
    return true;
  }
  const nextCharacter = identifier[prefix.length];
  return nextCharacter !== undefined && (nextCharacter === '_' || /[A-Z0-9]/.test(nextCharacter));
}

export function matchesAnyPrefix(identifier: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => hasLiteralPrefix(identifier, prefix));
}

export function classifyVariable(
  identifier: string,
  configuration: DiagnosticPrefixConfiguration
): VariableScope | undefined {
  if (matchesAnyPrefix(identifier, configuration.globalVariablePrefixes)) {
    return 'global';
  }
  if (matchesAnyPrefix(identifier, configuration.localVariablePrefixes)) {
    return 'local';
  }
  return undefined;
}

export function collectDeclarations(text: string, target: Set<string> = new Set<string>()): Set<string> {
  for (const declaration of parseKrlVariableDeclarations(text)) {
    if (declaration.kind !== 'parameter') {
      target.add(declaration.normalizedName);
    }
  }
  return target;
}

export function collectFunctionParameters(text: string, target: Set<string> = new Set<string>()): Set<string> {
  for (const declaration of parseKrlVariableDeclarations(text)) {
    if (declaration.kind === 'parameter') {
      target.add(declaration.normalizedName);
    }
  }
  return target;
}

export function collectGlobalSourceDeclarations(
  text: string,
  target: Set<string> = new Set<string>()
): Set<string> {
  for (const declaration of parseKrlVariableDeclarations(text)) {
    if (isExplicitProjectGlobalDeclaration(declaration)) {
      target.add(declaration.normalizedName);
    }
  }
  return target;
}

export function collectProjectDatDeclarations(
  filePath: string,
  text: string,
  target: Set<string> = new Set<string>()
): Set<string> {
  if (path.basename(filePath).toLowerCase() === '$config.dat') {
    return collectDeclarations(text, target);
  }
  if (!hasPublicDefdatHeader(text)) {
    return target;
  }
  for (const declaration of parseKrlVariableDeclarations(text)) {
    if (isExplicitProjectGlobalDeclaration(declaration)) {
      target.add(declaration.normalizedName);
    }
  }
  return target;
}

export function isExplicitProjectGlobalDeclaration(
  declaration: ParsedKrlVariableDeclaration
): boolean {
  return declaration.kind === 'declaration' && declaration.global;
}

export function hasPublicDefdatHeader(text: string): boolean {
  const sanitized = sanitizeForAnalysis(text);
  return /^\s*DEFDAT\s+[A-Za-z_][A-Za-z0-9_]*\s+PUBLIC\b/im.test(sanitized);
}
