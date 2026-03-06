const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const countries = require('./data/countries');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

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

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=precipitation_probability&timezone=auto`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
  const data = await response.json();

  const current = data.current_weather;
  const currentTime = current.time; // e.g. "2026-03-06T14:00"

  // Find closest hour index in hourly data
  const hourlyTimes = data.hourly.time;
  const hourlyPrecip = data.hourly.precipitation_probability;
  let precipIndex = hourlyTimes.findIndex(t => t === currentTime);
  if (precipIndex === -1) {
    // Fallback: find closest time
    precipIndex = hourlyTimes.reduce((best, t, i) => {
      return Math.abs(new Date(t) - new Date(currentTime)) <
             Math.abs(new Date(hourlyTimes[best]) - new Date(currentTime)) ? i : best;
    }, 0);
  }
  const precipProbability = hourlyPrecip[precipIndex] ?? 0;

  const weatherInfo = getWeatherInfo(current.weathercode);

  return {
    temperature: Math.round(current.temperature),
    condition: weatherInfo.label,
    emoji: weatherInfo.emoji,
    windSpeed: Math.round(current.windspeed),
    precipProbability
  };
}

// Home / index route
app.get('/', (req, res) => {
  res.render('index', { countries });
});

// Individual country weather routes
app.get('/weather/:slug', async (req, res) => {
  const { slug } = req.params;
  const country = countries.find(c => c.slug === slug);

  if (!country) {
    return res.status(404).render('404', { message: 'Country not found' });
  }

  try {
    const weather = await fetchWeather(country.lat, country.lon);
    res.render('weather', { country, weather });
  } catch (err) {
    console.error(`Weather fetch failed for ${country.country}:`, err.message);
    res.status(500).render('error', {
      country,
      message: 'Unable to load live weather data right now. Please try again in a moment.'
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
