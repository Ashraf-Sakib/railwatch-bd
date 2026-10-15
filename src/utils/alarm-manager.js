export class AlarmManager {
  constructor() {
    this.ALARM_PREFIX = 'railwatch-';
  }

  /**
   * Create a new alarm
   */
  async createAlarm(name, when, periodInMinutes = null) {
    try {
      const alarmName = `${this.ALARM_PREFIX}${name}`;
      
      const alarmInfo = {
        when: when
      };
      
      if (periodInMinutes) {
        alarmInfo.periodInMinutes = periodInMinutes;
      }
      
      await chrome.alarms.create(alarmName, alarmInfo);
      return alarmName;
    } catch (error) {
      console.error('Failed to create alarm:', error);
      return null;
    }
  }

  /**
   * Create a periodic alarm
   */
  async createPeriodicAlarm(name, periodInMinutes) {
    try {
      const alarmName = `${this.ALARM_PREFIX}${name}`;
      
      // If periodInMinutes is less than 1, use 1 minute
      const period = Math.max(1, periodInMinutes);
      
      await chrome.alarms.create(alarmName, {
        periodInMinutes: period
      });
      
      return alarmName;
    } catch (error) {
      console.error('Failed to create periodic alarm:', error);
      return null;
    }
  }

  /**
   * Clear an alarm
   */
  async clearAlarm(name) {
    try {
      const alarmName = `${this.ALARM_PREFIX}${name}`;
      await chrome.alarms.clear(alarmName);
      return true;
    } catch (error) {
      console.error('Failed to clear alarm:', error);
      return false;
    }
  }

  /**
   * Clear all alarms
   */
  async clearAllAlarms() {
    try {
      const alarms = await chrome.alarms.getAll();
      for (const alarm of alarms) {
        if (alarm.name.startsWith(this.ALARM_PREFIX)) {
          await chrome.alarms.clear(alarm.name);
        }
      }
      return true;
    } catch (error) {
      console.error('Failed to clear all alarms:', error);
      return false;
    }
  }

  /**
   * Get all alarms
   */
  async getAllAlarms() {
    try {
      const alarms = await chrome.alarms.getAll();
      return alarms.filter(alarm => alarm.name.startsWith(this.ALARM_PREFIX));
    } catch (error) {
      console.error('Failed to get alarms:', error);
      return [];
    }
  }

  /**
   * Get a specific alarm
   */
  async getAlarm(name) {
    try {
      const alarmName = `${this.ALARM_PREFIX}${name}`;
      const alarm = await chrome.alarms.get(alarmName);
      return alarm || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if an alarm exists
   */
  async alarmExists(name) {
    const alarm = await this.getAlarm(name);
    return alarm !== null;
  }

  /**
   * Schedule a one-time reminder
   */
  async scheduleReminder(name, dateTime, data = {}) {
    const when = new Date(dateTime).getTime();
    return this.createAlarm(`reminder-${name}`, when);
  }

  /**
   * Schedule monitoring alarm
   */
  async scheduleMonitoring(config, checkIntervalMinutes = 1) {
    const alarmName = `monitor-${config.from}-${config.to}-${config.date}`;
    return this.createPeriodicAlarm(alarmName, checkIntervalMinutes);
  }

  /**
   * Stop monitoring alarm
   */
  async stopMonitoring(config) {
    const alarmName = `monitor-${config.from}-${config.to}-${config.date}`;
    return this.clearAlarm(alarmName);
  }

  /**
   * Get monitoring alarm for a journey
   */
  async getMonitoringAlarm(config) {
    const alarmName = `monitor-${config.from}-${config.to}-${config.date}`;
    return this.getAlarm(alarmName);
  }
}