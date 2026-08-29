#!/usr/bin/env node

/**
 * rubber-duck CLI
 * Automate VS Code 1.135's Rubber Duck dual-model reviews via AHP WebSocket.
 *
 * Usage:
 *   rubber-duck review <file>        Run dual-model review on a file
 *   rubber-duck compare <file>       Side-by-side primary vs secondary output
 *   rubber-duck batch <glob>         Review multiple files, aggregate report
 *   rubber-duck models               List available model pairs
 *
 * Options:
 *   --host <url>       AHP WebSocket URL (default: ws://localhost:4040)
 *   --primary <model>  Primary model (default: from AHP session)
 *   --secondary <model> Secondary "rubber duck" model
 *   --focus <area>     Focus area: bugs | perf | security | edge-cases | all
 *   --format <fmt>     Output: markdown | json | terminal (default: terminal)
 *   --diff             Show only disagreements between models
 *   -o <file>          Write report to file
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { glob } from 'node:fs';

// ── CLI parsing ──────────────────────────────────────────────────────────────

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    host:      { type: 'string', default: 'ws://localhost:4040' },
    primary:   { type: 'string' },
    secondary: { type: 'string' },
    focus:     { type: 'string', default: 'all' },
    format:    { type: 'string', default: 'terminal' },
    diff:      { type: 'boolean', default: false },
    output:    { type: 'string', short: 'o' },
    help:      { type: 'boolean', short: 'h', default: false },
  },
});

const [command, ...targets] = positionals;

if (opts.help || !command) {
  console.log(`
rubber-duck — Dual-model code review via AHP Rubber Duck (VS Code 1.135)

Commands:
  review <file>       Run dual-model review on a single file
  compare <file>      Side-by-side primary vs secondary analysis
  batch <glob>        Review multiple files, aggregate findings
  models              List available model pairs from AHP session

Options:
  --host <url>        AHP WebSocket (default: ws://localhost:4040)
  --primary <model>   Primary model override
  --secondary <model> Secondary "rubber duck" model override
  --focus <area>      bugs | perf | security | edge-cases | all
  --format <fmt>      markdown | json | terminal
  --diff              Show only disagreements
  -o <file>           Output file
`);
  process.exit(0);
}

// ── AHP WebSocket client ─────────────────────────────────────────────────────

class AHPClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.requestId = 0;
    this.pending = new Map();
  }

  async connect() {
    const { WebSocket } = await import('ws').catch(() => {
      // Fallback: simulate for demo when ws not installed
      return { WebSocket: null };
    });

    if (!WebSocket) {
      console.log('[rubber-duck] ws module not found — running in demo mode');
      this.demo = true;
      return;
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => {
        console.log(`[rubber-duck] AHP not reachable at ${this.url} — running in demo mode`);
        this.demo = true;
        resolve();
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      });
    });
  }

  async send(method, params) {
    if (this.demo) return this._demoResponse(method, params);

    const id = ++this.requestId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async listModels() {
    const resp = await this.send('session/listModels', {});
    return resp?.result?.models || DEMO_MODELS;
  }

  async rubberDuckReview(code, filename, focus, primaryModel, secondaryModel) {
    const prompt = buildReviewPrompt(code, filename, focus);

    // 1. Primary model analysis
    const primary = await this.send('chat/completions', {
      model: primaryModel,
      messages: [{ role: 'user', content: prompt }],
    });

    // 2. Secondary model via /rubber-duck command
    const secondary = await this.send('chat/completions', {
      model: secondaryModel,
      messages: [
        { role: 'user', content: prompt },
        { role: 'system', content: 'You are the Rubber Duck reviewer. Focus on what the primary reviewer might have MISSED. Look for edge cases, implicit assumptions, and subtle bugs.' },
      ],
    });

    return {
      file: filename,
      primary: extractFindings(primary),
      secondary: extractFindings(secondary),
    };
  }

  _demoResponse(method, params) {
    if (method === 'session/listModels') {
      return { result: { models: DEMO_MODELS } };
    }
    const model = params?.model || 'demo';
    return {
      result: {
        choices: [{
          message: {
            content: generateDemoReview(params?.messages?.[0]?.content, model),
          },
        }],
      },
    };
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ── Review prompt builder ────────────────────────────────────────────────────

function buildReviewPrompt(code, filename, focus) {
  const focusMap = {
    bugs:         'Focus on logical bugs, off-by-one errors, null/undefined risks, and incorrect control flow.',
    perf:         'Focus on performance: unnecessary allocations, O(n^2) loops, missing caching, redundant work.',
    security:     'Focus on security: injection, path traversal, prototype pollution, secrets in code, unsafe deserialization.',
    'edge-cases': 'Focus on edge cases: empty inputs, concurrent access, integer overflow, Unicode, timezone issues.',
    all:          'Cover bugs, performance, security, and edge cases.',
  };

  return `Review this code file. ${focusMap[focus] || focusMap.all}

File: ${filename}
\`\`\`
${code}
\`\`\`

For each finding, output:
- Line number (approximate)
- Severity: critical | warning | info
- Category: bug | perf | security | edge-case
- Description (one sentence)
- Suggested fix (one sentence)

End with a summary: overall quality score 1-10 and top 3 priorities.`;
}

// ── Finding extraction ───────────────────────────────────────────────────────

function extractFindings(response) {
  const content = response?.result?.choices?.[0]?.message?.content || '';
  return {
    raw: content,
    findings: parseFindings(content),
  };
}

function parseFindings(text) {
  const findings = [];
  const lines = text.split('\n');
  let current = null;

  for (const line of lines) {
    const lineMatch = line.match(/(?:line|L)\s*(\d+)/i);
    const sevMatch = line.match(/\b(critical|warning|info)\b/i);
    const catMatch = line.match(/\b(bug|perf|security|edge-case)\b/i);

    if (lineMatch && sevMatch) {
      if (current) findings.push(current);
      current = {
        line: parseInt(lineMatch[1]),
        severity: sevMatch[1].toLowerCase(),
        category: catMatch?.[1]?.toLowerCase() || 'bug',
        description: line.replace(/^[-*•]\s*/, '').trim(),
      };
    } else if (current && line.trim().startsWith('Suggested') || line.trim().startsWith('Fix:')) {
      current.fix = line.replace(/^[-*•]\s*(?:Suggested fix:|Fix:)\s*/i, '').trim();
    }
  }
  if (current) findings.push(current);
  return findings;
}

// ── Comparison / diff ────────────────────────────────────────────────────────

function compareResults(primary, secondary) {
  const pLines = new Set(primary.findings.map(f => f.line));
  const sLines = new Set(secondary.findings.map(f => f.line));

  const agreed = primary.findings.filter(f => sLines.has(f.line));
  const primaryOnly = primary.findings.filter(f => !sLines.has(f.line));
  const secondaryOnly = secondary.findings.filter(f => !pLines.has(f.line));

  return { agreed, primaryOnly, secondaryOnly };
}

// ── Output formatters ────────────────────────────────────────────────────────

function formatTerminal(result, diffOnly) {
  const { primary, secondary, file } = result;
  const comp = compareResults(primary, secondary);
  let out = '';

  out += `\n${'═'.repeat(60)}\n`;
  out += `  RUBBER DUCK REVIEW: ${file}\n`;
  out += `${'═'.repeat(60)}\n\n`;

  if (!diffOnly) {
    out += `── Primary Model ──────────────────────────\n`;
    out += primary.raw + '\n\n';
    out += `── Secondary Model (Rubber Duck) ──────────\n`;
    out += secondary.raw + '\n\n';
  }

  out += `── Comparison ────────────────────────────\n`;
  out += `  Both agreed on:     ${comp.agreed.length} finding(s)\n`;
  out += `  Primary only:       ${comp.primaryOnly.length} finding(s)\n`;
  out += `  Rubber Duck caught: ${comp.secondaryOnly.length} finding(s)\n\n`;

  if (comp.secondaryOnly.length > 0) {
    out += `── Rubber Duck Exclusive Findings ─────────\n`;
    for (const f of comp.secondaryOnly) {
      const sev = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
      out += `  ${sev} L${f.line} [${f.category}] ${f.description}\n`;
      if (f.fix) out += `     Fix: ${f.fix}\n`;
    }
  }

  return out;
}

function formatMarkdown(result) {
  const { primary, secondary, file } = result;
  const comp = compareResults(primary, secondary);

  let md = `# Rubber Duck Review: ${file}\n\n`;
  md += `## Primary Model\n\n${primary.raw}\n\n`;
  md += `## Secondary Model (Rubber Duck)\n\n${secondary.raw}\n\n`;
  md += `## Comparison\n\n`;
  md += `| Metric | Count |\n|--------|-------|\n`;
  md += `| Both agreed | ${comp.agreed.length} |\n`;
  md += `| Primary only | ${comp.primaryOnly.length} |\n`;
  md += `| Rubber Duck exclusive | ${comp.secondaryOnly.length} |\n`;
  return md;
}

function formatJSON(result) {
  const comp = compareResults(result.primary, result.secondary);
  return JSON.stringify({
    file: result.file,
    primary: result.primary.findings,
    secondary: result.secondary.findings,
    comparison: comp,
  }, null, 2);
}

// ── Demo data ────────────────────────────────────────────────────────────────

const DEMO_MODELS = [
  { id: 'gpt-5.5', name: 'GPT-5.5', role: 'primary' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', role: 'secondary' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', role: 'secondary' },
];

function generateDemoReview(prompt, model) {
  const isPrimary = !model.includes('secondary') && !model.includes('duck');
  if (isPrimary) {
    return `## Code Review (Primary)

- Line 12 — Severity: warning — Category: bug
  Description: Return value unchecked after async call.
  Suggested fix: Add null check or try/catch around the await.

- Line 34 — Severity: info — Category: perf
  Description: Array rebuilt on every render cycle.
  Suggested fix: Memoize with useMemo or move outside component.

Summary: Quality 7/10. Priorities: (1) error handling, (2) memoization, (3) type annotations.`;
  }

  return `## Code Review (Rubber Duck)

- Line 12 — Severity: critical — Category: security
  Description: User input flows into SQL query without parameterization.
  Suggested fix: Use parameterized queries or an ORM.

- Line 27 — Severity: warning — Category: edge-case
  Description: Empty array case not handled — reduce() will throw.
  Suggested fix: Add guard clause or provide initial value to reduce.

- Line 45 — Severity: info — Category: bug
  Description: Timezone assumed UTC but locale-dependent Date used.
  Suggested fix: Explicitly use UTC methods or a library like date-fns/utc.

Summary: Quality 6/10. Priorities: (1) SQL injection risk, (2) empty input crash, (3) timezone assumptions.`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new AHPClient(opts.host);
  await client.connect();

  try {
    switch (command) {
      case 'models': {
        const models = await client.listModels();
        console.log('\nAvailable models for Rubber Duck pairing:\n');
        for (const m of models) {
          const role = m.role === 'primary' ? '  [PRIMARY]  ' : '  [SECONDARY]';
          console.log(`${role} ${m.id} — ${m.name}`);
        }
        break;
      }

      case 'review':
      case 'compare': {
        const file = targets[0];
        if (!file) { console.error('Usage: rubber-duck review <file>'); process.exit(1); }
        const filepath = resolve(file);
        if (!existsSync(filepath)) { console.error(`File not found: ${filepath}`); process.exit(1); }

        const code = readFileSync(filepath, 'utf-8');
        const filename = basename(filepath);

        const models = await client.listModels();
        const primaryModel = opts.primary || models.find(m => m.role === 'primary')?.id || 'gpt-5.5';
        const secondaryModel = opts.secondary || models.find(m => m.role === 'secondary')?.id || 'claude-opus-4.6';

        console.log(`\n[rubber-duck] Primary: ${primaryModel} | Secondary: ${secondaryModel}`);
        console.log(`[rubber-duck] Focus: ${opts.focus} | File: ${filename}\n`);

        const result = await client.rubberDuckReview(code, filename, opts.focus, primaryModel, secondaryModel);

        let output;
        switch (opts.format) {
          case 'json':     output = formatJSON(result); break;
          case 'markdown': output = formatMarkdown(result); break;
          default:         output = formatTerminal(result, opts.diff); break;
        }

        console.log(output);
        if (opts.output) {
          writeFileSync(opts.output, output);
          console.log(`\n[rubber-duck] Report saved to ${opts.output}`);
        }
        break;
      }

      case 'batch': {
        const pattern = targets[0];
        if (!pattern) { console.error('Usage: rubber-duck batch <glob>'); process.exit(1); }

        // Simple glob expansion
        const { execSync } = await import('node:child_process');
        const files = execSync(`ls ${pattern} 2>/dev/null || true`).toString().trim().split('\n').filter(Boolean);

        if (files.length === 0) { console.log('No files matched.'); break; }

        console.log(`\n[rubber-duck] Batch review: ${files.length} file(s)\n`);

        const models = await client.listModels();
        const primaryModel = opts.primary || models.find(m => m.role === 'primary')?.id || 'gpt-5.5';
        const secondaryModel = opts.secondary || models.find(m => m.role === 'secondary')?.id || 'claude-opus-4.6';

        const allResults = [];
        for (const file of files) {
          const code = readFileSync(file, 'utf-8');
          const result = await client.rubberDuckReview(code, basename(file), opts.focus, primaryModel, secondaryModel);
          allResults.push(result);
          const comp = compareResults(result.primary, result.secondary);
          console.log(`  ${basename(file)}: ${comp.secondaryOnly.length} exclusive duck findings`);
        }

        const totalDuckFindings = allResults.reduce((sum, r) => {
          return sum + compareResults(r.primary, r.secondary).secondaryOnly.length;
        }, 0);

        console.log(`\n[rubber-duck] Total exclusive Rubber Duck findings: ${totalDuckFindings}`);
        break;
      }

      default:
        console.error(`Unknown command: ${command}. Use --help.`);
        process.exit(1);
    }
  } finally {
    client.close();
  }
}

main().catch(console.error);
