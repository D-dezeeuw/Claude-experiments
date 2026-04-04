/**
 * TraderAI — World News Pulse (Radial Bar Chart)
 * Cities/regions arranged in a circle, bar length = news temperature.
 */

// Cities mapped to keyword patterns for news scanning
const WORLD_CITIES = [
  { name: 'New York',    region: 'US',          keywords: ['new york', 'wall street', 'nyse', 'nasdaq', 'manhattan', 'fed ', 'federal reserve'] },
  { name: 'Washington',  region: 'US',          keywords: ['washington', 'white house', 'congress', 'pentagon', 'capitol', 'senate'] },
  { name: 'London',      region: 'Europe',      keywords: ['london', 'uk ', 'britain', 'ftse', 'bank of england', 'boe'] },
  { name: 'Frankfurt',   region: 'Europe',      keywords: ['frankfurt', 'ecb', 'eurozone', 'euro ', 'dax', 'bundesbank'] },
  { name: 'Tokyo',       region: 'Asia',        keywords: ['tokyo', 'japan', 'nikkei', 'boj', 'yen '] },
  { name: 'Shanghai',    region: 'China',       keywords: ['shanghai', 'china', 'beijing', 'pboc', 'yuan', 'chinese'] },
  { name: 'Hong Kong',   region: 'China',       keywords: ['hong kong', 'hang seng', 'hkex'] },
  { name: 'Mumbai',      region: 'Emerging',    keywords: ['mumbai', 'india', 'sensex', 'nifty', 'modi', 'rupee'] },
  { name: 'Dubai',       region: 'Middle East', keywords: ['dubai', 'saudi', 'opec', 'gulf ', 'uae', 'abu dhabi'] },
  { name: 'Tel Aviv',    region: 'Middle East', keywords: ['israel', 'tel aviv', 'gaza', 'hamas', 'netanyahu', 'idf'] },
  { name: 'Moscow',      region: 'Russia',      keywords: ['moscow', 'russia', 'putin', 'kremlin', 'ukraine', 'kyiv', 'ruble'] },
  { name: 'São Paulo',   region: 'Emerging',    keywords: ['brazil', 'são paulo', 'sao paulo', 'bovespa', 'lula', 'real '] },
];

const REGION_COLORS = {
  'US':          '#3b82f6', // blue
  'Europe':      '#8b5cf6', // violet
  'Asia':        '#06b6d4', // cyan
  'China':       '#f59e0b', // amber
  'Middle East': '#ef4444', // red
  'Russia':      '#f97316', // orange
  'Emerging':    '#10b981', // emerald
};

/**
 * Scan news articles and compute per-city metrics.
 * Returns array of { name, region, articleCount, sentiment, temperature, headlines[] }
 */
export function analyzeNewsByCity(newsArticles, regionRisk) {
  const results = WORLD_CITIES.map(city => {
    const matched = [];
    let sentimentSum = 0;

    for (const article of newsArticles) {
      const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
      const hit = city.keywords.some(kw => text.includes(kw));
      if (hit) {
        matched.push(article);
        sentimentSum += article.sentiment_score || 0;
      }
    }

    const avgSentiment = matched.length > 0 ? sentimentSum / matched.length : 0;

    // Temperature: combine article volume + sentiment intensity + region risk
    const regionData = regionRisk?.[city.region] || regionRisk?.[Object.keys(regionRisk || {}).find(r => r.includes(city.region.split(' ')[0]))] || {};
    const regionScore = regionData.score || 0;
    const volume = Math.min(matched.length, 30); // cap at 30
    const intensity = Math.abs(avgSentiment);

    // Temperature 0-100: weighted combo of volume, sentiment intensity, and region risk
    const temperature = Math.min(100, Math.round(
      (volume / 30) * 40 +      // 40% from article volume
      intensity * 30 +           // 30% from sentiment strength
      regionScore * 0.3          // 30% from geopolitical risk
    ));

    return {
      name: city.name,
      region: city.region,
      color: REGION_COLORS[city.region] || '#6b7280',
      articleCount: matched.length,
      sentiment: +avgSentiment.toFixed(3),
      sentimentLabel: avgSentiment > 0.15 ? 'Positive' : avgSentiment < -0.15 ? 'Negative' : 'Neutral',
      temperature,
      headlines: matched.slice(0, 3).map(a => a.headline || ''),
    };
  });

  return results;
}

/**
 * Render radial bar chart as SVG.
 * Bars radiate from center, length = temperature, color = sentiment.
 */
export function renderRadialChart(container, cityData) {
  const size = 500;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 60;
  const maxBarLen = 140;
  const barWidth = 18;
  const count = cityData.length;

  // Sentiment color: green (positive) → gray (neutral) → red (negative)
  function sentColor(sentiment, baseColor) {
    if (sentiment > 0.15) return '#4ade80';
    if (sentiment < -0.15) return '#f87171';
    return baseColor;
  }

  // Global sentiment donut data
  const pos = cityData.filter(c => c.sentiment > 0.15).length;
  const neg = cityData.filter(c => c.sentiment < -0.15).length;
  const neu = count - pos - neg;
  const totalArticles = cityData.reduce((s, c) => s + c.articleCount, 0);

  let svg = `<svg viewBox="0 0 ${size} ${size}" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">`;

  // Background subtle circles
  for (let r = innerR; r <= innerR + maxBarLen; r += 35) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(100,116,139,0.08)" stroke-width="1"/>`;
  }

  // Temperature scale labels
  for (let r = innerR + 35; r <= innerR + maxBarLen; r += 35) {
    const val = Math.round(((r - innerR) / maxBarLen) * 100);
    svg += `<text x="${cx + r + 2}" y="${cy - 2}" fill="rgba(100,116,139,0.3)" font-size="8" font-family="monospace">${val}</text>`;
  }

  // Bars
  for (let i = 0; i < count; i++) {
    const city = cityData[i];
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2; // start from top
    const barLen = (city.temperature / 100) * maxBarLen;
    const color = sentColor(city.sentiment, city.color);

    // Bar start/end points
    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * (innerR + barLen);
    const y2 = cy + Math.sin(angle) * (innerR + barLen);

    // Perpendicular offset for bar width
    const px = Math.cos(angle + Math.PI / 2) * (barWidth / 2);
    const py = Math.sin(angle + Math.PI / 2) * (barWidth / 2);

    // Bar as polygon (trapezoid — slightly wider at tip)
    const tipW = barWidth / 2 + 1;
    const tpx = Math.cos(angle + Math.PI / 2) * (tipW / 2);
    const tpy = Math.sin(angle + Math.PI / 2) * (tipW / 2);

    // Gradient ID
    const gradId = `grad-${i}`;
    svg += `<defs><linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.9"/>
    </linearGradient></defs>`;

    svg += `<polygon
      points="${x1-px},${y1-py} ${x1+px},${y1+py} ${x2+tpx},${y2+tpy} ${x2-tpx},${y2-tpy}"
      fill="url(#${gradId})"
      stroke="${color}" stroke-width="0.5" stroke-opacity="0.5"
      class="radial-bar" data-city="${city.name}"
    >
      <title>${city.name}: ${city.temperature}° | ${city.articleCount} articles | ${city.sentimentLabel}</title>
    </polygon>`;

    // Glow dot at tip
    svg += `<circle cx="${x2}" cy="${y2}" r="3" fill="${color}" opacity="0.8">
      <animate attributeName="opacity" values="0.8;0.4;0.8" dur="2s" repeatCount="indefinite"/>
    </circle>`;

    // City label
    const labelR = innerR + barLen + 14;
    const lx = cx + Math.cos(angle) * labelR;
    const ly = cy + Math.sin(angle) * labelR;
    const angleDeg = (angle * 180 / Math.PI);
    // Flip text for bottom half so it's always readable
    const flip = angleDeg > 0 && angleDeg < 180;
    const textRotate = flip ? angleDeg + 180 : angleDeg;
    const anchor = flip ? 'end' : 'start';

    svg += `<text x="${lx}" y="${ly}" fill="${color}" font-size="11" font-weight="600"
      font-family="system-ui, sans-serif" text-anchor="${anchor}"
      transform="rotate(${textRotate}, ${lx}, ${ly})"
      style="text-shadow: 0 0 6px rgba(0,0,0,0.9)">${city.name}</text>`;

    // Small article count
    const countR = innerR + barLen + 26;
    const clx = cx + Math.cos(angle) * countR;
    const cly = cy + Math.sin(angle) * countR;
    svg += `<text x="${clx}" y="${cly}" fill="rgba(148,163,184,0.6)" font-size="9"
      font-family="monospace" text-anchor="${anchor}"
      transform="rotate(${textRotate}, ${clx}, ${cly})">${city.articleCount} articles</text>`;
  }

  // Center donut
  const donutR = 40;
  const donutW = 8;
  const total = pos + neg + neu || 1;
  const slices = [
    { count: pos, color: '#4ade80', label: 'Positive' },
    { count: neu, color: '#64748b', label: 'Neutral' },
    { count: neg, color: '#f87171', label: 'Negative' },
  ];

  let startAngle = -Math.PI / 2;
  for (const slice of slices) {
    if (slice.count === 0) continue;
    const sweepAngle = (slice.count / total) * Math.PI * 2;
    const endAngle = startAngle + sweepAngle;
    const x1d = cx + Math.cos(startAngle) * donutR;
    const y1d = cy + Math.sin(startAngle) * donutR;
    const x2d = cx + Math.cos(endAngle) * donutR;
    const y2d = cy + Math.sin(endAngle) * donutR;
    const large = sweepAngle > Math.PI ? 1 : 0;

    svg += `<path d="M ${x1d} ${y1d} A ${donutR} ${donutR} 0 ${large} 1 ${x2d} ${y2d}"
      fill="none" stroke="${slice.color}" stroke-width="${donutW}" opacity="0.7">
      <title>${slice.label}: ${slice.count}/${count} regions</title>
    </path>`;
    startAngle = endAngle;
  }

  // Center text
  svg += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">${totalArticles}</text>`;
  svg += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">articles</text>`;

  svg += '</svg>';
  container.innerHTML = svg;
}
