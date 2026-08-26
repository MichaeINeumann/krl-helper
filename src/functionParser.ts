import { sanitizeForAnalysis } from './diagnosticSanitizer';

export type KrlFunctionKind = 'DEF' | 'DEFFCT';

export interface ParsedKrlFunction {
  name: string;
  normalizedName: string;
  signature: string;
  kind: KrlFunctionKind;
  global: boolean;
  line: number;
  lineStartOffset: number;
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

export interface KrlFunctionCall {
  name: string;
  normalizedName: string;
  startOffset: number;
  endOffset: number;
}

export interface SourcedKrlFunction extends ParsedKrlFunction {
  sourceId: string;
  moduleEntry?: boolean;
}

export const krlBuiltInFunctions = new Set([
  'abs', 'acos', 'asin', 'atan2', 'bas', 'clear_krldlg', 'clear_krlmsg', 'cos',
  'cread', 'cwrite', 'exp', 'fract', 'ini', 'round', 'set_cd_params',
  'set_krldlg', 'set_krlmsg', 'set_motionparamset', 'sin', 'sqrt', 'sread',
  'sread_ext', 'stradd', 'strclear', 'strcopy', 'strcut', 'strfind', 'strlen',
  'strtolower', 'strtol', 'strtor', 'strtoupper', 'swrite', 'swrite_ext', 'tan',
  'trunc'
]);

export function parseKrlFunctions(text: string): ParsedKrlFunction[] {
  const sanitized = sanitizeForAnalysis(text);
  const definitions: ParsedKrlFunction[] = [];
  let lineStart = 0;
  let lineNumber = 0;

  while (lineStart <= sanitized.length) {
    const newlineOffset = sanitized.indexOf('\n', lineStart);
    const lineEnd = newlineOffset === -1 ? sanitized.length : newlineOffset;
    const sanitizedLine = sanitized.slice(lineStart, lineEnd).replace(/\r$/, '');
    const originalLine = text.slice(lineStart, lineStart + sanitizedLine.length);
    const parsed = parseFunctionLine(sanitizedLine);
    if (parsed) {
      const nameOffsetInLine = parsed.match.lastIndexOf(parsed.name, parsed.match.indexOf('('));
      const firstNonWhitespace = sanitizedLine.search(/\S/);
      const trimmedEnd = originalLine.trimEnd().length;
      definitions.push({
        name: parsed.name,
        normalizedName: parsed.name.toLowerCase(),
        signature: originalLine.trim(),
        kind: parsed.kind,
        global: parsed.global,
        line: lineNumber,
        lineStartOffset: lineStart,
        startOffset: lineStart + Math.max(0, firstNonWhitespace),
        endOffset: lineStart + trimmedEnd,
        nameStartOffset: lineStart + nameOffsetInLine,
        nameEndOffset: lineStart + nameOffsetInLine + parsed.name.length
      });
    }

    if (newlineOffset === -1) {
      break;
    }
    lineStart = newlineOffset + 1;
    lineNumber += 1;
  }
  return definitions;
}

export function findKrlFunctionCall(text: string, offset: number): KrlFunctionCall | undefined {
  if (offset < 0 || offset > text.length) {
    return undefined;
  }
  const sanitized = sanitizeForAnalysis(text);
  let startOffset = Math.min(offset, Math.max(0, text.length - 1));
  if (!/[A-Za-z0-9_]/.test(sanitized[startOffset] ?? '') && startOffset > 0
      && /[A-Za-z0-9_]/.test(sanitized[startOffset - 1] ?? '')) {
    startOffset -= 1;
  }
  while (startOffset > 0 && /[A-Za-z0-9_]/.test(sanitized[startOffset - 1])) {
    startOffset -= 1;
  }
  let endOffset = startOffset;
  while (endOffset < sanitized.length && /[A-Za-z0-9_]/.test(sanitized[endOffset])) {
    endOffset += 1;
  }
  const name = sanitized.slice(startOffset, endOffset);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return undefined;
  }
  let nextOffset = endOffset;
  while (nextOffset < sanitized.length && /[ \t]/.test(sanitized[nextOffset])) {
    nextOffset += 1;
  }
  if (sanitized[nextOffset] !== '(') {
    return undefined;
  }
  const normalizedName = name.toLowerCase();
  if (krlBuiltInFunctions.has(normalizedName)) {
    return undefined;
  }
  const isDefinition = parseKrlFunctions(text).some(definition =>
    startOffset >= definition.nameStartOffset && endOffset <= definition.nameEndOffset
  );
  return isDefinition ? undefined : { name, normalizedName, startOffset, endOffset };
}

export function selectVisibleKrlFunctions<T extends SourcedKrlFunction>(
  definitions: readonly T[],
  currentSourceId: string,
  normalizedName: string
): T[] {
  const matching = definitions.filter(definition => definition.normalizedName === normalizedName);
  return [
    ...matching.filter(definition => definition.sourceId === currentSourceId),
    ...matching.filter(definition =>
      definition.sourceId !== currentSourceId && (definition.global || definition.moduleEntry)
    )
  ];
}

interface ParsedFunctionLine {
  name: string;
  kind: KrlFunctionKind;
  global: boolean;
  match: string;
}

function parseFunctionLine(line: string): ParsedFunctionLine | undefined {
  const deffct = /^\s*(GLOBAL\s+)?DEFFCT\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]*\])?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)/i.exec(line);
  if (deffct) {
    return { name: deffct[2], kind: 'DEFFCT', global: Boolean(deffct[1]), match: deffct[0] };
  }
  const definition = /^\s*(GLOBAL\s+)?DEF\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)/i.exec(line);
  if (definition) {
    return { name: definition[2], kind: 'DEF', global: Boolean(definition[1]), match: definition[0] };
  }
  return undefined;
}
