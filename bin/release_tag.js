import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function run(command, args, options = {}) {
  const result = execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  return typeof result === 'string' ? result.trim() : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  return packageJson.version;
}

const releaseArg = process.argv[2] || 'patch';
const validBumps = new Set(['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease']);

if (!validBumps.has(releaseArg) && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/.test(releaseArg)) {
  fail(
    [
      'Usage: npm run release -- [patch|minor|major|prepatch|preminor|premajor|prerelease|x.y.z]',
      'Examples:',
      '  npm run release',
      '  npm run release -- minor',
      '  npm run release -- 0.2.0',
    ].join('\n'),
  );
}

const versionBefore = readPackageVersion();

if (!versionBefore || typeof versionBefore !== 'string') {
  fail('Missing package.json version');
}

try {
  run('git', ['rev-parse', '--is-inside-work-tree']);
} catch {
  fail('This command must be run inside the @maveio/data git repository.');
}

const status = run('git', ['status', '--porcelain']);

if (status) {
  fail(
    [
      'Working tree is not clean. Commit or stash changes before running a release.',
      '',
      status,
    ].join('\n'),
  );
}

run('npm', ['run', 'release:check'], {
  stdio: 'inherit',
});

run('npm', ['version', '--no-git-tag-version', releaseArg], {
  stdio: 'inherit',
});

const version = readPackageVersion();
const tag = `v${version}`;

try {
  run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
  fail(`Tag ${tag} already exists.`);
} catch (error) {
  // Tag does not exist yet, which is what we want.
}

run('git', ['tag', '-a', tag, '-m', `@maveio/data ${version}`], {
  stdio: 'inherit',
});

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

console.log(`Version bumped: ${versionBefore} -> ${version}`);
console.log(`Created tag ${tag}.`);
console.log(`Next step: npm run release:push`);
console.log(`This will push branch ${branch} and tag ${tag}, which triggers the npm publish workflow.`);
