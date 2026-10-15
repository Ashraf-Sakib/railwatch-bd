// Mapping of station names to their codes used in the Bangladesh Railway system
export const STATIONS = {
  'Dhaka': 'dhk',
  'Chittagong': 'cgr',
  'Khulna': 'klna',
  'Rajshahi': 'raj',
  'Sylhet': 'syl',
  'Barishal': 'bari',
  'Rangpur': 'rng',
  'Mymensingh': 'mym',
  'Comilla': 'comi',
  'Noakhali': 'noak',
  'Bogra': 'bog',
  'Jessore': 'jes',
  'Dinajpur': 'din',
  'Pabna': 'pab',
  'Narayanganj': 'nara',
  'Gazipur': 'gazi',
  'Tangail': 'tang',
  'Jamalpur': 'jama',
  'Netrokona': 'netr',
  'Kishoreganj': 'kish',
  'Manikganj': 'mani',
  'Munshiganj': 'muns',
  'Narsingdi': 'nars',
  'Brahmanbaria': 'brah',
  'Chandpur': 'chan',
  'Lakshmipur': 'laks',
  'Feni': 'feni',
  'Cox\'s Bazar': 'cox',
  'Bandarban': 'band',
  'Khagrachari': 'khag',
  'Rangamati': 'ranga'
};

// Get station code from name
export function getStationCode(name) {
  return STATIONS[name] || null;
}

// Get station name from code
export function getStationName(code) {
  const [name] = Object.entries(STATIONS).find(([_, c]) => c === code) || [];
  return name || null;
}

// Search stations by name
export function searchStations(query) {
  const lowerQuery = query.toLowerCase();
  return Object.keys(STATIONS).filter(name => 
    name.toLowerCase().includes(lowerQuery)
  );
}