// Travel Customs Studio — Electron main process.
// Boots the Astro dev server (using Electron's bundled Node via
// ELECTRON_RUN_AS_NODE) and shows Write (/keystatic) + Preview (/) views.
const { app, BrowserWindow, WebContentsView, ipcMain, shell, Menu, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { publish } = require('./publish');

// Keep settings/token in the same folder forever, regardless of how the app
// is named or launched (dev vs installed). Changing this loses the GitHub
// connection Jacob already saved.
app.setPath('userData', path.join(app.getPath('appData'), 'travel-customs-studio'));

// Where the website project lives. In development the app sits inside the
// project (studio/). When installed, we read it from settings.json or fall
// back to the known location of Jacob's project.
const DEFAULT_PROJECT_ROOT =
  'C:\\Users\\jacob\\OneDrive\\Personal\\Claude\\Code\\Travel Customs Studio Website';

function looksLikeProject(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'astro.config.mjs')) &&
      fs.existsSync(path.join(dir, 'node_modules', 'astro', 'astro.js'))
    );
  } catch {
    return false;
  }
}

function resolveProjectRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, '..');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (settings.projectRoot && looksLikeProject(settings.projectRoot)) {
      return settings.projectRoot;
    }
  } catch {}
  if (looksLikeProject(DEFAULT_PROJECT_ROOT)) return DEFAULT_PROJECT_ROOT;
  return null;
}

let PROJECT_ROOT = null; // set once the app is ready

// Helper scripts can't be spawned from inside the packaged archive —
// electron-builder unpacks them next to it (asarUnpack).
function unpackedPath(...segments) {
  return path.join(__dirname, ...segments).replace('app.asar', 'app.asar.unpacked');
}

const PREFERRED_PORT = 4400;
// The live internet address for the "See site" button.
let LIVE_SITE_URL = 'https://thetravelcustoms.com';

const SIDEBAR_WIDTH = 200;

let mainWindow = null;
let contentView = null;
let astroProcess = null;
let devUrl = null;
let currentTab = 'write';
let quitting = false;
let restartCount = 0;

function sendStatus(state, detail = '') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('studio:status', { state, detail });
  }
}

function startAstro() {
  const astroBin = path.join(PROJECT_ROOT, 'node_modules', 'astro', 'astro.js');
  astroProcess = spawn(
    process.execPath,
    [astroBin, 'dev', '--port', String(PREFERRED_PORT)],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  let sawReady = false;
  const onOutput = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[astro] ${text}`);
    // Astro auto-increments the port if 4400 is taken — trust its own report.
    // Its banner contains ANSI color codes and may say localhost OR 127.0.0.1.
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    const match = plain.match(/(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/);
    if (match && !sawReady) {
      sawReady = true;
      restartCount = 0;
      devUrl = match[1].replace(/\/$/, '');
      sendStatus('ready');
      showTab(currentTab);
    }
  };
  astroProcess.stdout.on('data', onOutput);
  astroProcess.stderr.on('data', onOutput);

  astroProcess.on('exit', (code) => {
    astroProcess = null;
    devUrl = null;
    if (quitting) return;
    // The engine died underneath Jacob (e.g. a transient error). Restart it
    // quietly a few times before showing a real error — never a dead window.
    if (restartCount < 3) {
      restartCount += 1;
      sendStatus('restarting', 'The preview engine stopped — restarting it…');
      setTimeout(startAstro, 1500);
    } else {
      sendStatus(
        'error',
        'The preview engine keeps stopping. Close the app and open it again. ' +
          'Nothing on your live site has changed, and your writing is saved.',
      );
    }
  });
}

function killAstro() {
  if (astroProcess && astroProcess.pid) {
    // Kill the whole process tree — astro dev spawns children on Windows.
    try {
      spawnSync('taskkill', ['/pid', String(astroProcess.pid), '/T', '/F'], {
        windowsHide: true,
      });
    } catch {
      try {
        astroProcess.kill();
      } catch {}
    }
    astroProcess = null;
  }
}

function showTab(tab) {
  currentTab = tab;
  if (!contentView || !devUrl) return;
  const target = tab === 'preview' ? `${devUrl}/` : `${devUrl}/keystatic`;
  contentView.webContents.loadURL(target);
}

function layoutContentView() {
  if (!mainWindow || !contentView) return;
  const { width, height } = mainWindow.getContentBounds();
  contentView.setBounds({
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height,
  });
}

function isLocalDevUrl(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      u.protocol === 'http:'
    );
  } catch {
    return false;
  }
}

// Headless check: `electron . --verify-push` runs the publish pipeline with
// no window and prints the outcome plus the repo state on GitHub afterwards.
// Used to verify publishing works end-to-end. The token is never printed.
const VERIFY_PUSH = process.argv.includes('--verify-push');

async function verifyPushAndExit() {
  const git = require('isomorphic-git');
  const gitHttp = require('isomorphic-git/http/node');
  const github = loadGitHubConfig();
  console.log('[verify] github connected:', !!github);
  const result = await publish({
    projectRoot: PROJECT_ROOT,
    github,
    onProgress: ({ step, state, message }) =>
      console.log(`[verify] ${step} ${state}${message ? ': ' + message : ''}`),
  });
  console.log('[verify] result:', JSON.stringify(result));
  if (github) {
    try {
      const info = await git.getRemoteInfo({
        http: gitHttp,
        url: github.remoteUrl,
        onAuth: () => ({ username: 'x-access-token', password: github.token }),
      });
      const remoteMain = info.refs && info.refs.heads && info.refs.heads.main;
      console.log('[verify] remote main sha:', remoteMain || '(none)');
    } catch (err) {
      console.log('[verify] could not read remote info:', err.message);
    }
  }
  app.exit(result.ok ? 0 : 1);
}

app.whenReady().then(() => {
  PROJECT_ROOT = resolveProjectRoot();
  if (!PROJECT_ROOT) {
    dialog.showErrorBox(
      'Travel Customs Studio',
      'Studio couldn\'t find the Travel Customs website folder on this computer.\n\n' +
        'It normally lives at:\n' + DEFAULT_PROJECT_ROOT + '\n\n' +
        'If you moved it, open Claude and say "Studio can\'t find the project" — it can fix this in a minute.',
    );
    app.exit(1);
    return;
  }
  if (VERIFY_PUSH) {
    verifyPushAndExit();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#ffffff',
    title: 'Travel Customs Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  contentView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.contentView.addChildView(contentView);
  layoutContentView();
  mainWindow.on('resize', layoutContentView);

  // The content area may only ever show our local dev server. Anything else
  // (external links in posts, etc.) opens in the real browser.
  contentView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  contentView.webContents.on('will-navigate', (event, url) => {
    if (!isLocalDevUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Spell-check: squiggles come from Chromium, but the correction menu has to
  // be built by us. Right-clicking a misspelled word offers suggestions,
  // "Add to dictionary", and the usual edit actions.
  contentView.webContents.session.setSpellCheckerLanguages(['en-US']);
  contentView.webContents.on('context-menu', (_event, params) => {
    const template = [];
    for (const suggestion of params.dictionarySuggestions) {
      template.push({
        label: suggestion,
        click: () => contentView.webContents.replaceMisspelling(suggestion),
      });
    }
    if (params.misspelledWord) {
      if (template.length === 0) {
        template.push({ label: 'No suggestions', enabled: false });
      }
      template.push({ type: 'separator' });
      template.push({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () =>
          contentView.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord,
          ),
      });
      template.push({ type: 'separator' });
    }
    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: params.selectionText.length > 0 },
        { role: 'copy', enabled: params.selectionText.length > 0 },
        { role: 'paste' },
        { role: 'selectAll' },
      );
    } else if (params.selectionText.length > 0) {
      template.push({ role: 'copy' });
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup();
    }
  });

  sendStatus('starting');
  mainWindow.webContents.on('did-finish-load', () => {
    sendStatus(devUrl ? 'ready' : 'starting');
  });

  // Never let a close kill a publish mid-send.
  mainWindow.on('close', (event) => {
    if (publishing) {
      event.preventDefault();
      closeRequestedDuringPublish = true;
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Finishing your publish',
        message: 'Still publishing — the app will close itself as soon as it\'s done.',
        detail: 'Closing now could leave your publish half-finished online.',
        buttons: ['OK'],
      });
    }
  });

  startAstro();
  watchCategoryDeletions();
  checkRemoteSync();
});

// Guardrail: deleting a category that posts still use would block the next
// publish (the build gate refuses orphaned posts). Warn the moment it happens
// instead of letting Jacob discover it at publish time.
function watchCategoryDeletions() {
  const categoriesDir = path.join(PROJECT_ROOT, 'src', 'content', 'categories');
  const postsDir = path.join(PROJECT_ROOT, 'src', 'content', 'posts');
  if (!fs.existsSync(categoriesDir)) return;
  let known = new Set(fs.readdirSync(categoriesDir));
  let debounce = null;
  fs.watch(categoriesDir, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      let current;
      try {
        current = new Set(fs.readdirSync(categoriesDir));
      } catch {
        return;
      }
      for (const file of known) {
        if (current.has(file) || !file.endsWith('.yaml')) continue;
        const slug = file.replace(/\.yaml$/, '');
        const users = [];
        try {
          for (const post of fs.readdirSync(postsDir)) {
            const indexFile = path.join(postsDir, post, 'index.md');
            if (!fs.existsSync(indexFile)) continue;
            const text = fs.readFileSync(indexFile, 'utf8');
            if (new RegExp(`^category:\\s*${slug}\\s*$`, 'm').test(text)) users.push(post);
          }
        } catch {}
        if (users.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Heads up about that category',
            message: `You deleted the "${slug}" category, but ${users.length} post(s) still use it.`,
            detail:
              'Publishing is blocked until this is fixed (the safety check will refuse it).\n\n' +
              'Fix it either way:\n' +
              '• Re-create the category with the same name, or\n' +
              '• Open each of these posts and pick a different category:\n  – ' +
              users.join('\n  – '),
            buttons: ['OK'],
          });
        }
      }
      known = current;
    }, 400);
  });
}

// Cheap one-laptop insurance: warn if GitHub somehow has changes this
// computer doesn't (should never happen with one machine, but if it does,
// publishing would overwrite them). Quietly does nothing when offline.
async function checkRemoteSync() {
  const github = loadGitHubConfig();
  if (!github) return;
  try {
    const git = require('isomorphic-git');
    const gitHttp = require('isomorphic-git/http/node');
    const info = await git.getRemoteInfo({
      http: gitHttp,
      url: github.remoteUrl,
      onAuth: () => ({ username: 'x-access-token', password: github.token }),
    });
    const remoteSha = info.refs && info.refs.heads && info.refs.heads.main;
    if (!remoteSha) return;
    const localSha = await git.resolveRef({ fs, dir: PROJECT_ROOT, ref: 'main' });
    if (remoteSha === localSha) return;
    // Different is fine when this computer is simply ahead (unpushed work).
    let remoteIsOlder = false;
    try {
      await git.fetch({
        fs, http: gitHttp, dir: PROJECT_ROOT, url: github.remoteUrl, ref: 'main',
        singleBranch: true, depth: 50,
        onAuth: () => ({ username: 'x-access-token', password: github.token }),
      });
      remoteIsOlder = await git.isDescendent({ fs, dir: PROJECT_ROOT, oid: localSha, ancestor: remoteSha });
    } catch {}
    if (!remoteIsOlder && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'The online copy looks different',
        message: 'GitHub has changes that this computer doesn\'t have.',
        detail:
          'This usually only happens if the site was edited from somewhere else. ' +
          'Publishing from here could overwrite those changes.\n\n' +
          'If you\'re not sure why, open Claude and say "GitHub and my computer are out of sync" before publishing.',
        buttons: ['OK'],
      });
    }
  } catch {
    // offline or GitHub unreachable — normal, say nothing
  }
}

ipcMain.on('studio:navigate', (_event, tab) => {
  if (tab === 'write' || tab === 'preview') showTab(tab);
});

ipcMain.on('studio:open-live-site', () => {
  shell.openExternal(LIVE_SITE_URL || `${devUrl || 'http://localhost:' + PREFERRED_PORT}/`);
});

// --- GitHub connection (repo URL in settings.json; token encrypted with
// --- Windows DPAPI via safeStorage — never stored or logged in plain text).
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function tokenPath() {
  return path.join(app.getPath('userData'), 'github-token.bin');
}
function loadGitHubConfig() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (!settings.repoUrl) return null;
    const encrypted = fs.readFileSync(tokenPath());
    const token = safeStorage.decryptString(encrypted);
    if (!token) return null;
    return { remoteUrl: settings.repoUrl, token };
  } catch {
    return null;
  }
}

ipcMain.handle('studio:github-status', () => {
  const config = loadGitHubConfig();
  return { connected: !!config, repoUrl: config ? config.remoteUrl : null };
});

ipcMain.handle('studio:save-github', (_event, { repoUrl, token }) => {
  try {
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test((repoUrl || '').trim())) {
      return { ok: false, message: 'That doesn\'t look like a GitHub repository address (https://github.com/you/repo).' };
    }
    if (!token || token.trim().length < 20) {
      return { ok: false, message: 'That token looks too short — paste the whole thing.' };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, message: 'Windows secure storage isn\'t available right now — try again after signing in to Windows.' };
    }
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({ repoUrl: repoUrl.trim().replace(/\/$/, '') }, null, 2));
    fs.writeFileSync(tokenPath(), safeStorage.encryptString(token.trim()));
    return { ok: true, message: 'GitHub connected.' };
  } catch (err) {
    return { ok: false, message: 'Could not save: ' + err.message };
  }
});

// --- Publish ---
// If Jacob closes the window mid-publish, we must NOT die with the push
// half-done (that silently stranded a publish on 2026-07-05: the snapshot
// saved locally but never reached GitHub, so the live site never updated).
let publishing = false;
let closeRequestedDuringPublish = false;

ipcMain.handle('studio:publish', async () => {
  if (publishing) return { ok: false, published: false, message: 'Already publishing…' };
  publishing = true;
  try {
    const result = await publish({
      projectRoot: PROJECT_ROOT,
      github: loadGitHubConfig(),
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('studio:publish-progress', progress);
        }
      },
    });
    return result;
  } catch (err) {
    return {
      ok: false,
      published: false,
      message: 'Something unexpected went wrong: ' + err.message + '\nYour writing is safe on this computer.',
    };
  } finally {
    publishing = false;
    if (closeRequestedDuringPublish && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  }
});

ipcMain.on('studio:open-claude', () => {
  // Opens the Claude desktop app (registered claude:// protocol). There,
  // Jacob types what he wants changed about the site or this app, and
  // Claude Code works on this project's files directly.
  shell.openExternal('claude://').catch(() => {
    shell.openExternal('https://claude.ai');
  });
});

app.on('before-quit', () => {
  quitting = true;
  killAstro();
});

app.on('window-all-closed', () => {
  quitting = true;
  killAstro();
  app.quit();
});
