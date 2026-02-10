// Minimal YAML parser/stringifier for this project.
// This is intentionally small so Pages Functions can bundle without npm deps.
//
// Supported subset:
// - key: value
// - nested objects via indentation
// - arrays with "- " items (scalars or objects)
// - scalars: string, number, boolean, null
//
// Not supported: multiline strings, anchors, complex quoting rules.

function parseScalar(raw) {
  if (raw === "" || raw == null) return "";
  const s = String(raw).trim();
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  // quoted strings (single or double)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  // numbers
  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }
  return s;
}

function indentOf(line) {
  const m = /^\s*/.exec(line);
  return m ? m[0].length : 0;
}

function stripInlineComment(line) {
  // Very small heuristic: treat " #" as comment start (won't handle URLs etc.)
  const idx = line.indexOf(" #");
  if (idx === -1) return line;
  return line.slice(0, idx);
}

export function parseYAML(input) {
  const lines = String(input)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => stripInlineComment(l))
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));

  const root = {};
  const stack = [{ indent: -1, value: root, type: "object" }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentOf(line);
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    if (trimmed.startsWith("- ")) {
      // array item
      if (parent.type !== "array") {
        throw new Error(`YAML parse error: '-' item without array parent at line ${i + 1}`);
      }
      const rest = trimmed.slice(2);
      // object item inline "- key: value"
      const mObj = /^([^:]+):\s*(.*)$/.exec(rest);
      if (mObj) {
        const obj = {};
        obj[mObj[1].trim()] = parseScalar(mObj[2]);
        parent.value.push(obj);
        // If following lines are more-indented, they belong to this object.
        stack.push({ indent, value: obj, type: "object" });
      } else {
        parent.value.push(parseScalar(rest));
      }
      continue;
    }

    const m = /^([^:]+):\s*(.*)$/.exec(trimmed);
    if (!m) {
      throw new Error(`YAML parse error: expected 'key: value' at line ${i + 1}`);
    }

    const key = m[1].trim();
    const rest = m[2];

    if (rest === "") {
      // container starts (object or array) depending on next meaningful line
      const next = lines[i + 1];
      const nextTrim = next ? next.trim() : "";
      const isArray = nextTrim.startsWith("-");
      const container = isArray ? [] : {};
      parent.value[key] = container;
      stack.push({ indent, value: container, type: isArray ? "array" : "object" });
    } else {
      parent.value[key] = parseScalar(rest);
    }
  }

  return root;
}

function formatScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  // Quote strings that could be mis-read.
  if (s === "" || /[:#\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export function stringifyYAML(obj, indent = 0) {
  const pad = " ".repeat(indent);

  if (Array.isArray(obj)) {
    return obj
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const keys = Object.keys(item);
          if (keys.length === 0) return `${pad}- {}`;
          // Prefer "- key: value" for first key, then indent rest
          const first = keys[0];
          const firstVal = item[first];
          const head = `${pad}- ${first}: ${formatScalar(firstVal)}`;
          const tailKeys = keys.slice(1);
          if (tailKeys.length === 0) return head;
          const tail = tailKeys
            .map((k) => `${pad}  ${k}: ${formatScalar(item[k])}`)
            .join("\n");
          return `${head}\n${tail}`;
        }
        return `${pad}- ${formatScalar(item)}`;
      })
      .join("\n");
  }

  if (obj && typeof obj === "object") {
    return Object.keys(obj)
      .map((k) => {
        const v = obj[k];
        if (Array.isArray(v)) {
          const body = stringifyYAML(v, indent + 2);
          return `${pad}${k}:\n${body}`;
        }
        if (v && typeof v === "object") {
          const body = stringifyYAML(v, indent + 2);
          return `${pad}${k}:\n${body}`;
        }
        return `${pad}${k}: ${formatScalar(v)}`;
      })
      .join("\n");
  }

  return `${pad}${formatScalar(obj)}`;
}


// Compatibility aliases (older handlers import these names)
export function parseYaml(input) {
  return parseYAML(input);
}
export function stringifyYaml(obj, indent=0) {
  return stringifyYAML(obj, indent);
}
