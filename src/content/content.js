// Content script for the Bangladesh Railway e-ticket site
console.log('RailWatch BD content script loaded');

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'getPageInfo':
      handleGetPageInfo(sendResponse);
      return true;
    case 'checkLoginStatus':
      handleCheckLoginStatus(sendResponse);
      return true;
    case 'extractAvailability':
      handleExtractAvailability(request, sendResponse);
      return true;
    default:
      sendResponse({ error: 'Unknown action' });
      return false;
  }
});

function handleGetPageInfo(sendResponse) {
  try {
    sendResponse({
      success: true,
      data: {
        url: window.location.href,
        title: document.title,
        isBookingPage: window.location.pathname.includes('/booking'),
        isLoginPage: window.location.pathname.includes('/login'),
        isSearchPage: window.location.pathname === '/',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function handleCheckLoginStatus(sendResponse) {
  try {
    // Only treat the page as "login required" with unambiguous proof: a password field.
    const hasPasswordField = document.querySelector('input[type="password"]') !== null;
    sendResponse({ success: true, isLoggedIn: !hasPasswordField, hasPasswordField });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * "unavailable", "not available", "sold out" all CONTAIN the word "available" --
 * a plain includes('available') check reports them as available. Handle negatives first.
 */
function statusMeansAvailable(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  if (/(un-?available|not\s+available|sold\s*out|no\s+(tickets?|seats?)|n\/a|closed)/.test(t)) return false;
  return /\b(available|avl)\b/.test(t);
}

function handleExtractAvailability(request, sendResponse) {
  try {
    const { fromStation, toStation, journeyDate } = request;
    sendResponse({ success: true, data: extractAvailabilityFromPage(fromStation, toStation, journeyDate) });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function makeTrain(trainName, classes, fromStation, toStation, journeyDate, details = {}) {
  return {
    trainName,
    classes,
    hasAvailable: classes.some((c) => c.available),
    availableClasses: classes.filter((c) => c.available).map((c) => c.name),
    details,
    from: fromStation,
    to: toStation,
    date: journeyDate
  };
}

function extractAvailabilityFromPage(fromStation, toStation, journeyDate) {
  // 1) Rendered-text card parser (matches the current card-style markup). Preferred.
  let trains = extractFromRawPageText(fromStation, toStation, journeyDate);

  // 2) Only if that finds nothing, try the older DOM/table heuristics.
  if (trains.length === 0) {
    trains = extractFromDomHeuristics(fromStation, toStation, journeyDate);
  }

  const classCount = trains.reduce((n, t) => n + t.classes.length, 0);
  const seatSum = trains.reduce((n, t) => n + t.classes.reduce((m, c) => m + c.seats, 0), 0);

  return {
    trains,
    totalTrains: trains.length,
    hasAvailability: trains.some((t) => t.hasAvailable),
    // ready = at least one class row was really read. signature changes while the SPA is still rendering.
    ready: classCount > 0,
    signature: `${trains.length}|${classCount}|${seatSum}`,
    fromStation,
    toStation,
    journeyDate,
    pageUrl: window.location.href,
    pageTitle: document.title,
    extractedAt: new Date().toISOString()
  };
}

const KNOWN_CLASSES = new Set(['AC_B', 'AC_S', 'AC_CHAIR', 'F_BERTH', 'F_CHAIR', 'F_SEAT', 'S_CHAIR', 'SHOVAN', 'SHULOV', 'SNIGDHA']);
const NOISE_WORDS = new Set([
  'EXPRESS', 'COMMUTER', 'INTERCITY', 'LOCAL', 'MAIL', 'SPECIAL', 'FARE', 'VAT', 'BDT', 'TK', 'TAKA',
  'AVAILABLE', 'TICKETS', 'TICKET', 'SEAT', 'SEATS', 'CLASS', 'BOOK', 'NOW', 'SELECT', 'FROM', 'TO', 'DATE', 'AM', 'PM'
]);

function pickClassName(chunk) {
  const tokens = chunk.match(/\b[A-Z][A-Z_]{1,14}\b/g) || [];
  const usable = tokens.filter((t) => !NOISE_WORDS.has(t));
  const known = usable.filter((t) => KNOWN_CLASSES.has(t));
  if (known.length) return known[known.length - 1];
  return usable.length ? usable[usable.length - 1] : 'Unknown';
}

/**
 * Walks the page's visible text. Every "Available Tickets <n>" label is one class row.
 * The class name is the last class-looking token between the previous label (or the train title) and this label.
 * The train is the nearest train title ("NAME (123)") above the label.
 */
function extractFromRawPageText(fromStation, toStation, journeyDate) {
  const bodyText = (document.body?.innerText || '').replace(/\r/g, '');
  if (!bodyText) return [];

  const trainMatches = [];
  const trainRe = /(?<![A-Za-z_])([A-Z][A-Z ]{2,40}?\s*\(\d{1,4}\))/g;
  let m;
  while ((m = trainRe.exec(bodyText)) !== null) {
    trainMatches.push({ name: m[1].replace(/\s+/g, ' ').trim(), start: m.index, end: m.index + m[0].length });
  }

  const labelRe = /Available\s+Tickets?\s*[:\-]?\s*(\d+)/gi;
  const byTrain = new Map(); // name -> Map(className -> cls)
  const order = [];
  let prevEnd = 0;

  while ((m = labelRe.exec(bodyText)) !== null) {
    const seats = parseInt(m[1], 10) || 0;
    const owner = [...trainMatches].reverse().find((t) => t.end <= m.index);
    const trainName = owner?.name || 'Unknown Train';
    const chunkStart = Math.max(prevEnd, owner ? owner.end : 0);
    const className = pickClassName(bodyText.slice(chunkStart, m.index));
    prevEnd = m.index + m[0].length;

    if (!byTrain.has(trainName)) { byTrain.set(trainName, new Map()); order.push(trainName); }
    const classes = byTrain.get(trainName);
    const prev = classes.get(className);
    if (!prev || seats > prev.seats) {
      classes.set(className, {
        name: className,
        status: seats > 0 ? 'Available' : 'Unavailable',
        seats,
        available: seats > 0,
        availableSeats: seats
      });
    }
  }

  return order.map((name) => makeTrain(name, [...byTrain.get(name).values()], fromStation, toStation, journeyDate));
}

function extractFromDomHeuristics(fromStation, toStation, journeyDate) {
  const trains = [];
  const trainElements = document.querySelectorAll('.train-item, .schedule-item');

  trainElements.forEach((element) => {
    const trainName = element.querySelector('.train-name, .train-title, [class*="train-name"]')?.textContent?.trim() || 'Unknown Train';
    const classes = [];
    element.querySelectorAll('.class-availability, .seat-class').forEach((classEl) => {
      const className = classEl.querySelector('.class-name, [class*="class-name"]')?.textContent?.trim() || 'Unknown';
      const status = classEl.querySelector('.status, .availability, [class*="status"]')?.textContent?.trim() || 'Unknown';
      const seatsText = classEl.querySelector('.seats, .seat-count')?.textContent?.trim() || '0';
      const seats = parseInt(seatsText, 10) || 0;
      classes.push({ name: className, status, seats, available: seats > 0 || statusMeansAvailable(status), availableSeats: seats });
    });
    const details = {
      departureTime: element.querySelector('.departure-time, [class*="departure"]')?.textContent?.trim() || 'N/A',
      arrivalTime: element.querySelector('.arrival-time, [class*="arrival"]')?.textContent?.trim() || 'N/A',
      duration: element.querySelector('.duration, [class*="duration"]')?.textContent?.trim() || 'N/A'
    };
    if (classes.length) trains.push(makeTrain(trainName, classes, fromStation, toStation, journeyDate, details));
  });

  if (trains.length > 0) return trains;

  document.querySelectorAll('table').forEach((table) => {
    let current = null;
    table.querySelectorAll('tbody tr').forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;
      const firstCell = cells[0]?.textContent?.trim() || '';
      if (firstCell && !/\d+/.test(firstCell) && !firstCell.toLowerCase().includes('class')) {
        if (current && current.classes.length) trains.push(makeTrain(current.name, current.classes, fromStation, toStation, journeyDate));
        current = { name: firstCell, classes: [] };
      } else if (current) {
        const statusText = cells[1]?.textContent?.trim() || 'Unknown';
        const seats = parseInt(statusText.match(/\d+/)?.[0] || '0', 10);
        current.classes.push({
          name: cells[0]?.textContent?.trim() || 'Unknown',
          status: statusText,
          seats,
          available: seats > 0 || statusMeansAvailable(statusText),
          availableSeats: seats
        });
      }
    });
    if (current && current.classes.length) trains.push(makeTrain(current.name, current.classes, fromStation, toStation, journeyDate));
  });

  return trains;
}
