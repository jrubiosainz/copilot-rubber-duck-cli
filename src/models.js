/**
 * Model interaction layer.
 * Uses environment-provided API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)
 * or falls back to GitHub Copilot CLI auth when available.
 *
 * For this PoC, we simulate the two-pass analysis to demonstrate
 * the review structure. In production, replace with real API calls.
 */

const PRIMARY_SYSTEM = `You are a senior code reviewer. Analyze the provided code thoroughly.
Return your findings as a JSON object:
{
  "model": "<your model name>",
  "findings": ["finding 1", "finding 2", ...]
}
Focus areas (if any): {focus}
Be specific. Reference line numbers when possible.`;

const SECONDARY_SYSTEM = `You are a "rubber duck" code reviewer. You receive code AND a primary
review from another model. Your job is to:
1. Challenge the primary review — find what it MISSED
2. Look for edge cases, security issues, concurrency bugs, error handling gaps
3. Confirm points you agree with

Return JSON:
{
  "model": "<your model name>",
  "challenges": ["issue the primary missed 1", ...],
  "agreements": ["point you agree with 1", ...]
}
Be adversarial but fair. Surface real issues, not nitpicks.`;

export async function analyzeWithPrimary(code, config) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN;

  if (apiKey && process.env.OPENAI_API_KEY) {
    return callOpenAI(apiKey, config.primary, PRIMARY_SYSTEM, code, config.focus);
  }

  // Demo mode: structured static analysis
  return demoAnalysis(code, config.primary, config.focus);
}

export async function challengeWithSecondary(code, primaryResult, config) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  if (apiKey && process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(apiKey, config.secondary, SECONDARY_SYSTEM, code, primaryResult);
  }

  // Demo mode
  return demoChallenge(code, primaryResult, config.secondary);
}

async function callOpenAI(apiKey, model, system, code, focus) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system.replace('{focus}', focus.join(', ') || 'general') },
        { role: 'user', content: code },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });
  const data = await resp.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { model, findings: [data.choices?.[0]?.message?.content || 'Parse error'] };
  }
}

async function callAnthropic(apiKey, model, system, code, primaryResult) {
  const prompt = `CODE:\n${code}\n\nPRIMARY REVIEW:\n${JSON.stringify(primaryResult, null, 2)}`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
    }),
  });
  const data = await resp.json();
  try {
    return JSON.parse(data.content[0].text);
  } catch {
    return { model, challenges: [data.content?.[0]?.text || 'Parse error'], agreements: [] };
  }
}

// --- Demo mode (no API keys) ---

function demoAnalysis(code, model, focus) {
  const findings = [];
  const lines = code.split('\n');

  // Pattern-based checks
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    if (line.includes('eval('))
      findings.push(`Line ${ln}: eval() usage — potential code injection risk`);
    if (line.match(/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/))
      findings.push(`Line ${ln}: Empty catch block swallows errors silently`);
    if (line.match(/password|secret|api.?key/i) && line.includes('=') && !line.includes('process.env'))
      findings.push(`Line ${ln}: Possible hardcoded secret`);
    if (line.includes('TODO') || line.includes('FIXME'))
      findings.push(`Line ${ln}: Unresolved ${line.includes('TODO') ? 'TODO' : 'FIXME'}`);
    if (line.match(/==\s/) && !line.match(/===\s/) && !line.includes('/*'))
      findings.push(`Line ${ln}: Loose equality (==) — consider strict (===)`);
  }

  if (findings.length === 0) {
    findings.push('No obvious issues found in static scan');
  }

  return { model, findings };
}

function demoChallenge(code, primaryResult, model) {
  const challenges = [];
  const agreements = [];
  const lines = code.split('\n');

  // Look for things the primary might miss
  const hasAsync = code.includes('async ') || code.includes('Promise');
  const hasTryCatch = code.includes('try {') || code.includes('try{');

  if (hasAsync && !hasTryCatch)
    challenges.push('Async code without try/catch — unhandled promise rejections possible');
  if (code.includes('.innerHTML'))
    challenges.push('innerHTML usage without sanitization — XSS vector');
  if (code.match(/setTimeout|setInterval/) && !code.includes('clearTimeout') && !code.includes('clearInterval'))
    challenges.push('Timer set without cleanup — potential memory leak');
  if (code.includes('JSON.parse') && !code.match(/try.*JSON\.parse/s))
    challenges.push('JSON.parse without try/catch — will throw on malformed input');
  if (code.match(/fs\.(readFile|writeFile|unlink)/) && !code.includes('path.resolve'))
    challenges.push('File operations without path normalization — path traversal risk');

  // Agree with some primary findings
  for (const f of primaryResult.findings) {
    if (f.includes('eval(') || f.includes('secret') || f.includes('hardcoded'))
      agreements.push(f);
  }

  if (challenges.length === 0)
    challenges.push('No additional issues found beyond primary analysis');

  return { model, challenges, agreements };
}
