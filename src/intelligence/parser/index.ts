/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Code Parser - Extracts symbols, dependencies, and structure
 */

import type { Symbol, FunctionSymbol, ClassSymbol, Parameter } from '../../core/types';

interface ParseResult {
  symbols: Symbol[];
  functions: FunctionSymbol[];
  classes: ClassSymbol[];
  imports: string[];
  exports: string[];
  dependencies: string[];
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.c': 'c',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.m': 'objective-c',
  '.sh': 'bash',
  '.sql': 'sql',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.dockerfile': 'dockerfile',
  '.tf': 'terraform',
};

export function detectLanguage(filename: string): string | undefined {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return LANGUAGE_MAP[ext];
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('
').length;
}

function parseParameters(paramStr: string): Parameter[] {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => {
    const trimmed = p.trim();
    const optional = trimmed.includes('?');
    const defaultMatch = trimmed.match(/(.+?)\s*=\s*(.+)/);
    if (defaultMatch) {
      const typeMatch = defaultMatch[1].match(/(.+?):\s*(.+)/);
      return {
        name: typeMatch ? typeMatch[1].trim() : defaultMatch[1].trim(),
        type: typeMatch ? typeMatch[2].trim() : undefined,
        optional,
        defaultValue: defaultMatch[2].trim(),
      };
    }
    const typeMatch = trimmed.match(/(.+?):\s*(.+)/);
    return {
      name: typeMatch ? typeMatch[1].trim() : trimmed,
      type: typeMatch ? typeMatch[2].trim() : undefined,
      optional,
    };
  });
}

function parsePythonParameters(paramStr: string): Parameter[] {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => {
    const trimmed = p.trim();
    const defaultMatch = trimmed.match(/(.+?)\s*=\s*(.+)/);
    if (defaultMatch) {
      return {
        name: defaultMatch[1].trim(),
        type: undefined,
        optional: true,
        defaultValue: defaultMatch[2].trim(),
      };
    }
    return { name: trimmed, type: undefined, optional: false };
  });
}

export function parseTypeScript(content: string, filename: string): ParseResult {
  const symbols: Symbol[] = [];
  const functions: FunctionSymbol[] = [];
  const classes: ClassSymbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const dependencies: string[] = [];

  const importRegex = /import\s+(?:(?:\{[^}]*\}\s*from\s+)?|(?:\*\s+as\s+\w+\s+from\s+)?|(?:\w+\s+from\s+)?)['"]([^'"]+)['"];?/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
    if (!match[1].startsWith('.') && !match[1].startsWith('@/')) {
      dependencies.push(match[1].split('/')[0]);
    }
  }

  const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)?\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)(?:\s*:\s*([A-Za-z0-9_<>[\]|&\s]*))?/g;
  while ((match = functionRegex.exec(content)) !== null) {
    const func: FunctionSymbol = {
      id: 0, projectId: 0, fileId: 0,
      name: match[1],
      symbolType: 'function',
      lineStart: getLineNumber(content, match.index),
      signature: match[0],
      isExported: content.substring(Math.max(0, match.index - 20), match.index).includes('export'),
      isPublic: true,
      isAsync: match[0].includes('async'),
      isGenerator: match[0].includes('function*'),
      parameters: parseParameters(match[2]),
      returnType: match[3],
    };
    functions.push(func);
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'function',
      lineStart: func.lineStart, signature: match[0],
      isExported: func.isExported, isPublic: true });
  }

  const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)(?:\s*:\s*([A-Za-z0-9_<>[\]|&\s]*))?\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    const func: FunctionSymbol = {
      id: 0, projectId: 0, fileId: 0,
      name: match[1],
      symbolType: 'function',
      lineStart: getLineNumber(content, match.index),
      signature: match[0],
      isExported: content.substring(Math.max(0, match.index - 20), match.index).includes('export'),
      isPublic: true,
      isAsync: match[0].includes('async'),
      isGenerator: false,
      parameters: parseParameters(match[2]),
      returnType: match[3],
    };
    functions.push(func);
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'function',
      lineStart: func.lineStart, signature: match[0],
      isExported: func.isExported, isPublic: true });
  }

  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+extends\s+([A-Za-z_$][A-Za-z0-9_$]*))?(?:\s+implements\s+([A-Za-z_$][A-Za-z0-9_$\s,]*))?/g;
  while ((match = classRegex.exec(content)) !== null) {
    const cls: ClassSymbol = {
      id: 0, projectId: 0, fileId: 0,
      name: match[1],
      symbolType: 'class',
      lineStart: getLineNumber(content, match.index),
      signature: match[0],
      isExported: content.substring(Math.max(0, match.index - 20), match.index).includes('export'),
      isPublic: true,
      extends: match[2],
      implements: match[3] ? match[3].split(',').map(s => s.trim()) : undefined,
      isAbstract: match[0].includes('abstract'),
      methods: [],
      properties: [],
    };
    classes.push(cls);
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'class',
      lineStart: cls.lineStart, signature: match[0],
      isExported: cls.isExported, isPublic: true });
  }

  const interfaceRegex = /(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((match = interfaceRegex.exec(content)) !== null) {
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'interface',
      lineStart: getLineNumber(content, match.index), signature: match[0],
      isExported: content.substring(Math.max(0, match.index - 20), match.index).includes('export'),
      isPublic: true });
  }

  const typeRegex = /(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  while ((match = typeRegex.exec(content)) !== null) {
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'type',
      lineStart: getLineNumber(content, match.index), signature: match[0],
      isExported: content.substring(Math.max(0, match.index - 20), match.index).includes('export'),
      isPublic: true });
  }

  const enumRegex = /(?:export\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((match = enumRegex.exec(content)) !== null) {
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'enum',
      lineStart: getLineNumber(content, match.index), signature: match[0],
      isExported: content.substring(Math.max(0, match.index - 20), match.index).includes('export'),
      isPublic: true });
  }

  return { symbols, functions, classes, imports, exports, dependencies: [...new Set(dependencies)] };
}

export function parsePython(content: string, filename: string): ParseResult {
  const symbols: Symbol[] = [];
  const functions: FunctionSymbol[] = [];
  const classes: ClassSymbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const dependencies: string[] = [];

  const importRegex = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const module = match[1] || match[2];
    imports.push(module);
    if (!module.startsWith('.')) {
      dependencies.push(module.split('.')[0]);
    }
  }

  const funcRegex = /^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?::\s*([A-Za-z0-9_[\]|&\s]*))?/gm;
  while ((match = funcRegex.exec(content)) !== null) {
    const isPrivate = match[2].startsWith('_') && !match[2].startsWith('__');
    const func: FunctionSymbol = {
      id: 0, projectId: 0, fileId: 0,
      name: match[2],
      symbolType: 'function',
      lineStart: getLineNumber(content, match.index),
      signature: match[0].trim(),
      isExported: !isPrivate,
      isPublic: !isPrivate,
      isAsync: match[0].includes('async'),
      isGenerator: match[0].includes('yield'),
      parameters: parsePythonParameters(match[3]),
      returnType: match[4],
    };
    functions.push(func);
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[2], symbolType: 'function',
      lineStart: func.lineStart, signature: func.signature,
      isExported: func.isExported, isPublic: func.isPublic });
  }

  const classRegex = /^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const cls: ClassSymbol = {
      id: 0, projectId: 0, fileId: 0,
      name: match[1],
      symbolType: 'class',
      lineStart: getLineNumber(content, match.index),
      signature: match[0],
      isExported: true,
      isPublic: true,
      extends: match[2],
      isAbstract: content.substring(match.index, match.index + 200).includes('ABC'),
      methods: [],
      properties: [],
    };
    classes.push(cls);
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'class',
      lineStart: cls.lineStart, signature: match[0],
      isExported: true, isPublic: true });
  }

  for (const sym of symbols) {
    if (!sym.name.startsWith('_')) exports.push(sym.name);
  }

  return { symbols, functions, classes, imports, exports: [...new Set(exports)], dependencies: [...new Set(dependencies)] };
}

export function parseGeneric(content: string, filename: string, language?: string): ParseResult {
  const lang = language || detectLanguage(filename) || 'unknown';

  if (lang === 'typescript' || lang === 'javascript') {
    return parseTypeScript(content, filename);
  }
  if (lang === 'python') {
    return parsePython(content, filename);
  }

  // Generic parser for other languages
  const symbols: Symbol[] = [];
  const functions: FunctionSymbol[] = [];
  const classes: ClassSymbol[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  const dependencies: string[] = [];

  // Generic function detection
  const genericFuncRegex = /(?:function|def|func|fn)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match;
  while ((match = genericFuncRegex.exec(content)) !== null) {
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'function',
      lineStart: getLineNumber(content, match.index), signature: match[0],
      isExported: true, isPublic: true });
  }

  // Generic class detection
  const genericClassRegex = /(?:class|struct|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((match = genericClassRegex.exec(content)) !== null) {
    symbols.push({ id: 0, projectId: 0, fileId: 0, name: match[1], symbolType: 'class',
      lineStart: getLineNumber(content, match.index), signature: match[0],
      isExported: true, isPublic: true });
  }

  return { symbols, functions, classes, imports, exports, dependencies };
}
