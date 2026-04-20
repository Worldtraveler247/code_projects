function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    document.getElementById('clock').textContent = `${hours}:${minutes}:${seconds}`;

    // Update greeting based on time
    const greetingElement = document.getElementById('greeting');
    if (hours < 12) greetingElement.textContent = "Good Morning!";
    else if (hours < 18) greetingElement.textContent = "Good Afternoon!";
    else greetingElement.textContent = "Good Evening!";
}

function changeColor() {
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16);
    document.body.style.backgroundColor = randomColor;
}

// Update the clock every second
setInterval(updateClock, 1000);
updateClock(); // Run immediately on load