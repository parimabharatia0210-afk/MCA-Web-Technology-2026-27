"use strict";
const express = require("express");
const path = require("path");

try {
  const fs = require("fs");
  const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch { /* .env is optional; environment variables can also be set by the host */ }
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const cache = new Map();
const hits = new Map();
let reverseQueue = Promise.resolve();
let lastReverseLookup = 0;
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "geolocation=(self)" });
  const ip = req.ip || "local", now = Date.now();
  let entry = hits.get(ip);
  if (!entry || now - entry.start > 60_000) entry = { start: now, count: 0 };
  entry.count++; hits.set(ip, entry);
  if (hits.size > 5000) {
    for (const [address, state] of hits) if (now - state.start > 60_000) hits.delete(address);
    while (hits.size > 5000) hits.delete(hits.keys().next().value);
  }
  if (entry.count > 90) return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0, etag: true }));

async function getJson(url, ttl = 5 * 60_000) {
  const key = url.toString(), old = cache.get(key);
  if (old && old.until > Date.now()) return old.value;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "WeatherWiseAI/1.0" } });
  if (!response.ok) throw Object.assign(new Error("Weather provider is temporarily unavailable."), { status: 502 });
  const data = await response.json();
  if (!cache.has(key) && cache.size >= 1000) cache.delete(cache.keys().next().value);
  cache.set(key, { value: data, until: Date.now() + ttl });
  return data;
}
async function reverseGeocode(point) {
  const latitude = Number(point.latitude.toFixed(3)), longitude = Number(point.longitude.toFixed(3));
  const url = new URL(process.env.REVERSE_GEOCODER_URL || "https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({ format: "jsonv2", lat: String(latitude), lon: String(longitude), zoom: "10", addressdetails: "1" });
  const lookup = async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastReverseLookup));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastReverseLookup = Date.now();
    const data = await getJson(url, 24 * 3600_000);
    const a = data.address || {};
    return { name: a.city || a.town || a.village || a.municipality || a.suburb || a.county || "", region: a.state || a.state_district || a.county || "", country: a.country || "" };
  };
  const pending = reverseQueue.then(lookup, lookup);
  reverseQueue = pending.catch(() => {});
  return pending;
}
function coords(req) {
  const lat = req.query.latitude, lon = req.query.longitude;
  if (typeof lat !== "string" || !lat.trim() || typeof lon !== "string" || !lon.trim()) throw Object.assign(new Error("Valid latitude and longitude are required."), { status: 400 });
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw Object.assign(new Error("Valid latitude and longitude are required."), { status: 400 });
  return { latitude, longitude };
}
function withCoords(base, point) { const url = new URL(base); url.search = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), timezone: "auto" }); return url; }
const forecastVars = {
  current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,dew_point_2m,uv_index",
  hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,uv_index",
  daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,daylight_duration"
};
app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "WeatherWise AI", aiConfigured: Boolean(process.env.GEMINI_API_KEY) }));
app.get("/api/geocode", async (req, res, next) => {
  const name = String(req.query.q || "").trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a place name between 2 and 80 characters." });
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search"); url.search = new URLSearchParams({ name, count: "6", language: "en", format: "json" });
    const data = await getJson(url, 24 * 3600_000);
    res.json({ results: (data.results || []).map(p => ({ name: p.name, region: p.admin1 || "", country: p.country || "", latitude: p.latitude, longitude: p.longitude, timezone: p.timezone })) });
  } catch (e) { next(e); }
});
app.get("/api/weather", async (req, res, next) => {
  try {
    let point, place;
    if (req.query.latitude !== undefined || req.query.longitude !== undefined) point = coords(req);
    else {
      const city = String(req.query.city || "").trim();
      if (!city || city.length > 80) return res.status(400).json({ error: "Enter a city name (up to 80 characters)." });
      const g = new URL("https://geocoding-api.open-meteo.com/v1/search"); g.search = new URLSearchParams({ name: city, count: "1", language: "en", format: "json" });
      const geo = await getJson(g, 24 * 3600_000); place = geo.results?.[0];
      if (!place) return res.status(404).json({ error: `We couldn't find “${city}”. Try another place.` });
      point = { latitude: place.latitude, longitude: place.longitude };
    }
    const url = withCoords("https://api.open-meteo.com/v1/forecast", point);
    url.searchParams.set("current", forecastVars.current); url.searchParams.set("hourly", forecastVars.hourly); url.searchParams.set("daily", forecastVars.daily); url.searchParams.set("forecast_days", "7"); url.searchParams.set("forecast_hours", "48");
    const weather = await getJson(url, 10 * 60_000);
    if (!place) {
      try { place = await reverseGeocode(point); }
      catch { /* Coordinate-based weather is still useful when place lookup is offline. */ }
    }
    res.json({ location: { name: place?.name || `${point.latitude.toFixed(2)}, ${point.longitude.toFixed(2)}`, region: place?.region || place?.admin1 || "", country: place?.country || "", latitude: point.latitude, longitude: point.longitude, timezone: weather.timezone }, ...weather, source: "Open-Meteo", fetchedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});
app.get("/api/air-quality", async (req, res, next) => {
  try { const p = coords(req); const u = withCoords("https://air-quality-api.open-meteo.com/v1/air-quality", p); u.searchParams.set("current", "european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone"); u.searchParams.set("hourly", "european_aqi,pm10,pm2_5"); u.searchParams.set("forecast_hours", "24"); res.json({ ...(await getJson(u, 15 * 60_000)), source: "Open-Meteo Air Quality API" }); } catch (e) { next(e); }
});
app.get("/api/history", async (req, res, next) => {
  try {
    const p = coords(req), date = String(req.query.date || ""), parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || parsedDate >= new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) return res.status(400).json({ error: "Choose a valid past date in YYYY-MM-DD format." });
    const u = withCoords("https://archive-api.open-meteo.com/v1/archive", p); u.searchParams.set("start_date", date); u.searchParams.set("end_date", date); u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max"); u.searchParams.set("timezone", "auto"); res.json({ ...(await getJson(u, 24 * 3600_000)), source: "Open-Meteo Historical Weather API" });
  } catch (e) { next(e); }
});
app.post("/api/assistant", async (req, res) => {
  const question = String(req.body?.question || "").trim(), weather = req.body?.weather;
  if (!question || question.length > 1000 || !weather?.current || !weather?.location) return res.status(400).json({ error: "A question and current weather context are required." });
  // Keep the assistant useful without a paid/external AI credential. This
  // fallback uses only the forecast values provided by Open-Meteo.
  if (!process.env.GEMINI_API_KEY) {
    const c = weather.current, d = weather.daily || {};
    const numeric = value => typeof value === "number" && Number.isFinite(value) ? value : null;
    const high = numeric(d.temperature_2m_max?.[0]), low = numeric(d.temperature_2m_min?.[0]);
    const rain = numeric(d.precipitation_probability_max?.[0]), uv = numeric(d.uv_index_max?.[0]);
    const feels = numeric(c.apparent_temperature), gust = numeric(c.wind_gusts_10m);
    const temp = value => value === null ? "unavailable" : `${Math.round(value)}°C`;
    const q = question.toLowerCase();
    let answer = `For ${weather.location.name}, the supplied data shows ${temp(numeric(c.temperature_2m))} now`;
    if (high !== null && low !== null) answer += `, with a forecast range of ${Math.round(low)}° to ${Math.round(high)}°C today`;
    answer += ". ";
    if (/umbrella|rain|wet/.test(q)) answer += rain === null ? "Rain probability data is unavailable, so I can’t make an umbrella recommendation from this forecast." : rain >= 40 ? `Rain is possible today (maximum forecast probability ${Math.round(rain)}%), so carrying an umbrella is a sensible precaution.` : `The maximum forecast rain probability today is ${Math.round(rain)}%, so rain is not strongly indicated. Forecasts can change.`;
    else if (/wear|cloth|dress|jacket/.test(q)) answer += feels === null ? "Feels-like temperature is unavailable, so I can’t make a temperature-based clothing recommendation." : feels >= 30 ? `It feels like ${Math.round(feels)}°C now; light, breathable clothing may be more comfortable.` : feels <= 15 ? `It feels like ${Math.round(feels)}°C now; consider an extra layer.` : `It feels like ${Math.round(feels)}°C now. Dress for that temperature and check again before heading out.`;
    else if (/run|exercise|workout|outdoor/.test(q)) answer += `${rain === null ? "Rain probability is unavailable" : rain >= 50 ? `Rain probability reaches ${Math.round(rain)}%` : "Rain is not strongly indicated"}; ${gust === null ? "wind gust data is unavailable" : `wind gusts are ${Math.round(gust)} km/h`}. Check local conditions before strenuous activity.`;
    else if (/travel|trip|commut/.test(q)) answer += `${rain === null ? "Rain probability is unavailable." : rain >= 50 ? `Rain probability reaches ${Math.round(rain)}%; allow for wet conditions.` : "Rain is not strongly indicated."} This forecast cannot account for road conditions or local warnings, so check those separately.`;
    else if (/uv|sun/.test(q)) answer += uv === null ? "UV forecast data is unavailable." : `The forecast UV maximum is ${Math.round(uv)}. ${uv >= 6 ? "Sun protection and shade are advisable around midday." : "Check the UV level again if you will be outdoors for a long time."}`;
    else answer += `${rain === null ? "Rain probability is unavailable. " : rain >= 50 ? `Rain is possible (up to ${Math.round(rain)}% probability). ` : "No high rain probability is forecast. "}${uv !== null && uv >= 6 ? `UV reaches ${Math.round(uv)}, so consider sun protection. ` : uv === null ? "UV forecast is unavailable. " : ""}This is a simple reading of the available forecast, which may change.`;
    return res.json({ answer, source: "Rule-based guidance from supplied Open-Meteo data", mode: "local-guidance" });
  }  try {
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ systemInstruction: { parts: [{ text: "You are WeatherWise AI. Use only the supplied weather context, do not invent observations, explain uncertainty, and clearly distinguish supplied data from interpretation. Give concise practical advice." }] }, contents: [{ role: "user", parts: [{ text: `Weather data (JSON): ${JSON.stringify(weather)}\nQuestion: ${question}` }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 500 } }) });
    if (!r.ok) throw new Error("AI provider did not return a response."); const data = await r.json(); const answer = data.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("").trim();
    if (!answer) throw new Error("AI response was empty."); res.json({ answer, source: "Gemini interpretation of supplied Open-Meteo data" });
  } catch (e) { console.error("Assistant error:", e.message); res.status(502).json({ error: "The AI assistant is temporarily unavailable. Please try again." }); }
});
app.post("/api/briefing", async (req, res) => {
  const weather = req.body?.weather;
  if (!weather?.current || !weather?.daily || !weather?.location) return res.status(400).json({ error: "Weather context is required." });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "AI briefing is not configured." });
  try {
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ systemInstruction: { parts: [{ text: "Write a concise weather briefing using only supplied Open-Meteo data. Include conditions, high/low, rain chance, useful changes or risks, and practical advice. Do not invent missing values. Distinguish forecasts from observations and express uncertainty." }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(weather) }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 350 } }) });
    if (!r.ok) throw new Error("AI provider did not return a response.");
    const data = await r.json(), briefing = data.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("").trim();
    if (!briefing) throw new Error("AI response was empty.");
    res.json({ briefing, source: "Gemini analysis of supplied Open-Meteo data" });
  } catch (e) { console.error("Briefing error:", e.message); res.status(502).json({ error: "AI briefing is temporarily unavailable." }); }
});
app.post("/api/compare-insight", async (req, res) => {
  const cities = req.body?.cities;
  if (!Array.isArray(cities) || cities.length < 2 || cities.length > 5) return res.status(400).json({ error: "Select between two and five cities." });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "AI explanation requires GEMINI_API_KEY on the server." });
  const numeric = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  const clean = cities.map(city => ({
    location: String(city?.location || "Unknown location").slice(0, 100),
    current: Object.fromEntries(["temperature_2m", "apparent_temperature", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m"].map(key => [key, numeric(city?.current?.[key])])),
    today: Object.fromEntries(["high", "low", "precipitation_probability_max", "uv_index_max"].map(key => [key, numeric(city?.today?.[key])])),
    airQuality: Object.fromEntries(["european_aqi", "pm2_5", "pm10"].map(key => [key, numeric(city?.airQuality?.[key])]))
  }));
  try {
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ systemInstruction: { parts: [{ text: "Compare only the supplied city weather and AQI values. Identify meaningful differences for planning, quote numbers with units, explain missing AQI values as unavailable, and avoid asserting safety or inventing causes. Keep the explanation concise." }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(clean) }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 400 } }) });
    if (!r.ok) throw new Error("AI provider did not return a response.");
    const data = await r.json(), explanation = data.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("").trim();
    if (!explanation) throw new Error("AI response was empty.");
    res.json({ explanation, source: "Gemini explanation based on retrieved Open-Meteo weather and air-quality data" });
  } catch (e) { console.error("Comparison AI error:", e.message); res.status(502).json({ error: "AI comparison explanation is temporarily unavailable." }); }
});
app.get("/api/alerts", (_req, res) => res.json({ alerts: [], available: false, message: "No official meteorological alert feed is configured for this location. Weather patterns shown elsewhere are forecasts, not official warnings." }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, _req, res, _next) => { console.error("API error:", err.message); res.status(err.status || 502).json({ error: err.status ? err.message : "Weather data is temporarily unavailable. Please try again." }); });
const server = app.listen(PORT, () => console.log(`WeatherWise AI running at http://localhost:${PORT}`));
server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. If WeatherWise is already running, open http://localhost:${PORT}. Otherwise stop the existing process with Ctrl+C in its terminal, or choose another port with $env:PORT=3001.`);
    process.exitCode = 1;
    return;
  }
  console.error("Unable to start WeatherWise:", error.message);
  process.exitCode = 1;
});
