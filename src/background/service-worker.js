import { STATIONS, getStationCode } from '../config/stations.js';

const MONITOR_ALARM = 'railwatch-monitor';
const REMINDER_ALARM = 'railwatch-reminder';
const CHECK_INTERVAL_MINUTES = 3; // keep this >= 3, hammering the site risks getting blocked
const MAX_HISTORY_SIZE = 20;
const SITE_ORIGIN = 'https://eticket.railway.gov.bd';
const BOOKING_URL = `${SITE_ORIGIN}/`;
const SITE_PATTERN = `${SITE_ORIGIN}/*`;
const TAB_RELOAD_TIMEOUT_MS = 20000;
const RESULTS_POLL_MS = 1000;
const RESULTS_MAX_POLLS = 25;
const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

// IMPORTANT (MV3): this worker is killed after ~30s idle and every global below is reset.
// The globals are only a cache; loadState() re-reads chrome.storage at the start of every event.
let isMonitoring = false;
let currentConfig = null;
let lastAvailabilityState = null;
let lastNotifiedAvailable = false;
let monitorTab = null; // { id, lockedPath }
let checkHistory = [];
let checkInFlight = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const run = (fn) => { fn(sendResponse); return true; };
  switch (request.action) {
    case 'startMonitoring': return run((r) => handleStartMonitoring(request.config, r));
    case 'stopMonitoring': return run(handleStopMonitoring);
    case 'getStatus': return run(handleGetStatus);
    case 'setReminder': return run((r) => handleSetReminder(request.reminder, r));
    case 'clearAllData': return run(handleClearAllData);
    case 'checkNow': return run(handleCheckNow);
    case 'checkConnection': return run(handleCheckConnection);
    case 'connectRailway': return run(handleConnectRailway);
    case 'testNotification': return run(handleTestNotification);
    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return true;
  }
});

async function loadState() {
  const r = await chrome.storage.local.get([
    'isMonitoring', 'monitoringConfig', 'checkHistory',
    'lastAvailabilityState', 'lastNotifiedAvailable', 'monitorTab'
  ]);
  isMonitoring = !!r.isMonitoring;
  checkHistory = Array.isArray(r.checkHistory) ? r.checkHistory.slice(-MAX_HISTORY_SIZE) : [];
  lastAvailabilityState = typeof r.lastAvailabilityState === 'boolean' ? r.lastAvailabilityState : null;
  lastNotifiedAvailable = !!r.lastNotifiedAvailable;
  monitorTab = r.monitorTab || null;
  currentConfig = null;
  if (isMonitoring && r.monitoringConfig) {
    try {
      currentConfig = normalizeConfig(r.monitoringConfig);
    } catch (_e) {
      isMonitoring = false;
    }
  }
}

async function handleGetStatus(sendResponse) {
  await loadState();
  sendResponse({ success: true, isMonitoring, config: currentConfig, history: checkHistory });
}

async function handleConnectRailway(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ url: SITE_PATTERN });
    if (tabs.length > 0 && tabs[0].id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      await chrome.tabs.create({ url: BOOKING_URL, active: true });
    }
    const status = await getConnectionStatus();
    sendResponse({ success: true, ...status });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCheckConnection(sendResponse) {
  try {
    const status = await getConnectionStatus();
    sendResponse({ success: true, ...status });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleTestNotification(sendResponse) {
  const err = await createNotification(`railwatch-test-${Date.now()}`, {
    title: 'RailWatch BD: test',
    message: 'If you can see this, notifications work.'
  });
  sendResponse(err ? { success: false, error: `Notification failed: ${err}` } : { success: true });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === MONITOR_ALARM) {
    await performAvailabilityCheck('alarm');
  } else if (alarm.name === REMINDER_ALARM) {
    await triggerReminder();
  }
});

// Notification ids are not kept in memory (worker may have restarted); any RailWatch notification opens the site.
function openBooking(notificationId) {
  if (String(notificationId).startsWith('railwatch-') && !String(notificationId).startsWith('railwatch-test-')) {
    chrome.tabs.create({ url: BOOKING_URL });
  }
  chrome.notifications.clear(notificationId);
}
chrome.notifications.onClicked.addListener(openBooking);
chrome.notifications.onButtonClicked.addListener((id, idx) => { if (idx === 0) openBooking(id); });

chrome.runtime.onStartup.addListener(() => { restoreState(); });
chrome.runtime.onInstalled.addListener(() => { restoreState(); });

async function handleStartMonitoring(config, sendResponse) {
  try {
    const validated = normalizeConfig(config);

    await chrome.storage.local.set({
      monitoringConfig: validated,
      isMonitoring: true,
      checkHistory: [],
      lastAvailabilityState: null,
      lastNotifiedAvailable: false,
      monitorTab: null
    });
    await loadState();
    await ensureMonitorAlarm();

    updatePopup({
      lastCheck: new Date().toISOString(),
      nextCheck: nextCheckTimestamp(),
      status: 'Checking availability...',
      availability: false,
      history: checkHistory
    });

    sendResponse({ success: true }); // answer the popup right away; the first check can take a while
    await performAvailabilityCheck('start');
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleStopMonitoring(sendResponse) {
  try {
    await chrome.alarms.clear(MONITOR_ALARM);
    await chrome.storage.local.set({ isMonitoring: false, monitorTab: null });
    await loadState();
    updatePopup({ status: 'Monitoring stopped', availability: false, history: checkHistory });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSetReminder(reminder, sendResponse) {
  try {
    await chrome.storage.local.set({ reminder });
    await chrome.alarms.clear(REMINDER_ALARM);

    if (reminder?.enabled && reminder?.dateTime) {
      const when = new Date(reminder.dateTime).getTime();
      if (!Number.isFinite(when) || when <= Date.now()) {
        throw new Error('Reminder date/time must be in the future');
      }
      await chrome.alarms.create(REMINDER_ALARM, { when });
    }
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleClearAllData(sendResponse) {
  try {
    await chrome.alarms.clearAll();
    await chrome.storage.local.clear();
    await loadState();
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCheckNow(sendResponse) {
  try {
    await loadState();
    if (!isMonitoring || !currentConfig) {
      sendResponse({ success: false, error: 'Monitoring is not active' });
      return;
    }
    sendResponse({ success: true });
    await performAvailabilityCheck('manual');
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function ensureMonitorAlarm() {
  await chrome.alarms.clear(MONITOR_ALARM);
  await chrome.alarms.create(MONITOR_ALARM, {
    delayInMinutes: CHECK_INTERVAL_MINUTES,
    periodInMinutes: CHECK_INTERVAL_MINUTES
  });
}

function nextCheckTimestamp() {
  return new Date(Date.now() + CHECK_INTERVAL_MINUTES * 60 * 1000).toISOString();
}

function normalizeStationName(input) {
  return String(input || '').trim();
}

function resolveStationCode(name) {
  const cleaned = normalizeStationName(name);
  if (!cleaned) return null;
  const direct = getStationCode(cleaned);
  if (direct) return direct;
  const found = Object.entries(STATIONS).find(([station]) => station.toLowerCase() === cleaned.toLowerCase());
  return found ? found[1] : null;
}

function normalizeConfig(config) {
  const from = normalizeStationName(config?.from);
  const to = normalizeStationName(config?.to);
  const date = String(config?.date || '').trim();
  const train = normalizeStationName(config?.train) || null;
  const className = normalizeStationName(config?.className) || null;

  if (!from || !to || !date) throw new Error('From, To and Journey Date are required');
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('Origin and destination must be different');

  const fromCode = resolveStationCode(from);
  const toCode = resolveStationCode(to);
  // Station codes are optional metadata. Any route is allowed; we read whatever results your tab shows.

  return { from, to, fromCode, toCode, date, train, className };
}

function performAvailabilityCheck(source) {
  if (checkInFlight) return checkInFlight; // alarm + manual click must not run two reloads at once
  checkInFlight = runCheck(source).finally(() => { checkInFlight = null; });
  return checkInFlight;
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch (_e) { return ''; }
}

async function pickMonitorTab() {
  if (monitorTab?.id != null) {
    const t = await chrome.tabs.get(monitorTab.id).catch(() => null);
    if (t?.url?.startsWith(SITE_ORIGIN)) return t;
  }
  const tabs = await chrome.tabs.query({ url: SITE_PATTERN });
  if (!tabs.length) return null;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const pick = tabs.find((t) => t.id === active?.id) || tabs.find((t) => t.id) || tabs[0];
  monitorTab = { id: pick.id, lockedPath: null };
  await chrome.storage.local.set({ monitorTab });
  return pick;
}

/**
 * Core check: reload the user's own Railway results tab, wait until the SPA has actually rendered the
 * results, then read the rendered page via content.js. Nothing is forged; it is a normal page load.
 */
async function runCheck(source) {
  await loadState();
  if (!isMonitoring || !currentConfig) return;

  const base = () => ({ lastCheck: new Date().toISOString(), nextCheck: nextCheckTimestamp(), history: checkHistory });

  try {
    const tab = await pickMonitorTab();
    if (!tab?.id) {
      updatePopup({
        ...base(), availability: false,
        status: 'No Railway tab open. Search your journey on the website, keep that tab open, then click Refresh Connection.',
        connectionStatus: 'Not connected: open your search results tab.'
      });
      return;
    }

    // Never reload a tab the user has moved on from (seat selection / payment would be lost).
    if (monitorTab?.lockedPath && pathOf(tab.url) !== monitorTab.lockedPath) {
      updatePopup({
        ...base(),
        status: 'Monitored tab is no longer on the results page. Go back to the results (or Stop and Start again). Not reloading it.'
      });
      return;
    }

    updatePopup({ ...base(), status: source === 'manual' ? 'Running manual check...' : 'Refreshing results tab...' });

    const reloaded = await reloadAndWait(tab.id, TAB_RELOAD_TIMEOUT_MS);
    if (!reloaded) {
      updatePopup({ ...base(), availability: false, status: 'Tab took too long to reload; will retry next check.' });
      return;
    }

    const loginResponse = await waitForContentScript(tab.id, { action: 'checkLoginStatus' });
    if (!loginResponse?.success) {
      updatePopup({ ...base(), status: 'Could not talk to the Railway tab (content script missing). Reload the extension and the tab.' });
      return;
    }
    if (!loginResponse.isLoggedIn) {
      updatePopup({
        ...base(), availability: false,
        status: 'Login required before monitoring.',
        connectionStatus: 'Connected, but login required. Please sign in on the railway website.'
      });
      return;
    }

    const extraction = await readResults(tab.id);
    const availability = normalizeContentExtraction(extraction, currentConfig);

    if (!availability) {
      // Do NOT report "no tickets" here: we simply could not read any results.
      updatePopup({
        ...base(),
        status: "Couldn't find train results on the page. Make sure the monitored tab shows your search results (not the home or login page).",
        connectionStatus: 'Connected and logged in.'
      });
      return;
    }

    if (!monitorTab.lockedPath) {
      monitorTab.lockedPath = pathOf(tab.url);
    }

    const checkResult = {
      timestamp: new Date().toISOString(),
      available: availability.available,
      trainName: availability.trainName || 'Unknown',
      classes: availability.classes || [],
      details: availability.details || {}
    };
    checkHistory.push(checkResult);
    checkHistory = checkHistory.slice(-MAX_HISTORY_SIZE);

    // Notify on "not available -> available", and also if the very first check already finds tickets.
    if (availability.available && !lastNotifiedAvailable) {
      await sendAvailabilityNotification(availability);
      lastNotifiedAvailable = true;
    } else if (!availability.available) {
      lastNotifiedAvailable = false;
    }
    lastAvailabilityState = availability.available;

    await chrome.storage.local.set({ checkHistory, lastAvailabilityState, lastNotifiedAvailable, monitorTab });

    updatePopup({
      ...base(),
      status: availability.available ? 'Tickets available' : 'No tickets available',
      availability: availability.available,
      details: availability.details || {},
      classes: availability.classes || [],
      trainName: availability.trainName || 'All trains',
      connectionStatus: 'Connected and logged in. Monitoring is ready.'
    });
  } catch (error) {
    updatePopup({ ...base(), availability: false, status: `Error: ${error.message}` });
  }
}

/** Reload and resolve true once the tab has gone loading -> complete. Listener is registered BEFORE reloading. */
async function reloadAndWait(tabId, timeoutMs) {
  const done = new Promise((resolve) => {
    let sawLoading = false;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) finish(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
  await chrome.tabs.reload(tabId, { bypassCache: true });
  return done;
}

function sendMessageSafe(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response);
      });
    } catch (_error) {
      resolve(null);
    }
  });
}

async function waitForContentScript(tabId, message, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const res = await sendMessageSafe(tabId, message);
    if (res) return res;
    await sleep(500);
  }
  return null;
}

/**
 * The railway site is a single-page app: 'complete' fires before the results are drawn.
 * Poll until the page reports results AND the result count is stable across two polls.
 */
async function readResults(tabId) {
  let last = null;
  let lastReady = null;
  for (let i = 0; i < RESULTS_MAX_POLLS; i++) {
    const res = await sendMessageSafe(tabId, {
      action: 'extractAvailability',
      fromStation: currentConfig.from,
      toStation: currentConfig.to,
      journeyDate: currentConfig.date
    });
    if (res?.success && res.data?.ready) {
      lastReady = res;
      if (res.data.signature === last) return res;
      last = res.data.signature;
    }
    await sleep(RESULTS_POLL_MS);
  }
  return lastReady;
}

async function getConnectionStatus() {
  const tabs = await chrome.tabs.query({ url: SITE_PATTERN });
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return { connected: false, loggedIn: false, message: 'Not connected: open your Bangladesh Railway search results tab.' };
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    const response = await sendMessageSafe(tab.id, { action: 'checkLoginStatus' });
    if (response?.success && response.isLoggedIn) {
      return { connected: true, loggedIn: true, message: 'Connected and logged in. Monitoring is ready.' };
    }
  }
  return { connected: true, loggedIn: false, message: 'Connected, but login required. Please sign in on the railway website.' };
}

function normalizeContentExtraction(response, config) {
  if (!response?.success || !response?.data?.ready) return null;

  const trains = Array.isArray(response.data.trains) ? response.data.trains : [];
  if (!trains.length) return null;

  let filtered = trains;
  if (config.train) {
    const wanted = config.train.toLowerCase();
    const byTrain = trains.filter((t) => String(t.trainName || '').toLowerCase().includes(wanted));
    if (byTrain.length) filtered = byTrain;
  }

  const flattenedClasses = [];
  let available = false;
  let selectedTrain = null;
  const wantedClassTokens = getClassTokens(config.className);
  let totalAvailableSeats = 0;

  for (const train of filtered) {
    const classList = Array.isArray(train.classes) ? train.classes : [];
    const usableClasses = config.className
      ? classList.filter((c) => classMatchesWanted(c.name, wantedClassTokens))
      : classList;
    // If a class was chosen but nothing matched its aliases, fall back to all classes (avoid false negatives).
    const effectiveClasses = usableClasses.length > 0 ? usableClasses : classList;

    for (const cls of effectiveClasses) {
      const seats = Number.parseInt(cls.availableSeats ?? cls.seats ?? 0, 10) || 0;
      // content.js already decided `available` with proper "unavailable"/"not available" handling.
      const isAvailable = seats > 0 || cls.available === true;

      flattenedClasses.push({ name: cls.name || 'Unknown', available: isAvailable, seats, availableSeats: seats });
      if (isAvailable) {
        available = true;
        totalAvailableSeats += seats;
        selectedTrain = train.trainName || selectedTrain;
      }
    }

    if (!selectedTrain && train.trainName && train.trainName !== 'Unknown Train') {
      selectedTrain = train.trainName;
    }
  }

  if (!flattenedClasses.length) return null;

  return {
    available,
    trainName: selectedTrain || filtered[0]?.trainName || `${config.from} -> ${config.to}`,
    classes: flattenedClasses,
    details: { availableSeats: String(totalAvailableSeats) },
    from: config.from,
    to: config.to,
    date: config.date
  };
}

function normalizeClassToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getClassTokens(className) {
  const t = normalizeClassToken(className);
  return t ? [t] : [];
}

// Dropdown values are the site's own class codes (SNIGDHA, S_CHAIR, AC_B...). Exact match first, loose match for typed text.
function classMatchesWanted(className, wantedTokens) {
  if (!wantedTokens.length) return true;
  const classToken = normalizeClassToken(className);
  return wantedTokens.some((w) => classToken === w || (w.length >= 5 && (classToken.includes(w) || w.includes(classToken))));
}

/** Resolves with the error message (string) or null on success. iconUrl is REQUIRED by Chrome for 'basic'. */
function createNotification(id, options) {
  return new Promise((resolve) => {
    chrome.notifications.create(id, { type: 'basic', iconUrl: ICON_URL, priority: 2, requireInteraction: true, ...options }, () => {
      const err = chrome.runtime.lastError?.message || null;
      if (err) console.warn('Notification error:', err);
      resolve(err);
    });
  });
}

async function sendAvailabilityNotification(availability) {
  const classes = (availability.classes || []).filter((c) => c.available).map((c) => c.name);

  let message = `${currentConfig.from} -> ${currentConfig.to}\nDate: ${currentConfig.date}`;
  if (availability.trainName) message += `\nTrain: ${availability.trainName}`;
  if (classes.length > 0) message += `\nClasses: ${classes.join(', ')}`;
  if (availability.details?.availableSeats) message += `\nSeats: ${availability.details.availableSeats}`;

  await createNotification(`railwatch-${Date.now()}`, {
    title: 'RailWatch BD: Tickets Available',
    message,
    buttons: [{ title: 'Book now' }]
  });
}

async function triggerReminder() {
  const { reminder } = await chrome.storage.local.get(['reminder']);
  if (!reminder?.enabled || !reminder?.config) return;

  await createNotification(`railwatch-reminder-${Date.now()}`, {
    title: 'RailWatch BD Reminder',
    message: reminder.releaseDate
      ? `Tickets for ${reminder.config.from} -> ${reminder.config.to} (journey ${reminder.config.date}) open on ${reminder.releaseDate}. Log in and be ready on the railway site.`
      : `Journey reminder: ${reminder.config.from} -> ${reminder.config.to} on ${reminder.config.date}`
  });
}

function updatePopup(data) {
  chrome.runtime.sendMessage({ action: 'monitoringUpdate', data }).catch(() => {
    // Popup may not be open.
  });
}

async function restoreState() {
  await loadState();
  if (!isMonitoring || !currentConfig) {
    await chrome.alarms.clear(MONITOR_ALARM);
    return;
  }
  await ensureMonitorAlarm(); // alarms can be dropped on browser restart
  await performAvailabilityCheck('restore');
}
