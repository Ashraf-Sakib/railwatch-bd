import { getStationCode } from '../config/stations.js';

export class BangladeshRailwayAdapter {
  constructor() {
    this.baseUrl = 'https://eticket.railway.gov.bd';
    this.searchEndpoint = `${this.baseUrl}/`;
    this.bookingEndpoint = `${this.baseUrl}/booking`;
    this.sessionCookies = null;
  }

  /**
   * Get cookies from the current session
   */
  async getSessionCookies() {
    try {
      const cookies = await chrome.cookies.getAll({ domain: 'eticket.railway.gov.bd' });
      this.sessionCookies = cookies;
      return cookies;
    } catch (error) {
      console.error('Failed to get session cookies:', error);
      throw new Error('Unable to retrieve session cookies. Please ensure you are logged in.');
    }
  }

  /**
   * Build form data for the journey search
   */
  buildSearchFormData(fromStation, toStation, journeyDate, trainClass = null) {
    const formData = new FormData();
    formData.append('from_station', getStationCode(fromStation));
    formData.append('to_station', getStationCode(toStation));
    formData.append('journey_date', journeyDate);
    
    // Add optional train/class preference if available
    if (trainClass) {
      formData.append('class', trainClass);
    }
    
    return formData;
  }

  /**
   * Search for available journeys
   */
  async searchJourney(fromStation, toStation, journeyDate, trainClass = null) {
    try {
      await this.getSessionCookies();
      
      const formData = this.buildSearchFormData(fromStation, toStation, journeyDate, trainClass);
      
      const response = await fetch(this.searchEndpoint, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      return this.parseSearchResults(html, fromStation, toStation, journeyDate);
    } catch (error) {
      console.error('Failed to search journey:', error);
      throw error;
    }
  }

  /**
   * Parse the search results HTML to extract journey information
   */
  parseSearchResults(html, fromStation, toStation, journeyDate) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Look for train list containers
    const trainItems = doc.querySelectorAll('.train-item, .schedule-item, .train-list > div');
    const journeys = [];
    
    trainItems.forEach((item) => {
      const trainName = item.querySelector('.train-name, .train-title')?.textContent?.trim() || 
                       item.querySelector('h3, h4')?.textContent?.trim() || 'Unknown Train';
      
      // Find class availability
      const classes = [];
      const classElements = item.querySelectorAll('.class-availability, .seat-class');
      
      classElements.forEach((classEl) => {
        const className = classEl.querySelector('.class-name')?.textContent?.trim() || 'Unknown Class';
        const status = classEl.querySelector('.status, .availability')?.textContent?.trim() || 'Unknown';
        const seats = classEl.querySelector('.seats, .seat-count')?.textContent?.trim() || '0';
        
        const available = status.toLowerCase().includes('available') || 
                         (seats && parseInt(seats) > 0);
        
        classes.push({
          name: className,
          status: status,
          seats: parseInt(seats) || 0,
          available: available,
          availableSeats: parseInt(seats) || 0
        });
      });
      
      // If no class elements found, try to detect from table structure
      if (classes.length === 0) {
        const tableRows = item.querySelectorAll('table tbody tr');
        tableRows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const className = cells[0]?.textContent?.trim() || 'Unknown';
            const statusText = cells[1]?.textContent?.trim() || 'Unknown';
            const available = statusText.toLowerCase().includes('available');
            const seatCount = parseInt(statusText.match(/\d+/)?.[0] || '0');
            
            classes.push({
              name: className,
              status: statusText,
              seats: seatCount,
              available: available,
              availableSeats: seatCount
            });
          }
        });
      }
      
      // Determine overall availability
      const hasAvailableClass = classes.some(c => c.available);
      
      journeys.push({
        trainName: trainName,
        from: fromStation,
        to: toStation,
        date: journeyDate,
        classes: classes,
        hasAvailable: hasAvailableClass,
        availableClasses: classes.filter(c => c.available).map(c => c.name),
        allClasses: classes,
        details: {
          departureTime: item.querySelector('.departure-time')?.textContent?.trim() || 'N/A',
          arrivalTime: item.querySelector('.arrival-time')?.textContent?.trim() || 'N/A',
          duration: item.querySelector('.duration')?.textContent?.trim() || 'N/A'
        }
      });
    });
    
    return {
      journeys: journeys,
      totalTrains: journeys.length,
      hasAvailability: journeys.some(j => j.hasAvailable),
      fromStation,
      toStation,
      journeyDate
    };
  }

  /**
   * Get detailed availability for a specific journey
   */
  async getAvailability(fromStation, toStation, journeyDate, trainName = null, className = null) {
    const result = await this.searchJourney(fromStation, toStation, journeyDate);
    
    if (trainName) {
      // Filter by specific train
      const specificTrain = result.journeys.find(j => 
        j.trainName.toLowerCase().includes(trainName.toLowerCase())
      );
      
      if (specificTrain) {
        return {
          ...result,
          journeys: [specificTrain],
          totalTrains: 1,
          hasAvailability: specificTrain.hasAvailable,
          specificTrain: specificTrain
        };
      }
      return {
        ...result,
        journeys: [],
        totalTrains: 0,
        hasAvailability: false
      };
    }
    
    return result;
  }

  /**
   * Check if tickets are available for a journey
   */
  async isTicketAvailable(fromStation, toStation, journeyDate, trainName = null, className = null) {
    const availability = await this.getAvailability(fromStation, toStation, journeyDate, trainName, className);
    
    if (className) {
      // Check specific class availability
      const availableJourney = availability.journeys.find(j => 
        j.classes.some(c => c.name.toLowerCase().includes(className.toLowerCase()) && c.available)
      );
      return {
        available: !!availableJourney,
        journey: availableJourney || null,
        className: className
      };
    }
    
    return {
      available: availability.hasAvailability,
      journey: availability.journeys.find(j => j.hasAvailable) || null,
      allJourneys: availability.journeys
    };
  }

  /**
   * Get the booking URL for a specific journey
   */
  getBookingUrl(fromStation, toStation, journeyDate, trainName = null) {
    let url = `${this.bookingEndpoint}?from=${encodeURIComponent(fromStation)}&to=${encodeURIComponent(toStation)}&date=${journeyDate}`;
    
    if (trainName) {
      url += `&train=${encodeURIComponent(trainName)}`;
    }
    
    return url;
  }

  /**
   * Get journey details from URL or search parameters
   */
  async getJourneyDetails(bookingUrl) {
    // Extract parameters from URL
    const url = new URL(bookingUrl);
    const params = new URLSearchParams(url.search);
    
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const date = params.get('date') || '';
    const train = params.get('train') || null;
    
    if (from && to && date) {
      return await this.getAvailability(from, to, date, train);
    }
    
    throw new Error('Unable to extract journey details from URL');
  }
}