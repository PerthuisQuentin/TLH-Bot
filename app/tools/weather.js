import 'dotenv/config';
import { Type } from '@google/genai';

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_BASE_URL = 'https://api.worldweatheronline.com/premium/v1';

/**
 * Fetches current weather for a given city
 * @param {string} city - City name (e.g., "Paris", "London", "New York")
 * @returns {Promise<Object>} Weather data
 */
export async function getWeather(city) {
  if (!WEATHER_API_KEY) {
    throw new Error('WEATHER_API_KEY is not defined in environment variables');
  }

  console.log(`Fetching weather for city: ${city}`);

  try {
    const url = `${WEATHER_BASE_URL}/weather.ashx?key=${WEATHER_API_KEY}&q=${encodeURIComponent(city)}&format=json&num_of_days=1&lang=fr`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Erreur API World Weather Online: ${response.status}`);
    }

    const data = await response.json();

    // Check for API errors
    if (data.data?.error) {
      throw new Error(`Ville "${city}" non trouvée ou erreur API`);
    }

    const current = data.data.current_condition[0];
    const location = data.data.request[0];

    return {
      city: location.query,
      country: location.type === 'City' ? '' : location.type,
      temperature: parseInt(current.temp_C),
      feelsLike: parseInt(current.FeelsLikeC),
      tempMin: parseInt(data.data.weather[0].mintempC),
      tempMax: parseInt(data.data.weather[0].maxtempC),
      humidity: parseInt(current.humidity),
      pressure: parseInt(current.pressure),
      description: current.lang_fr?.[0]?.value || current.weatherDesc[0].value,
      windSpeed: parseInt(current.windspeedKmph),
      clouds: parseInt(current.cloudcover),
      visibility: parseInt(current.visibility),
      uvIndex: parseInt(current.uvIndex),
    };
  } catch (error) {
    console.error('Error fetching weather:', error);
    throw error;
  }
}

/**
 * Formats weather data into a human-readable string
 * @param {Object} weather - Weather data from getWeather
 * @returns {string} Formatted weather string
 */
export function formatWeatherData(weather) {
  const cityDisplay = weather.country
    ? `${weather.city}, ${weather.country}`
    : weather.city;
  return `Météo à ${cityDisplay}:
🌡️ Température: ${weather.temperature}°C (ressenti ${weather.feelsLike}°C)
📊 Min/Max: ${weather.tempMin}°C / ${weather.tempMax}°C
☁️ Conditions: ${weather.description}
💧 Humidité: ${weather.humidity}%
🌬️ Vent: ${weather.windSpeed} km/h
☁️ Couverture nuageuse: ${weather.clouds}%
👁️ Visibilité: ${weather.visibility} km
☀️ Index UV: ${weather.uvIndex}`;
}

/**
 * Tool definition for World Weather Online integration with Ollama
 */
export const weatherToolOllama = {
  type: 'function',
  function: {
    name: 'get_weather',
    description:
      'Récupère la météo actuelle et la température pour une ville donnée',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description:
            'Le nom de la ville (ex: "Paris", "Lyon", "Marseille"). Peut inclure le code pays (ex: "Paris,FR")',
        },
      },
      required: ['city'],
    },
  },
};

/**
 * Tool definition for World Weather Online integration with Gemini
 */
export const weatherToolGemini = {
  name: 'get_weather',
  description:
    "Récupère la météo actuelle et la température pour une ville donnée. Utilise cette fonction quand l'utilisateur demande la météo, la température, ou les conditions climatiques d'une ville.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      city: {
        type: Type.STRING,
        description:
          'Le nom de la ville (ex: "Paris", "Lyon", "Marseille"). Peut inclure le code pays (ex: "Paris,FR")',
      },
    },
    required: ['city'],
  },
};
