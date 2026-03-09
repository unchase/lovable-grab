// LovableGrab — Background Service Worker
const EXPORT_API = "https://lovable-api.com";

const trace = (lvl, ...args) => {
  console[lvl]('[LovableGrab SW]', ...args);
};

// Message router
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  trace('info', 'Action:', msg.action);

  if (msg.action === 'downloadProject') {
    const { projectId, idToken } = msg;

    if (!projectId || !idToken) {
      trace('error', 'Missing projectId or idToken');
      reply({ success: false, error: 'Credentials or project ID missing' });
      return true;
    }

    handleExport(projectId, idToken)
      .then(r => reply(r))
      .catch(e => {
        trace('error', 'Export pipeline error:', e);
        reply({ success: false, error: e.message || 'Unexpected error' });
      });

    return true;
  }

  return false;
});

// Delegate export to content script
async function handleExport(projId, token) {
  trace('info', `Export requested: ${projId}`);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) throw new Error('No active tab');

    const result = await chrome.tabs.sendMessage(tab.id, {
      action: 'downloadProject',
      projectId: projId,
      idToken: token
    });

    trace('info', 'Content script result:', result);

    if (result.needsJsZip) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['plugins/jszip.min.js']
      });

      const retry = await chrome.tabs.sendMessage(tab.id, {
        action: 'downloadProject',
        projectId: projId,
        idToken: token
      });

      return retry;
    }

    return result;
  } catch (e) {
    trace('error', 'Export delegation failed:', e);
    return { success: false, error: e.message || 'Communication with page failed' };
  }
}

// Lifecycle
chrome.runtime.onInstalled.addListener(() => {
  trace('info', 'LovableGrab installed/updated —', chrome.runtime.getManifest().version);
});
