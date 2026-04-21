function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    document.getElementById('clock').textContent = `${hours}:${minutes}:${seconds}`;

    const greetingElement = document.getElementById('greeting');
    if (hours < 12) greetingElement.textContent = "Good Morning!";
    else if (hours < 18) greetingElement.textContent = "Good Afternoon!";
    else greetingElement.textContent = "Good Evening!";
}

async function fetchWeather() {
    const weatherLoading = document.getElementById('weather-loading');
    const weatherInfo = document.getElementById('weather-info');
    const tempElement = document.getElementById('temp');
    const descElement = document.getElementById('weather-desc');

    if (!navigator.geolocation) {
        weatherLoading.textContent = "Geolocation not supported";
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
            // Using Open-Meteo API (Free, no key required)
            const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
            const data = await response.json();
            
            const weather = data.current_weather;
            tempElement.textContent = Math.round(weather.temperature);
            descElement.textContent = getWeatherDescription(weather.weathercode);
            
            weatherLoading.classList.add('hidden');
            weatherInfo.classList.remove('hidden');
        } catch (error) {
            weatherLoading.textContent = "Error loading weather";
            console.error(error);
        }
    }, (error) => {
        weatherLoading.textContent = "Location access denied";
        console.error(error);
    });
}

function getWeatherDescription(code) {
    const descriptions = {
        0: "Clear sky",
        1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Fog", 48: "Depositing rime fog",
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        95: "Thunderstorm"
    };
    return descriptions[code] || "Variable conditions";
}

function changeColor() {
    const colors = [
        'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        'linear-gradient(135deg, #2c3e50 0%, #000000 100%)',
        'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
        'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)'
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    document.body.style.background = randomColor;
}

// Initialization
setInterval(updateClock, 1000);
updateClock();
fetchWeather();
