export function getBusinessDate(date = new Date()) {
  try {
    const localStr = date.toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    const localDateObj = new Date(localStr);
    
    const hour = localDateObj.getHours();
    // If local time is between 12:00 AM and 5:00 AM, adjust to the previous calendar day
    if (hour >= 0 && hour < 5) {
      localDateObj.setDate(localDateObj.getDate() - 1);
    }
    
    const year = localDateObj.getFullYear();
    const month = String(localDateObj.getMonth() + 1).padStart(2, '0');
    const day = String(localDateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (err) {
    console.error("Error calculating business date, falling back to UTC:", err);
    return date.toISOString().slice(0, 10);
  }
}
