import 'dotenv/config';
import { ToolParamType, type ToolFunctionDeclaration, type WeatherData } from './types.ts';

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_BASE_URL = 'https://api.worldweatheronline.com/premium/v1';

export async function getWeather(city: string): Promise<WeatherData> {
    if (!WEATHER_API_KEY) {
        throw new Error('WEATHER_API_KEY is not defined in environment variables');
    }

    console.log(`Fetching weather for city: ${city}`);

    const url = `${WEATHER_BASE_URL}/weather.ashx?key=${WEATHER_API_KEY}&q=${encodeURIComponent(city)}&format=json&num_of_days=1&lang=fr`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Erreur API World Weather Online: ${response.status}`);
    }

    const data = (await response.json()) as {
        data?: {
            error?: unknown[];
            current_condition?: Array<{
                temp_C: string;
                FeelsLikeC: string;
                humidity: string;
                pressure: string;
                windspeedKmph: string;
                cloudcover: string;
                visibility: string;
                uvIndex: string;
                lang_fr?: Array<{ value: string }>;
                weatherDesc: Array<{ value: string }>;
            }>;
            request?: Array<{ query: string; type: string }>;
            weather?: Array<{ mintempC: string; maxtempC: string }>;
        };
    };

    if (data.data?.error) {
        throw new Error(`Ville "${city}" non trouvée ou erreur API`);
    }

    const current = data.data!.current_condition![0];
    const location = data.data!.request![0];

    return {
        city: location.query,
        country: location.type === 'City' ? '' : location.type,
        temperature: parseInt(current.temp_C),
        feelsLike: parseInt(current.FeelsLikeC),
        tempMin: parseInt(data.data!.weather![0].mintempC),
        tempMax: parseInt(data.data!.weather![0].maxtempC),
        humidity: parseInt(current.humidity),
        pressure: parseInt(current.pressure),
        description: current.lang_fr?.[0]?.value ?? current.weatherDesc[0].value,
        windSpeed: parseInt(current.windspeedKmph),
        clouds: parseInt(current.cloudcover),
        visibility: parseInt(current.visibility),
        uvIndex: parseInt(current.uvIndex),
    };
}

export function formatWeatherData(weather: WeatherData): string {
    const cityDisplay = weather.country ? `${weather.city}, ${weather.country}` : weather.city;
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

export const weatherToolOllama = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Récupère la météo actuelle et la température pour une ville donnée',
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

export const weatherToolGemini: ToolFunctionDeclaration = {
    name: 'get_weather',
    description:
        "Récupère la météo actuelle et la température pour une ville donnée. Utilise cette fonction quand l'utilisateur demande la météo, la température, ou les conditions climatiques d'une ville.",
    parameters: {
        type: ToolParamType.OBJECT,
        properties: {
            city: {
                type: ToolParamType.STRING,
                description:
                    'Le nom de la ville (ex: "Paris", "Lyon", "Marseille"). Peut inclure le code pays (ex: "Paris,FR")',
            },
        },
        required: ['city'],
    },
};
