# Copilot Rubber Duck CLI

CLI tool that brings VS Code 1.135's new Rubber Duck feature to the terminal: get a second opinion from a complementary model on any code file, diff, or PR.

## Why

VS Code 1.135 (August 26, 2026) introduced Rubber Duck, an experimental feature that asks a second model to review the primary agent's work and surface missed details or edge cases. But it only works inside VS Code's Agents window.

This CLI brings the same concept everywhere: terminal, CI pipelines, pre-commit hooks, code review workflows.

## How it works

1. You point it at a file, diff, or directory
2. It sends the code to a primary model for analysis
3. It sends the same code + the primary analysis to a secondary (complementary) model
4. The secondary model acts as "rubber duck" — challenging assumptions, finding edge cases, surfacing what the first model missed
5. You get a structured report with both perspectives

## Install

```bash
npm install -g copilot-rubber-duck-cli
# or run directly
npx copilot-rubber-duck-cli review src/auth.ts
```

## Usage

```bash
# Review a single file
rubber-duck review src/server.ts

# Review a git diff
rubber-duck diff HEAD~3

# Review with specific model pair
rubber-duck review src/api.ts --primary gpt-4.1 --secondary claude-opus-4

# Review and output JSON
rubber-duck review src/main.py --format json

# Review a whole directory
rubber-duck review src/ --recursive

# Strict mode: fail CI if issues found
rubber-duck review src/ --strict --exit-code
```

## Model Pairs

The default pairing uses complementary model families for maximum coverage:

| Primary | Secondary | Why |
|---------|-----------|-----|
| GPT-4.1 | Claude Opus 4 | Different training, different blind spots |
| Claude Opus 4 | GPT-4.1 | Reverse perspective |
| GPT-5.5 | Gemini 2.5 Pro | Frontier cross-check |

## Output

```
== Rubber Duck Review: src/auth.ts ==

[Primary Analysis - GPT-4.1]
- Auth token validation looks correct
- Rate limiting properly implemented
- Session cleanup on expiry: OK

[Rubber Duck Challenge - Claude Opus 4]
! Token refresh race condition on line 47:
  concurrent requests during refresh window could both
  trigger rotation, invalidating the first token.
! Missing constant-time comparison for token validation (line 23)
  Current string equality is vulnerable to timing attacks.
+ Agree: rate limiting implementation is solid.

[Verdict]
2 issues surfaced by rubber duck review
1 agreement confirmed
```

## Configuration

Create `.rubber-duck.yml` in your project root:

```yaml
primary: gpt-4.1
secondary: claude-opus-4
ignore:
  - "**/*.test.ts"
  - "vendor/"
focus:
  - security
  - error-handling
  - concurrency
strict: false
```

## CI Integration

```yaml
# GitHub Actions
- name: Rubber Duck Review
  run: npx copilot-rubber-duck-cli diff ${{ github.event.pull_request.base.sha }} --strict --exit-code
```

## License

MIT
