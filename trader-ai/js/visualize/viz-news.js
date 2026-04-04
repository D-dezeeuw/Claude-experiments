/**
 * TraderAI — World News Pulse (Radial Bar Chart)
 * Cities/regions arranged in a circle, bar length = news temperature.
 */

// Cities grouped by continent, ordered so continents cluster together in the radial chart
const WORLD_CITIES = [
  // North America
  { name: 'New York',     continent: 'North America', keywords: ['new york', 'wall street', 'nyse', 'nasdaq', 'manhattan', 'fed ', 'federal reserve'] },
  { name: 'Washington',   continent: 'North America', keywords: ['washington', 'white house', 'congress', 'pentagon', 'capitol', 'senate', 'treasury'] },
  { name: 'San Francisco',continent: 'North America', keywords: ['silicon valley', 'san francisco', 'tech sector', 'venture capital', 'startup'] },
  { name: 'Toronto',      continent: 'North America', keywords: ['toronto', 'canada', 'tsx', 'canadian', 'bank of canada'] },

  // Europe
  { name: 'London',       continent: 'Europe',        keywords: ['london', 'uk ', 'britain', 'ftse', 'bank of england', 'boe', 'british'] },
  { name: 'Amsterdam',    continent: 'Europe',        keywords: ['amsterdam', 'netherlands', 'dutch', 'euronext', 'holland'] },
  { name: 'Frankfurt',    continent: 'Europe',        keywords: ['frankfurt', 'ecb', 'eurozone', 'dax', 'bundesbank', 'german'] },
  { name: 'Paris',        continent: 'Europe',        keywords: ['paris', 'france', 'french', 'cac 40', 'macron'] },
  { name: 'Zurich',       continent: 'Europe',        keywords: ['zurich', 'swiss', 'switzerland', 'snb', 'davos'] },

  // Asia-Pacific
  { name: 'Tokyo',        continent: 'Asia-Pacific',  keywords: ['tokyo', 'japan', 'nikkei', 'boj', 'yen ', 'japanese'] },
  { name: 'Shanghai',     continent: 'Asia-Pacific',  keywords: ['shanghai', 'china', 'beijing', 'pboc', 'yuan', 'chinese'] },
  { name: 'Hong Kong',    continent: 'Asia-Pacific',  keywords: ['hong kong', 'hang seng', 'hkex'] },
  { name: 'Singapore',    continent: 'Asia-Pacific',  keywords: ['singapore', 'sgx', 'asean', 'southeast asia'] },
  { name: 'Sydney',       continent: 'Asia-Pacific',  keywords: ['sydney', 'australia', 'asx', 'australian', 'reserve bank'] },
  { name: 'Seoul',        continent: 'Asia-Pacific',  keywords: ['seoul', 'south korea', 'korean', 'kospi', 'samsung'] },

  // Middle East & Africa
  { name: 'Dubai',        continent: 'Middle East & Africa', keywords: ['dubai', 'saudi', 'opec', 'gulf ', 'uae', 'abu dhabi', 'riyadh'] },
  { name: 'Tel Aviv',     continent: 'Middle East & Africa', keywords: ['israel', 'tel aviv', 'gaza', 'hamas', 'netanyahu', 'idf'] },
  { name: 'Lagos',        continent: 'Middle East & Africa', keywords: ['nigeria', 'lagos', 'africa', 'african'] },

  // Eastern Europe & Russia
  { name: 'Moscow',       continent: 'Eastern Europe',keywords: ['moscow', 'russia', 'putin', 'kremlin', 'ruble', 'russian'] },
  { name: 'Kyiv',         continent: 'Eastern Europe',keywords: ['ukraine', 'kyiv', 'zelensky', 'ukrainian', 'donbas'] },

  // South America
  { name: 'São Paulo',    continent: 'South America', keywords: ['brazil', 'são paulo', 'sao paulo', 'bovespa', 'lula'] },
  { name: 'Mumbai',       continent: 'South Asia',    keywords: ['mumbai', 'india', 'sensex', 'nifty', 'modi', 'rupee', 'indian'] },
];

const CONTINENT_COLORS = {
  'North America':        '#3b82f6', // blue
  'Europe':               '#8b5cf6', // violet
  'Asia-Pacific':         '#06b6d4', // cyan
  'Middle East & Africa': '#ef4444', // red
  'Eastern Europe':       '#f97316', // orange
  'South America':        '#10b981', // emerald
  'South Asia':           '#f59e0b', // amber
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
    const regionData = regionRisk?.[city.continent] || regionRisk?.[Object.keys(regionRisk || {}).find(r => r.includes(city.continent.split(' ')[0]))] || {};
    const regionScore = regionData.score || 0;
    const volume = Math.min(matched.length, 30);
    const intensity = Math.abs(avgSentiment);

    // Temperature 0-100: weighted combo of volume, sentiment intensity, and region risk
    const temperature = Math.min(100, Math.round(
      (volume / 30) * 40 +
      intensity * 30 +
      regionScore * 0.3
    ));

    return {
      name: city.name,
      continent: city.continent,
      color: CONTINENT_COLORS[city.continent] || '#6b7280',
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
 * Bars radiate from center, grouped by continent with arc separators.
 */
export function renderRadialChart(container, cityData) {
  const size = 560;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 55;
  const maxBarLen = 120;
  const barWidth = 14;
  const count = cityData.length;

  function sentColor(sentiment, baseColor) {
    if (sentiment > 0.15) return '#4ade80';
    if (sentiment < -0.15) return '#f87171';
    return baseColor;
  }

  // Detect continent groups and their index ranges
  const continentGroups = [];
  let prevContinent = null;
  for (let i = 0; i < count; i++) {
    if (cityData[i].continent !== prevContinent) {
      continentGroups.push({ name: cityData[i].continent, color: cityData[i].color, startIdx: i, endIdx: i });
      prevContinent = cityData[i].continent;
    } else {
      continentGroups[continentGroups.length - 1].endIdx = i;
    }
  }

  const totalArticles = cityData.reduce((s, c) => s + c.articleCount, 0);
  const pos = cityData.filter(c => c.sentiment > 0.15).length;
  const neg = cityData.filter(c => c.sentiment < -0.15).length;
  const neu = count - pos - neg;

  let svg = `<svg viewBox="0 0 ${size} ${size}" class="w-full h-full" xmlns="http://www.w3.org/2000/svg">`;

  // Background rings
  for (let r = innerR; r <= innerR + maxBarLen; r += 30) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(100,116,139,0.07)" stroke-width="1"/>`;
  }

  // ── Continent arc labels (outer ring) ──
  const arcR = innerR + maxBarLen + 38;
  for (const group of continentGroups) {
    const startAngle = (group.startIdx / count) * Math.PI * 2 - Math.PI / 2 - (0.3 / count) * Math.PI * 2;
    const endAngle = ((group.endIdx + 1) / count) * Math.PI * 2 - Math.PI / 2 + (0.3 / count) * Math.PI * 2;

    // Subtle arc line for the continent group
    const ax1 = cx + Math.cos(startAngle) * (innerR - 8);
    const ay1 = cy + Math.sin(startAngle) * (innerR - 8);
    const ax2 = cx + Math.cos(endAngle) * (innerR - 8);
    const ay2 = cy + Math.sin(endAngle) * (innerR - 8);
    const arcSpan = endAngle - startAngle;
    const large = arcSpan > Math.PI ? 1 : 0;
    svg += `<path d="M ${ax1} ${ay1} A ${innerR - 8} ${innerR - 8} 0 ${large} 1 ${ax2} ${ay2}"
      fill="none" stroke="${group.color}" stroke-width="2" opacity="0.25"/>`;

    // Continent label along outer arc
    const midAngle = (startAngle + endAngle) / 2;
    const lx = cx + Math.cos(midAngle) * arcR;
    const ly = cy + Math.sin(midAngle) * arcR;
    const angleDeg = midAngle * 180 / Math.PI;
    const flip = angleDeg > 0 && angleDeg < 180;
    const textRotate = flip ? angleDeg + 180 : angleDeg;
    const anchor = flip ? 'end' : 'start';

    svg += `<text x="${lx}" y="${ly}" fill="${group.color}" font-size="8" font-weight="700"
      font-family="system-ui, sans-serif" text-anchor="${anchor}" letter-spacing="0.5"
      transform="rotate(${textRotate}, ${lx}, ${ly})" opacity="0.6"
      style="text-transform:uppercase">${group.name}</text>`;
  }

  // ── City bars ──
  for (let i = 0; i < count; i++) {
    const city = cityData[i];
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const barLen = Math.max(3, (city.temperature / 100) * maxBarLen); // min 3 so empty bars are visible
    const color = sentColor(city.sentiment, city.color);

    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * (innerR + barLen);
    const y2 = cy + Math.sin(angle) * (innerR + barLen);

    const px = Math.cos(angle + Math.PI / 2) * (barWidth / 2);
    const py = Math.sin(angle + Math.PI / 2) * (barWidth / 2);

    const gradId = `grad-${i}`;
    svg += `<defs><linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.85"/>
    </linearGradient></defs>`;

    svg += `<polygon
      points="${x1-px},${y1-py} ${x1+px},${y1+py} ${x2+px},${y2+py} ${x2-px},${y2-py}"
      fill="url(#${gradId})" stroke="${color}" stroke-width="0.5" stroke-opacity="0.4"
    >
      <title>${city.name}: ${city.temperature}° | ${city.articleCount} articles | ${city.sentimentLabel}</title>
    </polygon>`;

    // Glow dot at tip
    svg += `<circle cx="${x2}" cy="${y2}" r="2.5" fill="${color}" opacity="0.8">
      <animate attributeName="opacity" values="0.8;0.3;0.8" dur="${1.5 + Math.random()}s" repeatCount="indefinite"/>
    </circle>`;

    // City name label
    const labelR = innerR + barLen + 12;
    const lx = cx + Math.cos(angle) * labelR;
    const ly = cy + Math.sin(angle) * labelR;
    const angleDeg = angle * 180 / Math.PI;
    const flip = angleDeg > 0 && angleDeg < 180;
    const textRotate = flip ? angleDeg + 180 : angleDeg;
    const anchor = flip ? 'end' : 'start';

    svg += `<text x="${lx}" y="${ly}" fill="${color}" font-size="10" font-weight="600"
      font-family="system-ui, sans-serif" text-anchor="${anchor}"
      transform="rotate(${textRotate}, ${lx}, ${ly})"
      style="text-shadow: 0 0 6px rgba(0,0,0,0.9)">${city.name}</text>`;
  }

  // ── Center donut ──
  const donutR = 36;
  const donutW = 7;
  const total = pos + neg + neu || 1;
  const slices = [
    { count: pos, color: '#4ade80', label: 'Positive' },
    { count: neu, color: '#64748b', label: 'Neutral' },
    { count: neg, color: '#f87171', label: 'Negative' },
  ];

  let arcStart = -Math.PI / 2;
  for (const slice of slices) {
    if (slice.count === 0) continue;
    const sweep = (slice.count / total) * Math.PI * 2;
    const arcEnd = arcStart + sweep;
    const x1d = cx + Math.cos(arcStart) * donutR;
    const y1d = cy + Math.sin(arcStart) * donutR;
    const x2d = cx + Math.cos(arcEnd) * donutR;
    const y2d = cy + Math.sin(arcEnd) * donutR;
    const large = sweep > Math.PI ? 1 : 0;

    svg += `<path d="M ${x1d} ${y1d} A ${donutR} ${donutR} 0 ${large} 1 ${x2d} ${y2d}"
      fill="none" stroke="${slice.color}" stroke-width="${donutW}" opacity="0.7">
      <title>${slice.label}: ${slice.count}/${count} cities</title>
    </path>`;
    arcStart = arcEnd;
  }

  // Center text
  svg += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#e2e8f0" font-size="16" font-weight="700" font-family="system-ui">${totalArticles}</text>`;
  svg += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">articles</text>`;

  svg += '</svg>';
  container.innerHTML = svg;

  // ── Zoom & Pan ──
  setupZoomPan(container);
}

function setupZoomPan(container) {
  const svg = container.querySelector('svg');
  if (!svg) return;

  let scale = 1;
  let panX = 0, panY = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let panStartX = 0, panStartY = 0;

  function applyTransform() {
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    svg.style.transformOrigin = 'center center';
  }

  function zoom(delta) {
    scale = Math.max(0.5, Math.min(4, scale + delta));
    applyTransform();
  }

  function reset() {
    scale = 1; panX = 0; panY = 0;
    applyTransform();
  }

  // Scroll to zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 0.15 : -0.15);
  }, { passive: false });

  // Drag to pan
  container.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    container.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    container.style.cursor = 'grab';
  });

  // Touch support
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      panStartX = panX;
      panStartY = panY;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    panX = panStartX + (e.touches[0].clientX - dragStartX);
    panY = panStartY + (e.touches[0].clientY - dragStartY);
    applyTransform();
  }, { passive: true });

  container.addEventListener('touchend', () => { isDragging = false; });

  // Button controls
  const zoomIn = document.getElementById('radial-zoom-in');
  const zoomOut = document.getElementById('radial-zoom-out');
  const zoomReset = document.getElementById('radial-zoom-reset');
  if (zoomIn) zoomIn.addEventListener('click', () => zoom(0.3));
  if (zoomOut) zoomOut.addEventListener('click', () => zoom(-0.3));
  if (zoomReset) zoomReset.addEventListener('click', reset);
}
