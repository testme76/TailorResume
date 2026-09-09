const elements = {
  company: document.querySelector('#company'),
  docLink: document.querySelector('#docLink'),
  extractButton: document.querySelector('#extractButton'),
  jd: document.querySelector('#jd'),
  modelName: document.querySelector('#modelName'),
  pasteButton: document.querySelector('#pasteButton'),
  pdfLink: document.querySelector('#pdfLink'),
  prepareButton: document.querySelector('#prepareButton'),
  previewFields: document.querySelector('#previewFields'),
  previewPanel: document.querySelector('#previewPanel'),
  publishButton: document.querySelector('#publishButton'),
  resultFilename: document.querySelector('#resultFilename'),
  resultPanel: document.querySelector('#resultPanel'),
  role: document.querySelector('#role'),
  status: document.querySelector('#status'),
};

const labels = {
  SUMMARY: 'Summary',
  ROLE1_BULLET1: 'Role 1 · Bullet 1',
  ROLE1_BULLET2: 'Role 1 · Bullet 2',
  ROLE1_BULLET3: 'Role 1 · Bullet 3',
  ROLE2_BULLET1: 'Role 2 · Bullet 1',
  ROLE2_BULLET2: 'Role 2 · Bullet 2',
  ROLE2_BULLET3: 'Role 2 · Bullet 3',
  PROJECT1_BULLET1: 'Project 1 · Bullet 1',
  PROJECT1_BULLET2: 'Project 1 · Bullet 2',
  PROJECT2_BULLET1: 'Project 2 · Bullet 1',
  PROJECT2_BULLET2: 'Project 2 · Bullet 2',
  SKILLS: 'Skills',
};

let config = { tokenLimits: {} };
let audioContext;
let generationId = null;

function enableAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
}

function playSuccessSound() {
  try {
    enableAudio();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    for (const [index, frequency] of [659.25, 783.99].entries()) {
      const start = now + index * 0.12;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.1, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    }
  } catch {
    // Audio is optional and must never interrupt resume generation.
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.retryable = body.retryable;
    error.cleanupRequired = body.cleanupRequired;
    throw error;
  }
  return body;
}

function setStatus(message, type = 'working') {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
}

function clearStatus() {
  elements.status.className = 'status hidden';
  elements.status.textContent = '';
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function requireJobText() {
  const value = elements.jd.value.trim();
  if (value.length < 40) throw new Error('请先粘贴完整职位描述。');
  return value;
}

async function extractMetadata() {
  const jd = requireJobText();
  setBusy(elements.extractButton, true, '识别中…');
  setStatus('正在识别公司和职位…');
  try {
    const result = await api('/api/extract', {
      method: 'POST',
      body: JSON.stringify({ jd }),
    });
    if (result.company) elements.company.value = result.company;
    if (result.role) elements.role.value = result.role;
    setStatus('识别完成，请检查公司和职位。', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(elements.extractButton, false);
  }
}

function updateCounter(textarea, counter, minimum, limit) {
  const length = textarea.value.length;
  counter.textContent = `${length} / ${minimum}-${limit}`;
  counter.classList.toggle('over', length < minimum || length > limit);
}

function renderPreview(tokenValues, tokenLimits, tokenMinimums) {
  elements.previewFields.replaceChildren();
  for (const [token, limit] of Object.entries(tokenLimits)) {
    const minimum = tokenMinimums[token] || 1;
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-field';

    const heading = document.createElement('div');
    heading.className = 'field-heading';
    const label = document.createElement('label');
    label.htmlFor = `token-${token}`;
    label.textContent = labels[token] || token;
    const counter = document.createElement('span');
    counter.className = 'counter';
    heading.append(label, counter);

    const textarea = document.createElement('textarea');
    textarea.id = `token-${token}`;
    textarea.dataset.token = token;
    textarea.value = tokenValues[token] || '';
    textarea.rows = token === 'SUMMARY' ? 4 : 3;
    textarea.addEventListener('input', () =>
      updateCounter(textarea, counter, minimum, limit)
    );
    updateCounter(textarea, counter, minimum, limit);

    wrapper.append(heading, textarea);
    elements.previewFields.append(wrapper);
  }
  elements.previewPanel.classList.remove('hidden');
  elements.previewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function prepare() {
  enableAudio();
  let jd;
  try {
    jd = requireJobText();
    if (!elements.company.value.trim() || !elements.role.value.trim()) {
      throw new Error('请确认 Company 和 Role。');
    }
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  setBusy(elements.prepareButton, true, 'Terra 正在生成…');
  setStatus('正在根据职位要求生成 12 个字段，这通常需要几十秒…');
  elements.resultPanel.classList.add('hidden');
  generationId = null;
  try {
    const result = await api('/api/prepare', {
      method: 'POST',
      body: JSON.stringify({
        jd,
        company: elements.company.value,
        role: elements.role.value,
      }),
    });
    generationId = result.generationId;
    renderPreview(result.tokenValues, result.tokenLimits, result.tokenMinimums);
    playSuccessSound();
    setStatus('预览已生成。检查或修改后再确认发布。', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(elements.prepareButton, false);
  }
}

function collectTokenValues() {
  const values = {};
  let invalid = false;
  for (const textarea of elements.previewFields.querySelectorAll('textarea[data-token]')) {
    const token = textarea.dataset.token;
    values[token] = textarea.value.trim();
    const minimum = config.tokenMinimums[token] || 1;
    if (
      values[token].length < minimum ||
      values[token].length > config.tokenLimits[token]
    ) invalid = true;
  }
  if (invalid) throw new Error('请修正空白字段或红色超长字段。');
  return values;
}

async function publish() {
  enableAudio();
  let tokenValues;
  try {
    if (!generationId) throw new Error('请重新生成预览后再发布。');
    tokenValues = collectTokenValues();
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  setBusy(elements.publishButton, true, '正在生成文件…');
  setStatus('正在复制模板、替换内容并导出 PDF…');
  try {
    const result = await api('/api/publish', {
      method: 'POST',
      body: JSON.stringify({
        generationId,
        company: elements.company.value,
        role: elements.role.value,
        tokenValues,
      }),
    });
    elements.docLink.href = result.docLink;
    elements.pdfLink.href = result.pdfUrl;
    elements.resultFilename.textContent = result.pdfFilename;
    elements.resultPanel.classList.remove('hidden');
    elements.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    playSuccessSound();
    setStatus('生成完成。', 'success');
  } catch (error) {
    const suffix = error.cleanupRequired
      ? ' 请检查错误信息中的 Google Doc，并在清理后重试。'
      : error.retryable ? ' 可以安全地再次点击发布重试。' : '';
    setStatus(`${error.message}${suffix}`, 'error');
  } finally {
    setBusy(elements.publishButton, false);
  }
}

elements.pasteButton.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error('剪贴板里没有文字。');
    elements.jd.value = text;
    elements.previewPanel.classList.add('hidden');
    await extractMetadata();
  } catch (error) {
    setStatus(`无法读取剪贴板：${error.message}。也可以按 Ctrl+V 粘贴。`, 'error');
    elements.jd.focus();
  }
});

elements.extractButton.addEventListener('click', extractMetadata);
elements.prepareButton.addEventListener('click', prepare);
elements.publishButton.addEventListener('click', publish);
function invalidatePreview() {
  generationId = null;
  elements.previewPanel.classList.add('hidden');
  elements.resultPanel.classList.add('hidden');
  clearStatus();
}
elements.jd.addEventListener('input', invalidatePreview);
elements.company.addEventListener('input', invalidatePreview);
elements.role.addEventListener('input', invalidatePreview);

api('/api/config')
  .then((value) => {
    config = value;
    elements.modelName.textContent = value.model;
  })
  .catch((error) => setStatus(error.message, 'error'));
