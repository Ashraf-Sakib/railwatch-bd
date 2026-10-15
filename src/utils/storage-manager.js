export class StorageManager {
  constructor() {
    this.storage = chrome.storage.local;
    this.STORAGE_KEYS = {
      CONFIG: 'railwatch_config',
      MONITORING_STATE: 'railwatch_monitoring_state',
      AVAILABILITY_HISTORY: 'railwatch_availability_history',
      NOTIFICATIONS: 'railwatch_notifications',
      REMINDER: 'railwatch_reminder'
    };
  }

  /**
   * Save configuration
   */
  async saveConfig(config) {
    try {
      await this.storage.set({ [this.STORAGE_KEYS.CONFIG]: config });
      return true;
    } catch (error) {
      console.error('Failed to save config:', error);
      return false;
    }
  }

  /**
   * Load configuration
   */
  async loadConfig() {
    try {
      const result = await this.storage.get(this.STORAGE_KEYS.CONFIG);
      return result[this.STORAGE_KEYS.CONFIG] || null;
    } catch (error) {
      console.error('Failed to load config:', error);
      return null;
    }
  }

  /**
   * Save monitoring state
   */
  async saveMonitoringState(state) {
    try {
      await this.storage.set({ [this.STORAGE_KEYS.MONITORING_STATE]: state });
      return true;
    } catch (error) {
      console.error('Failed to save monitoring state:', error);
      return false;
    }
  }

  /**
   * Load monitoring state
   */
  async loadMonitoringState() {
    try {
      const result = await this.storage.get(this.STORAGE_KEYS.MONITORING_STATE);
      return result[this.STORAGE_KEYS.MONITORING_STATE] || null;
    } catch (error) {
      console.error('Failed to load monitoring state:', error);
      return null;
    }
  }

  /**
   * Save availability history
   */
  async saveAvailabilityHistory(history) {
    try {
      await this.storage.set({ [this.STORAGE_KEYS.AVAILABILITY_HISTORY]: history });
      return true;
    } catch (error) {
      console.error('Failed to save availability history:', error);
      return false;
    }
  }

  /**
   * Load availability history
   */
  async loadAvailabilityHistory() {
    try {
      const result = await this.storage.get(this.STORAGE_KEYS.AVAILABILITY_HISTORY);
      return result[this.STORAGE_KEYS.AVAILABILITY_HISTORY] || [];
    } catch (error) {
      console.error('Failed to load availability history:', error);
      return [];
    }
  }

  /**
   * Save notifications state
   */
  async saveNotifications(notifications) {
    try {
      await this.storage.set({ [this.STORAGE_KEYS.NOTIFICATIONS]: notifications });
      return true;
    } catch (error) {
      console.error('Failed to save notifications:', error);
      return false;
    }
  }

  /**
   * Load notifications state
   */
  async loadNotifications() {
    try {
      const result = await this.storage.get(this.STORAGE_KEYS.NOTIFICATIONS);
      return result[this.STORAGE_KEYS.NOTIFICATIONS] || [];
    } catch (error) {
      console.error('Failed to load notifications:', error);
      return [];
    }
  }

  /**
   * Save reminder configuration
   */
  async saveReminder(reminder) {
    try {
      await this.storage.set({ [this.STORAGE_KEYS.REMINDER]: reminder });
      return true;
    } catch (error) {
      console.error('Failed to save reminder:', error);
      return false;
    }
  }

  /**
   * Load reminder configuration
   */
  async loadReminder() {
    try {
      const result = await this.storage.get(this.STORAGE_KEYS.REMINDER);
      return result[this.STORAGE_KEYS.REMINDER] || null;
    } catch (error) {
      console.error('Failed to load reminder:', error);
      return null;
    }
  }

  /**
   * Clear all storage data
   */
  async clearAll() {
    try {
      await this.storage.clear();
      return true;
    } catch (error) {
      console.error('Failed to clear storage:', error);
      return false;
    }
  }

  /**
   * Get all storage data
   */
  async getAll() {
    try {
      return await this.storage.get(null);
    } catch (error) {
      console.error('Failed to get all storage data:', error);
      return {};
    }
  }
}