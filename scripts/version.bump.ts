#!/usr/bin/env npx tsx
/**
 * Release-prep script. Bumps the package version and commits.
 *
 * Usage:
 *   npm run version.bump patch "fix broken dispatch edge case"  # v0.1.1
 *   npm run version.bump minor "add onboard command"            # v0.2.0
 *   npm run version.bump major "breaking CLI changes"           # v1.0.0
 *   npm run version.bump rollback                               # undo last bump
 *
 * NOTE: There are two separate "version" concepts in this project.
 *   - Package version (package.json) — the looopy tool release version.
 *     That is what THIS script bumps.
 *   - Workflow version (each workflow's .looopy/config.json) — a per-workflow
 *     field stamped onto run records for regression tracking. Totally separate;
 *     this script does not touch it.
 *
 * Tagging is deferred to publish time so tags only exist for shipped versions.
 * Re-bumping or amending after this script is free — no tag cleanup needed.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// ── ESM __dirname shim ────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── ANSI colors ───────────────────────────────────────────────
const yellow = '\x1b[33m';
const green  = '\x1b[32m';
const cyan   = '\x1b[36m';
const red    = '\x1b[31m';
const reset  = '\x1b[0m';

const root = resolve(__dirname, '..');
const pkgPath = join(root, 'package.json');

const git        = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const gitCapture = (cmd: string) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();

const bumpType = process.argv[2] as 'patch' | 'minor' | 'major' | 'rollback';
const commitMsg = process.argv.slice(3).join(' ').trim() || '';

if (!bumpType || !['patch', 'minor', 'major', 'rollback'].includes(bumpType)) {
  console.error('Usage: npm run version.bump <patch|minor|major|rollback> [message]');
  process.exit(1);
}

if (bumpType !== 'rollback' && !commitMsg) {
  console.error(`${red}Commit message is required.${reset}`);
  console.error(`Usage: npm run version.bump ${bumpType} "your message here"`);
  process.exit(1);
}

// ── Rollback ──────────────────────────────────────────────────

if (bumpType === 'rollback') {
  const lastMsg = gitCapture('git log --oneline -1 --format=%s');
  const versionMatch = lastMsg.match(/^v(\d+\.\d+\.\d+)/);

  if (!versionMatch) {
    console.error(`${red}Last commit is not a version bump: "${lastMsg}"${reset}`);
    console.error('Rollback only works on the most recent version.bump commit.');
    process.exit(1);
  }

  const tag = `v${versionMatch[1]}`;

  // Refuse if the commit is already pushed (would require force-push or revert).
  let isPushed = false;
  try {
    isPushed = gitCapture('git log --oneline origin/HEAD..HEAD').length > 0;
  } catch {
    // No upstream configured — treat as not pushed.
  }

  if (!isPushed) {
    console.error(`${red}Last version commit appears to be pushed already. Rollback aborted.${reset}`);
    console.error('Use git revert instead for pushed commits.');
    process.exit(1);
  }

  // Defensively clean up any local tag for this version (tags are deferred to
  // publish, but may exist from a manual run or a previous publish attempt).
  try { git(`git tag -d ${tag}`); } catch { /* tag may not exist — fine */ }

  git('git reset --soft HEAD~1');
  git(`git checkout HEAD -- package.json`);

  const restoredVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  console.log(`\n${green}Rolled back ${tag} → v${restoredVersion}${reset}`);
  console.log(`  Commit removed (other staged changes preserved)`);
  console.log(`  Version restored to v${restoredVersion}\n`);
  process.exit(0);
}

// ── Bump ──────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version as string;

const [major, minor, patch] = current.split('.').map(Number);
const next =
  bumpType === 'major' ? `${major + 1}.0.0` :
  bumpType === 'minor' ? `${major}.${minor + 1}.0` :
  /* patch */            `${major}.${minor}.${patch + 1}`;

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`  package.json: ${current} → ${next}`);

console.log(`\nBumped ${bumpType}: ${current} → ${next}\n`);

git('git add package.json');
const fullMsg = `v${next} — ${commitMsg}`;
git(`git commit -m "${fullMsg.replace(/"/g, '\\"')}"`);

console.log(`\n${green}Committed v${next}${reset}`);
console.log(`${yellow}To inspect and tag/push when ready:${reset}\n`);
console.log(`  ${cyan}git log --oneline -1${reset}    # review the commit`);
console.log(`  ${cyan}git tag v${next} && git push && git push --tags${reset}\n`);
