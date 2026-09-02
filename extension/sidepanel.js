const elements = {
  company: document.querySelector('#company'),
  connection: document.querySelector('#connection'),
  copyInterestButton: document.querySelector('#copyInterestButton'),
  docLink: document.querySelector('#docLink'),
  filename: document.querySelector('#filename'),
  generateButton: document.querySelector('#generateButton'),
  historyBadge: document.querySelector('#historyBadge'),
  historyDetails: document.querySelector('#historyDetails'),
  historyLabel: document.querySelector('#historyLabel'),
  inspectButton: document.querySelector('#inspectButton'),
  interest: document.querySelector('#interest'),
  interestAnswer: document.querySelector('#interestAnswer'),
  interestButton: document.querySelector('#interestButton'),
  interestJob: document.querySelector('#interestJob'),
  jd: document.querySelector('#jd'),
  pageUrl: document.querySelector('#pageUrl'),
  pdfLink: document.querySelector('#pdfLink'),
  result: document.querySelector('#result'),
  role: document.querySelector('#role'),
  snapshotInfo: document.querySelector('#snapshotInfo'),
  status: document.querySelector('#status'),
};

const apiCandidates = ['http://127.0.0.1:4317', 'http://127.0.0.1:4318'];
let apiBase = null;
let currentTab = null;
let currentJobStatus = null;
let currentSnapshot = null;
let syncSequence = 0;
let interestSequence = 0;
let interestSaveTimer = null;

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function clearStatus() {
  elements.status.textContent = '';
  elements.status.className = 'status hidden';
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function api(path, options = {}) {
  const candidates = apiBase
    ? [apiBase, ...apiCandidates.filter((candidate) => candidate !== apiBase)]
    : apiCandidates;
  let lastError;

  for (const base of candidates) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const body = await response.json();
      apiBase = base;
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      return body;
    } catch (error) {
      lastError = error;
      if (apiBase === base || !(error instanceof TypeError)) throw error;
    }
  }
  throw new Error(`Cannot connect to TailorResume. Start npm.cmd run app. ${lastError?.message || ''}`);
}

function readDocument() {
  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const selected = clean(globalThis.getSelection?.().toString());
  const body = clean(document.body?.innerText).slice(0, 120000);
  const meta = (selector) => document.querySelector(selector)?.content?.trim() || '';
  return {
    body,
    selected,
    heading: clean(document.querySelector('h1')?.innerText),
    title: clean(meta('meta[property="og:title"]') || document.title),
    siteName: clean(meta('meta[property="og:site_name"]')),
    url: location.href,
  };
}

function frameScore(frame) {
  const text = frame.selected.length >= 40 ? frame.selected : frame.body;
  const hits = (text.match(/responsibilit|qualification|requirements|about (the )?(job|role)|what you('|’)ll do|job description/gi) || []).length;
  return (frame.selected.length >= 40 ? 100000 : 0) + Math.min(text.length, 80000) + hits * 2500;
}

function bestFrame(results) {
  return results
    .map((result) => result.result)
    .filter((result) => result?.body?.length >= 40 || result?.selected?.length >= 40)
    .sort((left, right) => frameScore(right) - frameScore(left))[0];
}

const snapshotKey = (tabId) => `boundSnapshot:${tabId}`;
const interestKey = (applicationId) => `interest:${applicationId}`;

function compactSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    applicationId: snapshot.applicationId,
    job: {
      company: snapshot.job.company,
      role: snapshot.job.role,
    },
    resume: snapshot.resume,
    version: snapshot.version,
    url: snapshot.url,
  };
}

async function bindSnapshot(tabId, snapshot) {
  await chrome.storage.session.set({ [snapshotKey(tabId)]: compactSnapshot(snapshot) });
}

async function boundSnapshot(tabId) {
  const result = await chrome.storage.session.get(snapshotKey(tabId));
  return result[snapshotKey(tabId)] || null;
}

async function clearBoundSnapshot(tabId) {
  await chrome.storage.session.remove(snapshotKey(tabId));
}

async function restoreInterest(snapshot) {
  const sequence = ++interestSequence;
  elements.interestAnswer.value = '';
  if (!snapshot) return;
  const saved = await chrome.storage.local.get(interestKey(snapshot.applicationId));
  if (sequence === interestSequence && currentSnapshot?.applicationId === snapshot.applicationId) {
    elements.interestAnswer.value = saved[interestKey(snapshot.applicationId)] || '';
  }
}

function renderSnapshot(snapshot) {
  currentSnapshot = snapshot;
  if (!snapshot) {
    elements.result.classList.add('hidden');
    elements.interest.classList.add('hidden');
    void restoreInterest(null);
    return;
  }
  elements.filename.textContent = snapshot.resume.filename;
  elements.snapshotInfo.textContent = `${snapshot.job.company} — ${snapshot.job.role} · version ${snapshot.version}`;
  elements.pdfLink.href = `${apiBase}${snapshot.resume.url}`;
  elements.docLink.href = snapshot.resume.docLink;
  elements.interestJob.textContent = `${snapshot.job.company} — ${snapshot.job.role}`;
  elements.result.classList.remove('hidden');
  elements.interest.classList.remove('hidden');
  void restoreInterest(snapshot);
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function renderJobStatus(record) {
  const status = record?.status || 'new';
  currentJobStatus = record;
  elements.historyBadge.textContent = status;
  elements.historyBadge.className = `badge ${status}`;
  elements.inspectButton.textContent = status === 'inspected'
    ? 'Check current job page'
    : 'Read current job page';

  if (status === 'inspected') {
    elements.historyLabel.textContent = 'Already inspected — no need to review again';
    elements.historyDetails.textContent = `Inspected ${formatTime(record.inspectedAt)}.`;
    if (record.company) elements.company.value = record.company;
    if (record.role) elements.role.value = record.role;
    if (record.jd) elements.jd.value = record.jd;
  } else {
    elements.historyLabel.textContent = 'This job has not been inspected';
    elements.historyDetails.textContent = 'A successful Inspect will save the JD and prevent duplicate review.';
  }
}

async function loadJobStatus(url) {
  const record = await api(`/api/job-status?url=${encodeURIComponent(url)}`);
  renderJobStatus(record);
  return record;
}

async function markInspected(tab, { company, role, jd }) {
  const record = await api('/api/job-status', {
    method: 'POST',
    body: JSON.stringify({
      url: tab.url,
      status: 'inspected',
      company,
      role,
      jd,
    }),
  });
  renderJobStatus(record);
  return record;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No active job page is available.');
  if (currentTab && (currentTab.id !== tab.id || currentTab.url !== tab.url)) {
    elements.company.value = '';
    elements.role.value = '';
    elements.jd.value = '';
    renderSnapshot(null);
    renderJobStatus({ status: 'new' });
  }
  currentTab = tab;
  elements.pageUrl.textContent = tab.url;
  return tab;
}

async function syncActivePage() {
  const sequence = ++syncSequence;
  try {
    const tab = await activeTab();
    if (!/^https?:/i.test(tab.url)) return;
    const [record, latest, bound] = await Promise.all([
      api(`/api/job-status?url=${encodeURIComponent(tab.url)}`),
      api(`/api/applications/latest?url=${encodeURIComponent(tab.url)}`),
      boundSnapshot(tab.id),
    ]);
    if (sequence !== syncSequence) return null;
    renderJobStatus(record);
    if (latest) await bindSnapshot(tab.id, latest);
    if (sequence !== syncSequence) return null;
    renderSnapshot(latest || bound);
    return record;
  } catch (error) {
    if (sequence === syncSequence) setStatus(error.message, 'error');
    return null;
  }
}

async function inspectPage() {
  clearStatus();
  try {
    const tab = await activeTab();
    if (!/^https?:/i.test(tab.url)) throw new Error('Open a normal http/https job posting first.');
    const existing = await loadJobStatus(tab.url);
    if (existing.status === 'inspected') {
      const [latest, bound] = await Promise.all([
        api(`/api/applications/latest?url=${encodeURIComponent(tab.url)}`),
        boundSnapshot(tab.id),
      ]);
      if (latest) await bindSnapshot(tab.id, latest);
      renderSnapshot(latest || bound);
      setStatus('Already inspected — no need to review this job again.', 'success');
      return;
    }
    setBusy(elements.inspectButton, true, 'Reading job page…');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: readDocument,
    });
    const frame = bestFrame(results);
    if (!frame) throw new Error('No usable job description was found. Select the JD text and try again.');
    const jd = frame.selected.length >= 40 ? frame.selected : frame.body;
    elements.jd.value = jd;
    elements.role.value = frame.heading || frame.title;
    elements.company.value = frame.siteName;
    setStatus('Job text captured. Identifying company and role…');
    const metadata = await api('/api/extract', {
      method: 'POST',
      body: JSON.stringify({ jd }),
    });
    elements.company.value = metadata.company || elements.company.value;
    elements.role.value = metadata.role || elements.role.value;
    await markInspected(tab, {
      company: elements.company.value,
      role: elements.role.value,
      jd,
    });
    await clearBoundSnapshot(tab.id);
    const latest = await api(`/api/applications/latest?url=${encodeURIComponent(tab.url)}`);
    if (latest) await bindSnapshot(tab.id, latest);
    renderSnapshot(latest);
    setStatus('Job inspected and saved. Check the details before generating.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(elements.inspectButton, false);
    if (currentJobStatus) renderJobStatus(currentJobStatus);
  }
}

async function generateResume() {
  clearStatus();
  setBusy(elements.generateButton, true, 'Generating…');
  try {
    const tab = await activeTab();
    const jd = elements.jd.value.trim();
    const company = elements.company.value.trim();
    const role = elements.role.value.trim();
    if (jd.length < 40) throw new Error('Read or paste the complete job description first.');
    if (!company || !role) throw new Error('Confirm both Company and Role first.');
    setStatus('Tailoring the resume and exporting the PDF. This can take a minute…');
    const snapshot = await api('/api/applications', {
      method: 'POST',
      body: JSON.stringify({ url: tab.url, jd, company, role }),
    });
    await bindSnapshot(tab.id, snapshot);
    renderSnapshot(snapshot);
    setStatus('Tailored resume generated. Open the PDF and attach it manually.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(elements.generateButton, false);
  }
}

async function generateInterestAnswer() {
  const snapshot = currentSnapshot;
  if (!snapshot) {
    setStatus('Generate or bind a tailored resume first.', 'error');
    return;
  }
  setBusy(elements.interestButton, true, 'Generating…');
  setStatus(`Writing an answer for ${snapshot.job.company}…`);
  try {
    const result = await api('/api/company-interest', {
      method: 'POST',
      body: JSON.stringify({ applicationId: snapshot.applicationId }),
    });
    await chrome.storage.local.set({ [interestKey(snapshot.applicationId)]: result.answer });
    if (currentSnapshot?.applicationId === snapshot.applicationId) {
      elements.interestAnswer.value = result.answer;
      setStatus('Why-this-company answer generated. Review it before copying.', 'success');
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(elements.interestButton, false);
  }
}

async function copyInterestAnswer() {
  const answer = elements.interestAnswer.value.trim();
  if (!answer) {
    setStatus('Generate or write the answer first.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(answer);
    setStatus('Why-this-company answer copied.', 'success');
  } catch (error) {
    setStatus(`Could not copy the answer: ${error.message}`, 'error');
  }
}

async function initialize() {
  try {
    await activeTab();
    const config = await api('/api/config');
    elements.connection.textContent = `Connected · ${config.model}`;
    elements.connection.classList.add('connected');
    await syncActivePage();
  } catch (error) {
    elements.connection.textContent = 'Local service offline';
    setStatus(error.message, 'error');
  }
}

elements.inspectButton.addEventListener('click', inspectPage);
elements.generateButton.addEventListener('click', generateResume);
elements.interestButton.addEventListener('click', generateInterestAnswer);
elements.copyInterestButton.addEventListener('click', copyInterestAnswer);
elements.interestAnswer.addEventListener('input', () => {
  clearTimeout(interestSaveTimer);
  const applicationId = currentSnapshot?.applicationId;
  if (!applicationId) return;
  interestSaveTimer = setTimeout(() => {
    void chrome.storage.local.set({
      [interestKey(applicationId)]: elements.interestAnswer.value,
    });
  }, 250);
});
chrome.tabs.onActivated.addListener(() => {
  void syncActivePage();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
    void syncActivePage();
  }
});
void initialize();
