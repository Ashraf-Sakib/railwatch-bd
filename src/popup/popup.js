import { STATIONS } from '../config/stations.js';

const els = {
  fromStation: document.getElementById('fromStation'),
  toStation: document.getElementById('toStation'),
  journeyDate: document.getElementById('journeyDate'),
  releaseHint: document.getElementById('releaseHint'),
  trainName: document.getElementById('trainName'),
  className: document.getElementById('className'),
  startBtn: document.getElementById('startMonitoring'),
  stopBtn: document.getElementById('stopMonitoring'),
  checkNowBtn: document.getElementById('checkNow'),
  connectRailwayBtn: document.getElementById('connectRailway'),
  refreshConnectionBtn: document.getElementById('refreshConnection'),
  testNotificationBtn: document.getElementById('testNotification'),
  statusBadge: document.getElementById('appStateBadge'),
  monitoringStatus: document.getElementById('monitoringStatus'),
  connectionStatus: document.getElementById('connectionStatus'),
  lastCheck: document.getElementById('lastCheck'),
  nextCheck: document.getElementById('nextCheck'),
  availabilityStatus: document.getElementById('availabilityStatus'),
  checkHistory: document.getElementById('checkHistory'),
  trainInfo: document.getElementById('trainInfo'),
  classInfo: document.getElementById('classInfo'),
  stationOptions: document.getElementById('stationOptions'),
  enableReminder: document.getElementById('enableReminder'),
  reminderDateTime: document.getElementById('reminderDateTime'),
  setReminder: document.getElementById('setReminder'),
  clearAll: document.getElementById('clearAll')
};

// Suggestions only. Any station/route is allowed: the extension reads whatever results page your tab shows.
const EXTRA_STATION_NAMES = ['Kamalapur', 'Biman Bandar', 'Tongi', 'Joydebpur', 'Bhairab Bazar', 'Akhaura', 'Cumilla', 'Chattogram', 'Feni', 'Laksam', 'Srimangal', 'Ishwardi', 'Santahar', 'Parbatipur', 'Sirajganj'];
const STATION_NAMES = [...new Set([...Object.keys(STATIONS), ...EXTRA_STATION_NAMES])];

// Tickets open 10 days before the journey. The reminder defaults to the evening before that day.
const RELEASE_DAYS_BEFORE_JOURNEY = 10;
const REMINDER_HOUR = 18;

init();

function init() {
  setDefaultDateValues();
  renderStationOptions();
  bindEvents();
  restoreReminderSettings();
  refreshConnectionStatus();
  checkMonitoringStatus();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// toISOString() is UTC, which is off by 6 hours in Bangladesh. Format local time instead.
function localDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localDateTime(d) {
  return `${localDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function releaseDates(journeyDateStr) {
  if (!journeyDateStr) return null;
  const journey = new Date(`${journeyDateStr}T00:00:00`);
  if (Number.isNaN(journey.getTime())) return null;
  const release = new Date(journey);
  release.setDate(release.getDate() - RELEASE_DAYS_BEFORE_JOURNEY);
  const reminder = new Date(release);
  reminder.setDate(reminder.getDate() - 1);
  reminder.setHours(REMINDER_HOUR, 0, 0, 0);
  return { release, reminder };
}

function updateReleaseHint() {
  const d = releaseDates(els.journeyDate.value);
  if (!d) {
    els.releaseHint.textContent = '';
    return;
  }
  const releaseText = d.release.toDateString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (d.release < startOfToday) {
    els.releaseHint.textContent = `Tickets opened on ${releaseText}. Click Start to watch for cancelled tickets.`;
  } else if (d.reminder.getTime() <= Date.now()) {
    els.releaseHint.textContent = `Tickets open on ${releaseText} (the day-before reminder time has passed). Set a reminder time manually below.`;
  } else {
    els.releaseHint.textContent = `Tickets open on ${releaseText}. Reminder is pre-set for ${localDateTime(d.reminder).replace('T', ' ')}.`;
  }
}

function applyReleaseDefaults() {
  const d = releaseDates(els.journeyDate.value);
  if (d && d.reminder.getTime() > Date.now()) {
    els.reminderDateTime.value = localDateTime(d.reminder);
  }
  updateReleaseHint();
}

function setDefaultDateValues() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  els.journeyDate.value = localDate(tomorrow);

  const reminderDefault = new Date(tomorrow);
  reminderDefault.setHours(10, 0, 0, 0);
  els.reminderDateTime.value = localDateTime(reminderDefault);
  applyReleaseDefaults();
}

function renderStationOptions() {
  const optionsHtml = STATION_NAMES.map((station) => `<option value="${station}"></option>`).join('');
  els.stationOptions.innerHTML = optionsHtml;
}

function bindEvents() {
  els.startBtn.addEventListener('click', startMonitoring);
  els.stopBtn.addEventListener('click', stopMonitoring);
  els.checkNowBtn.addEventListener('click', checkNow);
  els.connectRailwayBtn.addEventListener('click', connectRailwaySession);
  els.refreshConnectionBtn.addEventListener('click', refreshConnectionStatus);
  els.testNotificationBtn.addEventListener('click', testNotification);
  els.enableReminder.addEventListener('change', onReminderToggle);
  els.setReminder.addEventListener('click', setReminder);
  els.journeyDate.addEventListener('change', applyReleaseDefaults);
  els.clearAll.addEventListener('click', clearAllData);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'monitoringUpdate') {
      applyMonitoringUpdate(request.data);
    }
  });
}

function updateControlState(running) {
  els.startBtn.disabled = running;
  els.stopBtn.disabled = !running;
  els.checkNowBtn.disabled = !running;
  els.statusBadge.textContent = running ? 'Monitoring' : 'Idle';
}

function normalizeStationName(value) {
  return String(value || '').trim();
}

function validateConfig(config) {
  if (!config.from || !config.to || !config.date) {
    return 'Please fill in From, To, and Journey Date.';
  }

  if (config.from.toLowerCase() === config.to.toLowerCase()) {
    return 'Origin and destination must be different.';
  }

  const selectedDate = new Date(`${config.date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selectedDate < today) {
    return 'Journey date cannot be in the past.';
  }

  return null;
}

function getConfigFromForm() {
  return {
    from: normalizeStationName(els.fromStation.value),
    to: normalizeStationName(els.toStation.value),
    date: els.journeyDate.value,
    train: normalizeStationName(els.trainName.value) || null,
    className: els.className.value || null
  };
}

async function startMonitoring() {
  await refreshConnectionStatus();

  const config = getConfigFromForm();
  const validationError = validateConfig(config);
  if (validationError) {
    showStatusMessage(validationError, false);
    return;
  }

  const response = await chrome.runtime.sendMessage({ action: 'startMonitoring', config });
  if (!response?.success) {
    showStatusMessage(response?.error || 'Unable to start monitoring.', false);
    return;
  }

  await chrome.storage.local.set({ monitoringConfig: config, isMonitoring: true });
  updateControlState(true);
  els.monitoringStatus.textContent = 'Running';
  els.availabilityStatus.textContent = 'Checking';
  showStatusMessage('Monitoring started successfully.', true);
}

async function stopMonitoring() {
  const response = await chrome.runtime.sendMessage({ action: 'stopMonitoring' });
  if (!response?.success) {
    showStatusMessage(response?.error || 'Unable to stop monitoring.', false);
    return;
  }

  await chrome.storage.local.set({ isMonitoring: false });
  updateControlState(false);
  els.monitoringStatus.textContent = 'Stopped';
  els.availabilityStatus.textContent = 'Not monitoring';
  showStatusMessage('Monitoring stopped.', true);
}

async function testNotification() {
  const response = await chrome.runtime.sendMessage({ action: 'testNotification' });
  if (response?.success) {
    showStatusMessage('Test notification sent. If you did not see it, check Windows/macOS notification settings (Focus Assist / Do Not Disturb) for Chrome.', true);
  } else {
    showStatusMessage(response?.error || 'Test notification failed.', false);
  }
}

async function checkNow() {
  await refreshConnectionStatus();

  const response = await chrome.runtime.sendMessage({ action: 'checkNow' });
  if (!response?.success) {
    showStatusMessage(response?.error || 'Manual check failed.', false);
    return;
  }

  els.availabilityStatus.textContent = 'Checking';
}

function onReminderToggle() {
  const enabled = els.enableReminder.checked;
  els.reminderDateTime.disabled = !enabled;
  els.setReminder.disabled = !enabled;
}

async function setReminder() {
  if (!els.enableReminder.checked) {
    return;
  }

  if (!els.reminderDateTime.value) {
    showStatusMessage('Please select reminder date/time.', false);
    return;
  }

  const when = new Date(els.reminderDateTime.value).getTime();
  if (!Number.isFinite(when) || when <= Date.now()) {
    showStatusMessage('Reminder must be in the future.', false);
    return;
  }

  const reminder = {
    enabled: true,
    dateTime: els.reminderDateTime.value,
    config: getConfigFromForm(),
    releaseDate: releaseDates(els.journeyDate.value)?.release.toDateString() || null
  };

  const response = await chrome.runtime.sendMessage({ action: 'setReminder', reminder });
  if (!response?.success) {
    showStatusMessage(response?.error || 'Unable to set reminder.', false);
    return;
  }

  await chrome.storage.local.set({ reminder });
  showStatusMessage('Reminder scheduled.', true);
}

async function clearAllData() {
  const confirmed = window.confirm('Clear all saved monitoring data?');
  if (!confirmed) {
    return;
  }

  const response = await chrome.runtime.sendMessage({ action: 'clearAllData' });
  if (!response?.success) {
    showStatusMessage(response?.error || 'Unable to clear data.', false);
    return;
  }

  els.fromStation.value = '';
  els.toStation.value = '';
  els.trainName.value = '';
  els.className.value = '';
  els.enableReminder.checked = false;
  els.reminderDateTime.disabled = true;
  els.setReminder.disabled = true;
  setDefaultDateValues();
  updateControlState(false);

  els.monitoringStatus.textContent = 'Idle';
  els.lastCheck.textContent = 'Never';
  els.nextCheck.textContent = '--';
  els.availabilityStatus.textContent = 'Waiting';
  els.trainInfo.hidden = true;
  els.classInfo.hidden = true;
  els.checkHistory.innerHTML = '<div class="empty-state">No checks performed yet</div>';

  showStatusMessage('All data cleared.', true);
}

function applyMonitoringUpdate(data = {}) {
  if (data.lastCheck) {
    els.lastCheck.textContent = new Date(data.lastCheck).toLocaleTimeString();
  }

  if (data.nextCheck) {
    els.nextCheck.textContent = new Date(data.nextCheck).toLocaleTimeString();
  }

  if (typeof data.availability === 'boolean') {
    els.availabilityStatus.textContent = data.availability ? 'Available' : 'Unavailable';
    els.availabilityStatus.className = `value ${data.availability ? 'ok' : 'bad'}`;
  }

  if (data.status) {
    const statusLower = data.status.toLowerCase();
    els.monitoringStatus.textContent = data.status;
    const running = !(statusLower.includes('stopped') || statusLower.includes('idle'));
    updateControlState(running);
  }

  if (data.connectionStatus) {
    setConnectionUI(data.connectionStatus, data.connectionStatus.toLowerCase().includes('logged in'));
  }

  if (Array.isArray(data.history)) {
    renderHistory(data.history);
  }

  if (data.trainName) {
    els.trainInfo.hidden = false;
    els.trainInfo.textContent = `Train: ${data.trainName}`;
  }

  if (Array.isArray(data.classes) && data.classes.length > 0) {
    els.classInfo.hidden = false;
    els.classInfo.textContent = `Classes: ${data.classes.map((c) => c.name).join(', ')}`;
  }
}

function renderHistory(history) {
  if (!history.length) {
    els.checkHistory.innerHTML = '<div class="empty-state">No checks performed yet</div>';
    return;
  }

  const rows = history.slice(-8).reverse().map((item) => {
    const time = new Date(item.timestamp).toLocaleTimeString();
    const stateClass = item.available ? 'ok' : 'bad';
    const stateText = item.available ? 'Available' : 'Unavailable';
    const trainText = item.trainName || 'Unknown';

    return `
      <div class="history-item">
        <span class="time">${time}</span>
        <span class="state ${stateClass}">${stateText}</span>
        <span class="train">${trainText}</span>
      </div>
    `;
  });

  els.checkHistory.innerHTML = rows.join('');
}

async function restoreReminderSettings() {
  const data = await chrome.storage.local.get(['reminder']);
  if (!data?.reminder) {
    return;
  }

  const reminder = data.reminder;
  els.enableReminder.checked = !!reminder.enabled;
  els.reminderDateTime.disabled = !reminder.enabled;
  els.setReminder.disabled = !reminder.enabled;

  if (reminder.dateTime) {
    els.reminderDateTime.value = reminder.dateTime;
  }
}

async function checkMonitoringStatus() {
  const data = await chrome.storage.local.get(['isMonitoring', 'monitoringConfig', 'checkHistory']);

  if (data.monitoringConfig) {
    els.fromStation.value = data.monitoringConfig.from || '';
    els.toStation.value = data.monitoringConfig.to || '';
    els.journeyDate.value = data.monitoringConfig.date || els.journeyDate.value;
    els.trainName.value = data.monitoringConfig.train || '';
    els.className.value = data.monitoringConfig.className || '';
    updateReleaseHint();
  }

  const running = !!data.isMonitoring;
  updateControlState(running);

  if (running) {
    els.monitoringStatus.textContent = 'Running';
    els.availabilityStatus.textContent = 'Monitoring';
  }

  if (Array.isArray(data.checkHistory)) {
    renderHistory(data.checkHistory);
  }

  await refreshConnectionStatus();
}

function showStatusMessage(message, isSuccess) {
  els.monitoringStatus.textContent = message;
  els.monitoringStatus.className = `value ${isSuccess ? 'ok' : 'bad'}`;
}

async function refreshConnectionStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkConnection' });
    if (!response?.success) {
      setConnectionUI('Connection check failed.', false);
      return { connected: false, loggedIn: false };
    }

    setConnectionUI(response.message, isConnectedAndReadyMessage(response.message, response.loggedIn));
    return response;
  } catch (_error) {
    setConnectionUI('Unable to reach extension service worker.', false);
    return { connected: false, loggedIn: false };
  }
}

async function connectRailwaySession() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'connectRailway' });
    if (!response?.success) {
      setConnectionUI(response?.error || 'Failed to connect Railway session.', false);
      return;
    }

    setConnectionUI(response.message, isConnectedAndReadyMessage(response.message, response.loggedIn));
    if (response.loggedIn) {
      showStatusMessage('Railway session connected. You can start monitoring.', true);
    } else {
      showStatusMessage('Railway tab opened. Please log in, then click Refresh Connection.', false);
    }
  } catch (_error) {
    setConnectionUI('Failed to connect Railway session.', false);
  }
}

function setConnectionUI(message, loggedIn) {
  els.connectionStatus.textContent = message;
  els.connectionStatus.className = `value ${loggedIn ? 'ok' : 'bad'}`;
}

function isConnectedAndReadyMessage(message, loggedIn) {
  if (loggedIn) {
    return true;
  }

  const text = String(message || '').toLowerCase();
  return text.includes('session detected') || text.includes('connected via chrome session') || text.includes('logged in');
}
