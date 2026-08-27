import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { analyzeWithPrimary, challengeWithSecondary } from './models.js';

const CODE_EXTS = new Set([
  '.js','.ts','.jsx','.tsx','.py','.go','.rs','.java','.cs','.rb',
  '.c','.cpp','.h','.hpp','.swift','.kt','.scala','.php','.sh','.yml','.yaml',
]);

export async function review(target, config) {
  const stat = statSync(target);
  const files = stat.isDirectory()
    ? collectFiles(target, config.recursive)
    : [target];

  const contents = files.map(f => ({
    path: relative(process.cwd(), f),
    content: readFileSync(f, 'utf8'),
  }));

  const codeBlock = contents
    .map(f => `// --- ${f.path} ---\n${f.content}`)
    .join('\n\n');

  const primaryResult = await analyzeWithPrimary(codeBlock, config);
  const secondaryResult = await challengeWithSecondary(
    codeBlock, primaryResult, config
  );

  return {
    target: stat.isDirectory() ? target : relative(process.cwd(), target),
    primary: primaryResult,
    secondary: secondaryResult,
    issues: secondaryResult.challenges.length,
    agreements: secondaryResult.agreements.length,
  };
}

function collectFiles(dir, recursive) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.isFile() && CODE_EXTS.has(extname(entry.name))) {
      results.push(full);
    } else if (entry.isDirectory() && recursive) {
      results.push(...collectFiles(full, true));
    }
  }
  return results;
}
