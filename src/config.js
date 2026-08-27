import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadConfig(configPath, cliOpts) {
  const defaults = {
    primary: 'gpt-4.1',
    secondary: 'claude-opus-4',
    format: 'text',
    recursive: false,
    strict: false,
    focus: [],
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  };

  let fileConfig = {};
  const tryPath = configPath || '.rubber-duck.yml';
  if (existsSync(tryPath)) {
    try {
      const raw = readFileSync(tryPath, 'utf8');
      fileConfig = parseSimpleYaml(raw);
    } catch { /* ignore parse errors */ }
  }

  return { ...defaults, ...fileConfig, ...stripUndefined(cliOpts) };
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));
}

function parseSimpleYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (m) {
      const val = m[2].trim();
      if (val.startsWith('[')) {
        try { result[m[1]] = JSON.parse(val); } catch { /* skip */ }
      } else if (val === 'true') result[m[1]] = true;
      else if (val === 'false') result[m[1]] = false;
      else result[m[1]] = val;
    }
  }
  return result;
}
