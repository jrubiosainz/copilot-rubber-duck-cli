import { execSync } from 'node:child_process';
import { analyzeWithPrimary, challengeWithSecondary } from './models.js';

export async function diffReview(baseRef, config) {
  let diff;
  try {
    diff = execSync(`git diff ${baseRef}`, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch (e) {
    console.error(`Failed to get diff from ref "${baseRef}": ${e.message}`);
    process.exit(1);
  }

  if (!diff.trim()) {
    console.log('No changes found.');
    process.exit(0);
  }

  const primaryResult = await analyzeWithPrimary(diff, config);
  const secondaryResult = await challengeWithSecondary(
    diff, primaryResult, config
  );

  return {
    target: `diff ${baseRef}`,
    primary: primaryResult,
    secondary: secondaryResult,
    issues: secondaryResult.challenges.length,
    agreements: secondaryResult.agreements.length,
  };
}
