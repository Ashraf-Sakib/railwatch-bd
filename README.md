RailWatch BD

Chrome extension to monitor Bangladesh Railway ticket availability and alert when tickets become available.


Project Structure

- manifest.json: Extension manifest and permissions.
- src/background/service-worker.js: Monitoring engine, alarms, notifications, reminder handling.
- src/popup/popup.html: Popup UI markup.
- src/popup/popup.css: Popup visual design system.
- src/popup/popup.js: Popup interaction/state logic.
- src/config/stations.js: Station name/code mapping.

How Monitoring Works

1. User configures a journey in the popup.
2. Configuration is validated and normalized (including station-code resolution).
3. Background service creates a periodic alarm (every 3 minutes).
4. On each alarm tick, service checks login/session and runs availability parsing.
5. Popup receives live updates and history via runtime messaging.

Local Run

1. Open Chrome and go to chrome://extensions.
2. Enable Developer mode.
3. Click Load unpacked and select this project root.
4. Open https://eticket.railway.gov.bd and log in.
5. Open extension popup and start monitoring.

Production Readiness Checklist

- Verify station list accuracy in src/config/stations.js against latest railway backend values.
- Confirm request payload fields expected by the railway site (form names may change over time).
- Add real extension icons (16/32/48/128 PNG) and reference them in manifest.json.
- Perform manual E2E verification on a clean browser profile.
- Validate notification behavior across Windows/macOS/Linux.
- Add automated smoke tests for parser behavior with stored HTML fixtures.
- Bump version in manifest.json per release.

Known Constraints

- Monitoring requires an active authenticated session on eticket.railway.gov.bd.
- Railway page markup/content can change, which may require parser updates.
- Availability parsing is heuristic and should be periodically validated.
