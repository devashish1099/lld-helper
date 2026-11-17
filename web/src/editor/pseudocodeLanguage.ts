import type * as Monaco from 'monaco-editor';

const KEYWORDS = [
  'CLASS', 'INTERFACE', 'ENUM', 'ABSTRACT', 'EXTENDS', 'IMPLEMENTS', 'FIELD', 'FUNCTION', 'METHOD', 'PROCEDURE',
  'CONSTRUCTOR', 'END', 'IF', 'THEN', 'ELSE', 'ELSEIF', 'FOR', 'EACH', 'IN', 'TO', 'STEP', 'DO', 'WHILE', 'REPEAT',
  'UNTIL', 'RETURN', 'RETURNS', 'BREAK', 'CONTINUE', 'SET', 'LET', 'CALL', 'NEW', 'TRY', 'CATCH', 'FINALLY', 'THROW',
  'AND', 'OR', 'NOT', 'IS', 'TRUE', 'FALSE', 'NULL', 'INPUT', 'OUTPUT', 'PRINT', 'SWITCH', 'CASE', 'DEFAULT',
  'LOCK', 'UNLOCK', 'SYNCHRONIZED', 'WAIT', 'NOTIFY', 'ASYNC', 'AWAIT', 'STATIC', 'PUBLIC', 'PRIVATE', 'PROTECTED',
  'OF', 'WITH', 'AS', 'BEGIN',
];

export function registerPseudocode(monaco: typeof Monaco) {
  monaco.languages.register({ id: 'pseudocode', extensions: ['.pseudo'], aliases: ['Pseudocode'] });
  monaco.languages.setMonarchTokensProvider('pseudocode', {
    ignoreCase: true,
    keywords: KEYWORDS,
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'heading.pseudo'],
        [/\/\/.*$/, 'comment'],
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\d+(\.\d+)?/, 'number'],
        [/(?:FUNCTION|METHOD|PROCEDURE)\b/i, { token: 'keyword.pseudo', next: '@fnName' }],
        [/(?:CLASS|INTERFACE|ENUM)\b/i, { token: 'keyword.pseudo', next: '@typeName' }],
        [/[A-Za-z_][\w]*(?=\s*\()/, 'function.pseudo'],
        [/[A-Za-z_][\w]*/, { cases: { '@keywords': 'keyword.pseudo', '[A-Z][a-z]\\w*': 'type.pseudo', '@default': 'identifier' } }],
        [/[<>]=?|[!=]=|<-|->|:=|=|\+|-|\*|\/|%/, 'operator'],
        [/[{}()[\]]/, '@brackets'],
      ],
      fnName: [
        [/\s+/, ''],
        [/[A-Za-z_][\w]*/, 'function.pseudo', '@pop'],
        [/./, '', '@pop'],
      ],
      typeName: [
        [/\s+/, ''],
        [/[A-Za-z_][\w]*/, 'type.pseudo', '@pop'],
        [/./, '', '@pop'],
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);
  monaco.languages.setLanguageConfiguration('pseudocode', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*(CLASS|INTERFACE|ENUM|FUNCTION|METHOD|PROCEDURE|CONSTRUCTOR|IF|ELSE|ELSEIF|FOR|WHILE|REPEAT|TRY|CATCH|FINALLY|SWITCH|CASE|BEGIN)\b.*$/i,
      decreaseIndentPattern: /^\s*(END|ELSE|ELSEIF|UNTIL|CATCH|FINALLY)\b.*$/i,
    },
    folding: { offSide: true },
  });
  // Block snippets so structured pseudocode is quick to write (independent of the Java autocomplete toggle).
  monaco.languages.registerCompletionItemProvider('pseudocode', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const S = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const snip = (label: string, insertText: string, detail: string) => ({
        label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText,
        insertTextRules: S,
        detail,
        range,
      });
      return {
        suggestions: [
          snip('CLASS', 'CLASS ${1:Name}\n\t$0\nEND CLASS', 'class block'),
          snip('INTERFACE', 'INTERFACE ${1:Name}\n\tFUNCTION ${2:method}(${3})\nEND INTERFACE', 'interface block'),
          snip('FUNCTION', 'FUNCTION ${1:name}(${2:params})\n\t$0\nEND FUNCTION', 'function block'),
          snip('IF', 'IF ${1:condition} THEN\n\t$0\nEND IF', 'if block'),
          snip('IFELSE', 'IF ${1:condition} THEN\n\t$2\nELSE\n\t$0\nEND IF', 'if/else block'),
          snip('FOR EACH', 'FOR EACH ${1:item} IN ${2:items}\n\t$0\nEND FOR', 'for-each loop'),
          snip('FOR', 'FOR ${1:i} FROM ${2:0} TO ${3:n}\n\t$0\nEND FOR', 'counted loop'),
          snip('WHILE', 'WHILE ${1:condition}\n\t$0\nEND WHILE', 'while loop'),
          snip('TRY', 'TRY\n\t$1\nCATCH ${2:error}\n\t$0\nEND TRY', 'try/catch'),
          snip('ENUM', 'ENUM ${1:Name}\n\t${2:A}, ${3:B}\nEND ENUM', 'enum'),
        ],
      };
    },
  });
}
