#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { review } from './review.js';
import { diffReview } from './diff.js';
import { loadConfig } from './config.js';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
  Rubber Duck CLI — Second opinion on your code

  Usage:
    rubber-duck review <file|dir>  [options]
    rubber-duck diff   <base-ref>  [options]

  Options:
    --primary   <model>    Primary model (default: gpt-4.1)
    --secondary <model>    Rubber duck model (default: claude-opus-4)
    --format    <fmt>      Output format: text|json|markdown (default: text)
    --recursive            Review directory recursively
    --strict               Fail with exit code 1 if issues found
    --exit-code            Alias for --strict
    --focus     <areas>    Comma-separated focus areas
    --config    <path>     Path to .rubber-duck.yml
    -h, --help             Show this help
  `);
  process.exit(0);
}

const opts = {
  primary:   findFlag(args, '--primary')   || 'gpt-4.1',
  secondary: findFlag(args, '--secondary') || 'claude-opus-4',
  format:    findFlag(args, '--format')    || 'text',
  recursive: args.includes('--recursive'),
  strict:    args.includes('--strict') || args.includes('--exit-code'),
  focus:     (findFlag(args, '--focus') || '').split(',').filter(Boolean),
  configPath: findFlag(args, '--config'),
};

const target = args[1];

if (!target) {
  console.error('Error: missing target. Run rubber-duck --help');
  process.exit(1);
}

const config = loadConfig(opts.configPath, opts);

if (command === 'review') {
  const result = await review(resolve(target), config);
  render(result, config.format);
  if (config.strict && result.issues > 0) process.exit(1);
} else if (command === 'diff') {
  const result = await diffReview(target, config);
  render(result, config.format);
  if (config.strict && result.issues > 0) process.exit(1);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

function render(result, format) {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === 'markdown') {
    console.log(formatMarkdown(result));
  } else {
    console.log(formatText(result));
  }
}

function formatText(r) {
  const lines = [`\n== Rubber Duck Review: ${r.target} ==\n`];
  lines.push(`[Primary Analysis — ${r.primary.model}]`);
  for (const f of r.primary.findings) lines.push(`  - ${f}`);
  lines.push('');
  lines.push(`[Rubber Duck Challenge — ${r.secondary.model}]`);
  for (const f of r.secondary.challenges) lines.push(`  ! ${f}`);
  for (const a of r.secondary.agreements) lines.push(`  + ${a}`);
  lines.push('');
  lines.push(`[Verdict]`);
  lines.push(`  ${r.issues} issue(s) surfaced by rubber duck`);
  lines.push(`  ${r.agreements} agreement(s) confirmed\n`);
  return lines.join('\n');
}

function formatMarkdown(r) {
  const lines = [`## Rubber Duck Review: ${r.target}\n`];
  lines.push(`### Primary Analysis (${r.primary.model})\n`);
  for (const f of r.primary.findings) lines.push(`- ${f}`);
  lines.push(`\n### Rubber Duck Challenge (${r.secondary.model})\n`);
  for (const f of r.secondary.challenges) lines.push(`- **Issue:** ${f}`);
  for (const a of r.secondary.agreements) lines.push(`- *Agree:* ${a}`);
  lines.push(`\n### Verdict\n`);
  lines.push(`- **${r.issues}** issue(s) surfaced`);
  lines.push(`- **${r.agreements}** agreement(s)\n`);
  return lines.join('\n');
}

function findFlag(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
