/**
 * Replaces comments, strings and inline KRL structures with spaces while
 * preserving every UTF-16 offset used by VS Code diagnostics.
 */
export function sanitizeForAnalysis(text: string): string {
  const characters = text.split('');
  const directivePattern = /^[\t ]*&[A-Za-z_][A-Za-z0-9_]*[^\r\n]*/gm;
  let directiveMatch: RegExpExecArray | null;
  while ((directiveMatch = directivePattern.exec(text))) {
    const endOffset = directiveMatch.index + directiveMatch[0].length;
    for (let offset = directiveMatch.index; offset < endOffset; offset += 1) {
      characters[offset] = ' ';
    }
  }

  let quote: string | null = null;
  let quoteEscaped = false;
  let blockCommentEnd: string | null = null;
  let braceDepth = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];

    if (quote) {
      characters[index] = ' ';
      if (quoteEscaped) {
        quoteEscaped = false;
      } else if (character === '\\') {
        quoteEscaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (blockCommentEnd) {
      if (character === blockCommentEnd[0] && characters[index + 1] === blockCommentEnd[1]) {
        characters[index] = ' ';
        characters[index + 1] = ' ';
        index += 1;
        blockCommentEnd = null;
      } else if (character !== '\r' && character !== '\n') {
        characters[index] = ' ';
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      characters[index] = ' ';
      continue;
    }

    if (character === ';') {
      while (index < characters.length && characters[index] !== '\r' && characters[index] !== '\n') {
        characters[index] = ' ';
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (character === '/' && characters[index + 1] === '*') {
      characters[index] = ' ';
      characters[index + 1] = ' ';
      index += 1;
      blockCommentEnd = '*/';
      continue;
    }

    if (character === '(' && characters[index + 1] === '*') {
      characters[index] = ' ';
      characters[index + 1] = ' ';
      index += 1;
      blockCommentEnd = '*)';
      continue;
    }

    if (braceDepth > 0) {
      if (character === '{') {
        braceDepth += 1;
      } else if (character === '}') {
        braceDepth -= 1;
      }
      if (character !== '\r' && character !== '\n') {
        characters[index] = ' ';
      }
      continue;
    }

    if (character === '{') {
      braceDepth = 1;
      characters[index] = ' ';
    }
  }

  return characters.join('');
}
