/* Global configuration state (persisted) */
const DEFAULTS = {
  alertsApi: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open",
  weatherApiKey: "",
  newsApiKey: "",
  tilesUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};

function loadConfig() {
  try {
    const raw = localStorage.getItem("dm_config");
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  localStorage.setItem("dm_config", JSON.stringify(cfg));
}

let CONFIG = loadConfig();

/* Navbar scroll behavior */
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const el = document.querySelector(btn.dataset.target);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

/* Config dropdown */
const configToggle = document.getElementById("configToggle");
const configMenu = document.getElementById("configMenu");
const configForm = document.getElementById("configForm");
if (configToggle && configMenu && configForm) {
  configToggle.addEventListener("click", () => {
    const isHidden = configMenu.hasAttribute("hidden");
    configMenu.toggleAttribute("hidden");
    configToggle.setAttribute("aria-expanded", String(isHidden));
  });

  // Initialize fields
  configForm.alertsApi.value = CONFIG.alertsApi;
  configForm.weatherApiKey.value = CONFIG.weatherApiKey;
  configForm.newsApiKey.value = CONFIG.newsApiKey;
  configForm.tilesUrl.value = CONFIG.tilesUrl;

  configForm.addEventListener("submit", (e) => {
    e.preventDefault();
    CONFIG = {
      alertsApi: configForm.alertsApi.value.trim() || DEFAULTS.alertsApi,
      weatherApiKey: configForm.weatherApiKey.value.trim(),
      newsApiKey: configForm.newsApiKey.value.trim(),
      tilesUrl: configForm.tilesUrl.value.trim() || DEFAULTS.tilesUrl,
    };
    saveConfig(CONFIG);
    configMenu.setAttribute("hidden", "");
    // Re-init map tiles and refresh data
    resetMapTiles(CONFIG.tilesUrl);
    fetchAndRenderAlerts();
    fetchAndRenderWeather();
    fetchAndRenderNews();
  });
}

/* Volunteer form */
const volunteerForm = document.getElementById("volunteerForm");
if (volunteerForm) {
  volunteerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    document.getElementById("volunteerThanks").hidden = false;
    volunteerForm.reset();
  });
}

/* Leaflet Map */
const INDIA_CENTER = [22.9734, 78.6569];
const INDIA_BBOX = { minLat: 6.0, maxLat: 37.5, minLng: 68.0, maxLng: 97.5 };
let map = L.map("map", { zoomControl: false, attributionControl: false }).setView(INDIA_CENTER, 4);
let tilesLayer = L.tileLayer(CONFIG.tilesUrl, { maxZoom: 19 }).addTo(map);

function resetMapTiles(url) {
  if (tilesLayer) {
    map.removeLayer(tilesLayer);
  }
  tilesLayer = L.tileLayer(url, { maxZoom: 19 }).addTo(map);
}

const alertLayerGroup = L.layerGroup().addTo(map);

/* Alerts */
async function fetchAlerts() {
  const url = CONFIG.alertsApi || DEFAULTS.alertsApi;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

function geometryWithinIndia(geometry) {
  try {
    if (!geometry) return false;
    const coords = geometry.coordinates;
    // EONET geometries can be [lon, lat] or arrays for polygons
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      return (
        lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat &&
        lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng
      );
    }
    // Polygon or Multi geometry: check any point
    const flat = flattenCoords(coords);
    return flat.some(([lng, lat]) => (
      lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat &&
      lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng
    ));
  } catch {
    return false;
  }
}

function flattenCoords(arr, out = []) {
  if (typeof arr[0] === "number") {
    out.push(arr);
  } else if (Array.isArray(arr)) {
    for (const a of arr) flattenCoords(a, out);
  }
  return out;
}

function renderAlertsList(filteredEvents) {
  const list = document.getElementById("alertsList");
  list.innerHTML = "";
  for (const ev of filteredEvents) {
    const item = document.createElement("div");
    item.className = "item";
    const categories = (ev.categories || []).map(c => c.title).join(", ");
    const source = ev.sources && ev.sources[0] ? ev.sources[0].url : "";
    const latestGeo = ev.geometry && ev.geometry.length ? ev.geometry[ev.geometry.length - 1] : null;
    const when = latestGeo && latestGeo.date ? new Date(latestGeo.date).toLocaleString() : "—";
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div>
          <div style="font-weight:600;">${ev.title || "Alert"}</div>
          <div class="muted" style="font-size:12px;">${categories}</div>
          <div class="muted" style="font-size:12px;">Updated: ${when}</div>
        </div>
        <span class="badge alert">Active</span>
      </div>
      ${source ? `<a class="muted" style="font-size:12px;" href="${source}" target="_blank" rel="noopener">Source</a>` : ""}
    `;
    list.appendChild(item);
  }
  document.getElementById("kpiAlerts").textContent = String(filteredEvents.length);
}

function addAlertsToMap(filteredEvents) {
  alertLayerGroup.clearLayers();
  const bounds = L.latLngBounds([]);
  for (const ev of filteredEvents) {
    if (!ev.geometry) continue;
    for (const g of ev.geometry) {
      const coords = g.coordinates;
      if (typeof coords[0] === "number") {
        const [lng, lat] = coords;
        const marker = L.circleMarker([lat, lng], {
          radius: 6,
          color: "#ef5350",
          fillColor: "#ef5350",
          fillOpacity: 0.8,
          weight: 1,
        }).bindPopup(`<b>${ev.title || "Alert"}</b><br/>${new Date(g.date).toLocaleString()}`);
        alertLayerGroup.addLayer(marker);
        bounds.extend([lat, lng]);
      } else {
        const latlngs = flattenCoords(coords).map(([lng, lat]) => [lat, lng]);
        if (latlngs.length) {
          const poly = L.polygon(latlngs, { color: "#ef5350", weight: 1, fillOpacity: 0.1 });
          alertLayerGroup.addLayer(poly);
          latlngs.forEach(ll => bounds.extend(ll));
        }
      }
    }
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
  } else {
    map.setView(INDIA_CENTER, 4);
  }
}

async function fetchAndRenderAlerts() {
  try {
    const data = await fetchAlerts();
    const events = data.events || data || [];
    const inIndia = events.filter((ev) => {
      if (!ev.geometry || !ev.geometry.length) return false;
      return ev.geometry.some(geometryWithinIndia);
    });
    renderAlertsList(inIndia);
    addAlertsToMap(inIndia);
  } catch (e) {
    console.error(e);
  }
}

document.getElementById("refreshAlerts")?.addEventListener("click", fetchAndRenderAlerts);

/* Weather */
async function fetchAndRenderWeather() {
  const cityInput = document.getElementById("weatherCity");
  const weatherBox = document.getElementById("weatherCurrent");
  const city = (cityInput?.value || "Delhi, IN").trim();
  document.getElementById("kpiCities").textContent = city;
  if (!CONFIG.weatherApiKey) {
    weatherBox.innerHTML = '<span class="muted">Set OpenWeather API key in settings.</span>';
    return;
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${CONFIG.weatherApiKey}&units=metric`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather API error");
    const w = await res.json();
    const temp = Math.round(w.main?.temp);
    const feels = Math.round(w.main?.feels_like);
    const desc = (w.weather && w.weather[0] && w.weather[0].description) || "—";
    const humid = w.main?.humidity;
    weatherBox.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;">
        <div style="font-size:32px;">${temp}°C</div>
        <div>
          <div style="font-weight:600; text-transform:capitalize;">${desc}</div>
          <div class="muted" style="font-size:12px;">Feels like ${feels}°C • Humidity ${humid}%</div>
        </div>
      </div>
    `;
  } catch {
    weatherBox.innerHTML = '<span class="muted">Failed to load weather.</span>';
  }
}

document.getElementById("weatherForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  fetchAndRenderWeather();
});

/* News (GNews) */
async function fetchAndRenderNews() {
  const list = document.getElementById("newsList");
  if (!CONFIG.newsApiKey) {
    list.innerHTML = '<span class="muted">Set GNews API key in settings.</span>';
    document.getElementById("kpiArticles").textContent = "0";
    return;
  }
  try {
    const query = "disaster OR flood OR earthquake OR cyclone";
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=in&max=10&apikey=${CONFIG.newsApiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("News API error");
    const data = await res.json();
    const articles = data.articles || [];
    document.getElementById("kpiArticles").textContent = String(articles.length);
    list.innerHTML = "";
    for (const a of articles) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <a href="${a.url}" target="_blank" rel="noopener" style="color:inherit; text-decoration:none;">
          <div style="font-weight:600;">${a.title}</div>
          <div class="muted" style="font-size:12px;">${a.source?.name || ""} • ${new Date(a.publishedAt).toLocaleString()}</div>
        </a>
      `;
      list.appendChild(div);
    }
  } catch {
    list.innerHTML = '<span class="muted">Failed to load news.</span>';
    document.getElementById("kpiArticles").textContent = "0";
  }
}

/* Initialize */
fetchAndRenderAlerts();
fetchAndRenderWeather();
fetchAndRenderNews();