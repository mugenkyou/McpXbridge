let ws = null;
let activeTabId = null;
let reconnectAttempt = 0;
let lastErrorMessage = '';
let serverUrl = 'ws://127.0.0.1:29100';

// ---------- Chrome API helpers (callback-based, safe in MV3) ----------
function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || [])));
}
function tabsUpdate(tabId, updateProps) {
  return new Promise((resolve) => chrome.tabs.update(tabId, updateProps, (tab) => resolve(tab)));
}
function scriptingExecuteScript(args) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(args, (results) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(results || []);
    });
  });
}
function windowsGetAll() {
  return new Promise((resolve) => chrome.windows.getAll({}, (wins) => resolve(wins || [])));
}

function sendPopupStatus(status) {
  // Use callback to absorb "Receiving end does not exist" when popup isn't open
  try {
    chrome.runtime.sendMessage({ status }, () => {
      // Accessing lastError prevents the uncaught promise rejection
      // when there are no listeners (e.g., popup closed)
      void chrome.runtime.lastError;
    });
  } catch (_err) {
    // ignore sync errors just in case
  }
}

// Auto-reconnect disabled; manual connect only

async function getActiveTabId() {
  if (!activeTabId) {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    const tab = tabs[0];
    activeTabId = tab && tab.id;
  }
  return activeTabId;
}

async function updateActiveTab() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs[0];
  activeTabId = tab && tab.id;
  return activeTabId;
}

async function exec(tabId, func, args = []) {
  try {
    const results = await scriptingExecuteScript({ target: { tabId }, func, args });
    const first = results && results[0];
    return first ? first.result : null;
  } catch (error) {
    console.error('Script execution error:', error);
    return null;
  }
}

// Handle messages from the MCP server
function handleMCPMessage(message) {
  try {
    const { id, type, payload } = message;
    console.log('Received MCP message:', type, payload, id);
    
    switch (type) {
      case 'browser_navigate':
        handleNavigate(id, payload);
        break;
      case 'browser_go_back':
        handleGoBack(id);
        break;
      case 'browser_go_forward':
        handleGoForward(id);
        break;
      case 'browser_wait':
        handleWait(id, payload);
        break;
      case 'browser_click':
        handleClick(id, payload);
        break;
      case 'browser_type':
        handleType(id, payload);
        break;
      case 'browser_hover':
        handleHover(id, payload);
        break;
      case 'browser_snapshot':
        handleSnapshot(id);
        break;
      case 'browser_screenshot':
        handleScreenshot(id);
        break;
      case 'getUrl':
        handleGetUrl(id);
        break;
      case 'getTitle':
        handleGetTitle(id);
        break;
      default:
        console.log('Unknown message type:', type);
        if (ws && ws.readyState === WebSocket.OPEN && id) {
           ws.send(JSON.stringify({ id, error: `Unknown message type: ${type}` }));
        }
    }
  } catch (error) {
    console.error('Error handling MCP message:', error);
    lastErrorMessage = String(error?.message || error);
    if (message?.id && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: message.id, error: lastErrorMessage }));
    }
  }
}

async function handleNavigate(id, payload) {
  const tabId = await getActiveTabId();
  if (tabId && payload.url) {
    await tabsUpdate(tabId, { url: payload.url });
    sendResult(id, true);
  } else {
    sendResult(id, false);
  }
}

async function handleGoBack(id) {
  const tabId = await getActiveTabId();
  if (tabId) {
    await exec(tabId, () => { history.back(); });
    sendResult(id, true);
  } else {
    sendResult(id, false);
  }
}

async function handleGoForward(id) {
  const tabId = await getActiveTabId();
  if (tabId) {
    await exec(tabId, () => { history.forward(); });
    sendResult(id, true);
  } else {
    sendResult(id, false);
  }
}

async function handleWait(id, payload) {
  const time = payload?.time || 1;
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  sendResult(id, true);
}

async function handleClick(id, payload) {
  const tabId = await getActiveTabId();
  // Server sends 'element', not 'selector'
  const selector = payload.element || payload.selector;
  if (tabId && selector) {
    await exec(tabId, (sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.click();
        return true;
      }
      return false;
    }, [selector]);
    sendResult(id, true);
  } else {
    sendResult(id, false);
  }
}

async function handleType(id, payload) {
  const tabId = await getActiveTabId();
  const selector = payload.element || payload.selector;
  if (tabId && selector && payload.text) {
    await exec(tabId, (sel, text, mode) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const applyValue = (node) => {
        if (mode === 'append') node.value = (node.value || '') + text;
        else node.value = text;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        applyValue(el);
        return true;
      }
      if (el.isContentEditable) {
        if (mode === 'append') el.textContent = (el.textContent || '') + text;
        else el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, [selector, payload.text, payload.mode || 'replace']);
    sendResult(id, true);
  } else {
    sendResult(id, false);
  }
}

async function handleHover(id, payload) {
  const tabId = await getActiveTabId();
  const selector = payload.element || payload.selector;
  if (tabId && selector) {
    await exec(tabId, (sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return true;
      }
      return false;
    }, [selector]);
    sendResult(id, true);
  } else {
    sendResult(id, false);
  }
}

async function handleSnapshot(id) {
  const tabId = await getActiveTabId();
  if (tabId) {
    try {
      const result = await exec(tabId, () => {
        const dims = { width: window.innerWidth, height: window.innerHeight };
        const scroll = { x: window.scrollX, y: window.scrollY };
        return {
          url: window.location.href,
          title: document.title,
          viewport: dims,
          scroll,
          html: document.documentElement.outerHTML
        };
      });
      sendResult(id, result);
    } catch (error) {
      console.error('Snapshot error:', error);
      sendResult(id, null);
    }
  } else {
    sendResult(id, null);
  }
}

async function handleScreenshot(id) {
  try {
    // Give the tab a brief moment to settle
    await new Promise(resolve => setTimeout(resolve, 300));
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
    // Return the data URL; the server/tool declares mimeType 'image/png'
    sendResult(id, dataUrl);
  } catch (error) {
    console.error('Screenshot error:', error);
    sendResult(id, null);
  }
}

async function handleGetUrl(id) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    sendResult(id, null);
    return;
  }
  try {
    const url = await retry(async () => await exec(tabId, () => window.location.href), 3, 300);
    sendResult(id, url);
  } catch (error) {
    console.error('getUrl error:', error);
    sendResult(id, null);
  }
}

async function handleGetTitle(id) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    sendResult(id, null);
    return;
  }
  try {
    const title = await retry(async () => await exec(tabId, () => document.title), 3, 300);
    sendResult(id, title);
  } catch (error) {
    console.error('getTitle error:', error);
    sendResult(id, null);
  }
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function retry(fn, times = 3, delayMs = 300) {
  let lastErr;
  for (let i = 0; i < times; i++) {
    try {
      const res = await fn();
      if (res !== undefined && res !== null) return res;
    } catch (e) {
      lastErr = e;
    }
    if (i < times - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  if (lastErr) throw lastErr;
  return null;
}

function sendResult(id, result) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Return { id, result } to satisfy sender.ts waiting for that ID
    ws.send(JSON.stringify({ 
      id,
      result
    }));
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return true;
  }
  
  try {
    ws = new WebSocket(serverUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected to MCP server');
      sendPopupStatus('Connected');
      reconnectAttempts = 0;
      // Send initial connection message
      ws.send(JSON.stringify({ 
        type: 'extension_connected',
        data: { version: '1.0.0', capabilities: ['navigate', 'click', 'type', 'hover', 'snapshot'] }
      }));
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected from MCP server');
      sendPopupStatus('Disconnected');
      const attempt = ++reconnectAttempt;
      ws = null;
      // Backoff up to 30s
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
      setTimeout(() => {
        if (!ws) connect();
      }, delay);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      lastErrorMessage = String(error?.message || 'WebSocket error');
      sendPopupStatus('WebSocket error');
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMCPMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
    
    return true;
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    lastErrorMessage = String(error?.message || 'Failed to create WebSocket');
    sendPopupStatus('Failed to open WebSocket');
    return false;
  }
}

// scheduleReconnect removed

// Listen for tab updates to keep track of active tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId === tabId) {
    activeTabId = null;
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd === 'connect') {
    reconnectAttempt = 0;
    const ok = connect();
    sendResponse({ success: ok, lastError: lastErrorMessage });
    return false; // synchronous response
  }
  
  if (msg?.cmd === 'getStatus') {
    const connected = ws && ws.readyState === WebSocket.OPEN;
    sendResponse({ status: connected ? 'connected' : 'disconnected', lastError: lastErrorMessage, url: serverUrl });
    return false; // synchronous response
  }
  
  if (msg?.cmd === 'disconnect') {
    if (ws) {
      ws.close();
      ws = null;
    }
    sendResponse({ success: true });
    return false; // synchronous response
  }
});

// alarms reconnect removed

// Keyboard commands support
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'connect') {
    connect();
  } else if (command === 'disconnect') {
    if (ws) {
      ws.close();
      ws = null;
      sendPopupStatus('Disconnected');
    }
  }
});

// Disconnect when the last browser window is closed
chrome.windows.onRemoved.addListener(async () => {
  const windows = await windowsGetAll();
  if (windows.length === 0 && ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
    sendPopupStatus('Disconnected');
    // Clear connected tab marker so next session starts disconnected
    try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  }
});

// Clear stale state when the extension service worker starts
chrome.runtime.onStartup?.addListener(() => {
  try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  sendPopupStatus('Disconnected');
});

chrome.runtime.onInstalled.addListener(() => {
  try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  sendPopupStatus('Disconnected');
});

// Best-effort cleanup when the service worker is about to be suspended
chrome.runtime.onSuspend?.addListener(() => {
  try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
});



