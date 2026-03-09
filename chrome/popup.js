// LovableGrab — Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  const alertEl = document.getElementById('alert');
  const projIdEl = document.getElementById('proj-id');
  const authStateEl = document.getElementById('auth-state');
  const metaEl = document.getElementById('meta');
  const grabBtn = document.getElementById('grab-btn');
  const hintEl = document.getElementById('hint');

  let activeTab = null;
  let projId = null;
  let authToken = null;

  // Resolve active tab
  const tabList = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabList[0];

  // Validate URL
  if (!activeTab.url.match(/^https:\/\/lovable\.dev\/projects\/[a-f0-9-]+/i)) {
    setAlert('Open a Lovable project page first', 'fail');
    hintEl.textContent = 'Navigate to any project on lovable.dev, then reopen this popup.';
    return;
  }

  // Parse project identifier
  const idMatch = activeTab.url.match(/\/projects\/([a-f0-9-]+)/i);
  if (idMatch?.[1]) {
    projId = idMatch[1];
    projIdEl.textContent = projId;
    metaEl.style.display = 'block';
  } else {
    setAlert('Cannot detect project identifier', 'fail');
    return;
  }

  // Fetch auth info from content script
  try {
    setAlert('Checking credentials…', 'wait');

    const authInfo = await chrome.tabs.sendMessage(activeTab.id, { action: 'getAuthInfo' });

    if (authInfo?.idToken) {
      authToken = authInfo.idToken;
      authStateEl.textContent = 'Verified ✓';
      setAlert('Ready to export', 'ok');
      grabBtn.disabled = false;
      hintEl.textContent = 'Click the button to download the project as a ZIP archive.';
    } else {
      authStateEl.textContent = 'Missing';
      setAlert('Auth token unavailable', 'fail');
      hintEl.textContent = 'Log in and reload the page. For 3rd-party auth (Google/GitHub), use the in-page toolbar button.';
      console.log('[LovableGrab] Token not resolved, 3rd-party auth may require in-page action.');
    }
  } catch (err) {
    setAlert('Page communication failed — reload and retry', 'fail');
    console.error('[LovableGrab] Popup comm error:', err);
  }

  // Export handler
  grabBtn.addEventListener('click', async () => {
    if (!projId || !authToken) {
      setAlert('Project ID or credentials missing', 'fail');
      return;
    }

    try {
      setAlert('Exporting project…', 'wait');
      grabBtn.disabled = true;

      const result = await chrome.runtime.sendMessage({
        action: 'downloadProject',
        projectId: projId,
        idToken: authToken
      });

      if (result.success) {
        setAlert('Export complete ✓', 'ok');
      } else {
        setAlert(`Export failed: ${result.error}`, 'fail');
        grabBtn.disabled = false;
      }
    } catch (err) {
      setAlert('Export error — check console', 'fail');
      console.error('[LovableGrab] Export error:', err);
      grabBtn.disabled = false;
    }
  });

  // Update alert box
  function setAlert(text, variant = 'idle') {
    alertEl.textContent = text;
    alertEl.className = 'alert-box';
    if (variant) alertEl.classList.add(`alert-${variant}`);
  }
});