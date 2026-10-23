const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const rootDir = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const owner = pkg.build?.publish?.owner || 'bhaijew';
const repo = pkg.build?.publish?.repo || 'sole';

console.log('=====================================================');
console.log(`Sole What POS - GitHub Release Publisher`);
console.log(`Target Repo: ${owner}/${repo}`);
console.log(`Version:     ${version} (${tag})`);
console.log('=====================================================\n');

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
}

function runOutput(cmd) {
  try {
    return execSync(cmd, { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  // 1. Stage changes and commit if needed
  const status = runOutput('git status --porcelain');
  if (status) {
    console.log('[Git] Staging modified files...');
    run('git add -A');
    try {
      run(`git commit -m "chore(release): bump version to ${version}"`);
    } catch {
      console.log('[Git] No new commit created (already clean).');
    }
  }

  // 2. Check if tag exists locally
  const localTags = runOutput('git tag -l');
  const tagExistsLocally = localTags.split(/\r?\n/).includes(tag);

  if (!tagExistsLocally) {
    console.log(`[Git] Creating local tag ${tag}...`);
    run(`git tag -a ${tag} -m "Release ${tag}"`);
  } else {
    console.log(`[Git] Tag ${tag} already exists locally.`);
  }

  // 3. Push commit and tag to GitHub
  console.log('\n[Git] Pushing main branch and tag to GitHub...');
  try {
    run('git push origin main');
    run(`git push origin ${tag}`);
    console.log(`\n[SUCCESS] Tag ${tag} pushed to GitHub!`);
    console.log(`GitHub Actions will now automatically build and publish the release.`);
    console.log(`Track progress at: https://github.com/${owner}/${repo}/actions`);
  } catch (err) {
    console.warn('[Git Push Warning] Could not push automatically. Please run: git push origin main && git push origin ' + tag);
  }

  // 4. If token is available and local artifacts exist, upload directly
  const releaseDir = path.join(rootDir, 'release');
  const setupExe = path.join(releaseDir, `Sole What Setup ${version}.exe`);
  const latestYml = path.join(releaseDir, 'latest.yml');

  if (token && fs.existsSync(setupExe)) {
    console.log('\n[Direct Upload] GitHub Token found! Uploading release directly via API...');
    try {
      run(`npx cross-env ELECTRON_BUILDER_COMPRESSION_LEVEL=1 electron-builder --win --publish always`);
      console.log('[Direct Upload] Successfully published artifacts to GitHub Release!');
    } catch (publishErr) {
      console.warn('[Direct Upload] electron-builder publish warning:', publishErr.message);
    }
  }
}

main().catch((err) => {
  console.error('[Error]', err.message);
  process.exit(1);
});
