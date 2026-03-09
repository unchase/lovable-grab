// LovableGrab — Content Script
'use strict';

// --- Config ---
const EXPORT_API = "https://lovable-api.com";
const TAG = '[LovableGrab]';
const TOKEN_WAIT_MS = 3000;

// --- Logger ---
const out = {
  log: (msg, ...a) => console.log(`${TAG} ${msg}`, ...a),
  warn: (msg, ...a) => console.warn(`${TAG} ${msg}`, ...a),
  err: (msg, ...a) => console.error(`${TAG} ${msg}`, ...a),
  dbg: (msg, ...a) => { /* console.log(`${TAG} [DBG] ${msg}`, ...a); */ }
};

// --- Token cache from injected script (main world) ---
let cachedAuthToken = null;

// Accept token broadcasts from injected code
window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  if (ev.data?.type === 'LG_AUTH_TOKEN') {
    if (ev.data.idToken) {
      cachedAuthToken = ev.data.idToken;
      out.log("Auth token received from injected script.");
      out.dbg(`Token prefix: ${cachedAuthToken.substring(0, 20)}…`);
    } else {
      out.dbg("Null token broadcast received.");
    }
  }
});

// --- Script Injection ---
async function loadPayloadScripts() {
  out.log("Loading payload scripts…");

  try {
    const payloads = [
      'injections/tampermonkey.js',
    ];

    for (const path of payloads) {
      await embedScript(path);
    }

    out.log("All payload scripts loaded.");
  } catch (e) {
    out.err("Payload injection failed:", e);
  }
}

function embedScript(path) {
  return new Promise((resolve, reject) => {
    out.dbg(`Embedding: ${path}`);

    const el = document.createElement('script');
    el.src = chrome.runtime.getURL(path);
    el.onload = () => { out.dbg(`Loaded: ${path}`); resolve(); };
    el.onerror = (e) => { out.err(`Failed: ${path}`, e); reject(e); };

    (document.head || document.documentElement).appendChild(el);
  });
}

// Ask injected script for auth token via postMessage
function requestTokenFromPayload() {
  return new Promise((resolve) => {
    if (cachedAuthToken) {
      resolve(cachedAuthToken);
      return;
    }

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      out.dbg("Token request timed out.");
      resolve(null);
    }, TOKEN_WAIT_MS);

    function onMsg(ev) {
      if (ev.source !== window) return;
      if (ev.data?.type === 'LG_AUTH_TOKEN') {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (ev.data.idToken) {
          cachedAuthToken = ev.data.idToken;
          resolve(ev.data.idToken);
        } else {
          resolve(null);
        }
      }
    }

    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'LG_TOKEN_REQUEST' }, '*');
  });
}

// Extract token from DOM (credential-based auth)
function extractCredentialToken() {
  out.dbg("Scanning script tags for credential token…");
  const scripts = document.querySelectorAll('script');
  const pattern = /\\\\"idToken\\\\":\\\\"([A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+)\\\\"/;

  for (const s of scripts) {
    const txt = s.textContent;
    if (txt) {
      const m = txt.match(pattern);
      if (m?.[1]) {
        out.log("Credential token located in DOM.");
        out.dbg(`Token prefix: ${m[1].substring(0, 20)}…`);
        return m[1];
      }
    }
  }

  return null;
}

// Resolve token: credential → cached → request from payload
async function resolveAuthToken() {
  const cred = extractCredentialToken();
  if (cred) return cred;

  if (cachedAuthToken) {
    out.log("Using cached token from injected payload.");
    return cachedAuthToken;
  }

  out.log("Requesting token from payload…");
  const tok = await requestTokenFromPayload();
  if (tok) {
    out.log("Token resolved via payload request.");
    return tok;
  }

  out.err("Auth token could not be resolved.");
  return null;
}

// Sync variant (uses cached values only)
function resolveAuthTokenSync() {
  const cred = extractCredentialToken();
  if (cred) return cred;

  if (cachedAuthToken) {
    out.log("Using cached token (sync).");
    return cachedAuthToken;
  }

  out.warn("Sync token resolve failed — cache empty.");
  return null;
}

// Parse project ID from current URL
function parseProjectId() {
  const m = window.location.pathname.match(/\/projects\/([a-f0-9-]+)/i);
  if (m?.[1]) {
    out.dbg(`Project: ${m[1]}`);
    return m[1];
  }
  out.warn("Project ID not detected in URL.");
  return null;
}

// Base64 → Blob
function b64ToBlob(data, mime = '') {
  try {
    const raw = atob(data);
    const chunks = [];
    for (let i = 0; i < raw.length; i += 512) {
      const slice = raw.slice(i, i + 512);
      const bytes = new Array(slice.length);
      for (let j = 0; j < slice.length; j++) bytes[j] = slice.charCodeAt(j);
      chunks.push(new Uint8Array(bytes));
    }
    return new Blob(chunks, { type: mime });
  } catch (e) {
    out.err("b64→Blob conversion failed:", e);
    return new Blob(["Conversion error"], { type: "text/plain" });
  }
}

// Trigger file download
function saveBlob(blob, name) {
  try {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    anchor.href = href;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    out.log(`Download started: ${name}`);
  } catch (e) {
    out.err("Download trigger failed:", e);
    alert("Download Error: " + e.message);
  }
}

// --- Project Export ---
async function exportProject(projId, token) {
  if (!projId || !token) {
    out.err("Export aborted: missing project ID or token");
    return { success: false, error: "Missing project ID or auth token" };
  }

  out.log(`Exporting project: ${projId}`);

  try {
    const endpoint = `${EXPORT_API}/projects/${projId}/source-code`;
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include'
    });

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        out.err(`Auth rejected (${resp.status})`);
        return { success: false, error: "Auth failed — re-login and refresh." };
      }
      out.err(`HTTP ${resp.status}`);
      return { success: false, error: `API returned ${resp.status}` };
    }

    const payload = await resp.json();
    out.log("Source data retrieved.");

    if (!payload?.files?.length) {
      out.err("Empty file list in API response");
      return { success: false, error: "No files found" };
    }

    // Build ZIP
    out.log("Building archive…");
    const label = payload.name || projId;

    try {
      if (typeof JSZip === 'undefined') {
        out.warn("JSZip unavailable — injection needed.");
        return { success: false, error: "JSZip missing — refresh and retry.", needsJsZip: true };
      }

      const archive = new JSZip();
      const root = archive.folder(label);

      for (const f of payload.files) {
        if (f.contents !== undefined) {
          const content = f.binary ? b64ToBlob(f.contents) : f.contents;
          root.file(f.name, content, { binary: !!f.binary });
          out.dbg(`Packed: ${f.name}`);
        }
      }

      const zipBlob = await archive.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });

      saveBlob(zipBlob, `${label}.zip`);
      out.log(`Archive ready: ${label}.zip`);

      return { success: true };
    } catch (e) {
      out.err("Archive creation failed:", e);
      return { success: false, error: `ZIP error: ${e.message}` };
    }
  } catch (e) {
    out.err("Export failed:", e);
    return { success: false, error: e.message };
  }
}

// Ensure JSZip is available
function loadJSZip() {
  out.dbg("Checking JSZip availability…");
  if (!window.JSZip) {
    const el = document.createElement('script');
    el.src = chrome.runtime.getURL('plugins/jszip.min.js');
    el.onload = () => out.dbg("JSZip loaded.");
    el.onerror = (e) => out.err("JSZip load failed", e);
    document.head.appendChild(el);
  }
}

// --- Message Router ---
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  out.dbg("Incoming message:", msg);

  if (msg.action === 'checkToken') {
    resolveAuthToken().then(t => reply({ token: t }));
    return true;
  }
  if (msg.action === 'refreshToken') {
    out.log("Refresh requested");
    window.location.reload();
    return true;
  }
  if (msg.action === 'ensureJSZip') {
    loadJSZip();
    reply({ success: true });
    return false;
  }
  if (msg.action === 'downloadProject') {
    const pid = msg.projectId || parseProjectId();

    resolveAuthToken().then(token => {
      if (token && pid) {
        loadJSZip();
        exportProject(pid, token)
          .then(r => { try { reply(r); } catch (_) { /* channel closed */ } })
          .catch(e => { try { reply({ success: false, error: e.message }); } catch (_) { /* */ } });
      } else {
        reply({
          success: false,
          error: !token ? "Auth token unavailable" : "Project ID missing",
          noToken: !token
        });
      }
    });

    return true;
  }
  if (msg.action === 'getAuthInfo') {
    resolveAuthToken().then(token => {
      const pid = parseProjectId();
      reply({ idToken: token, projectId: pid });
    });
    return true;
  }
  return true;
});

// --- Bootstrap ---
out.log("Content script active on Lovable project page.");
loadJSZip();
loadPayloadScripts();
