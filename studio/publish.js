// The publish pipeline: shrink images → build gate → git snapshot → push.
// Every step reports progress; every failure has a plain-English message and
// leaves the site/repo in a safe state. NOTHING is published without a
// successful local build. The gate is non-negotiable: no code path reaches
// the live site without passing it first.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const git = require('isomorphic-git');
const gitHttp = require('isomorphic-git/http/node');

// Publish builds go to a folder OUTSIDE OneDrive: OneDrive holds locks on
// files in the project's dist/ and randomly fails builds with EPERM.
const BUILD_OUT = path.join(
  process.env.LOCALAPPDATA || require('node:os').tmpdir(),
  'travel-customs-studio',
  'build-out',
);

function runNodeScript(projectRoot, scriptArgs, onLog) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, scriptArgs, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        FORCE_COLOR: '0',
        TC_BUILD_OUT: BUILD_OUT,
        TC_PROJECT_ROOT: projectRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onLog) onLog(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('exit', (code) => resolve({ code, output }));
    child.on('error', (err) => resolve({ code: -1, output: output + '\n' + err.message }));
  });
}

async function resizeImages(projectRoot, onLog) {
  // In the installed app this script is unpacked next to the app archive.
  const script = path
    .join(__dirname, 'scripts', 'resize-images.js')
    .replace('app.asar', 'app.asar.unpacked');
  return runNodeScript(projectRoot, [script], onLog);
}

async function buildSite(projectRoot, onLog) {
  const astroBin = path.join(projectRoot, 'node_modules', 'astro', 'astro.js');
  return runNodeScript(projectRoot, [astroBin, 'build'], onLog);
}

// Extracts the human-readable explanation from a failed build so Jacob sees
// "which post, what problem" instead of a stack trace. Astro prints the
// message lines immediately BEFORE its "Stack trace:" marker.
function summarizeBuildError(output) {
  const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = plain
    .split(/\r?\n/)
    .filter((l) => !/DeprecationWarning|--trace-deprecation/.test(l));
  const stackIdx = lines.findIndex((l) => /stack trace/i.test(l));
  if (stackIdx > 0) {
    const before = lines
      .slice(Math.max(0, stackIdx - 10), stackIdx)
      .map((l) => l.trim())
      // drop route-progress noise like "├─ /posts/foo/index.html (+3ms)"
      .filter((l) => l && !/^[│├└─▶λ]/.test(l) && !/^\d\d:\d\d:\d\d/.test(l) && !/\(\+\d+ms\)/.test(l));
    if (before.length) return before.slice(-6).join('\n');
  }
  const trimmed = lines.filter((l) => l.trim());
  const errorStart = trimmed.findIndex((l) => /error/i.test(l));
  const picked = errorStart >= 0 ? trimmed.slice(errorStart, errorStart + 6) : trimmed.slice(-6);
  return picked.join('\n');
}

async function commitAll(dir, message, author) {
  const matrix = await git.statusMatrix({ fs, dir });
  let changed = 0;
  for (const [filepath, head, workdir] of matrix) {
    if (head === 1 && workdir === 1) continue; // unmodified
    changed += 1;
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath });
    } else {
      await git.add({ fs, dir, filepath });
    }
  }
  if (changed === 0) return { sha: null, changed: 0 };
  const sha = await git.commit({ fs, dir, message, author });
  return { sha, changed };
}

async function pushToGitHub(dir, { remoteUrl, token }, onLog) {
  const result = await git.push({
    fs,
    http: gitHttp,
    dir,
    url: remoteUrl,
    ref: 'main',
    remoteRef: 'main',
    onAuth: () => ({ username: 'x-access-token', password: token }),
    onMessage: (msg) => onLog && onLog(msg + '\n'),
  });
  if (result && result.ok !== true) {
    throw new Error(result.error || 'Push was rejected.');
  }
}

/**
 * Runs the full publish pipeline.
 * @param options.projectRoot absolute path of the website project
 * @param options.github null, or { remoteUrl, token } when GitHub is connected
 * @param options.onProgress ({ step, state, message }) => void
 * @returns { ok, published, message }
 */
async function publish({ projectRoot, github, onProgress }) {
  const report = (step, state, message) => onProgress && onProgress({ step, state, message });

  // 1. Shrink any big photos so the repo and builds stay fast.
  report('images', 'running', 'Optimizing photos…');
  const resize = await resizeImages(projectRoot);
  const resizedNote = (resize.output.match(/^resized /gm) || []).length;
  report('images', 'done', resizedNote ? `Shrank ${resizedNote} photo(s)` : 'Photos already optimized');

  // 2. THE BUILD GATE. If this fails, nothing is committed or pushed.
  report('build', 'running', 'Checking your site for problems…');
  const build = await buildSite(projectRoot);
  if (build.code !== 0) {
    const detail = summarizeBuildError(build.output);
    report('build', 'error', detail);
    return {
      ok: false,
      published: false,
      message:
        'Something in your site has a problem, so it was NOT published. ' +
        'Nothing on your live site changed.\n\n' + detail,
    };
  }
  report('build', 'done', 'Site checks out');

  // 3. Git snapshot — the version-history safety net. Always local-first:
  // even if the push fails, the work is safely committed on this computer.
  report('commit', 'running', 'Saving a snapshot of your work…');
  const now = new Date();
  const stamp = now.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  let commit;
  try {
    commit = await commitAll(projectRoot, `Publish — ${stamp}`, {
      name: 'Jacob Thompson',
      email: 'jacobthompsn@gmail.com',
    });
  } catch (err) {
    report('commit', 'error', err.message);
    return {
      ok: false,
      published: false,
      message:
        'Your site built fine, but saving the snapshot failed: ' + err.message +
        '\nNothing was published. Try again — your writing is still safe on disk.',
    };
  }
  if (commit.changed === 0) {
    report('commit', 'done', 'Nothing new since the last publish');
  } else {
    report('commit', 'done', `Snapshot saved (${commit.changed} file(s))`);
  }

  // 4. Push to GitHub — the off-machine backup + what triggers the live deploy.
  // This runs even when nothing changed locally: GitHub may still be behind
  // (e.g. the very first publish after connecting). Pushing when everything
  // is already up to date is a harmless no-op.
  if (!github) {
    report('push', 'skipped', 'GitHub not connected yet');
    return {
      ok: true,
      published: false,
      message:
        commit.changed === 0
          ? 'Nothing new to publish — everything is already saved on this computer.'
          : `Saved on this computer (${commit.changed} file(s)). ` +
            'Connect GitHub in Settings to publish to the internet.',
    };
  }
  report('push', 'running', 'Sending to GitHub…');
  try {
    await pushToGitHub(projectRoot, github, null);
  } catch (err) {
    report('push', 'error', err.message);
    return {
      ok: false,
      published: false,
      message:
        'Saved on your computer, but couldn\'t reach GitHub: ' + err.message +
        '\nYour work is safe. Check your internet connection and click Publish again.',
    };
  }
  report('push', 'done', 'Sent to GitHub');
  return {
    ok: true,
    published: true,
    message:
      commit.changed === 0
        ? 'Everything is published — GitHub is up to date.'
        : 'Published! Your changes are on their way to the live site.',
  };
}

module.exports = { publish };
