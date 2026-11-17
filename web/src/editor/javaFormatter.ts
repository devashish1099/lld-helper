import type * as Monaco from 'monaco-editor';

/**
 * Re-indents Java source by brace depth (4 spaces), handling switch/case bodies,
 * continuation lines starting with '.', comments, strings and text blocks.
 * It does not reflow code; it fixes indentation, which is what matters in interviews.
 */
export function formatJava(src: string, indentUnit = '    '): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const stack: ('block' | 'switch')[] = [];
  let parenDepth = 0;
  let inBlockComment = false;
  let inTextBlock = false;
  const out: string[] = [];

  for (const raw of lines) {
    if (inTextBlock) {
      out.push(raw);
      if ((raw.match(/"""/g) ?? []).length % 2 === 1) inTextBlock = false;
      continue;
    }
    const line = raw.trim();
    if (!line) {
      out.push('');
      continue;
    }
    if (inBlockComment) {
      out.push(indentUnit.repeat(stack.length) + (line.startsWith('*') ? ` ${line}` : line));
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }

    // Code-only view of the line (strings/chars/comments removed) for counting.
    const code = line
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '');

    let leadingClosers = 0;
    for (const ch of code) {
      if (ch === '}') leadingClosers++;
      else if (ch !== ')' && ch !== ' ') break;
    }
    let depth = Math.max(0, stack.length - leadingClosers);
    const top = stack[Math.max(0, stack.length - leadingClosers) - 1];
    const isCase = /^(case\b.*|default)\s*:/.test(line) || /^(case\b|default\b).*->/.test(line);
    if (top === 'switch' && !isCase && leadingClosers === 0 && !/^(case|default)\b/.test(line)) depth++;
    if (line.startsWith('.') || parenDepth > 0) depth += 2;
    out.push(indentUnit.repeat(depth) + line);

    // Update state with this line's braces/parens.
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '{') stack.push(/\bswitch\s*\(.*\)\s*$/.test(code.slice(0, i)) && !/->\s*$/.test(code.slice(0, i)) ? 'switch' : 'block');
      else if (ch === '}') stack.pop();
      else if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    }
    const commentStart = code.lastIndexOf('/*');
    if (commentStart >= 0 && !code.slice(commentStart).includes('*/')) inBlockComment = true;
    if ((code.match(/"""/g) ?? []).length % 2 === 1) inTextBlock = true;
  }
  return out.join('\n');
}

export function registerJavaFormatter(monaco: typeof Monaco) {
  monaco.languages.registerDocumentFormattingEditProvider('java', {
    displayName: 'LLD Studio Java formatter',
    provideDocumentFormattingEdits(model, options) {
      const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
      const formatted = formatJava(model.getValue(), unit);
      return formatted === model.getValue() ? [] : [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
}
