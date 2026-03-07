require('dotenv').config({ path: require('path').join(__dirname, '.env') });
// v1.1.0 — HX logo, nav links, strapline
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const countries = require('./data/countries');
const blogPosts = require('./data/blog');

// Locale support
const locales = {
  en: require('./locales/en'),
  de: require('./locales/de'),
  fr: require('./locales/fr'),
  es: require('./locales/es'),
  it: require('./locales/it'),
};
const SUPPORTED_LANGS = ['de', 'fr', 'es', 'it'];
const BASE_URL = process.env.BASE_URL || 'https://web-production-17f8.up.railway.app';

function buildAlternates(englishSlug) {
  const alts = [{ lang: 'en', href: `/weather/${englishSlug}` }];
  SUPPORTED_LANGS.forEach(lang => {
    const c = locales[lang].countries[englishSlug];
    if (c) alts.push({ lang, href: `/weather/${lang}/${c.slug}` });
  });
  return alts;
}

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'hx-weather-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth strategy (only initialise if credentials are present)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      name: profile.displayName,
      photo: profile.photos?.[0]?.value || null
    };
    return done(null, user);
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// WMO Weather Code descriptions and emoji
const weatherCodes = {
  0:  { label: 'Clear Sky',            emoji: '☀️' },
  1:  { label: 'Mainly Clear',         emoji: '🌤️' },
  2:  { label: 'Partly Cloudy',        emoji: '⛅' },
  3:  { label: 'Overcast',             emoji: '☁️' },
  45: { label: 'Foggy',               emoji: '🌫️' },
  48: { label: 'Icy Fog',             emoji: '🌫️' },
  51: { label: 'Light Drizzle',        emoji: '🌦️' },
  53: { label: 'Moderate Drizzle',     emoji: '🌦️' },
  55: { label: 'Heavy Drizzle',        emoji: '🌦️' },
  61: { label: 'Slight Rain',          emoji: '🌧️' },
  63: { label: 'Moderate Rain',        emoji: '🌧️' },
  65: { label: 'Heavy Rain',           emoji: '🌧️' },
  71: { label: 'Slight Snow',          emoji: '🌨️' },
  73: { label: 'Moderate Snow',        emoji: '🌨️' },
  75: { label: 'Heavy Snow',           emoji: '❄️' },
  77: { label: 'Snow Grains',          emoji: '❄️' },
  80: { label: 'Slight Showers',       emoji: '🌦️' },
  81: { label: 'Moderate Showers',     emoji: '🌦️' },
  82: { label: 'Heavy Showers',        emoji: '🌧️' },
  85: { label: 'Slight Snow Showers',  emoji: '🌨️' },
  86: { label: 'Heavy Snow Showers',   emoji: '🌨️' },
  95: { label: 'Thunderstorm',         emoji: '⛈️' },
  96: { label: 'Thunderstorm',         emoji: '⛈️' },
  99: { label: 'Heavy Thunderstorm',   emoji: '⛈️' }
};

function getWeatherInfo(code) {
  return weatherCodes[code] || { label: 'Unknown', emoji: '🌡️' };
}

async function fetchCountryImage(capital, countryName) {
  const tryFetch = async (term) => {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'hx-weather/1.0 (holidayextras.com)' } });
      if (!res.ok) return null;
      const data = await res.json();
      return data.originalimage?.source || data.thumbnail?.source || null;
    } catch {
      return null;
    }
  };
  return (await tryFetch(capital)) || (await tryFetch(countryName)) || null;
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,weathercode,apparent_temperature,surface_pressure,visibility,precipitation_probability&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,sunrise,sunset,daylight_duration&timezone=auto&forecast_days=7`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
  const data = await response.json();

  const current = data.current_weather;
  const currentTime = current.time;

  const hourlyTimes = data.hourly.time;
  const hourlyPrecip = data.hourly.precipitation_probability;
  let precipIndex = hourlyTimes.findIndex(t => t === currentTime);
  if (precipIndex === -1) {
    precipIndex = hourlyTimes.reduce((best, t, i) => {
      return Math.abs(new Date(t) - new Date(currentTime)) <
             Math.abs(new Date(hourlyTimes[best]) - new Date(currentTime)) ? i : best;
    }, 0);
  }
  const precipProbability = hourlyPrecip[precipIndex] ?? 0;
  const weatherInfo = getWeatherInfo(current.weathercode);

  // Extra stats at current hour
  const feelsLike = Math.round(data.hourly.apparent_temperature?.[precipIndex] ?? current.temperature);
  const pressure = Math.round(data.hourly.surface_pressure?.[precipIndex] ?? 1013);
  const visibility = Math.round((data.hourly.visibility?.[precipIndex] ?? 10000) / 1000);

  // Next 8 hourly slots
  const nextHours = [];
  for (let i = 0; i < 8; i++) {
    const idx = precipIndex + i;
    if (idx >= hourlyTimes.length) break;
    nextHours.push({
      time: hourlyTimes[idx].split('T')[1].substring(0, 5),
      temp: Math.round(data.hourly.temperature_2m[idx]),
      ...getWeatherInfo(data.hourly.weathercode[idx]),
    });
  }

  // Sunrise / sunset / daylight
  const sunrise = (data.daily.sunrise?.[0] || '').split('T')[1]?.substring(0, 5) || '—';
  const sunset  = (data.daily.sunset?.[0]  || '').split('T')[1]?.substring(0, 5) || '—';
  const daylightSec = data.daily.daylight_duration?.[0] || 0;
  const daylightH = Math.floor(daylightSec / 3600);
  const daylightM = Math.floor((daylightSec % 3600) / 60);

  // Date label
  const [yr, mo, dy] = currentTime.split('T')[0].split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const sfx = [11,12,13].includes(dy) ? 'th' : dy%10===1?'st':dy%10===2?'nd':dy%10===3?'rd':'th';
  const dateLabel = `${dy}${sfx} ${months[mo-1]} ${yr}`;

  // 7-day daily forecast
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const forecast7day = (data.daily?.time || []).map((dateStr, i) => {
    const d = new Date(dateStr + 'T12:00:00Z');
    const wInfo = getWeatherInfo(data.daily.weathercode[i]);
    const daylightSec = data.daily.daylight_duration?.[i] || 0;
    return {
      date: dateStr,
      dayLabel: i === 0 ? 'Today' : dayNames[d.getUTCDay()],
      dateLabel: `${d.getUTCDate()} ${shortMonths[d.getUTCMonth()]}`,
      emoji: wInfo.emoji,
      condition: wInfo.label,
      tempMax: Math.round(data.daily.temperature_2m_max[i]),
      tempMin: Math.round(data.daily.temperature_2m_min[i]),
      precipProbability: data.daily.precipitation_probability_max?.[i] ?? 0,
      windSpeed: Math.round(data.daily.windspeed_10m_max?.[i] ?? 0),
      sunrise: (data.daily.sunrise?.[i] || '').split('T')[1]?.substring(0, 5) || '—',
      sunset: (data.daily.sunset?.[i] || '').split('T')[1]?.substring(0, 5) || '—',
      daylightH: Math.floor(daylightSec / 3600),
      daylightM: Math.floor((daylightSec % 3600) / 60),
    };
  });

  return {
    temperature: Math.round(current.temperature),
    condition: weatherInfo.label,
    emoji: weatherInfo.emoji,
    windSpeed: Math.round(current.windspeed),
    precipProbability,
    wmoCode: current.weathercode,
    feelsLike,
    pressure,
    visibility,
    sunrise,
    sunset,
    daylightH,
    daylightM,
    nextHours,
    dateLabel,
    forecast7day,
  };
}

// ===========================
// Auth routes
// ===========================

// Debug endpoint — remove after confirming auth works
app.get('/auth/status', (req, res) => {
  res.json({
    clientIdSet: !!process.env.GOOGLE_CLIENT_ID,
    clientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.CALLBACK_URL || '(not set)',
    strategyRegistered: !!passport._strategy('google'),
    nodeEnv: process.env.NODE_ENV || '(not set)',
    port: process.env.PORT || '(not set)',
    allEnvKeys: Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY')).join(', ')
  });
});

app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) {
    return res.status(503).send('Google auth is not configured. Check environment variables.');
  }
  passport.authenticate('google', { scope: ['profile'] })(req, res, next);
});

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// ===========================
// App routes
// ===========================
const HOME_ALTERNATES = [
  { lang: 'en', href: '/' },
  { lang: 'de', href: '/de' },
  { lang: 'fr', href: '/fr' },
  { lang: 'es', href: '/es' },
  { lang: 'it', href: '/it' },
];

function buildDisplayCountries(lang) {
  return countries.map(c => {
    const lc = lang === 'en' ? null : locales[lang].countries[c.slug];
    return { ...c, displayName: lc ? lc.country : c.country, localSlug: lc ? lc.slug : c.slug };
  });
}

app.get('/', async (req, res) => {
  const [weatherResults, blogImages] = await Promise.all([
    Promise.all(countries.map(c => fetchWeather(c.lat, c.lon).catch(() => null))),
    Promise.all(blogPosts.map(p => fetchCountryImage(p.wikiQuery, p.wikiQuery).catch(() => null))),
  ]);
  const weatherMap = {};
  countries.forEach((c, i) => { weatherMap[c.slug] = weatherResults[i]; });
  const enrichedPosts = blogPosts.map((p, i) => ({ ...p, image: blogImages[i] }));
  const updatedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  res.render('index', {
    displayCountries: buildDisplayCountries('en'), weatherLinkPrefix: '/weather/',
    weatherMap, updatedAt, blogPosts: enrichedPosts, user: req.user || null,
    lang: 'en', t: locales.en.ui, alternates: HOME_ALTERNATES,
  });
});

// Localized homepages
SUPPORTED_LANGS.forEach(lang => {
  app.get(`/${lang}`, async (req, res) => {
    const [weatherResults, blogImages] = await Promise.all([
      Promise.all(countries.map(c => fetchWeather(c.lat, c.lon).catch(() => null))),
      Promise.all((locales[lang].blogPosts || blogPosts).map(p => fetchCountryImage(p.wikiQuery || p.slug, p.wikiQuery || p.slug).catch(() => null))),
    ]);
    const weatherMap = {};
    countries.forEach((c, i) => { weatherMap[c.slug] = weatherResults[i]; });
    const rawPosts = locales[lang].blogPosts || blogPosts;
    const enrichedPosts = rawPosts.map((p, i) => ({ ...p, image: blogImages[i] }));
    const updatedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    res.render('index', {
      displayCountries: buildDisplayCountries(lang), weatherLinkPrefix: `/weather/${lang}/`,
      weatherMap, updatedAt, blogPosts: enrichedPosts, user: req.user || null,
      lang, t: locales[lang].ui, alternates: HOME_ALTERNATES,
    });
  });
});

// Search endpoint (JSON)
app.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = countries
    .filter(c =>
      c.country.toLowerCase().includes(q) ||
      c.capital.toLowerCase().includes(q)
    )
    .map(c => ({ name: c.country, capital: c.capital, flag: c.flag, slug: c.slug }));
  res.json(results);
});

app.get('/blog', async (req, res) => {
  const images = await Promise.all(
    blogPosts.map(p => fetchCountryImage(p.wikiQuery, p.wikiQuery).catch(() => null))
  );
  const enriched = blogPosts.map((p, i) => ({ ...p, image: images[i] }));
  res.render('blog-index', { blogPosts: enriched, user: req.user || null });
});

app.get('/blog/:slug', async (req, res) => {
  const post = blogPosts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('<h1>404 – Post not found</h1><p><a href="/">Back to home</a></p>');
  const image = await fetchCountryImage(post.wikiQuery, post.wikiQuery).catch(() => null);
  res.render('blog-post', { post: { ...post, image }, user: req.user || null });
});

app.get('/weather/:slug', async (req, res) => {
  const { slug } = req.params;
  const country = countries.find(c => c.slug === slug);

  if (!country) {
    return res.status(404).send('<h1>404 – Page not found</h1><p><a href="/">Back to home</a></p>');
  }

  try {
    const [weather, heroImage] = await Promise.all([
      fetchWeather(country.lat, country.lon),
      fetchCountryImage(country.capital, country.country)
    ]);
    res.render('weather', {
      country, weather, heroImage,
      lang: 'en',
      t: locales.en.ui,
      alternates: buildAlternates(slug),
      user: req.user || null,
    });
  } catch (err) {
    console.error(`Weather fetch failed for ${country.country}:`, err.message);
    res.status(500).render('error', {
      country,
      user: req.user || null,
      message: 'Unable to load live weather data right now. Please try again in a moment.'
    });
  }
});

// Multilingual weather pages: /weather/:lang/:localSlug
app.get('/weather/:lang/:localSlug', async (req, res) => {
  const { lang, localSlug } = req.params;

  if (!SUPPORTED_LANGS.includes(lang)) {
    return res.status(404).send('<h1>404 – Page not found</h1><p><a href="/">Back to home</a></p>');
  }

  const locale = locales[lang];
  const englishSlug = Object.keys(locale.countries).find(
    k => locale.countries[k].slug === localSlug
  );

  if (!englishSlug) {
    return res.status(404).send('<h1>404 – Page not found</h1><p><a href="/">Back to home</a></p>');
  }

  const baseCountry = countries.find(c => c.slug === englishSlug);
  const localCountry = locale.countries[englishSlug];

  try {
    const [weather, heroImage] = await Promise.all([
      fetchWeather(baseCountry.lat, baseCountry.lon),
      fetchCountryImage(localCountry.capital, localCountry.country),
    ]);

    const translatedCondition = locale.wmo[weather.wmoCode] || weather.condition;
    const localWeather = { ...weather, condition: translatedCondition };

    res.render('weather', {
      country: { ...baseCountry, ...localCountry },
      weather: localWeather,
      heroImage,
      lang,
      t: locale.ui,
      alternates: buildAlternates(englishSlug),
      user: req.user || null,
    });
  } catch (err) {
    console.error(`Weather fetch failed for ${localCountry.country}:`, err.message);
    res.status(500).render('error', {
      country: { ...baseCountry, ...localCountry },
      user: req.user || null,
      message: 'Unable to load live weather data right now. Please try again in a moment.',
    });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).send('<h1>404 – Page not found</h1><p><a href="/">Back to home</a></p>');
});

app.listen(PORT, () => {
  console.log(`HX Weather running at http://localhost:${PORT}`);
});
