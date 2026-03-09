// ==UserScript==
// @name         LovableGrab
// @namespace    https://github.com/unchase/lovable-downloader
// @version      1.0.0
// @description  One-click source code exporter for Lovable.dev projects
// @author       unchase (https://github.com/unchase)
// @match        https://lovable.dev/projects/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lovable.dev
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @connect      lovable-api.com
// @grant        none
// ==/UserScript==

// biome-ignore lint/complexity/useArrowFunction: tampermonkey required
(function () {
    'use strict';

    // --- Config ---
    const EXPORT_API = "https://lovable-api.com";
    const SIDEBAR_SEL = ".overflow-x-auto.p-2";
    const FILE_ITEM_SEL = 'div.group.flex.cursor-pointer.items-center';
    const CODE_VIEWER_SEL = 'button[aria-label="Code viewer"]';
    const TOOLBAR_SEL = 'button.cursor-pointer';
    const EXPORT_BTN_ID = 'lg-export-btn';
    const GRAB_ICON_CLS = 'lg-grab-icon';
    const HIDDEN_CLS = 'lg-hidden';
    const INJECT_DELAY = 500;
    const INJECT_MAX_TRIES = 10;
    const ZIP_LIB_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    const ZIP_SCRIPT_ID = 'lg-jszip-loader';
    const AUTH_ENDPOINTS = ['securetoken.googleapis.com', 'identitytoolkit.googleapis.com'];
    const PROGRESS_ID = 'lg-progress-bar';
    const VERBOSE = false;

    // --- Intercepted Firebase Token ---
    let firebaseIdToken = null;

    // Helper: check if URL matches any Firebase endpoint
    function isFirebaseAuthUrl(url) {
        return url && AUTH_ENDPOINTS.some(ep => url.includes(ep));
    }

    // --- Firebase Auth API Interceptor ---
    // Intercepts fetch and XMLHttpRequest to capture id_token from Firebase token refresh
    function setupFirebaseTokenInterceptor() {
        // --- Intercept fetch ---
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            try {
                const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url;
                if (isFirebaseAuthUrl(url)) {
                    // Clone the response so we don't consume the body
                    const cloned = response.clone();
                    cloned.json().then(data => {
                        if (data?.id_token || data?.idToken) {
                            const token = data.id_token || data.idToken;
                            firebaseIdToken = token;
                            log.info('Firebase id_token intercepted via fetch!');
                            // Send to content-script
                            window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: token }, '*');
                        }
                    }).catch(() => { /* ignore parse errors */ });
                }
            } catch (e) {
                // Don't break the page if interception fails
            }
            return response;
        };

        // --- Intercept XMLHttpRequest ---
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._lovableUrl = url;
            return originalXHROpen.apply(this, [method, url, ...rest]);
        };

        XMLHttpRequest.prototype.send = function (...args) {
            if (isFirebaseAuthUrl(this._lovableUrl)) {
                this.addEventListener('load', function () {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (data?.id_token || data?.idToken) {
                            const token = data.id_token || data.idToken;
                            firebaseIdToken = token;
                            log.info('Firebase id_token intercepted via XHR!');
                            window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: token }, '*');
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                });
            }
            return originalXHRSend.apply(this, args);
        };

        log.info('Firebase Auth API interceptor installed.');
    }

    // --- Read idToken from Firebase IndexedDB ---
    function getIdTokenFromIndexedDB() {
        return new Promise((resolve) => {
            try {
                const request = indexedDB.open('firebaseLocalStorageDb');
                request.onerror = () => {
                    log.warn('Cannot open firebaseLocalStorageDb');
                    resolve(null);
                };
                request.onsuccess = (event) => {
                    try {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
                            log.warn('firebaseLocalStorage store not found');
                            db.close();
                            resolve(null);
                            return;
                        }
                        const tx = db.transaction('firebaseLocalStorage', 'readonly');
                        const store = tx.objectStore('firebaseLocalStorage');
                        const getAllRequest = store.getAll();
                        getAllRequest.onsuccess = () => {
                            const results = getAllRequest.result;
                            let token = null;
                            for (const item of results) {
                                // Firebase stores user data with stsTokenManager containing accessToken
                                const val = item?.value || item;
                                if (val?.stsTokenManager?.accessToken) {
                                    token = val.stsTokenManager.accessToken;
                                    log.info('idToken found in IndexedDB (stsTokenManager.accessToken)!');
                                    break;
                                }
                                // Also check for idToken field directly
                                if (val?.idToken) {
                                    token = val.idToken;
                                    log.info('idToken found in IndexedDB (idToken field)!');
                                    break;
                                }
                            }
                            db.close();
                            if (token) {
                                firebaseIdToken = token;
                                window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: token }, '*');
                            }
                            resolve(token);
                        };
                        getAllRequest.onerror = () => {
                            db.close();
                            resolve(null);
                        };
                    } catch (e) {
                        log.warn('Error reading IndexedDB:', e);
                        resolve(null);
                    }
                };
            } catch (e) {
                log.warn('IndexedDB not available:', e);
                resolve(null);
            }
        });
    }

    // --- Structured Logging ---
    const log = {
        prefix: '[LovableGrab]',
        info: (msg, ...args) => console.log(`${log.prefix} ${msg}`, ...args),
        warn: (msg, ...args) => console.warn(`${log.prefix} ${msg}`, ...args),
        error: (msg, ...args) => console.error(`${log.prefix} ${msg}`, ...args),
        debug: (msg, ...args) => { if (VERBOSE) console.log(`${log.prefix} [DEBUG] ${msg}`, ...args); }
    };

    log.info("Script starting v1.0.0 (Loading Indicator)...");

    // --- Constants ---
    const JWT_REGEX = /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/; // Regex to validate JWT structure
    const JWT_REGEX_STRICT = /^eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/; // Regex to validate JWT structure

    // --- Global State Variables ---
    let sourceCodeData = null;
    let isFetchingData = false;
    let projectId = null;
    let idToken = null;
    let sidebarObserver = null;
    let triggerButtonObserver = null;
    let pathToItemMap = new Map();
    let buttonInjectionRetries = 0;
    let isJszipLoading = false;
    let jsZipLoadPromise = null;
    let loadingIndicatorElement = null; // Reference to the indicator DOM element

    // --- CSS Injection ---
    function addGlobalStyles() {
        const styleId = 'lovable-downloader-styles';
        if (document.getElementById(styleId)) return;

        const css = `
          /* Style for hiding individual icons */
          .${GRAB_ICON_CLS}.${HIDDEN_CLS} {
              display: none !important;
          }

          /* Styles for the loading indicator */
          #${PROGRESS_ID} {
              position: fixed;
              bottom: 20px;
              left: 50%;
              transform: translateX(-50%);
              background-color: rgba(0, 0, 0, 0.75); /* Dark semi-transparent background */
              color: white;
              padding: 8px 16px;
              border-radius: 6px;
              font-size: 14px;
              font-family: system-ui, sans-serif;
              z-index: 9999; /* High z-index */
              opacity: 0;
              visibility: hidden;
              transition: opacity 0.3s ease-in-out, visibility 0.3s ease-in-out;
              pointer-events: none; /* Prevent interactions */
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
          }

          #${PROGRESS_ID}.visible {
              opacity: 1;
              visibility: visible;
          }
      `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
        log.debug("Added global CSS rules.");
    }

    // --- Loading Indicator Functions ---

    /**
     * Creates the loading indicator DIV and appends it to the body if it doesn't exist.
     */
    function createLoadingIndicator() {
        if (document.getElementById(PROGRESS_ID)) {
            loadingIndicatorElement = document.getElementById(PROGRESS_ID);
            return; // Already exists
        }
        log.debug("Creating loading indicator element...");
        loadingIndicatorElement = document.createElement('div');
        loadingIndicatorElement.id = PROGRESS_ID;
        // Start hidden
        document.body.appendChild(loadingIndicatorElement);
    }

    /**
     * Shows the loading indicator with a specific message.
     * @param {string} message - The text to display (e.g., "Loading data...").
     */
    function showLoadingIndicator(message) {
        if (!loadingIndicatorElement) {
            log.warn("Attempted to show loading indicator but element not found.");
            createLoadingIndicator(); // Try creating it just in case
            if (!loadingIndicatorElement) return; // Still failed
        }
        log.debug(`Showing loading indicator: "${message}"`);
        loadingIndicatorElement.textContent = message;
        loadingIndicatorElement.classList.add('visible');
    }

    /**
     * Hides the loading indicator.
     */
    function hideLoadingIndicator() {
        if (!loadingIndicatorElement) return;
        log.debug("Hiding loading indicator.");
        loadingIndicatorElement.classList.remove('visible');
        // Optional: Clear text after a delay to prevent FOUC if shown again quickly
        // setTimeout(() => { if(loadingIndicatorElement && !loadingIndicatorElement.classList.contains('visible')) loadingIndicatorElement.textContent = ''; }, 300);
    }


    // --- Utility Functions --- (getProjectIdFromUrl, base64ToBlob, triggerDownload)
    // Keep these as they were
    function getProjectIdFromUrl() { const m = window.location.pathname.match(/\/projects\/([a-f0-9-]+)/i); if (m?.[1]) { log.debug(`Project ID: ${m[1]}`); return m[1]; } else { log.warn("Project ID not found."); return null; } }
    function base64ToBlob(b64, ct = '') { try { const bc = atob(b64), ba = []; for (let o = 0; o < bc.length; o += 512) { const s = bc.slice(o, o + 512), bn = new Array(s.length); for (let i = 0; i < s.length; i++) { bn[i] = s.charCodeAt(i); } ba.push(new Uint8Array(bn)); } return new Blob(ba, { type: ct }); } catch (e) { log.error("B64->Blob Error:", e); return new Blob(["Err"], { type: "text/plain" }); } }
    function triggerDownload(blob, fn) { try { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.style.display = 'none'; a.href = u; a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); log.info(`Download triggered: ${fn}`); } catch (e) { log.error("Trigger DL Error:", e); alert("DL Error."); } }

    // --- Token Extraction Functions ---
    function getCredentialIdToken() {
        // Look through all script tags in the document
        const scripts = document.querySelectorAll('script');
        // Regex pattern to match idToken in serialized JSON
        const regex = /\\"idToken\\":\\"([A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+)\\"/;

        for (const script of scripts) {
            const content = script.textContent;
            if (content) {
                const match = content.match(regex);
                if (match?.[1]) {
                    log.info("idToken found.");
                    log.debug(`Token: ${match[1].substring(0, 20)}...`);
                    return match[1];
                }
            }
        }

        return null;
    }

    function validateJwt(jwt) {
        if (!jwt) {
            return false;
        }
        return JWT_REGEX_STRICT.test(jwt);
    }

    function get3rdAuthIdToken() {
        // Check if __next_f exists and is an array
        if (typeof __next_f === 'undefined' || !Array.isArray(__next_f)) {
            log.debug("__next_f not available, skipping 3rd-party auth token extraction.");
            return null;
        }

        const getPart1 = (s) => s?.match(/(eyJ[\w|.|-]+)/)?.[0] || null;
        const getFull = (s) => s?.match(JWT_REGEX)?.[0] || null;

        const method1 = () => {
            try {
                // Method 1
                let offset = 12;
                if (!__next_f[offset]?.[1]) {
                    // Method 2
                    offset = 13;
                    if (!__next_f[offset]?.[1]) {
                        return null;
                    }
                }
                let jwtPart1 = getPart1(__next_f[offset][1]);
                if (!jwtPart1) {
                    // Try other offset
                    offset = (offset === 12) ? 13 : 12;
                    if (!__next_f[offset]?.[1]) return null;
                    jwtPart1 = getPart1(__next_f[offset][1]);
                    if (!jwtPart1) return null;
                }
                const nextEntry = __next_f[offset + 1];
                if (nextEntry?.[1]) {
                    const jwtPart2 = nextEntry[1];
                    let jwt = jwtPart1 + jwtPart2;
                    if (!validateJwt(jwt)) {
                        // Method 3
                        jwt = jwtPart1;
                    }
                    return validateJwt(jwt) ? jwt : null;
                }
                return validateJwt(jwtPart1) ? jwtPart1 : null;
            } catch (e) {
                log.debug("method1 failed:", e.message);
                return null;
            }
        }

        const method2 = () => {
            try {
                // Method 4
                if (!__next_f[14]?.[1]) return null;
                const jwtFull = getFull(__next_f[14][1]);
                if (jwtFull && validateJwt(jwtFull)) {
                    return jwtFull;
                }
                return null;
            } catch (e) {
                log.debug("method2 failed:", e.message);
                return null;
            }
        }

        const method3 = () => {
            try {
                // Method 5
                if (!__next_f[16]?.[1]) return null;
                const jwtFull = getFull(__next_f[16][1]);
                if (jwtFull && validateJwt(jwtFull)) {
                    return jwtFull;
                }
                return null;
            } catch (e) {
                log.debug("method3 failed:", e.message);
                return null;
            }
        }

        // Try all methods to find a broader range of __next_f entries
        let jwt = method1();
        if (!jwt) {
            jwt = method2();
        }
        if (!jwt) {
            jwt = method3();
        }

        // Method 6: Brute-force scan all __next_f entries for JWT
        if (!jwt) {
            log.debug("All indexed methods failed, scanning all __next_f entries...");
            for (let i = 0; i < __next_f.length; i++) {
                try {
                    const entry = __next_f[i];
                    if (entry?.[1] && typeof entry[1] === 'string') {
                        const found = getFull(entry[1]);
                        if (found && validateJwt(found)) {
                            log.debug(`JWT found in __next_f[${i}]`);
                            jwt = found;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        return jwt;
    }

    function getIdTokenFromDom() {
        log.debug("Searching for idToken...");
        const credentialIdToken = getCredentialIdToken();
        if (credentialIdToken) {
            log.info("idToken found in credentialIdToken.");
            return credentialIdToken;
        }

        log.debug("Checking 3rd-party auth...");
        const thirdPartyIdToken = get3rdAuthIdToken();
        if (thirdPartyIdToken) {
            log.info("Auth token found in third-party auth.");
            return thirdPartyIdToken;
        }

        log.error("Auth token not found.");
        return null;
    }

    // --- JSZip Loading ---
    async function loadJszipFromCDNIfNeeded() {
        if (typeof JSZip !== 'undefined') { log.debug("JSZip already available."); return true; }
        if (isJszipLoading) { log.debug("JSZip dynamic load in progress..."); return jsZipLoadPromise; }
        if (document.getElementById(ZIP_SCRIPT_ID)) { log.warn("JSZip script tag exists but global not defined."); return false; }
        log.info("JSZip not found, attempting load from CDN..."); isJszipLoading = true;
        jsZipLoadPromise = new Promise((resolve) => {
            const script = document.createElement('script'); script.id = ZIP_SCRIPT_ID; script.src = ZIP_LIB_URL; script.async = true;
            script.onload = () => { if (typeof JSZip !== 'undefined') { log.info("JSZip loaded from CDN."); isJszipLoading = false; resolve(true); } else { log.error("CDN script loaded, but JSZip global missing!"); isJszipLoading = false; resolve(false); } };
            script.onerror = (error) => { log.error("Failed to load JSZip script from CDN:", error); isJszipLoading = false; resolve(false); };
            document.body.appendChild(script);
        });
        return jsZipLoadPromise;
    }


    // --- Data Fetching and Processing ---

    async function ensureDataFetched() {
        if (sourceCodeData) { log.debug("Data already available."); return true; }
        if (isFetchingData) { log.warn("Fetch already in progress."); showLoadingIndicator("Loading data..."); return false; } // Show indicator if fetch is ongoing
        if (!idToken) { log.error("Cannot fetch: Token missing."); alert("Auth token not found."); return false; }
        if (!projectId) { log.error("Cannot fetch: Project ID missing."); return false; }

        log.info("Data not found, initiating fetch...");
        isFetchingData = true;
        showLoadingIndicator("Fetching project data..."); // Show indicator before fetch

        let fetchedData = null;
        try {
            const apiUrl = `${EXPORT_API}/projects/${projectId}/source-code`;
            const response = await fetch(apiUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${idToken}` }, credentials: 'include' });
            if (!response.ok) { throw new Error(`HTTP ${response.status}`); } // Let catch handle specific errors
            fetchedData = await response.json();
            log.info("Source code fetched successfully on demand.");
            sourceCodeData = fetchedData; // Store fetched data
            buildPathMap(sourceCodeData); // Build the map
            associatePathsToExistingIcons(); // Associate paths now data is ready
            return true; // Success
        } catch (error) {
            log.error("Fetch failed:", error);
            if (error.message.includes("401") || error.message.includes("403")) {
                alert("Authentication failed. Try refreshing or logging in again.");
            } else {
                alert(`Error fetching project data: ${error.message}. Check console.`);
            }
            return false; // Fetch failed
        } finally {
            isFetchingData = false;
            hideLoadingIndicator(); // Hide indicator regardless of success/failure
        }
    }

    function buildPathMap(d) { pathToItemMap.clear(); if (!d?.files) { log.warn("Cannot build map: Invalid data."); return; } d.files.forEach(i => pathToItemMap.set(i.name, i)); const fps = new Set(); d.files.forEach(i => { const p = i.name.split('/'); let cp = ''; for (let j = 0; j < p.length - 1; j++) { cp += `${j > 0 ? '/' : ''}${p[j]}`; if (cp) fps.add(cp); } }); fps.forEach(fp => { if (!pathToItemMap.has(fp)) pathToItemMap.set(fp, { name: fp, isImplicitFolder: true }); }); log.debug(`Path map built (${pathToItemMap.size}).`); }
    function findSourceItem(p) { return pathToItemMap.get(p) || null; }
    function isFolder(p) { const i = pathToItemMap.get(p); if (i?.isImplicitFolder) return true; if (!sourceCodeData?.files) return false; const x = p ? (p.endsWith('/') ? p : p + '/') : ""; return sourceCodeData.files.some(f => f.name !== p && f.name.startsWith(x)); }
    function associatePathsToExistingIcons() { if (!sourceCodeData?.files || pathToItemMap.size === 0) return; log.debug("Associating paths with existing entries..."); document.querySelectorAll(FILE_ITEM_SEL).forEach(e => { if (e.hasAttribute('data-path')) return; const nS = e.querySelector('span.truncate'), n = nS?.textContent?.trim(); if (!n) return; const pI = Array.from(pathToItemMap.keys()).find(p => p === n || p.endsWith(`/${n}`)); if (pI) { e.setAttribute('data-path', pI); log.debug(`Associated path post-fetch: "${n}" -> "${pI}"`); } else { log.warn(`Could not associate path post-fetch for "${n}".`); } }); }


    // --- Download Logic ---

    function downloadFile(item) { if (!item || item.contents === undefined) { log.error("Invalid file item:", item); alert("DL Fail: No Data."); return; } const fn = item.name.split('/').pop() || 'file'; log.info(`Preparing file: ${fn} (Binary:${!!item.binary})`); let mt = 'application/octet-stream'; if (!item.binary) { mt = 'text/plain';/*types*/ } else {/*types*/ } const blc = item.binary ? base64ToBlob(item.contents, mt) : item.contents; triggerDownload(new Blob([blc], { type: mt }), fn); }
    function addFilesToZip(fp, zipFldr) { if (!sourceCodeData?.files) { log.warn("Cannot zip: data missing."); return; } const pfx = fp ? (fp.endsWith('/') ? fp : fp + '/') : ""; sourceCodeData.files.forEach(i => { if (i.name.startsWith(pfx)) { const rp = i.name.substring(pfx.length); if (rp && i.contents !== undefined) { const c = i.binary ? base64ToBlob(i.contents) : i.contents; zipFldr.file(rp, c, { binary: !!i.binary }); log.debug(`Zip Add: ${rp}`); } } }); }

    async function downloadFolderAsZip(folderPath) {
        const jszipReady = await loadJszipFromCDNIfNeeded();
        if (!jszipReady) { log.error("Aborting zip: JSZip not ready."); alert("JSZip library failed to load."); return; }

        const folderName = folderPath ? (folderPath.split('/').pop() || folderPath) : 'project_root';
        const zipFileName = `${folderName}.zip`;
        log.info(`Zipping folder: ${folderPath || '(root)'} as ${zipFileName}`);
        showLoadingIndicator(`Zipping "${folderName}"...`); // Show zipping status

        try {
            const zip = new JSZip();
            const zipRootFolder = zip.folder(folderName);
            addFilesToZip(folderPath, zipRootFolder);
            if (Object.keys(zipRootFolder.files).length === 0 && !isFolder(folderPath) && folderPath !== "") { log.warn("Folder empty."); }
            log.debug("Generating ZIP blob...");
            const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            triggerDownload(zipBlob, zipFileName);
            log.info(`ZIP generated successfully for ${folderPath || '(root)'}`);
        } catch (error) {
            log.error("Error creating ZIP file:", error);
            alert(`Failed to create ZIP archive for "${folderName}". Check console.`);
        } finally {
            hideLoadingIndicator(); // Hide indicator after zipping attempt
        }
    }


    // --- Visibility Control ---
    function shouldElementsBeVisible() { const b = document.querySelector(CODE_VIEWER_SEL); const ds = b?.getAttribute('data-state'), ap = b?.getAttribute('aria-pressed'); if (ds) return ds === 'on'; if (ap) return ap === 'true'; return false; }
    function updateIndividualIconVisibility() { const show = shouldElementsBeVisible(); log.debug(`Updating individual icon visibility. Show: ${show}`); document.querySelectorAll(`.${GRAB_ICON_CLS}:not(#${EXPORT_BTN_ID} > svg)`).forEach(i => i.classList.toggle(HIDDEN_CLS, !show)); }


    // --- DOM Manipulation & Event Handling ---
    function createDownloadAllButton() { if (document.getElementById(EXPORT_BTN_ID)) return document.getElementById(EXPORT_BTN_ID); log.debug("Creating 'Download All' button element..."); const btn = document.createElement('button'); btn.id = EXPORT_BTN_ID; btn.className = "inline-flex items-center justify-center gap-1 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none bg-background hover:bg-primary/20 border border-border h-7 px-2 rounded-md py-1"; btn.type = 'button'; btn.title = 'Download All Project Files as ZIP'; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.classList.add('h-4', 'w-4', GRAB_ICON_CLS); svg.innerHTML = `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`; btn.appendChild(svg); btn.addEventListener('click', async (e) => { e.stopPropagation(); log.info("Download All button clicked."); const dataReady = await ensureDataFetched(); if (!dataReady) { log.error("DL All cancelled: Data fetch failed."); return; } const jszipReady = await loadJszipFromCDNIfNeeded(); if (!jszipReady) { log.error("DL All cancelled: JSZip could not be loaded."); return; } await downloadFolderAsZip(""); }); return btn; }
    function injectDownloadAllButtonWhenReady() {
        if (document.getElementById(EXPORT_BTN_ID)) {
            log.debug("DL All button already injected.");
            return;
        }
        const cursorPointerElement = document.querySelector(TOOLBAR_SEL);
        const targetToolbar = cursorPointerElement?.parentElement; if (targetToolbar) {
            log.info("Target toolbar found. Injecting DL All button...");
            const dlAllBtn = createDownloadAllButton();
            if (dlAllBtn) {
                const children = Array.from(targetToolbar.children);
                const insertPosition = Math.min(2, children.length - 1);
                targetToolbar.insertBefore(dlAllBtn, children[insertPosition]);
                log.info("DL All injected at second to last position.");
            }
        } else {
            buttonInjectionRetries++;
            if (buttonInjectionRetries <= INJECT_MAX_TRIES) {
                log.warn(`Toolbar not found. Retrying injection (${buttonInjectionRetries}/${INJECT_MAX_TRIES})...`);
                setTimeout(injectDownloadAllButtonWhenReady, INJECT_DELAY);
            } else {
                log.error("Max retries reached for DL All button injection.");
            }
        }
    }
    function addDownloadIconsToFileEntries() { log.debug("Running add/update icon placeholders..."); const entries = document.querySelectorAll(FILE_ITEM_SEL); if (!entries.length) { log.debug("No file entries found."); return; } const vis = shouldElementsBeVisible(); const svgPath = `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`; entries.forEach(e => { let svg = e.querySelector(`.${GRAB_ICON_CLS}`); if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.classList.add('shrink-0', 'h-4', 'w-4', 'ml-auto', 'text-muted-foreground', GRAB_ICON_CLS, 'opacity-50', 'hover:opacity-100', 'transition-opacity'); svg.style.cursor = 'pointer'; svg.innerHTML = svgPath; if (!vis) svg.classList.add(HIDDEN_CLS); e.appendChild(svg); svg.addEventListener('click', handleDownloadClick); log.debug(`Added icon placeholder.`); } else { svg.classList.toggle(HIDDEN_CLS, !vis); } }); log.debug("Finished icon processing cycle."); }
    async function handleDownloadClick(event) { /* ... (calls ensureDataFetched -> handleDownloadLogic) ... */ event.stopPropagation(); const icon = event.currentTarget; const entry = icon.closest(FILE_ITEM_SEL); log.debug("Individual download icon clicked."); const dataReady = await ensureDataFetched(); if (!dataReady) { log.error("DL cancelled: data fetch failed."); return; } const currentPath = entry?.getAttribute('data-path'); if (!currentPath) { const nameSpan = entry?.querySelector('span.truncate'); const name = nameSpan?.textContent?.trim(); const pI = name ? Array.from(pathToItemMap.keys()).find(p => p === name || p.endsWith(`/${name}`)) : null; if (pI) { log.warn(`Path resolved via fallback for "${name}"`); entry.setAttribute('data-path', pI); handleDownloadLogic(pI); } else { alert("DL failed: path unknown after fetch."); log.error("Path association failed completely:", entry); return; } } else { handleDownloadLogic(currentPath); } }
    async function handleDownloadLogic(currentPath) { /* ... (calls loadJszipIfNeeded -> downloadFolderAsZip) ... */ log.info(`Handling DL request for path: ${currentPath}`); const itemData = findSourceItem(currentPath); const isItemFolder = (itemData?.isImplicitFolder || isFolder(currentPath)); if (isItemFolder) { log.debug("Item is folder, ensuring JSZip..."); const jszipReady = await loadJszipFromCDNIfNeeded(); if (!jszipReady) { log.error("Folder DL cancelled: JSZip load failed."); alert("JSZip library failed."); return; } log.debug("JSZip ready for folder DL."); await downloadFolderAsZip(currentPath); } else if (itemData && typeof itemData.contents !== 'undefined') { log.debug("Item is file."); downloadFile(itemData); } else if (!itemData) { if (isFolder(currentPath)) { log.warn("Folder check passed but itemData missing?"); await downloadFolderAsZip(currentPath); } else { log.error(`Item data not found: ${currentPath}`); alert("Cannot find data."); } } else { log.warn(`Item not downloadable: ${currentPath}`, itemData); alert("Item not downloadable."); } }


    // --- Initialization & Observation ---
    function setupTriggerButtonObserver() { if (triggerButtonObserver) return; const btn = document.querySelector(CODE_VIEWER_SEL); if (!btn) { log.warn("Trigger btn obs target missing. Retrying..."); setTimeout(setupTriggerButtonObserver, 2000); return; } const cfg = { attributes: true, attributeFilter: ['data-state', 'aria-pressed'] }; log.info("Setting up trigger btn observer..."); triggerButtonObserver = new MutationObserver(() => { log.debug('Trigger button state changed.'); updateIndividualIconVisibility(); }); triggerButtonObserver.observe(btn, cfg); updateIndividualIconVisibility(); }
    function setupSidebarObserver() { if (sidebarObserver) return; const tgt = document.querySelector(SIDEBAR_SEL)?.parentElement || document.body; if (!tgt) { log.error("Sidebar obs target missing."); return; } const cfg = { childList: true, subtree: true }; log.info("Setting up sidebar observer..."); let tmr; const dbUpdate = () => { clearTimeout(tmr); tmr = setTimeout(() => { log.debug("Debounced sidebar update running..."); addDownloadIconsToFileEntries(); if (sourceCodeData) associatePathsToExistingIcons(); updateIndividualIconVisibility(); }, 350); }; sidebarObserver = new MutationObserver(ml => { let rel = ml.some(m => m.type === 'childList' && (Array.from(m.addedNodes).some(n => n.nodeType === 1 && (n.matches?.(FILE_ITEM_SEL) || n.querySelector?.(FILE_ITEM_SEL))) || Array.from(m.removedNodes).some(n => n.nodeType === 1 && n.matches?.(FILE_ITEM_SEL)))); if (rel) { log.debug('Relevant sidebar DOM change detected.'); dbUpdate(); } }); sidebarObserver.observe(tgt, cfg); }

    async function initializeDownloads() {
        log.info("Initializing script...");
        addGlobalStyles(); // Add CSS rules (includes indicator styles now)
        createLoadingIndicator(); // Create the hidden indicator element

        projectId = getProjectIdFromUrl();
        if (!projectId) { log.error("Initialization failed: Project ID missing."); return; }

        idToken = getIdTokenFromDom(); // Get token from DOM
        // Fallback: use Firebase intercepted token if DOM extraction failed
        if (!idToken && firebaseIdToken) {
            idToken = firebaseIdToken;
            log.info("Using Firebase intercepted token.");
        }
        // Fallback: try IndexedDB
        if (!idToken) {
            const idbToken = await getIdTokenFromIndexedDB();
            if (idbToken) {
                idToken = idbToken;
                log.info("Using token from IndexedDB.");
            }
        }
        if (!idToken) {
            log.warn("Token not found initially. Will retry...");
            const retryGetToken = async (attempt) => {
                if (attempt > 5 || idToken) return;
                await new Promise(r => setTimeout(r, 2000));
                // Check intercepted token first (may have arrived while waiting)
                if (firebaseIdToken) {
                    idToken = firebaseIdToken;
                    log.info(`Token acquired from API interceptor on retry ${attempt}.`);
                    window.postMessage({ type: 'LG_AUTH_TOKEN', idToken }, '*');
                    return;
                }
                const idbToken = await getIdTokenFromIndexedDB();
                if (idbToken && !idToken) {
                    idToken = idbToken;
                    log.info(`Token acquired from IndexedDB on retry ${attempt}.`);
                    window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: idbToken }, '*');
                } else if (!idToken) {
                    retryGetToken(attempt + 1);
                }
            };
            retryGetToken(1);
        }
        else { log.info("Initial authentication token acquired."); }

        // --- Send token to content-script via postMessage ---
        if (idToken) {
            window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: idToken }, '*');
            log.debug("Sent idToken to content-script via postMessage.");
        }

        // --- Listen for token requests from content-script ---
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data?.type === 'LG_TOKEN_REQUEST') {
                log.debug("Received token request from content-script.");
                // Re-extract token in case it changed
                const freshToken = getIdTokenFromDom() || firebaseIdToken;
                if (freshToken) {
                    idToken = freshToken;
                    window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: freshToken }, '*');
                    log.debug("Sent fresh idToken to content-script.");
                } else {
                    window.postMessage({ type: 'LG_AUTH_TOKEN', idToken: null }, '*');
                    log.warn("Token request received but token not found.");
                }
            }
        });

        // --- Don't fetch data initially ---

        log.info("Setting up initial UI elements and observers...");
        injectDownloadAllButtonWhenReady(); // Start trying to inject the button
        addDownloadIconsToFileEntries(); // Add icon placeholders
        setupTriggerButtonObserver(); // Watches toggle button
        setupSidebarObserver(); // Watches sidebar content

        log.info("Initialization complete. Ready for download requests.");
    }

    // --- Run Script ---
    // Install Firebase interceptor IMMEDIATELY so we catch token refresh
    setupFirebaseTokenInterceptor();
    // Initialize UI after short delay to let page load
    setTimeout(initializeDownloads, 1800);

})(); // End of Tampermonkey IIFE
