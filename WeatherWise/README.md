# WeatherWise AI

**Beyond Weather. Smarter Decisions.** WeatherWise AI is a full-stack weather dashboard that combines live provider data with practical, clearly labeled guidance. It is an MCA portfolio project built with Node.js, Express, and browser-native JavaScript.

> WeatherWise displays forecast-model data from Open-Meteo. Its “current” conditions are the provider's latest model values, not readings from a local weather station.

## Project overview

Search for a city or use browser location to view current conditions, hourly and seven-day forecasts, air quality, and historical daily weather. Compare two to five cities using retrieved weather and AQI data. A rule-based assistant works without an AI credential; optional Gemini features provide a daily briefing and comparison explanation when configured.

## Features

- Current weather details including temperature, feels-like temperature, humidity, wind, pressure, visibility, UV, and precipitation.
- 48-hour hourly and seven-day forecasts, with temperature and precipitation-probability charts.
- Search suggestions, recent places, browser geolocation, and an OpenStreetMap location map.
- European AQI and pollutant values from Open-Meteo Air Quality.
- Search and select two to five cities for a side-by-side comparison based on provider data.
- Forecast-based assistant guidance without a Gemini key; optional Gemini daily briefing and comparison explanation.
- Historical daily weather lookup for one past date.
- Clear status when an official weather-alert provider is not configured.
- Light/dark theme, automatic refresh, and responsive layouts.

## Technologies

- **Server:** Node.js 18 or later, Express
- **Client:** HTML, CSS, and vanilla JavaScript
- **Weather data:** Open-Meteo Forecast, Geocoding, Air Quality, and Historical Weather APIs
- **Reverse geocoding and map:** OpenStreetMap Nominatim and Leaflet / OpenStreetMap tiles
- **Charts:** Chart.js
- **Optional AI:** Google Gemini API

Third-party map, chart, and font assets load from public CDNs. Weather lookups do not depend on Gemini. Charts and the map may be unavailable when their CDNs are blocked.

## Architecture

The browser serves the dashboard from `public/` and calls JSON endpoints on the Express server. The server validates requests, calls external data providers, applies timeouts and in-memory caching, and returns provider data to the browser. The Gemini key, when configured, is read only by the server and is never embedded in client files. The browser stores a small recent-place list and theme preference in local storage; there is no account system or database.

```text
Browser (public/index.html, app.js, style.css)
        |
        | same-origin /api requests
        v
Node.js + Express (server.js)
   |             |                |
   v             v                v
Open-Meteo   OpenStreetMap   Google Gemini (optional)
```

## Project structure

```text
WeatherWise/
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- style.css
|-- .env.example
|-- .gitignore
|-- package-lock.json
|-- package.json
|-- README.md
`-- server.js
```

`node_modules/` is created locally by npm and is excluded from Git.

## APIs and data sources

| Source | Use | Credential |
| --- | --- | --- |
| [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Current model conditions and hourly/daily forecasts | None for this project |
| [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | City search and suggestions | None |
| [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) | European AQI and pollutants | None |
| [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) | Daily data for a selected past date | None |
| [OpenStreetMap Nominatim](https://nominatim.org/release-docs/latest/api/Reverse/) | Reverse geocoding of browser coordinates | None; usage policy applies |
| [OpenStreetMap tiles](https://www.openstreetmap.org/copyright) | Map tiles and attribution | None |
| [Google Gemini API](https://ai.google.dev/gemini-api/docs) | Optional generated briefing and comparison explanation | `GEMINI_API_KEY` |

WeatherWise does not currently connect to an official meteorological alert feed. The alerts panel states this limitation instead of presenting a forecast as an official warning.

## Requirements

- Node.js 18 or later (npm is included with Node.js)
- Internet access for weather services and optional CDN assets
- Optional: a Gemini API key for AI-generated daily briefings and comparison explanations

## Installation

Clone the repository, open its folder in a terminal, and install the dependencies:

```bash
git clone <your-github-repository-url>
cd WeatherWise
npm install
```

`npm ci` is also available for a clean install that follows `package-lock.json`. Neither command requires uploading `node_modules/`; npm installs it on your computer.

## Environment configuration

The weather dashboard works without a `.env` file or paid API key. To enable Gemini features, copy `.env.example` to `.env` and add your own key to the local `.env` file:

```env
PORT=3000
GEMINI_API_KEY=your_key_from_google_ai_studio
GEMINI_MODEL=gemini-3.8-flash
# Optional: REVERSE_GEOCODER_URL=https://nominatim.openstreetmap.org/reverse
```

Keep `.env` private. It is excluded by `.gitignore`; commit `.env.example` instead. Do not put API keys in `public/` or paste them into source files. Restart the server after changing environment variables. Gemini model availability may change; `GEMINI_MODEL` can be set to a model enabled for your key.

## Run the application

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). Check server status at [http://localhost:3000/api/health](http://localhost:3000/api/health). For automatic restart while editing, use:

```bash
npm run dev
```

If port 3000 is occupied, stop the other server or choose a different port. In PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

Then open `http://localhost:3001`.

## API routes

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | Server status and whether Gemini is configured |
| `GET /api/geocode?q=Pune` | City search suggestions |
| `GET /api/weather?city=Pune` | Weather by city name |
| `GET /api/weather?latitude=18.52&longitude=73.86` | Weather by coordinates |
| `GET /api/air-quality?latitude=18.52&longitude=73.86` | Current and hourly AQI data |
| `GET /api/history?latitude=18.52&longitude=73.86&date=2025-01-01` | Historical daily data for a past date |
| `GET /api/alerts?latitude=18.52&longitude=73.86` | Explicit alert-feed availability status |
| `POST /api/assistant` | Forecast-grounded assistant answer; Gemini is optional |
| `POST /api/briefing` | Gemini-generated daily briefing; requires a key |
| `POST /api/compare-insight` | Gemini-generated comparison explanation; requires a key |

## Screenshots

No screenshots are included yet. Before publishing a portfolio version, capture the main dashboard, city comparison, and a narrow mobile layout, then add those images to a `screenshots/` folder and embed them here.

## Verification

Check JavaScript syntax with:

```bash
node --check server.js
node --check public/app.js
```

Start the server and verify `/api/health`, then try a city search, hourly/daily forecast switch, air quality, city comparison, and a past date. Browser location requires permission and a secure context such as `localhost` or HTTPS. Gemini-specific results require a valid key and enabled model.

### QA status

Backend syntax, clean dependency installation, server startup, the health endpoint, and selected data routes have been checked. Weather, geocoding, air-quality, and historical routes returned provider data during the project audit; invalid city, coordinate, and date inputs were also checked. Gemini could not be verified against Google because no API key is configured. Browser-level interaction and visual checks (including location permission flows and desktop, tablet, and mobile layouts) remain pending; do not treat them as passed.

## Limitations

- “Current” conditions are the latest Open-Meteo model values, not local instrument observations.
- Official warnings are not available because no government alert feed is configured.
- The map shows the selected location only; it has no radar or weather overlays.
- Historical lookup supports one past date and daily values, not date-range analysis or climate normals.
- Rule-based assistant responses summarize supplied forecast data and are not authoritative safety advice. Gemini can be unavailable and should not replace official guidance.
- Caching and request limiting are in-memory and intended for a local/student demonstration, not a horizontally scaled production service.
- There is no database, account system, or server-side user profile.

## License

No license file is currently included. Add a license if you want to specify how others may use, modify, or distribute this project.
