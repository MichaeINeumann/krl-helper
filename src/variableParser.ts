import { sanitizeForAnalysis } from './diagnosticSanitizer';
import { parseKrlFunctions } from './functionParser';

export type KrlVariableDeclarationKind = 'declaration' | 'parameter' | 'signal';

export interface ParsedKrlVariableDeclaration {
  name: string;
  normalizedName: string;
  kind: KrlVariableDeclarationKind;
  global: boolean;
  line: number;
  lineStartOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

export interface KrlVariableReference {
  name: string;
  normalizedName: string;
  startOffset: number;
  endOffset: number;
}

const declarationQualifiers = new Set([
  'const', 'static', 'public', 'private', 'extern', 'global', 'decl', 'in', 'out', 'inout'
]);
const typeDefinitionKeywords = new Set(['enum', 'struc']);
const implicitDeclarationTypes = [
  'BOOL', 'CHAR', 'INT', 'REAL', 'AXIS', 'E6AXIS', 'FRAME', 'POS', 'E6POS'
] as const;
const implicitDeclarationPattern = new RegExp(
  `^\\s*(?:${implicitDeclarationTypes.join('|')})\\b`,
  'i'
);

export function parseKrlVariableDeclarations(text: string): ParsedKrlVariableDeclaration[] {
  const sanitized = sanitizeForAnalysis(text);
  const declarations: ParsedKrlVariableDeclaration[] = [];
  let lineStart = 0;
  let lineNumber = 0;

  while (lineStart <= sanitized.length) {
    const newlineOffset = sanitized.indexOf('\n', lineStart);
    const lineEnd = newlineOffset === -1 ? sanitized.length : newlineOffset;
    const line = sanitized.slice(lineStart, lineEnd).replace(/\r$/, '');
    declarations.push(...parseVariableLine(line, lineNumber, lineStart));

    if (newlineOffset === -1) {
      break;
    }
    lineStart = newlineOffset + 1;
    lineNumber += 1;
  }

  declarations.push(...parseFunctionParameters(sanitized));
  return declarations;
}

export function findKrlVariableReference(text: string, offset: number): KrlVariableReference | undefined {
  if (offset < 0 || offset > text.length || text.length === 0) {
    return undefined;
  }
  const sanitized = sanitizeForAnalysis(text);
  let startOffset = Math.min(offset, sanitized.length - 1);
  if (!isIdentifierCharacter(sanitized[startOffset]) && startOffset > 0
      && isIdentifierCharacter(sanitized[startOffset - 1])) {
    startOffset -= 1;
  }
  while (startOffset > 0 && isIdentifierCharacter(sanitized[startOffset - 1])) {
    startOffset -= 1;
  }
  let endOffset = startOffset;
  while (endOffset < sanitized.length && isIdentifierCharacter(sanitized[endOffset])) {
    endOffset += 1;
  }
  const name = sanitized.slice(startOffset, endOffset);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return undefined;
  }
  if (startOffset > 0 && (sanitized[startOffset - 1] === '$' || sanitized[startOffset - 1] === '#')) {
    return undefined;
  }
  for (let index = startOffset - 1; index >= 0; index -= 1) {
    const character = sanitized[index];
    if (character !== ' ' && character !== '\t') {
      if (character === '.') {
        return undefined;
      }
      break;
    }
  }
  let nextOffset = endOffset;
  while (nextOffset < sanitized.length && /[ \t]/.test(sanitized[nextOffset])) {
    nextOffset += 1;
  }
  if (sanitized[nextOffset] === '(') {
    return undefined;
  }
  return { name, normalizedName: name.toLowerCase(), startOffset, endOffset };
}

function parseVariableLine(
  line: string,
  lineNumber: number,
  lineStartOffset: number
): ParsedKrlVariableDeclaration[] {
  const signal = /^\s*SIGNAL\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(line);
  if (signal) {
    const nameOffset = signal.index + signal[0].lastIndexOf(signal[1]);
    return [createDeclaration(signal[1], 'signal', false, lineNumber, lineStartOffset, nameOffset)];
  }

  const prefix = /^\s*(?:(DECL)\s+(?:(GLOBAL)\s+)?|(GLOBAL)\s+(?:(DECL)\s+)?)/i.exec(line);
  let global = false;
  let cursor = 0;
  if (prefix) {
    global = Boolean(prefix[2] || prefix[3]);
    cursor = prefix[0].length;
    if (/^\s*DEF(?:FCT)?\b/i.test(line.slice(cursor))) {
      return [];
    }

    let leadingIdentifier = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(cursor));
    while (leadingIdentifier && declarationQualifiers.has(leadingIdentifier[1].toLowerCase())) {
      cursor += leadingIdentifier[0].length;
      leadingIdentifier = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(cursor));
    }
    if (!leadingIdentifier) {
      return [];
    }
    if (typeDefinitionKeywords.has(leadingIdentifier[1].toLowerCase())) {
      return [];
    }
    // Skip the KRL or user-defined type after DECL/GLOBAL.
    cursor += leadingIdentifier[0].length;
  } else {
    const implicitType = implicitDeclarationPattern.exec(line);
    if (!implicitType) {
      return [];
    }
    // KRL permits DECL to be omitted for built-in local variable types.
    cursor = implicitType[0].length;
  }

  return splitTopLevelSegments(line, cursor).flatMap(segment => {
    const declarator = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(segment.text);
    if (!declarator) {
      return [];
    }
    const nameOffset = segment.start + declarator[0].lastIndexOf(declarator[1]);
    return [createDeclaration(
      declarator[1], 'declaration', global, lineNumber, lineStartOffset, nameOffset
    )];
  });
}

function parseFunctionParameters(sanitized: string): ParsedKrlVariableDeclaration[] {
  const parameters: ParsedKrlVariableDeclaration[] = [];
  for (const definition of parseKrlFunctions(sanitized)) {
    const openParenthesis = sanitized.indexOf('(', definition.nameEndOffset);
    if (openParenthesis === -1 || openParenthesis >= definition.endOffset) {
      continue;
    }
    const closeParenthesis = sanitized.indexOf(')', openParenthesis + 1);
    if (closeParenthesis === -1 || closeParenthesis > definition.endOffset) {
      continue;
    }
    const parameterText = sanitized.slice(openParenthesis + 1, closeParenthesis);
    for (const segment of splitTopLevelSegments(parameterText, 0)) {
      const colonOffset = findTopLevelColon(segment.text);
      const declarationPart = colonOffset === -1 ? segment.text : segment.text.slice(0, colonOffset);
      const identifiers = [...declarationPart.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)];
      const identifier = identifiers.reverse().find(match =>
        !declarationQualifiers.has(match[0].toLowerCase())
      );
      if (identifier?.index === undefined) {
        continue;
      }
      const absoluteNameOffset = openParenthesis + 1 + segment.start + identifier.index;
      parameters.push(createDeclaration(
        identifier[0], 'parameter', false, definition.line,
        definition.lineStartOffset, absoluteNameOffset - definition.lineStartOffset
      ));
    }
  }
  return parameters;
}

function createDeclaration(
  name: string,
  kind: KrlVariableDeclarationKind,
  global: boolean,
  line: number,
  lineStartOffset: number,
  nameOffsetInLine: number
): ParsedKrlVariableDeclaration {
  const nameStartOffset = lineStartOffset + nameOffsetInLine;
  return {
    name,
    normalizedName: name.toLowerCase(),
    kind,
    global,
    line,
    lineStartOffset,
    nameStartOffset,
    nameEndOffset: nameStartOffset + name.length
  };
}

interface TextSegment {
  text: string;
  start: number;
}

function splitTopLevelSegments(text: string, startOffset: number): TextSegment[] {
  const segments: TextSegment[] = [];
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenthesisDepth = 0;
  let segmentStart = startOffset;
  for (let index = startOffset; index <= text.length; index += 1) {
    const character = text[index];
    if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (character === '{') {
      braceDepth += 1;
    } else if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    }
    if ((character === ',' && bracketDepth === 0 && braceDepth === 0 && parenthesisDepth === 0)
        || index === text.length) {
      segments.push({ text: text.slice(segmentStart, index), start: segmentStart });
      segmentStart = index + 1;
    }
  }
  return segments;
}

function findTopLevelColon(text: string): number {
  let bracketDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '[') {
      bracketDepth += 1;
    } else if (text[index] === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (text[index] === ':' && bracketDepth === 0) {
      return index;
    }
  }
  return -1;
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}
