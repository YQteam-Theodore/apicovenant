/**
 * A focused YAML 1.2 subset parser.
 *
 * `apicovenant` ships with **zero runtime dependencies**, so instead of pulling
 * in a YAML library we implement the subset that OpenAPI documents actually
 * use:
 *
 *   - block mappings and block sequences (including `- key: value` items)
 *   - flow collections (`[a, b]`, `{a: 1}`)
 *   - single/double quoted scalars, plain scalars, and type resolution
 *   - literal (`|`) and folded (`>`) block scalars with chomping indicators
 *   - comments, document markers, anchors (`&a`) and aliases (`*a`)
 *   - multi-line plain scalars
 *
 * Anything outside the subset raises a {@link YamlError} that points at the
 * offending line, so users get a precise diagnosis instead of a silent
 * mis-parse.
 */

export class YamlError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column = 0) {
    super(`${message} (line ${line}${column ? `, column ${column}` : ''})`);
    this.name = 'YamlError';
    this.line = line;
    this.column = column;
  }
}

interface SourceLine {
  /** Number of leading spaces. */
  indent: number;
  /** Comment stripped content with trailing whitespace removed. */
  text: string;
  /** Original line, needed verbatim for block scalars. */
  raw: string;
  /** 1-based line number. */
  num: number;
  /** True for blank lines and comment-only lines. */
  blank: boolean;
}

const TRUE_VALUES = new Set(['true', 'True', 'TRUE']);
const FALSE_VALUES = new Set(['false', 'False', 'FALSE']);
const NULL_VALUES = new Set(['null', 'Null', 'NULL', '~', '']);

export function parseYaml(text: string): unknown {
  return new YamlParser(text).parseDocument();
}

class YamlParser {
  private readonly lines: SourceLine[];
  private index = 0;
  private readonly anchors = new Map<string, unknown>();

  constructor(source: string) {
    this.lines = source
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((raw, i) => {
        const indent = raw.length - raw.trimStart().length;
        const stripped = stripComment(raw);
        // `text` is the line content with the indentation removed; `raw` keeps
        // the original bytes so block scalars can be reproduced verbatim.
        const text = stripped.slice(indent).replace(/\s+$/, '');
        const blank = text.trim() === '';
        return { indent, text: blank ? '' : text, raw, num: i + 1, blank };
      });
  }

  parseDocument(): unknown {
    this.skipIgnorable();
    const first = this.lines[this.index];
    if (first && first.text === '---') {
      this.index += 1;
      this.skipIgnorable();
    }
    if (!this.lines[this.index]) return null;

    const value = this.parseNode(0);
    return value === undefined ? null : value;
  }

  // ---------------------------------------------------------------- helpers

  private skipIgnorable(): void {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!line) break;
      if (line.blank) {
        this.index += 1;
        continue;
      }
      if (line.text === '---' || line.text === '...') {
        this.index += 1;
        continue;
      }
      break;
    }
  }

  private peek(): SourceLine | undefined {
    this.skipIgnorable();
    return this.lines[this.index];
  }

  // ------------------------------------------------------------------ nodes

  private parseNode(minIndent: number): unknown {
    const line = this.peek();
    if (!line) return null;
    if (line.text === '---' || line.text === '...') return null;
    if (isSequenceEntry(line.text)) return this.parseSequence(line.indent);
    if (findKeySeparator(line.text) === -1) {
      // A bare scalar document (rare but legal).
      this.index += 1;
      return this.parseInlineValue(line.text, line.indent, line);
    }
    return this.parseMapping(line.indent);
  }

  private parseMapping(indent: number): Record<string, unknown> {
    const map: Record<string, unknown> = {};

    for (;;) {
      const line = this.peek();
      if (!line) break;
      if (line.text === '---' || line.text === '...') break;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new YamlError('Unexpected indentation', line.num, line.indent + 1);
      }
      if (isSequenceEntry(line.text)) break;

      const sep = findKeySeparator(line.text);
      if (sep === -1) {
        throw new YamlError(`Expected "key: value" but found "${line.text}"`, line.num, 1);
      }

      const key = parseKey(line.text.slice(0, sep), line.num);
      const rest = line.text.slice(sep + 1).trim();
      this.index += 1;
      map[key] = this.parseValueAfterKey(rest, indent, line);
    }

    return map;
  }

  private parseSequence(indent: number): unknown[] {
    const items: unknown[] = [];

    for (;;) {
      const line = this.peek();
      if (!line) break;
      if (line.text === '---' || line.text === '...') break;
      if (line.indent !== indent) break;
      if (!isSequenceEntry(line.text)) break;

      const dashIndex = line.raw.indexOf('-', line.indent);
      const afterDash = line.raw.slice(dashIndex + 1);
      const leading = afterDash.length - afterDash.trimStart().length;
      const contentIndent = indent + 1 + leading;
      const content = line.text.slice(1).trim();

      if (content === '') {
        this.index += 1;
        items.push(this.parseChildBlock(indent));
        continue;
      }

      if (findKeySeparator(content) !== -1) {
        // `- key: value` — re-enter the line as a mapping that starts at the
        // column of the first character after the dash.
        this.lines[this.index] = { ...line, indent: contentIndent, text: content };
        items.push(this.parseMapping(contentIndent));
        continue;
      }

      this.index += 1;
      items.push(this.parseInlineValue(content, contentIndent, line));
    }

    return items;
  }

  /** Parse the block that belongs to a key whose value was empty. */
  private parseChildBlock(parentIndent: number): unknown {
    const next = this.peek();
    if (!next) return null;
    if (next.indent > parentIndent) return this.parseNode(next.indent);
    // A sequence may legally sit at the same indentation as its parent key.
    if (next.indent === parentIndent && isSequenceEntry(next.text)) {
      return this.parseSequence(next.indent);
    }
    return null;
  }

  private parseValueAfterKey(rest: string, parentIndent: number, line: SourceLine): unknown {
    let value = rest;
    let anchorName: string | undefined;

    if (value.startsWith('&')) {
      const match = /^&([^\s]+)\s*/.exec(value);
      if (!match) throw new YamlError('Invalid anchor', line.num, line.indent + 1);
      anchorName = match[1];
      value = value.slice(match[0].length).trim();
    }

    let parsed: unknown;
    if (value === '') {
      parsed = this.parseChildBlock(parentIndent);
    } else if (value.startsWith('|') || value.startsWith('>')) {
      parsed = this.parseBlockScalar(value, parentIndent, line);
    } else {
      parsed = this.parseInlineValue(value, parentIndent, line);
    }

    if (anchorName) this.anchors.set(anchorName, parsed);
    return parsed;
  }

  // ----------------------------------------------------------------- values

  private parseInlineValue(text: string, indent: number, line: SourceLine): unknown {
    const value = text.trim();

    if (value.startsWith('*')) {
      const name = value.slice(1).trim();
      if (!this.anchors.has(name)) {
        throw new YamlError(`Unknown alias "*${name}"`, line.num, line.indent + 1);
      }
      return this.anchors.get(name);
    }

    if (value.startsWith('&')) {
      const match = /^&([^\s]+)\s*/.exec(value);
      if (!match) throw new YamlError('Invalid anchor', line.num, line.indent + 1);
      const name = match[1];
      const inner = value.slice(match[0].length).trim();
      const parsed = this.parseInlineValue(inner, indent, line);
      this.anchors.set(name, parsed);
      return parsed;
    }

    if (value.startsWith('[') || value.startsWith('{')) {
      return parseFlow(value, line.num);
    }

    if (value.startsWith('"') || value.startsWith("'")) {
      const quoted = parseQuoted(value, line.num);
      return quoted.value;
    }

    // Plain scalar, possibly continued on following more-indented lines.
    const parts = [value];
    for (;;) {
      const next = this.lines[this.index];
      if (!next || next.blank) break;
      if (next.indent <= indent) break;
      if (next.text === '---' || next.text === '...') break;
      if (isSequenceEntry(next.text)) break;
      if (findKeySeparator(next.text) !== -1) break;
      parts.push(next.text.trim());
      this.index += 1;
    }

    return resolveScalar(parts.join(' '));
  }

  private parseBlockScalar(header: string, parentIndent: number, line: SourceLine): string {
    const style = header[0] as '|' | '>';
    const modifiers = header.slice(1).trim();
    const chomp = /[-+]/.test(modifiers) ? (modifiers.includes('-') ? 'strip' : 'keep') : 'clip';

    const collected: string[] = [];
    let blockIndent = -1;

    while (this.index < this.lines.length) {
      const current = this.lines[this.index];
      if (current === undefined) break;
      const isEmpty = current.raw.trim() === '';
      if (!isEmpty && current.indent <= parentIndent) break;
      if (!isEmpty && blockIndent === -1) blockIndent = current.indent;
      collected.push(isEmpty ? '' : current.raw.slice(Math.min(blockIndent, current.indent)));
      this.index += 1;
    }

    while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

    let body: string;
    if (style === '|') {
      body = collected.join('\n');
    } else {
      // Folded: single newlines become spaces, blank lines stay as newlines,
      // and more-indented lines keep their line breaks.
      const parts: string[] = [];
      for (let i = 0; i < collected.length; i += 1) {
        const current = collected[i] as string;
        if (i === 0) {
          parts.push(current);
          continue;
        }
        const previous = collected[i - 1] as string;
        if (current === '') {
          parts.push('\n');
          continue;
        }
        if (previous === '') {
          parts.push(current);
          continue;
        }
        if (/^\s/.test(current) || /^\s/.test(previous)) {
          parts.push('\n', current);
          continue;
        }
        parts.push(' ', current);
      }
      body = parts.join('');
    }

    if (chomp === 'strip') return body;
    if (chomp === 'keep') return `${body}\n`;
    return body === '' ? '' : `${body}\n`;
  }
}

// --------------------------------------------------------------- utilities

function isSequenceEntry(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

/**
 * Locate the `:` that separates a mapping key from its value.
 *
 * The colon must be outside quotes and flow collections and must be followed by
 * a space or the end of the line, otherwise it is part of a plain scalar.
 */
export function findKeySeparator(text: string): number {
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;

    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ']' || ch === '}') {
      depth -= 1;
      continue;
    }
    if (ch === ':' && depth === 0) {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') return i;
    }
  }

  return -1;
}

function parseKey(raw: string, lineNum: number): string {
  const key = raw.trim();
  if (key.startsWith('"') || key.startsWith("'")) {
    return parseQuoted(key, lineNum).value;
  }
  return key;
}

function parseQuoted(text: string, lineNum: number): { value: string; length: number } {
  const quote = text[0];
  let out = '';
  let i = 1;

  while (i < text.length) {
    const ch = text[i] as string;

    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, length: i + 1 };
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '\\') {
      const next = text[i + 1];
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '0':
          out += '\0';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'u': {
          const hex = text.slice(i + 2, i + 6);
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) throw new YamlError('Invalid unicode escape', lineNum);
          out += String.fromCharCode(code);
          i += 4;
          break;
        }
        default:
          out += next ?? '';
          break;
      }
      i += 2;
      continue;
    }

    if (ch === '"') return { value: out, length: i + 1 };
    out += ch;
    i += 1;
  }

  throw new YamlError('Unterminated quoted string', lineNum);
}

/** Resolve a plain (unquoted) scalar to its YAML 1.2 core-schema type. */
export function resolveScalar(raw: string): unknown {
  const text = raw.trim();
  if (NULL_VALUES.has(text)) return null;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  if (/^[-+]?\d+$/.test(text)) {
    const asNumber = Number(text);
    if (Number.isSafeInteger(asNumber)) return asNumber;
  }
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(text)) {
    const asNumber = Number(text);
    if (!Number.isNaN(asNumber)) return asNumber;
  }
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text, 16);
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  return text;
}

/** Strip a trailing `#` comment while respecting quotes. */
function stripComment(raw: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] as string;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && raw[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** Parse a flow collection such as `[a, b]` or `{a: 1, b: 2}`. */
function parseFlow(text: string, lineNum: number): unknown {
  let pos = 0;

  const skipWs = (): void => {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos += 1;
  };

  const parseValue = (): unknown => {
    skipWs();
    const ch = text[pos];
    if (ch === undefined) throw new YamlError('Unexpected end of flow collection', lineNum);
    if (ch === '[') return parseSeq();
    if (ch === '{') return parseMap();
    if (ch === '"' || ch === "'") {
      const { value, length } = parseQuoted(text.slice(pos), lineNum);
      pos += length;
      return value;
    }
    // Plain scalar until , ] }
    const start = pos;
    while (pos < text.length && !',]}\n'.includes(text[pos] as string)) pos += 1;
    return resolveScalar(text.slice(start, pos));
  };

  const parseSeq = (): unknown[] => {
    pos += 1; // consume [
    const items: unknown[] = [];
    for (;;) {
      skipWs();
      if (text[pos] === ']') {
        pos += 1;
        return items;
      }
      if (pos >= text.length) throw new YamlError('Unterminated flow sequence', lineNum);
      items.push(parseValue());
      skipWs();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      if (text[pos] === ']') {
        pos += 1;
        return items;
      }
      throw new YamlError('Expected "," or "]" in flow sequence', lineNum);
    }
  };

  const parseMap = (): Record<string, unknown> => {
    pos += 1; // consume {
    const map: Record<string, unknown> = {};
    for (;;) {
      skipWs();
      if (text[pos] === '}') {
        pos += 1;
        return map;
      }
      if (pos >= text.length) throw new YamlError('Unterminated flow mapping', lineNum);

      let key: string;
      if (text[pos] === '"' || text[pos] === "'") {
        const { value, length } = parseQuoted(text.slice(pos), lineNum);
        pos += length;
        key = value;
      } else {
        const start = pos;
        while (pos < text.length && text[pos] !== ':' && text[pos] !== ',' && text[pos] !== '}') pos += 1;
        key = text.slice(start, pos).trim();
      }

      skipWs();
      if (text[pos] !== ':') throw new YamlError('Expected ":" in flow mapping', lineNum);
      pos += 1;
      map[key] = parseValue();

      skipWs();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      if (text[pos] === '}') {
        pos += 1;
        return map;
      }
      throw new YamlError('Expected "," or "}" in flow mapping', lineNum);
    }
  };

  const result = parseValue();
  skipWs();
  return result;
}
