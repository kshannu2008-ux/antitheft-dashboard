/**
 * PC Anti-Theft Dashboard — JavaScript
 * Uses Firebase REST API (no SDK needed — just your API key and Project ID)
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

const FIRESTORE = (pid) =>
  `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;

// ============================================================
// Login
// ============================================================
function login() {
  PROJECT_ID = document.getElementById("input-project-id").value.trim();
  API_KEY = document.getElementById("input-api-key").value.trim();
  DEVICE_ID = document.getElementById("input-device-id").value.trim() || "my-pc";

  const errEl = document.getElementById("login-error");
  if (!PROJECT_ID || !API_KEY) {
    errEl.textContent = "Please enter your Firebase Project ID and API Key.";
    errEl.classList.remove("hidden");
    return;
  }
  errEl.classList.add("hidden");

  // Test connection
  fetchDeviceDoc().then((doc) => {
    if (doc === null) {
      errEl.textContent = "Could not connect. Check your Project ID, API Key, and Device ID.";
      errEl.classList.remove("hidden");
      return;
    }
    // Success — switch to dashboard
    document.getElementById("login-screen").classList.remove("active");
    document.getElementById("dashboard-screen").classList.add("active");
    document.getElementById("header-device-id").textContent = DEVICE_ID;

    initMap();
    updateDashboard(doc);
    refreshInterval = setInterval(refreshData, 15000); // refresh every 15s
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

// ============================================================
// Send Commands
// ============================================================
async function sendCommand(field) {
  const toast = document.getElementById("command-toast");
  const labels = {
    lock_requested: "🔒 Lock command sent! PC will lock within ~30 seconds.",
    take_webcam: "📷 Webcam capture command sent! Image will appear in Webcam tab.",
    take_screenshot: "🖥️ Screenshot command sent! Image will appear in Screenshot tab.",
  };
  const ok = await patchField(field, true);
  toast.className = "toast " + (ok ? "sent" : "error");
  toast.textContent = ok
    ? labels[field] || "Command sent!"
    : "❌ Failed to send command. Check your connection.";
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 5000);
}

// ============================================================
// Map
// ============================================================
function initMap() {
  if (map) return;
  map = L.map("map").setView([20, 0], 2);

  // Satellite imagery layer (ESRI) — works at all zoom levels worldwide
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics",
    maxZoom: 21,
    maxNativeZoom: 18,
  }).addTo(map);

  // Labels overlay on top of satellite
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
    attribution: "",
    maxZoom: 21,
    maxNativeZoom: 18,
    opacity: 0.8,
  }).addTo(map);
}

function updateMap(lat, lon, city, country) {
  if (!map || !lat || !lon) return;
  const pos = [lat, lon];
  if (!marker) {
    marker = L.marker(pos).addTo(map);
  } else {
    marker.setLatLng(pos);
  }
  marker.bindPopup(`<b>${city}</b><br/>${country}`).openPopup();
  map.setView(pos, 12);

  document.getElementById("map-city").textContent = `📍 ${city}`;
  document.getElementById("map-coords").textContent = `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
  document.getElementById("map-country").textContent = country;
}

// ============================================================
// Dashboard Update
// ============================================================
function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleString();
  } catch {
    return isoStr;
  }
}

function updateDashboard(doc) {
  if (!doc) return;

  const location = doc.location;
  const statusEl = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  if (location) {
    // Stats
    document.getElementById("stat-city").textContent =
      `${location.city || "—"}, ${location.country || "—"}`;
    document.getElementById("stat-ip").textContent = `IP: ${location.ip || "—"}`;
    document.getElementById("stat-isp").textContent = location.isp || "—";
    document.getElementById("stat-lastseen").textContent = formatTime(location.timestamp);
    document.getElementById("last-seen-text").textContent =
      `Last seen: ${formatTime(location.timestamp)}`;

    // Map
    if (location.lat && location.lon) {
      updateMap(location.lat, location.lon, location.city, location.country);
    }

    // Status
    statusEl.className = "status-indicator online";
    statusText.textContent = "Online";
  } else {
    statusEl.className = "status-indicator offline";
    statusText.textContent = "No data";
  }

  // Webcam image (stored as base64 in Firestore)
  if (doc.last_webcam_b64) {
    document.getElementById("webcam-placeholder").classList.add("hidden");
    document.getElementById("webcam-image-wrap").classList.remove("hidden");
    document.getElementById("webcam-img").src = "data:image/jpeg;base64," + doc.last_webcam_b64;
    document.getElementById("webcam-time").textContent =
      "Captured: " + formatTime(doc.last_webcam_time);
  }

  // Screenshot image (stored as base64 in Firestore)
  if (doc.last_screenshot_b64) {
    document.getElementById("screenshot-placeholder").classList.add("hidden");
    document.getElementById("screenshot-image-wrap").classList.remove("hidden");
    document.getElementById("screenshot-img").src = "data:image/jpeg;base64," + doc.last_screenshot_b64;
    document.getElementById("screenshot-time").textContent =
      "Captured: " + formatTime(doc.last_screenshot_time);
  }
}

async function refreshData() {
  const doc = await fetchDeviceDoc();
  if (doc !== null) updateDashboard(doc);
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
    location: "Location",
    webcam: "Webcam Snapshots",
    screenshot: "Screenshots",
  };
  document.getElementById("tab-title").textContent = titles[tabName] || tabName;

  // Activate correct nav item
  document.querySelectorAll(".nav-item").forEach((item) => {
    if (item.getAttribute("onclick")?.includes(tabName)) {
      item.classList.add("active");
    }
  });

  // Invalidate map size when switching to location tab
  if (tabName === "location" && map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

// ============================================================
// Allow Enter key on login
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  ["input-project-id", "input-api-key", "input-device-id"].forEach((id) => {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });
  });
});
