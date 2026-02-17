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
<title>Tapping Time — Maple Sap Tapping Forecast</title>
<meta name="description" content="Free maple sap tapping forecast. Uses your location and 7-day weather data to analyze freeze-thaw cycles and recommend the best days to tap sugar maple trees.">
<meta property="og:title" content="Tapping Time — Maple Sap Tapping Forecast">
<meta property="og:description" content="Analyze 7-day freeze-thaw cycles to find the best days for tapping sugar maple trees. Free, location-based forecast.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Tapping Time — Maple Sap Tapping Forecast">
<meta name="twitter:description" content="Analyze 7-day freeze-thaw cycles to find the best days for tapping sugar maple trees. Free, location-based forecast.">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "name": "Tapping Time",
      "description": "Free maple sap tapping forecast that analyzes 7-day freeze-thaw cycles to recommend the best days to tap sugar maple trees.",
      "applicationCategory": "WeatherApplication",
      "operatingSystem": "Any",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      }
    },
    {
      "@type": "HowTo",
      "name": "How to Tap Maple Trees",
      "description": "A step-by-step guide to tapping sugar maple trees for sap collection and syrup production.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Choose a tree",
          "text": "Pick a healthy sugar maple at least 30 cm (12 in) in diameter. A tree 12-18 in diameter supports one tap; larger than 18 in can take two."
        },
        {
          "@type": "HowToStep",
          "name": "Drill the tap hole",
          "text": "Use a 5/16 or 7/16 inch bit, about 5 cm (2 in) deep at a slight upward angle. Place the tap above a large root or below a large branch on the south-facing side."
        },
        {
          "@type": "HowToStep",
          "name": "Check your shavings",
          "text": "Light-coloured chips mean healthy sapwood. Dark shavings mean pick a different spot."
        },
        {
          "@type": "HowToStep",
          "name": "Collect sap",
          "text": "Hang a food-safe, lidded bucket or attach tubing to the spile. Collect sap daily and refrigerate it — sap spoils quickly above freezing."
        },
        {
          "@type": "HowToStep",
          "name": "Boil into syrup",
          "text": "It takes roughly 40 litres of sap to make 1 litre of syrup. Boil outdoors — the steam will peel wallpaper indoors."
        },
        {
          "@type": "HowToStep",
          "name": "Pull taps at end of season",
          "text": "Once temperatures stay above freezing consistently or buds appear on branches, pull your spiles. Remove spiles with pliers and let tap holes heal on their own."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the freeze-thaw cycle for maple sap?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Maple sap flows when nighttime temperatures drop below freezing and daytime temperatures rise above freezing. This creates pressure changes inside the tree that push sap through the tap. Ideal conditions are overnight lows of -7\\u00b0C to -2\\u00b0C with daytime highs of 4\\u00b0C to 10\\u00b0C."
          }
        },
        {
          "@type": "Question",
          "name": "When is the best time to tap maple trees?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The best sap runs happen during extended stretches of freeze-thaw days, typically in late winter to early spring. A single good day produces less sap than a 5-day run of consecutive freeze-thaw cycles."
          }
        },
        {
          "@type": "Question",
          "name": "When should I stop tapping and pull my spiles?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Pull your taps when temperatures stay above freezing consistently (ending the freeze-thaw cycle) or when buds appear on the branches. Budding sap develops an off 'buddy' flavour that won't make good syrup."
          }
        }
      ]
    }
  ]
}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Outfit:wght@400;500;600;700&display=swap">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #f5f0eb;
    color: #2c2520;
    line-height: 1.5;
    min-height: 100vh;
  }

  .container {
    max-width: 880px;
    margin: 0 auto;
    padding: 20px 16px;
  }

  header {
    text-align: center;
    margin-bottom: 16px;
  }

  header h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 2rem;
    font-weight: 700;
    color: #5C3D2E;
    letter-spacing: -0.02em;
  }

  header p {
    color: #6d6157;
    font-size: 0.9rem;
    margin-top: 2px;
  }

  .header-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 10px;
  }

  .header-current {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 0.88rem;
    color: #6d6157;
  }

  .header-current .header-temp {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: #2c2520;
  }

  .header-current .header-sep {
    color: #d4cdc6;
  }

  .loc-text {
    font-size: 0.82rem;
    color: #6d6157;
    font-weight: 500;
  }

  .map-container {
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    height: 100px;
    margin-bottom: 12px;
    pointer-events: none;
  }

  .map-container iframe {
    border-radius: 10px;
    display: block;
  }

  .unit-toggle {
    display: flex;
    gap: 2px;
    background: #f5f0eb;
    border-radius: 6px;
    padding: 2px;
  }

  .unit-toggle button {
    border: none;
    background: transparent;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.82rem;
    color: #6d6157;
    font-weight: 500;
    transition: all 0.15s;
  }

  .unit-toggle button.active {
    background: #fff;
    color: #2c2520;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  }

  .card {
    background: #fff;
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }

  .card h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6d6157;
    margin-bottom: 10px;
    font-weight: 600;
  }

  .recommendation-box {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px;
    border-radius: 10px;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .recommendation-box .rec-icon {
    font-size: 1.4rem;
    flex-shrink: 0;
  }

  .rec-tap_now { background: #d4edda; }
  .rec-upcoming { background: #fff3cd; }
  .rec-no_window { background: #f5f0eb; }
  .rec-season_over { background: #fde8e8; }
  .rec-too_cold { background: #e8f0fd; }

  .forecast-card {
    margin-bottom: 12px;
  }

  .forecast-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .forecast-day {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #faf8f6;
    border-radius: 8px;
    font-size: 0.85rem;
    border-left: 3px solid transparent;
  }

  .forecast-day.excellent { border-left-color: #00b894; }
  .forecast-day.good { border-left-color: #00cec9; }
  .forecast-day.fair { border-left-color: #fdcb6e; }
  .forecast-day.poor { border-left-color: #e8e3de; }

  .forecast-day .day-name {
    font-weight: 600;
    min-width: 90px;
  }

  .forecast-day .temps {
    color: #6d6157;
    min-width: 120px;
  }

  .forecast-day .day-rating {
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    min-width: 70px;
    text-align: right;
  }

  .day-rating.excellent { color: #007a56; }
  .day-rating.good { color: #008380; }
  .day-rating.fair { color: #c24726; }
  .day-rating.poor { color: #6b7a82; }

  .how-it-works {
    margin-bottom: 12px;
  }

  .how-it-works h3 {
    font-size: 0.9rem;
    margin-bottom: 6px;
    color: #5C3D2E;
    font-weight: 600;
  }

  .how-it-works p, .how-it-works li {
    font-size: 0.84rem;
    color: #6d6157;
    margin-bottom: 4px;
  }

  .how-it-works ul {
    padding-left: 18px;
  }

  .tapping-guides {
    margin-bottom: 12px;
  }

  .tapping-guides h3 {
    font-size: 0.9rem;
    margin-bottom: 6px;
    color: #5C3D2E;
    font-weight: 600;
  }

  .tapping-guides p, .tapping-guides li {
    font-size: 0.84rem;
    color: #6d6157;
    margin-bottom: 4px;
  }

  .tapping-guides ul {
    padding-left: 18px;
  }

  .tapping-guides a {
    color: #5C3D2E;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .tapping-guides a:hover {
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }

  footer {
    margin-top: 24px;
    padding: 16px 0;
    border-top: 1px solid #e8e3de;
    font-size: 0.78rem;
    color: #6d6157;
  }

  footer h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #5C3D2E;
    margin-bottom: 10px;
    font-weight: 600;
  }

  footer ul {
    list-style: none;
    padding: 0;
  }

  footer li {
    margin-bottom: 6px;
    line-height: 1.4;
  }

  footer a {
    color: #5C3D2E;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  footer a:hover {
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }

  footer .footer-note {
    margin-top: 12px;
    font-size: 0.75rem;
    color: #6d6157;
  }

  .loading, .error-state {
    text-align: center;
    padding: 48px 16px;
  }

  .loading p {
    margin-top: 16px;
    color: #6d6157;
  }

  .sap-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .sap-loader .leaf {
    font-size: 2.2rem;
    animation: leafBob 1.5s ease-in-out infinite;
    filter: drop-shadow(0 2px 4px rgba(92,61,46,0.2));
  }

  .sap-loader .drops {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }

  .sap-loader .drop {
    width: 6px;
    height: 6px;
    background: #C67A3C;
    border-radius: 50%;
    animation: sapDrop 1.2s ease-in-out infinite;
  }

  .sap-loader .drop:nth-child(2) { animation-delay: 0.2s; }
  .sap-loader .drop:nth-child(3) { animation-delay: 0.4s; }

  @keyframes leafBob {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-6px) rotate(5deg); }
  }

  @keyframes sapDrop {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.3); }
  }

  .error-state p {
    color: #d63031;
    margin-bottom: 12px;
  }

  .error-state button {
    padding: 8px 20px;
    background: #5C3D2E;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.88rem;
    font-weight: 500;
  }

  .window-dates {
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 2px;
  }

  .window-detail {
    font-size: 0.84rem;
    color: #6d6157;
  }

  /* Staggered content reveal */
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }

  #forecast-results .map-container,
  #forecast-results #recommendation-card,
  #forecast-results .forecast-card {
    animation: fadeSlideIn 0.45s ease-out both;
  }

  #forecast-results .map-container { animation-delay: 0s; }
  #forecast-results #recommendation-card { animation-delay: 0.08s; }
  #forecast-results .forecast-card { animation-delay: 0.16s; }

  .noscript-notice {
    background: #fff;
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border-left: 4px solid #5C3D2E;
    font-size: 0.88rem;
    color: #5C3D2E;
  }

  .noscript-notice p {
    margin-bottom: 4px;
  }

  .noscript-notice p:last-child {
    margin-bottom: 0;
    color: #6d6157;
  }

  /* Card hover lift */
  .card {
    transition: box-shadow 0.2s, transform 0.2s;
  }

  .card:hover {
    box-shadow: 0 6px 16px rgba(92,61,46,0.1);
    transform: translateY(-2px);
  }

  /* Forecast row hover */
  .forecast-day {
    transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
    cursor: default;
  }

  .forecast-day:hover {
    background: #f0ece7;
    transform: scale(1.01);
    box-shadow: 0 2px 6px rgba(0,0,0,0.04);
  }

  /* Maple leaf header decoration */
  header h1::before {
    content: '\\1F341';
    display: inline-block;
    margin-right: 6px;
    font-size: 1.5rem;
    vertical-align: middle;
    animation: leafSway 3s ease-in-out infinite;
  }

  @keyframes leafSway {
    0%, 100% { transform: rotate(-8deg); }
    50% { transform: rotate(8deg); }
  }

  /* Unit toggle hover */
  .unit-toggle button:not(.active):hover {
    color: #5C3D2E;
    background: rgba(255,255,255,0.5);
  }

  /* Error button interaction */
  .error-state button {
    transition: background 0.15s, transform 0.1s;
  }

  .error-state button:hover {
    background: #7B5440;
  }

  .error-state button:active {
    transform: scale(0.97);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 680px) {
    .forecast-day { flex-wrap: wrap; gap: 4px; }
    .forecast-day .temps { min-width: auto; }
    .container { padding: 16px 12px; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Tapping Time</h1>
    <p>Your maple sap forecast</p>
    <div class="header-bar" id="header-bar" style="display:none;">
      <span class="loc-text" id="loc-text"></span>
      <div class="unit-toggle">
        <button id="btn-c" class="active" onclick="setUnit('C')">°C</button>
        <button id="btn-f" onclick="setUnit('F')">°F</button>
      </div>
    </div>
    <div class="header-current" id="header-current" style="display:none;">
      <span class="header-temp" id="current-temp"></span>
      <span class="header-sep">&middot;</span>
      <span id="current-summary"></span>
    </div>
  </header>

  <div id="app">
    <!-- Dynamic forecast section (progressive enhancement) -->
    <section id="forecast-section" aria-live="polite">
      <h2 class="sr-only">Sap Forecast</h2>
      <noscript>
        <div class="noscript-notice">
          <p><strong>JavaScript is required for the live forecast.</strong></p>
          <p>Enable JavaScript and allow location access to see a personalized 7-day sap forecast. In the meantime, browse the tapping guides and resources below.</p>
        </div>
      </noscript>

      <div class="loading" id="loading">
        <div class="sap-loader">
          <div class="leaf">&#x1F341;</div>
          <div class="drops">
            <div class="drop"></div>
            <div class="drop"></div>
            <div class="drop"></div>
          </div>
        </div>
        <p>Detecting your location...</p>
      </div>

      <div class="error-state" id="error" style="display:none;">
        <p id="error-msg"></p>
        <button onclick="retry()">Try again</button>
      </div>

      <div id="forecast-results" style="display:none;">
        <div class="map-container" id="map-container" style="display:none;">
          <iframe id="map-frame" width="100%" height="100%" frameborder="0"
            scrolling="no" loading="lazy" title="Map showing your location"></iframe>
        </div>

        <div class="card" id="recommendation-card">
          <h2>Best Tapping Window</h2>
          <div id="recommendation"></div>
        </div>

        <div class="card forecast-card">
          <h2>7-Day Forecast</h2>
          <div class="forecast-list" id="forecast-list"></div>
        </div>
      </div>
    </section>

    <!-- Static content (always visible, no JS needed) -->
    <main>
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

      <div class="card tapping-guides">
        <h2>Tapping Guides</h2>
        <h3>Choosing &amp; Tapping a Tree</h3>
        <p>Pick a healthy sugar maple at least 30 cm (12 in) in diameter. Place
           the tap above a large root or below a large branch on the south-facing
           side for the earliest flow.</p>
        <ul>
          <li><strong>Tree size:</strong> 12–18 in diameter supports one tap; larger than 18 in can take two (<a href="https://vermontevaporator.com/diy-maple-syrup-how-to-tap-2/" target="_blank" rel="noopener">Vermont Evaporator Co.</a>).</li>
          <li><strong>Drill:</strong> Use a 5/16″ or 7/16″ bit, about 5 cm (2 in) deep at a slight upward angle.</li>
          <li><strong>Check your shavings:</strong> Light-coloured chips mean healthy sapwood — dark shavings mean pick a different spot (<a href="https://tapmytrees.com/tap-tree/" target="_blank" rel="noopener">Tap My Trees</a>).</li>
        </ul>
        <h3>Collecting &amp; Boiling</h3>
        <p>Hang a food-safe, lidded bucket or attach tubing to the spile. Collect
           sap daily and refrigerate it — sap spoils quickly above freezing.</p>
        <ul>
          <li><strong>Ratio:</strong> It takes roughly 40 litres of sap to make 1 litre of syrup.</li>
          <li><strong>Boil outdoors:</strong> The steam will peel wallpaper indoors (<a href="https://www.almanac.com/making-maple-syrup-answering-common-questions" target="_blank" rel="noopener">Old Farmer's Almanac</a>).</li>
        </ul>
        <h3>When to Pull Your Taps</h3>
        <p>Without the freeze-thaw cycle, sap flow stops. Watch for these signs
           that the season is over:</p>
        <ul>
          <li><strong>No more freezing nights:</strong> Once temperatures stay above freezing consistently, flow dries up (<a href="https://www.motherearthnews.com/homesteading-and-livestock/end-of-maple-tapping-season-zbcz1503/" target="_blank" rel="noopener">Mother Earth News</a>).</li>
          <li><strong>Bud break:</strong> Once buds appear on the branches, sap develops an off "buddy" flavour that won't make good syrup. Pull your spiles before buds open.</li>
        </ul>
        <h3>End-of-Season Cleanup</h3>
        <p>Remove spiles with pliers and let tap holes heal on their own — don't
           plug them.</p>
        <ul>
          <li><strong>Clean equipment:</strong> Scrub with dilute bleach (1 part unscented bleach to 20 parts water), then triple-rinse with hot water (<a href="https://tapmytrees.com/cleanup/" target="_blank" rel="noopener">Tap My Trees</a>).</li>
          <li><strong>Store dry:</strong> Keep spiles, buckets, and lids in a dry, dust-free place until next season (<a href="https://vermontevaporator.com/end-of-season-clean-up-pulling-taps-and-flushing-lines/" target="_blank" rel="noopener">Vermont Evaporator Co.</a>).</li>
        </ul>
      </div>
    </main>

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

    // Current conditions (in header)
    document.getElementById('current-temp').textContent = tempStr(d.current.temperature);
    document.getElementById('current-summary').textContent = d.current.summary;
    document.getElementById('header-current').style.display = 'flex';

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
    document.getElementById('forecast-results').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-msg').textContent = msg;
  }

  function showContent() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('forecast-results').style.display = 'block';
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
      document.getElementById('header-bar').style.display = 'flex';

      var delta = 0.05;
      var bbox = (lon - delta) + ',' + (lat - delta) + ',' +
                 (lon + delta) + ',' + (lat + delta);
      var mapUrl = 'https://www.openstreetmap.org/export/embed.html'
        + '?bbox=' + bbox + '&layer=mapnik&marker=' + lat + ',' + lon;
      document.getElementById('map-frame').src = mapUrl;
      document.getElementById('map-container').style.display = 'block';

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

  if ('requestIdleCallback' in window) {
    requestIdleCallback(getLocation, { timeout: 2000 });
  } else {
    setTimeout(getLocation, 1000);
  }
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

    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', {
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // Serve frontend for all other routes
    return new Response(getHTML(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
};
