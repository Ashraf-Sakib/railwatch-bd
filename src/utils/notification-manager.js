export class NotificationManager {
  constructor() {
    this.notificationIdPrefix = 'railwatch-';
    this.notifiedStates = new Map(); // journeyKey -> last notified availability
    this.PLUGIN_ICON = chrome.runtime.getURL('icons/icon128.png');
  }

  /**
   * Send a chrome notification
   */
  async sendNotification(title, message, url, journeyKey = null) {
    try {
      const notificationId = `${this.notificationIdPrefix}${Date.now()}`;
      
      // Check if we should send this notification
      if (journeyKey) {
        const lastNotified = this.notifiedStates.get(journeyKey);
        // Don't send duplicate notifications for same state
        if (lastNotified === true && message.includes('available')) {
          console.log('Skipping duplicate availability notification');
          return null;
        }
        if (lastNotified === false && message.includes('unavailable')) {
          console.log('Skipping duplicate unavailability notification');
          return null;
        }
      }
      
      const notificationOptions = {
        type: 'basic',
        iconUrl: this.PLUGIN_ICON,
        title: title,
        message: message,
        priority: 2,
        requireInteraction: true,
        silent: false
      };
      
      // Create notification
      const notification = await chrome.notifications.create(notificationId, notificationOptions);
      
      // Store click handler
      if (url) {
        chrome.notifications.onClicked.addListener((clickedId) => {
          if (clickedId === notificationId) {
            chrome.tabs.create({ url: url });
          }
        });
      }
      
      // Update notified state
      if (journeyKey) {
        const isAvailable = message.includes('available') && !message.includes('unavailable');
        this.notifiedStates.set(journeyKey, isAvailable);
      }
      
      return notificationId;
    } catch (error) {
      console.error('Failed to send notification:', error);
      return null;
    }
  }

  /**
   * Send availability notification
   */
  async notifyAvailability(journeyConfig, journeyDetails, bookingUrl) {
    const { from, to, date, train, className } = journeyConfig;
    const journeyKey = this.generateJourneyKey(journeyConfig);
    
    let title = '🎫 Tickets Available!';
    let message = `${from} → ${to} on ${date}`;
    
    if (train) {
      message += ` - ${train}`;
    }
    if (className) {
      message += ` (${className})`;
    }
    if (journeyDetails.availableClasses && journeyDetails.availableClasses.length > 0) {
      message += `\nAvailable: ${journeyDetails.availableClasses.join(', ')}`;
    }
    message += '\nClick to book now!';
    
    return this.sendNotification(title, message, bookingUrl, journeyKey);
  }

  /**
   * Send unavailability notification (when tickets become unavailable)
   */
  async notifyUnavailability(journeyConfig) {
    const { from, to, date, train, className } = journeyConfig;
    const journeyKey = this.generateJourneyKey(journeyConfig);
    
    const title = '⏳ Tickets Unavailable';
    let message = `${from} → ${to} on ${date}`;
    
    if (train) {
      message += ` - ${train}`;
    }
    if (className) {
      message += ` (${className})`;
    }
    message += '\nNo tickets available at this time.';
    
    return this.sendNotification(title, message, null, journeyKey);
  }

  /**
   * Send reminder notification
   */
  async sendReminder(journeyConfig) {
    const { from, to, date, train } = journeyConfig;
    
    const title = '🚆 RailWatch BD Reminder';
    let message = `Your journey from ${from} to ${to} on ${date} is coming up!`;
    
    if (train) {
      message += `\nTrain: ${train}`;
    }
    message += '\nDon\'t forget to check your booking.';
    
    const bookingUrl = `https://eticket.railway.gov.bd/booking?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}`;
    
    return this.sendNotification(title, message, bookingUrl);
  }

  /**
   * Generate journey key for tracking notifications
   */
  generateJourneyKey(config) {
    const { from, to, date, train, className } = config;
    return `${from}|${to}|${date}|${train || 'any'}|${className || 'any'}`;
  }

  /**
   * Clear notification history for a journey
   */
  clearNotificationHistory(journeyKey) {
    this.notifiedStates.delete(journeyKey);
  }

  /**
   * Clear all notification history
   */
  clearAllHistory() {
    this.notifiedStates.clear();
  }
}