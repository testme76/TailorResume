chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const snapshotKey = (tabId) => `boundSnapshot:${tabId}`;

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id || !tab.openerTabId) return;
  void chrome.storage.session.get(snapshotKey(tab.openerTabId)).then((source) => {
    const snapshot = source[snapshotKey(tab.openerTabId)];
    if (snapshot) return chrome.storage.session.set({ [snapshotKey(tab.id)]: snapshot });
    return undefined;
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(snapshotKey(tabId));
});
