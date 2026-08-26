import * as path from 'path';
import { sanitizeForAnalysis } from './diagnosticSanitizer';

export const diagnosticSettingDefinitions = [
  {
    key: 'localVariablePrefixes',
    fullKey: 'krlHelper.diagnostics.localVariablePrefixes',
    label: 'Local variable prefixes',
    description: 'Variables that must be declared in the current SRC/SUB, its companion DAT, or as function parameters.',
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

const declarationQualifiers = new Set([
  'const', 'static', 'public', 'private', 'extern', 'global', 'decl', 'in', 'out', 'inout'
]);

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
  const sanitized = sanitizeForAnalysis(text);
  for (const line of sanitized.split(/\r?\n/)) {
    const declaration = parseDeclarationLine(line);
    for (const name of declaration?.names ?? []) {
      target.add(name);
    }
  }
  return target;
}

export function collectFunctionParameters(text: string, target: Set<string> = new Set<string>()): Set<string> {
  const sanitized = sanitizeForAnalysis(text);
  const functionPattern = /^\s*(?:GLOBAL\s+)?DEF(?:FCT)?\b[^\r\n(]*\(([^)]*)\)/gim;
  let match: RegExpExecArray | null;
  while ((match = functionPattern.exec(sanitized))) {
    for (const parameter of match[1].split(',')) {
      const identifiers = parameter.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
      while (identifiers[0] && declarationQualifiers.has(identifiers[0].toLowerCase())) {
        identifiers.shift();
      }
      const parameterName = identifiers.length === 1 ? identifiers[0] : identifiers[1];
      if (parameterName) {
        target.add(parameterName.toLowerCase());
      }
    }
  }
  return target;
}

export function collectGlobalSourceDeclarations(
  text: string,
  target: Set<string> = new Set<string>()
): Set<string> {
  const sanitized = sanitizeForAnalysis(text);
  for (const line of sanitized.split(/\r?\n/)) {
    const declaration = parseDeclarationLine(line);
    if (!declaration?.global) {
      continue;
    }
    for (const name of declaration.names) {
      target.add(name);
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
  const sanitized = sanitizeForAnalysis(text);
  for (const line of sanitized.split(/\r?\n/)) {
    if (!/^\s*DECL\s+GLOBAL\b/i.test(line)) {
      continue;
    }
    const declaration = parseDeclarationLine(line);
    for (const name of declaration?.names ?? []) {
      target.add(name);
    }
  }
  return target;
}

export function hasPublicDefdatHeader(text: string): boolean {
  const sanitized = sanitizeForAnalysis(text);
  return /^\s*DEFDAT\s+[A-Za-z_][A-Za-z0-9_]*\s+PUBLIC\b/im.test(sanitized);
}

interface ParsedDeclaration {
  global: boolean;
  names: string[];
}

function parseDeclarationLine(line: string): ParsedDeclaration | undefined {
  const leftHandSide = line.split('=')[0];
  const prefix = /^\s*(?:(DECL)\s+(?:(GLOBAL)\s+)?|(GLOBAL)\s+(?:(DECL)\s+)?)/i.exec(leftHandSide);
  if (!prefix) {
    return undefined;
  }
  const global = Boolean(prefix[2] || prefix[3]);
  let remainder = leftHandSide.slice(prefix[0].length);
  if (/^\s*DEF(?:FCT)?\b/i.test(remainder)) {
    return undefined;
  }
  let leadingIdentifier = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(remainder);
  while (leadingIdentifier && declarationQualifiers.has(leadingIdentifier[1].toLowerCase())) {
    remainder = remainder.slice(leadingIdentifier[0].length);
    leadingIdentifier = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(remainder);
  }
  if (!leadingIdentifier) {
    return { global, names: [] };
  }
  // Remove the KRL or user-defined type, then parse comma-separated declarators.
  remainder = remainder.slice(leadingIdentifier[0].length);
  const declarators: string[] = [];
  let bracketDepth = 0;
  let declaratorStart = 0;
  for (let index = 0; index <= remainder.length; index += 1) {
    const character = remainder[index];
    if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }
    if ((character === ',' && bracketDepth === 0) || index === remainder.length) {
      declarators.push(remainder.slice(declaratorStart, index));
      declaratorStart = index + 1;
    }
  }
  return {
    global,
    names: declarators
      .map(declarator => /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(declarator)?.[1]?.toLowerCase())
      .filter((name): name is string => Boolean(name))
  };
}
