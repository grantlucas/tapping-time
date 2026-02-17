// Tapping Time — Cloudflare Worker
// Serves the frontend and proxies/caches Pirate Weather API requests

import {
  scoreDay,
  findBestWindow,
  generateRecommendation,
  type ForecastDay,
  type Rating,
} from './scoring';

interface Env {
  FORECAST_CACHE: KVNamespace;
  PIRATE_WEATHER_API_KEY: string;
}

interface CurrentConditions {
  temperature: number | null;
  summary: string;
  icon: string;
}

interface ForecastResult {
  current: CurrentConditions;
  today: ForecastDay | null;
  days: ForecastDay[];
  bestWindow: {
    startDate: string;
    endDate: string;
    length: number;
    avgScore: number;
  } | null;
  recommendation: { type: string; message: string };
  cached: boolean;
}

const CACHE_TTL = 10800; // 3 hours in seconds

// ── API handler ────────────────────────────────────────────────────────────

async function handleForecast(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat') ?? '');
  const lon = parseFloat(url.searchParams.get('lon') ?? '');

  if (isNaN(lat) || isNaN(lon)) {
    return Response.json({ error: 'Missing or invalid lat/lon parameters' }, { status: 400 });
  }

  // Round to 1 decimal for cache key (~11km grid)
  const rlat = Math.round(lat * 10) / 10;
  const rlon = Math.round(lon * 10) / 10;
  const cacheKey = `forecast:${rlat}:${rlon}`;

  // Check KV cache
  if (env.FORECAST_CACHE) {
    const cached = await env.FORECAST_CACHE.get(cacheKey, 'json');
    if (cached) {
      return Response.json({ ...(cached as ForecastResult), cached: true });
    }
  }

  // Fetch from Pirate Weather
  const apiKey = env.PIRATE_WEATHER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'API key not configured' }, { status: 500 });
  }

  const apiUrl = `https://api.pirateweather.net/forecast/${apiKey}/${lat},${lon}?units=si&extend=hourly`;
  let apiResponse: Response;
  try {
    apiResponse = await fetch(apiUrl);
  } catch {
    return Response.json({ error: 'Failed to reach weather API' }, { status: 502 });
  }

  if (!apiResponse.ok) {
    return Response.json({ error: `Weather API returned ${apiResponse.status}` }, { status: 502 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weather: any = await apiResponse.json();

  // Process current conditions
  const currently = weather.currently || {};
  const current: CurrentConditions = {
    temperature: currently.temperature ?? null,
    summary: currently.summary ?? '',
    icon: currently.icon ?? '',
  };

  // Process daily forecast
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyData: any[] = weather.daily?.data || [];
  const days: ForecastDay[] = dailyData.map(d => {
    const date = new Date(d.time * 1000).toISOString().split('T')[0];
    const tempHigh: number | null = d.temperatureHigh ?? d.temperatureMax ?? null;
    const tempLow: number | null = d.temperatureLow ?? d.temperatureMin ?? null;

    const { rating, score } = (tempHigh !== null && tempLow !== null)
      ? scoreDay(tempLow, tempHigh)
      : { rating: 'unknown' as Rating, score: 0 };

    return {
      date,
      tempHigh,
      tempLow,
      summary: d.summary ?? '',
      icon: d.icon ?? '',
      rating,
      score,
    };
  });

  // Find best tapping window and generate recommendation
  const bestWindow = findBestWindow(days);
  const recommendation = generateRecommendation(days, bestWindow);

  const result: ForecastResult = {
    current,
    today: days[0] || null,
    days,
    bestWindow: bestWindow ? {
      startDate: bestWindow.start,
      endDate: bestWindow.end,
      length: bestWindow.days.length,
      avgScore: bestWindow.totalScore / bestWindow.days.length,
    } : null,
    recommendation,
    cached: false,
  };

  // Store in KV cache
  if (env.FORECAST_CACHE) {
    await env.FORECAST_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
  }

  return Response.json(result);
}

// ── Frontend HTML ──────────────────────────────────────────────────────────

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tapping Time</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f0f4f3;
    color: #2d3436;
    line-height: 1.5;
    min-height: 100vh;
  }

  .container {
    max-width: 640px;
    margin: 0 auto;
    padding: 24px 16px;
  }

  header {
    text-align: center;
    margin-bottom: 24px;
  }

  header h1 {
    font-size: 1.8rem;
    color: #6b4226;
  }

  header p {
    color: #636e72;
    font-size: 0.95rem;
    margin-top: 4px;
  }

  .location-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fff;
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .location-bar .loc-text {
    font-size: 0.9rem;
    color: #636e72;
  }

  .unit-toggle {
    display: flex;
    gap: 4px;
    background: #f0f4f3;
    border-radius: 6px;
    padding: 2px;
  }

  .unit-toggle button {
    border: none;
    background: transparent;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.85rem;
    color: #636e72;
    transition: all 0.15s;
  }

  .unit-toggle button.active {
    background: #fff;
    color: #2d3436;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  }

  .card {
    background: #fff;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .card h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #636e72;
    margin-bottom: 12px;
  }

  .current-temp {
    font-size: 2.4rem;
    font-weight: 700;
    color: #2d3436;
  }

  .current-details {
    display: flex;
    gap: 16px;
    margin-top: 8px;
    font-size: 0.9rem;
    color: #636e72;
  }

  .current-rating {
    display: inline-block;
    margin-top: 12px;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .rating-excellent { background: #00b894; color: #fff; }
  .rating-good { background: #00cec9; color: #fff; }
  .rating-fair { background: #fdcb6e; color: #2d3436; }
  .rating-poor { background: #dfe6e9; color: #636e72; }
  .rating-unknown { background: #dfe6e9; color: #636e72; }

  .recommendation-box {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border-radius: 10px;
    font-size: 0.95rem;
  }

  .recommendation-box .rec-icon {
    font-size: 1.6rem;
    flex-shrink: 0;
  }

  .rec-tap_now { background: #d4edda; }
  .rec-upcoming { background: #fff3cd; }
  .rec-no_window { background: #f0f4f3; }
  .rec-season_over { background: #fde8e8; }
  .rec-too_cold { background: #e8f0fd; }

  .forecast-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .forecast-day {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #f8f9fa;
    border-radius: 8px;
    font-size: 0.9rem;
    border-left: 4px solid transparent;
  }

  .forecast-day.excellent { border-left-color: #00b894; }
  .forecast-day.good { border-left-color: #00cec9; }
  .forecast-day.fair { border-left-color: #fdcb6e; }
  .forecast-day.poor { border-left-color: #dfe6e9; }

  .forecast-day .day-name {
    font-weight: 600;
    min-width: 90px;
  }

  .forecast-day .temps {
    color: #636e72;
    min-width: 120px;
  }

  .forecast-day .day-rating {
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    min-width: 70px;
    text-align: right;
  }

  .day-rating.excellent { color: #00b894; }
  .day-rating.good { color: #00cec9; }
  .day-rating.fair { color: #e17055; }
  .day-rating.poor { color: #b2bec3; }

  .how-it-works h3 {
    font-size: 0.95rem;
    margin-bottom: 8px;
    color: #6b4226;
  }

  .how-it-works p, .how-it-works li {
    font-size: 0.88rem;
    color: #636e72;
    margin-bottom: 6px;
  }

  .how-it-works ul {
    padding-left: 20px;
  }

  footer {
    margin-top: 32px;
    padding: 20px 0;
    border-top: 1px solid #dfe6e9;
    font-size: 0.82rem;
    color: #636e72;
  }

  footer h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b4226;
    margin-bottom: 12px;
  }

  footer ul {
    list-style: none;
    padding: 0;
  }

  footer li {
    margin-bottom: 8px;
    line-height: 1.4;
  }

  footer a {
    color: #6b4226;
    text-decoration: none;
  }

  footer a:hover {
    text-decoration: underline;
  }

  footer .footer-note {
    margin-top: 16px;
    font-size: 0.78rem;
    color: #b2bec3;
  }

  .loading, .error-state {
    text-align: center;
    padding: 48px 16px;
  }

  .loading p {
    margin-top: 16px;
    color: #636e72;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #dfe6e9;
    border-top-color: #6b4226;
    border-radius: 50%;
    margin: 0 auto;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .error-state p {
    color: #d63031;
    margin-bottom: 12px;
  }

  .error-state button {
    padding: 8px 20px;
    background: #6b4226;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .window-dates {
    font-weight: 600;
    font-size: 0.95rem;
    margin-bottom: 2px;
  }

  .window-detail {
    font-size: 0.88rem;
    color: #636e72;
  }

  @media (max-width: 480px) {
    .forecast-day { flex-wrap: wrap; gap: 4px; }
    .forecast-day .temps { min-width: auto; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Tapping Time</h1>
    <p>When should I tap my maple tree?</p>
  </header>

  <div id="app">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <p>Detecting your location...</p>
    </div>

    <div class="error-state" id="error" style="display:none;">
      <p id="error-msg"></p>
      <button onclick="retry()">Try again</button>
    </div>

    <div id="content" style="display:none;">
      <div class="location-bar">
        <span class="loc-text" id="loc-text">Locating...</span>
        <div class="unit-toggle">
          <button id="btn-c" class="active" onclick="setUnit('C')">°C</button>
          <button id="btn-f" onclick="setUnit('F')">°F</button>
        </div>
      </div>

      <div class="card" id="current-card">
        <h2>Right Now</h2>
        <div class="current-temp" id="current-temp"></div>
        <div class="current-details">
          <span id="current-summary"></span>
          <span id="today-hilo"></span>
        </div>
        <div>
          <span class="current-rating" id="today-rating"></span>
        </div>
      </div>

      <div class="card" id="recommendation-card">
        <h2>Best Tapping Window</h2>
        <div id="recommendation"></div>
      </div>

      <div class="card">
        <h2>7-Day Forecast</h2>
        <div class="forecast-list" id="forecast-list"></div>
      </div>

      <div class="card how-it-works">
        <h2>How It Works</h2>
        <h3>The Freeze-Thaw Cycle</h3>
        <p>Maple sap flows when nighttime temperatures drop below freezing and daytime
           temperatures rise above freezing. This creates pressure changes inside the
           tree that push sap through the tap.</p>
        <h3>What the Ratings Mean</h3>
        <ul>
          <li><strong>Excellent:</strong> Ideal freeze-thaw — overnight lows of -7°C to -2°C with daytime highs of 4°C to 10°C.</li>
          <li><strong>Good:</strong> Solid freeze-thaw cycle — freezes overnight, thaws above 2°C during the day.</li>
          <li><strong>Fair:</strong> Marginal — some freeze-thaw activity but temperatures are outside the ideal range.</li>
          <li><strong>Poor:</strong> No freeze-thaw cycle — either too warm (no freeze) or too cold (no thaw).</li>
        </ul>
        <h3>Consecutive Days Matter</h3>
        <p>The best sap runs happen during extended stretches of freeze-thaw days. A
           single good day produces less sap than a 5-day run. The "Best Tapping Window"
           highlights the longest stretch of good-or-better conditions in the forecast.</p>
      </div>

      <footer>
        <h2>Sources &amp; Further Reading</h2>
        <ul>
          <li>
            Tyree, M.T. (1983). "Maple Sap Uptake, Exudation, and Pressure Changes
            Correlated with Freezing Exotherms and Thawing Endotherms."
            <em>Plant Physiology</em>, 73(2), 277–285.
            <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC1066453/" target="_blank" rel="noopener">PMC</a>
          </li>
          <li>
            Rapp, J.M. et al. (2019). "Finding the Sweet Spot: Shifting Optimal
            Climate for Maple Syrup Production in North America."
            <em>Forest Ecology and Management</em>.
            <a href="https://www.sciencedirect.com/science/article/pii/S0378112719303019" target="_blank" rel="noopener">ScienceDirect</a>
          </li>
          <li>
            Graf, I. et al. (2024). "Experimental and Computational Comparison of
            Freeze–Thaw-Induced Pressure Generation in Red and Sugar Maple."
            <em>Tree Physiology</em>, 44(4).
            <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11448476/" target="_blank" rel="noopener">PMC</a>
          </li>
          <li>
            <a href="https://www.uvm.edu/cals/proctor-maple-research-center" target="_blank" rel="noopener">UVM Proctor Maple Research Center</a>
            — the oldest maple research center in the world (est. 1946)
          </li>
          <li>
            <a href="https://blogs.cornell.edu/cornellmaple/" target="_blank" rel="noopener">Cornell Sugar Maple Research &amp; Extension Program</a>
            — production research and climate monitoring
          </li>
          <li>
            <a href="https://www.massmaple.org/about-maple-syrup/how-sugar-maple-trees-work/" target="_blank" rel="noopener">Massachusetts Maple Producers Association</a>
            — how sugar maple trees work
          </li>
          <li>
            <a href="https://umaine.edu/ecologyandenvironmentalsciences/2014/02/19/making-sense-of-maple-syrup/" target="_blank" rel="noopener">University of Maine</a>
            — making sense of maple syrup
          </li>
        </ul>
        <p class="footer-note">
          Weather data provided by <a href="https://pirateweather.net/" target="_blank" rel="noopener">Pirate Weather</a>.
        </p>
      </footer>
    </div>
  </div>
</div>

<script>
(function() {
  let forecastData = null;
  let unit = 'C';

  function toF(c) {
    return c !== null ? (c * 9/5) + 32 : null;
  }

  function tempStr(c) {
    if (c === null) return '--';
    const v = unit === 'F' ? toF(c) : c;
    return Math.round(v) + '°' + unit;
  }

  function ratingLabel(r) {
    return r.charAt(0).toUpperCase() + r.slice(1);
  }

  function dayName(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatWindowDates(start, end) {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const opts = { month: 'short', day: 'numeric' };
    if (start === end) return s.toLocaleDateString('en-US', { weekday: 'short', ...opts });
    return s.toLocaleDateString('en-US', opts) + ' – ' + e.toLocaleDateString('en-US', opts);
  }

  const recIcons = {
    tap_now: '\u{1F3AF}',
    upcoming: '\u{1F4C5}',
    no_window: '\u{1F32B}',
    season_over: '\u{2600}',
    too_cold: '\u{2744}'
  };

  function render() {
    if (!forecastData) return;
    const d = forecastData;

    // Current conditions
    document.getElementById('current-temp').textContent = tempStr(d.current.temperature);
    document.getElementById('current-summary').textContent = d.current.summary;

    if (d.today) {
      document.getElementById('today-hilo').textContent =
        'H: ' + tempStr(d.today.tempHigh) + '  L: ' + tempStr(d.today.tempLow);

      const ratingEl = document.getElementById('today-rating');
      ratingEl.textContent = ratingLabel(d.today.rating);
      ratingEl.className = 'current-rating rating-' + d.today.rating;
    }

    // Recommendation
    const recEl = document.getElementById('recommendation');
    const rec = d.recommendation;
    let recHTML = '<div class="recommendation-box rec-' + rec.type + '">';
    recHTML += '<span class="rec-icon">' + (recIcons[rec.type] || '') + '</span>';
    recHTML += '<div>';
    recHTML += '<div style="font-weight:600;">' + rec.message + '</div>';
    if (d.bestWindow) {
      recHTML += '<div class="window-dates" style="margin-top:6px;">'
        + formatWindowDates(d.bestWindow.startDate, d.bestWindow.endDate) + '</div>';
      recHTML += '<div class="window-detail">'
        + d.bestWindow.length + ' day' + (d.bestWindow.length > 1 ? 's' : '')
        + ' of favorable conditions</div>';
    }
    recHTML += '</div></div>';
    recEl.innerHTML = recHTML;

    // 7-day forecast
    const listEl = document.getElementById('forecast-list');
    listEl.innerHTML = '';
    d.days.forEach(function(day) {
      const row = document.createElement('div');
      row.className = 'forecast-day ' + day.rating;
      row.innerHTML =
        '<span class="day-name">' + dayName(day.date) + '</span>' +
        '<span class="temps">H: ' + tempStr(day.tempHigh) + '  L: ' + tempStr(day.tempLow) + '</span>' +
        '<span class="day-rating ' + day.rating + '">' + ratingLabel(day.rating) + '</span>';
      listEl.appendChild(row);
    });
  }

  window.setUnit = function(u) {
    unit = u;
    document.getElementById('btn-c').className = u === 'C' ? 'active' : '';
    document.getElementById('btn-f').className = u === 'F' ? 'active' : '';
    render();
  };

  function showError(msg) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-msg').textContent = msg;
  }

  function showContent() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('content').style.display = 'block';
  }

  async function fetchForecast(lat, lon) {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loading').querySelector('p').textContent = 'Fetching forecast...';

    try {
      const resp = await fetch('/api/forecast?lat=' + lat + '&lon=' + lon);
      if (!resp.ok) {
        const body = await resp.json().catch(function() { return {}; });
        throw new Error(body.error || 'Failed to load forecast');
      }
      forecastData = await resp.json();
      document.getElementById('loc-text').textContent =
        lat.toFixed(1) + ', ' + lon.toFixed(1);
      showContent();
      render();
    } catch (err) {
      showError(err.message);
    }
  }

  function getLocation() {
    if (!navigator.geolocation) {
      showError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        fetchForecast(pos.coords.latitude, pos.coords.longitude);
      },
      function(err) {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            showError('Location permission denied. Please allow location access and try again.');
            break;
          case err.POSITION_UNAVAILABLE:
            showError('Location unavailable. Please try again.');
            break;
          case err.TIMEOUT:
            showError('Location request timed out. Please try again.');
            break;
          default:
            showError('Could not detect your location.');
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  window.retry = function() {
    document.getElementById('error').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loading').querySelector('p').textContent = 'Detecting your location...';
    getLocation();
  };

  getLocation();
})();
</script>
</body>
</html>`;
}

// ── Worker entry point ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/forecast') {
      return handleForecast(request, env);
    }

    // Serve frontend for all other routes
    return new Response(getHTML(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
};
