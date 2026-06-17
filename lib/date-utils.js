export function getBusinessDate(date = new Date()) {
  try {
    const tz = process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE || 'America/Mexico_City';
    const cutoff = parseInt(process.env.NEXT_PUBLIC_BUSINESS_CUTOFF_HOUR || '5', 10);

    const localStr = date.toLocaleString('en-US', { timeZone: tz });
    const localDateObj = new Date(localStr);
    
    const hour = localDateObj.getHours();
    // If local time is between 12:00 AM and cutoff hour, adjust to the previous calendar day
    if (hour >= 0 && hour < cutoff) {
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
