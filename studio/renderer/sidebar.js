// Sidebar behavior — talks to the main process only through window.studio.
const writeButton = document.getElementById('btn-write');
const previewButton = document.getElementById('btn-preview');
const seeSiteButton = document.getElementById('btn-see-site');
const statusBox = document.getElementById('status');
const statusText = document.getElementById('status-text');

function setActive(tab) {
  writeButton.classList.toggle('active', tab === 'write');
  previewButton.classList.toggle('active', tab === 'preview');
}

writeButton.addEventListener('click', () => {
  setActive('write');
  window.studio.navigate('write');
});

previewButton.addEventListener('click', () => {
  setActive('preview');
  window.studio.navigate('preview');
});

seeSiteButton.addEventListener('click', () => {
  window.studio.openLiveSite();
});

document.getElementById('btn-ask-claude').addEventListener('click', () => {
  window.studio.openClaude();
});

// ---- Publish ----
const publishButton = document.getElementById('btn-publish');
const publishHint = document.getElementById('publish-hint');

const stepLabels = {
  images: 'Optimizing photos…',
  build: 'Checking your site for problems…',
  commit: 'Saving a snapshot of your work…',
  push: 'Sending to GitHub…',
};

window.studio.onPublishProgress(({ step, state, message }) => {
  if (state === 'running') {
    publishHint.className = 'publish-hint';
    publishHint.textContent = stepLabels[step] || message || 'Working…';
  }
});

publishButton.addEventListener('click', async () => {
  publishButton.disabled = true;
  publishHint.className = 'publish-hint';
  publishHint.textContent = 'Starting…';
  try {
    const result = await window.studio.publish();
    publishHint.className = 'publish-hint ' + (result.ok ? 'is-success' : 'is-error');
    publishHint.textContent = result.message;
  } catch (err) {
    publishHint.className = 'publish-hint is-error';
    publishHint.textContent = 'Something unexpected went wrong. Your writing is safe on this computer.';
  } finally {
    publishButton.disabled = false;
  }
});

// ---- GitHub connection ----
const githubToggle = document.getElementById('btn-github-toggle');
const githubForm = document.getElementById('github-form');
const githubMessage = document.getElementById('github-msg');

async function refreshGitHubLabel() {
  const status = await window.studio.gitHubStatus();
  githubToggle.textContent = status.connected ? 'GitHub connected ✓' : 'Connect GitHub…';
}
refreshGitHubLabel();

githubToggle.addEventListener('click', () => {
  githubForm.hidden = !githubForm.hidden;
});

document.getElementById('btn-github-save').addEventListener('click', async () => {
  const repoUrl = document.getElementById('gh-repo').value;
  const token = document.getElementById('gh-token').value;
  const result = await window.studio.saveGitHub({ repoUrl, token });
  githubMessage.className = 'publish-hint ' + (result.ok ? 'is-success' : 'is-error');
  githubMessage.textContent = result.message;
  if (result.ok) {
    document.getElementById('gh-token').value = '';
    setTimeout(() => {
      githubForm.hidden = true;
      refreshGitHubLabel();
    }, 1200);
  }
});

window.studio.onStatus(({ state, detail }) => {
  statusBox.className = 'status' + (state === 'ready' ? ' ready' : state === 'error' ? ' error' : '');
  if (state === 'starting') statusText.textContent = 'Starting up…';
  else if (state === 'restarting') statusText.textContent = detail || 'Restarting…';
  else if (state === 'ready') statusText.textContent = 'Everything is running';
  else if (state === 'error') statusText.textContent = detail || 'Something went wrong.';
});
