/**
 * PC Anti-Theft Dashboard v2 — Smart Connect Edition
 * Uses Firebase REST API (no SDK needed)
 */

// ============================================================
// State
// ============================================================
let PROJECT_ID = "";
let API_KEY = "";
let DEVICE_ID = "my-pc";
let map = null;
let marker = null;
let refreshInterval = null;
let currentBrowsePath = "drives";
let browseHistory = [];
let notifications = []; // Local notification store
let lastMobileCamTime = null;
let mobileCamFrameCount = 0;

const FIRESTORE = (pid) =>
  `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;

// ============================================================
// Login
// ============================================================
function login() {
  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Connecting...";

  PROJECT_ID = document.getElementById("input-project-id").value.trim();
  API_KEY = document.getElementById("input-api-key").value.trim();
  DEVICE_ID = document.getElementById("input-device-id").value.trim() || "my-pc";

  const errEl = document.getElementById("login-error");
  if (!PROJECT_ID || !API_KEY) {
    errEl.textContent = "Please enter your Firebase Project ID and API Key.";
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.querySelector("span").textContent = "Connect to Device";
    return;
  }
  errEl.classList.add("hidden");

  fetchDeviceDoc().then((doc) => {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Connect to Device";
    if (doc === null) {
      errEl.textContent = "Could not connect. Check your Project ID, API Key, and Device ID.";
      errEl.classList.remove("hidden");
      return;
    }
    document.getElementById("login-screen").classList.remove("active");
    document.getElementById("dashboard-screen").classList.add("active");
    document.getElementById("header-device-id").textContent = DEVICE_ID;

    initMap();
    updateDashboard(doc);
    refreshInterval = setInterval(refreshData, 10000); // 10s refresh
  });
}

function logout() {
  clearInterval(refreshInterval);
  PROJECT_ID = "";
  API_KEY = "";
  document.getElementById("dashboard-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
}

// ============================================================
// Firestore REST Helpers
// ============================================================
function fsUrl(collection, docId) {
  return `${FIRESTORE(PROJECT_ID)}/${collection}/${docId}?key=${API_KEY}`;
}

function fromFsValue(val) {
  if (!val) return null;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return parseInt(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("stringValue" in val) return val.stringValue;
  if ("nullValue" in val) return null;
  if ("mapValue" in val && val.mapValue.fields) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields)) {
      obj[k] = fromFsValue(v);
    }
    return obj;
  }
  return null;
}

function toFsValue(val) {
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number" && Number.isInteger(val)) return { integerValue: String(val) };
  if (typeof val === "number") return { doubleValue: val };
  if (typeof val === "string") return { stringValue: val };
  if (val === null || val === undefined) return { nullValue: null };
  return { stringValue: String(val) };
}

async function fetchDeviceDoc() {
  try {
    const res = await fetch(fsUrl("devices", DEVICE_ID));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.fields) return {};
    const doc = {};
    for (const [k, v] of Object.entries(data.fields)) {
      doc[k] = fromFsValue(v);
    }
    return doc;
  } catch {
    return null;
  }
}

async function patchField(fieldName, value) {
  const maskParam = `updateMask.fieldPaths=${fieldName}`;
  const url = `${FIRESTORE(PROJECT_ID)}/devices/${DEVICE_ID}?key=${API_KEY}&${maskParam}`;
  const body = { fields: { [fieldName]: toFsValue(value) } };
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function patchFields(fields) {
  const maskParams = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join("&");
  const url = `${FIRESTORE(PROJECT_ID)}/devices/${DEVICE_ID}?key=${API_KEY}&${maskParams}`;
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) {
    fsFields[k] = toFsValue(v);
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fsFields }),
  });
  return res.ok;
}

// ============================================================
// Toast / Notifications
// ============================================================
function showToast(message, type = "sent") {
  const toast = document.getElementById("command-toast");
  if (!toast) return;
  toast.className = "toast " + type;
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 5000);
}

// ============================================================
// Send Basic Commands
// ============================================================
async function sendCommand(field) {
  const labels = {
    lock_requested: "🔒 Lock command sent! PC will lock within ~30 seconds.",
    phone_lock_requested: "📱🔒 Remote Lock sent! Your Android phone will lock in ~3 seconds.",
    phone_ring_requested: "🔊📱 Ring command sent! Your phone will sound alarm at full volume.",
    take_webcam: "📷 Webcam capture command sent! Check Webcam tab in ~30s.",
    take_screenshot: "🖥️ Screenshot command sent! Check Screenshot tab in ~30s.",
    refresh_sysinfo: "🔄 Refresh requested! System info will update shortly.",
  };
  const ok = await patchField(field, true);
  showToast(ok ? (labels[field] || "✅ Command sent!") : "❌ Failed to send command.");
}

// ============================================================
// Volume Control
// ============================================================
function updateVolDisplay(val) {
  document.getElementById("vol-display").textContent = val + "%";
}

async function setVolume(forcedLevel) {
  const level = forcedLevel !== undefined
    ? forcedLevel
    : parseInt(document.getElementById("volume-slider").value);
  const ok = await patchField("volume_level", level);
  showToast(ok
    ? `🔊 Volume set to ${level}% — will apply in ~30 seconds.`
    : "❌ Failed to send volume command.");
}

// ============================================================
// Send PC Notification
// ============================================================
async function sendNotification() {
  const text = document.getElementById("notif-text").value.trim();
  if (!text) { showToast("⚠️ Type a message first!", "error"); return; }
  const ok = await patchField("send_notification", text);
  if (ok) {
    document.getElementById("notif-text").value = "";
    showToast("💬 Message sent! It will appear on your PC screen shortly.");
  } else {
    showToast("❌ Failed to send message.", "error");
  }
}

// ============================================================
// Clipboard Sync
// ============================================================
async function sendClipboard() {
  const text = document.getElementById("clipboard-text").value.trim();
  if (!text) { showToast("⚠️ Type some text first!", "error"); return; }
  const ok = await patchField("clipboard_set", text);
  if (ok) {
    showToast("📋 Text sent! It will be in your PC clipboard in ~30 seconds.");
  } else {
    showToast("❌ Failed to sync clipboard.", "error");
  }
}

// ============================================================
// File Browser
// ============================================================
async function browseRoot() {
  browseHistory = [];
  await requestBrowse("drives");
}

async function browseFolder(path, displayName) {
  browseHistory.push({ path: currentBrowsePath, display: document.getElementById("breadcrumb").innerHTML });
  await requestBrowse(path, displayName);
}

function browseBack() {
  if (browseHistory.length === 0) return browseRoot();
  const prev = browseHistory.pop();
  currentBrowsePath = prev.path;
  document.getElementById("breadcrumb").innerHTML = prev.display;
  refreshData(); // Re-fetch data which includes file_list
}

async function requestBrowse(path, displayName) {
  currentBrowsePath = path;
  document.getElementById("file-list-loading").classList.remove("hidden");
  document.getElementById("file-list-container").innerHTML = "";

  // Update breadcrumb
  const bc = document.getElementById("breadcrumb");
  if (path === "drives") {
    bc.innerHTML = `<span class="breadcrumb-item" onclick="browseRoot()">🖥️ My Computer</span>`;
  } else {
    bc.innerHTML = `
      <span class="breadcrumb-item" onclick="browseRoot()">🖥️ My Computer</span>
      <span class="bc-sep">›</span>
      <span class="breadcrumb-item active">${displayName || path}</span>
    `;
  }

  const isDrives = path === "drives";
  const ok = await patchFields(
    isDrives
      ? { browse_drives: true }
      : { browse_path: path }
  );
  if (!ok) {
    document.getElementById("file-list-loading").classList.add("hidden");
    showToast("❌ Failed to send browse request.", "error");
  }
  // File list will appear when refreshData() picks up file_list field
}

function renderFileList(fileListJson, listPath) {
  const container = document.getElementById("file-list-container");
  document.getElementById("file-list-loading").classList.add("hidden");

  let items;
  try {
    items = JSON.parse(fileListJson);
  } catch {
    container.innerHTML = `<div class="files-placeholder"><p>Invalid file list data.</p></div>`;
    return;
  }

  if (!items || items.length === 0) {
    container.innerHTML = `<div class="files-placeholder"><p>This folder is empty.</p></div>`;
    return;
  }

  let html = "";

  if (items[0].type === "drive") {
    // Drive listing
    html = items.map(d => `
      <div class="file-item glass" onclick="browseFolder('${d.name.replace(/\\/g, "\\\\")}', '${d.name}')">
        <span class="file-icon">💿</span>
        <div class="file-info">
          <div class="file-name">${d.name}</div>
          <div class="file-meta">${d.free_gb !== undefined ? `${d.free_gb} GB free of ${d.total_gb} GB` : "Drive"}</div>
        </div>
        <span class="file-arrow">›</span>
      </div>
    `).join("");
  } else if (items[0].type === "error") {
    html = `<div class="files-placeholder"><p>⚠️ ${items[0].name}</p></div>`;
  } else {
    if (browseHistory.length > 0) {
      html += `<div class="file-item glass back-item" onclick="browseBack()">
        <span class="file-icon">⬆️</span>
        <div class="file-info"><div class="file-name">.. (Back)</div></div>
      </div>`;
    }
    html += items.map(item => {
      const isFolder = item.type === "folder";
      const escapedPath = (item.path || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const clickHandler = isFolder
        ? `onclick="browseFolder('${escapedPath}', '${item.name.replace(/'/g, "\\'")}')"` 
        : "";
      const icon = isFolder ? "📁" : getFileIcon(item.name);
      const meta = isFolder ? "Folder" : `${item.size_kb || 0} KB`;
      return `
        <div class="file-item glass ${isFolder ? "folder-item" : "file-file-item"}" ${clickHandler}>
          <span class="file-icon">${icon}</span>
          <div class="file-info">
            <div class="file-name">${item.name}</div>
            <div class="file-meta">${meta}</div>
          </div>
          ${isFolder ? '<span class="file-arrow">›</span>' : ""}
        </div>
      `;
    }).join("");
  }

  container.innerHTML = html;
}

function getFileIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const icons = {
    pdf: "📄", doc: "📝", docx: "📝", txt: "📄", xls: "📊", xlsx: "📊",
    ppt: "📊", pptx: "📊", jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️",
    mp4: "🎬", avi: "🎬", mkv: "🎬", mp3: "🎵", wav: "🎵", flac: "🎵",
    zip: "🗜️", rar: "🗜️", "7z": "🗜️", exe: "⚙️", msi: "⚙️",
    py: "🐍", js: "📜", html: "🌐", css: "🎨", json: "📋",
  };
  return icons[ext] || "📄";
}

// ============================================================
// Map
// ============================================================
function initMap() {
  // No complex map library needed, we just use a Google Maps iframe
}

function updateMap(lat, lon, city, country) {
  if (!lat || !lon) return;

  const frame = document.getElementById("map-frame");
  if (frame) {
    // Generate Google Maps Embed URL
    // hl=en (Language)
    // z=15 (Zoom level)
    // q=lat,lon (Coordinates)
    frame.src = `https://maps.google.com/maps?q=${lat},${lon}&hl=en&z=15&output=embed`;
  }

  const updated = new Date().toLocaleTimeString();
  
  document.getElementById("map-city").textContent    = `📍 ${city || 'Unknown City'}`;
  document.getElementById("map-coords").textContent  = `Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}`;
  document.getElementById("map-country").textContent = `${country || ''} · Updated: ${updated}`;
}

// ============================================================
// Dashboard Update
// ============================================================
function formatTime(isoStr) {
  if (!isoStr) return "—";
  try { return new Date(isoStr).toLocaleString(); } catch { return isoStr; }
}

function updateSystemInfo(si) {
  if (!si) return;

  // Overview cards
  document.getElementById("stat-cpu").textContent = `${si.cpu_percent}%`;
  document.getElementById("stat-ram").textContent = `RAM: ${si.ram_percent}%`;
  const bat = si.battery_percent >= 0
    ? `${si.battery_percent}% ${si.battery_plugged ? "⚡ Charging" : "🔋"}`
    : "No battery";
  document.getElementById("stat-battery").textContent = bat;
  document.getElementById("stat-uptime").textContent = `Uptime: ${si.uptime || "—"}`;

  // System Info tab
  setProgressBar("si-cpu-bar", "si-cpu-val", si.cpu_percent, "%");
  setProgressBar("si-ram-bar", "si-ram-val", si.ram_percent, "%");
  setProgressBar("si-disk-bar", "si-disk-val", si.disk_percent, "%");
  const batPct = si.battery_percent >= 0 ? si.battery_percent : 0;
  setProgressBar("si-bat-bar", "si-bat-val", batPct, "%");

  document.getElementById("si-ram-detail").textContent =
    `${si.ram_used_gb} GB used / ${si.ram_total_gb} GB total`;
  document.getElementById("si-disk-detail").textContent =
    `${si.disk_used_gb} GB used / ${si.disk_total_gb} GB total`;
  document.getElementById("si-bat-status").textContent =
    si.battery_percent >= 0
      ? (si.battery_plugged ? "⚡ Plugged in — Charging" : "🔋 On battery power")
      : "No battery / Desktop PC";
  document.getElementById("si-uptime-val").textContent = si.uptime || "—";
  document.getElementById("si-sysinfo-updated").textContent =
    `Last updated: ${formatTime(si.timestamp)}`;
}

function setProgressBar(barId, valId, percent, suffix) {
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  if (!bar || !val) return;
  const pct = Math.min(100, Math.max(0, percent || 0));
  bar.style.width = pct + "%";
  val.textContent = pct + suffix;
  // Color coding
  if (pct > 85) { bar.style.background = "linear-gradient(90deg,#ff4757,#ff6b81)"; }
  else if (pct > 65) { bar.style.background = "linear-gradient(90deg,#ffa502,#ff6348)"; }
  else { bar.style.background = ""; }
}

function updateDashboard(doc) {
  if (!doc) return;

  const location = doc.location;
  const statusEl = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  if (location) {
    document.getElementById("stat-city").textContent =
      `${location.city || "—"}, ${location.country || "—"}`;
    document.getElementById("stat-ip").textContent = `IP: ${location.ip || "—"}`;
    document.getElementById("stat-lastseen").textContent = formatTime(location.timestamp);
    document.getElementById("last-seen-text").textContent =
      `Last seen: ${formatTime(location.timestamp)}`;
    if (location.lat && location.lon) {
      updateMap(location.lat, location.lon, location.city, location.country);
    }
    statusEl.className = "status-indicator online";
    statusText.textContent = "Online";
  } else {
    statusEl.className = "status-indicator offline";
    statusText.textContent = "No data";
  }

  // System Info
  if (doc.system_info) {
    updateSystemInfo(doc.system_info);
  }

  // Current volume
  if (doc.current_volume !== undefined && doc.current_volume >= 0) {
    const vol = doc.current_volume;
    document.getElementById("volume-slider").value = vol;
    document.getElementById("vol-display").textContent = vol + "%";
  }

  // Webcam
  if (doc.last_webcam_b64) {
    document.getElementById("webcam-placeholder").classList.add("hidden");
    document.getElementById("webcam-image-wrap").classList.remove("hidden");
    document.getElementById("webcam-img").src = "data:image/jpeg;base64," + doc.last_webcam_b64;
    document.getElementById("webcam-time").textContent =
      "Captured: " + formatTime(doc.last_webcam_time);
  }

  // Screenshot
  if (doc.last_screenshot_b64) {
    document.getElementById("screenshot-placeholder").classList.add("hidden");
    document.getElementById("screenshot-image-wrap").classList.remove("hidden");
    document.getElementById("screenshot-img").src = "data:image/jpeg;base64," + doc.last_screenshot_b64;
    document.getElementById("screenshot-time").textContent =
      "Captured: " + formatTime(doc.last_screenshot_time);
  }

  // Clipboard last sent
  if (doc.last_clipboard_sent) {
    document.getElementById("clipboard-last").textContent = doc.last_clipboard_sent;
    document.getElementById("clipboard-last-time").textContent =
      formatTime(doc.last_clipboard_time);
  }

  // File list
  if (doc.file_list) {
    renderFileList(doc.file_list, doc.file_list_path);
  }
}

// ============================================================
// Mobile Camera Viewer (PC side — receives frames from phone)
// ============================================================
function updateMobileCam(doc) {
  if (!doc.mobile_cam_active && !doc.mobile_cam_frame) return;

  const isActive = doc.mobile_cam_active === true;
  const frame = doc.mobile_cam_frame;
  const ts = doc.mobile_cam_time;

  const placeholder = document.getElementById("mobilecam-placeholder");
  const activeEl = document.getElementById("mobilecam-active");

  if (isActive && frame) {
    placeholder.classList.add("hidden");
    activeEl.classList.remove("hidden");
    document.getElementById("mobilecam-img").src = "data:image/jpeg;base64," + frame;
    document.getElementById("mobilecam-time").textContent = "📱 Live at " + formatTime(ts);
    if (ts !== lastMobileCamTime) {
      mobileCamFrameCount++;
      lastMobileCamTime = ts;
      document.getElementById("mobilecam-fps").textContent =
        `Frames received: ${mobileCamFrameCount}`;
    }
  } else if (!isActive) {
    placeholder.classList.remove("hidden");
    activeEl.classList.add("hidden");
    mobileCamFrameCount = 0;
    document.getElementById("mobilecam-fps").textContent = "";
  }
}

function copyMobileCamLink() {
  const url = "https://kshannu2008-ux.github.io/antitheft-dashboard/mobile-cam.html";
  navigator.clipboard.writeText(url).then(() => {
    showToast("📋 Link copied! Open it on your phone.");
  });
}

// ============================================================
// Phone Notifications (received from Android companion app)
// ============================================================
function updateNotifications(doc) {
  if (!doc.phone_notifications) return;

  let incoming;
  try {
    incoming = JSON.parse(doc.phone_notifications);
  } catch { return; }

  if (!Array.isArray(incoming) || incoming.length === 0) return;

  // Merge new notifications, avoid duplicates by id+timestamp
  const existingIds = new Set(notifications.map(n => n.id + n.time));
  const newOnes = incoming.filter(n => !existingIds.has(n.id + n.time));

  if (newOnes.length === 0) return;

  notifications = [...newOnes, ...notifications].slice(0, 100); // keep max 100
  renderNotifications();

  // Show Windows-style toast for new notifications
  newOnes.forEach(n => {
    if (n.type === 'call') {
      showCallAlert(n);
    } else {
      showToast(`${n.app_icon || '📱'} ${n.app}: ${n.title} — ${n.text}`, 'info');
    }
  });
}

function renderNotifications() {
  const list = document.getElementById("notif-list");
  const badge = document.getElementById("notif-badge");
  const countLabel = document.getElementById("notif-count-label");

  if (notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty">
      <div style="font-size:50px;margin-bottom:12px;opacity:0.3">🔔</div>
      <p>No notifications yet.</p>
    </div>`;
    badge.style.display = 'none';
    countLabel.textContent = 'No notifications';
    return;
  }

  badge.style.display = 'inline-block';
  badge.textContent = notifications.length > 99 ? '99+' : notifications.length;
  countLabel.textContent = `${notifications.length} notification${notifications.length !== 1 ? 's' : ''}`;

  list.innerHTML = notifications.map(n => `
    <div class="notif-item glass notif-${n.type || 'app'}">
      <div class="notif-icon">${n.type === 'call' ? '📞' : (n.app_icon || '📱')}</div>
      <div class="notif-body">
        <div class="notif-header-row">
          <span class="notif-app">${escapeHtml(n.app || 'Unknown')}</span>
          <span class="notif-time">${formatTime(n.time)}</span>
        </div>
        <div class="notif-title">${escapeHtml(n.title || '')}</div>
        <div class="notif-text">${escapeHtml(n.text || '')}</div>
      </div>
    </div>
  `).join('');
}

function showCallAlert(call) {
  // Show prominent call banner
  const banner = document.createElement('div');
  banner.className = 'call-alert glass';
  banner.innerHTML = `
    <div class="call-icon">📞</div>
    <div class="call-info">
      <div class="call-title">Incoming Call</div>
      <div class="call-number">${escapeHtml(call.title || call.text || 'Unknown')}</div>
    </div>
    <button onclick="this.parentElement.remove()" class="call-dismiss">✕</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => { if (banner.parentElement) banner.remove(); }, 30000);
  showToast(`📞 Incoming call: ${call.title || call.text}`, 'sent');
}

function clearNotifications() {
  notifications = [];
  renderNotifications();
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function refreshData() {
  const doc = await fetchDeviceDoc();
  if (doc !== null) {
    updateDashboard(doc);
    updateMobileCam(doc);
    updateNotifications(doc);
  }
}

// ============================================================
// Tab Navigation
// ============================================================
function showTab(tabName) {
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.getElementById(`tab-${tabName}`).classList.add("active");

  const titles = {
    overview: "Overview",
    notifs: "Phone Notifications & Calls",
    sysinfo: "System Info",
    controls: "Remote Controls",
    clipboard: "Clipboard Sync",
    files: "File Browser",
    mobilecam: "Phone Camera (Live)",
    location: "Location",
    webcam: "Webcam Snapshots",
    screenshot: "Screenshots",
  };
  document.getElementById("tab-title").textContent = titles[tabName] || tabName;

  const navItem = document.getElementById(`nav-${tabName}`);
  if (navItem) navItem.classList.add("active");

  if (tabName === "location" && map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

// ============================================================
// Enter key on login
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  ["input-project-id", "input-api-key", "input-device-id"].forEach((id) => {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });
  });
});
