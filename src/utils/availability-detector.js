import { BangladeshRailwayAdapter } from '../adapters/bangladesh-railway-adapter.js';

export class AvailabilityDetector {
  constructor() {
    this.adapter = new BangladeshRailwayAdapter();
    this.monitoringState = new Map(); // journeyKey -> state
    this.previousStates = new Map(); // journeyKey -> availability state
  }

  /**
   * Generate a unique key for a journey configuration
   */
  generateJourneyKey(config) {
    const { from, to, date, train, className } = config;
    return `${from}|${to}|${date}|${train || 'any'}|${className || 'any'}`;
  }

  /**
   * Check availability for a specific journey
   */
  async checkAvailability(config) {
    const { from, to, date, train, className } = config;
    
    try {
      const result = await this.adapter.isTicketAvailable(from, to, date, train, className);
      
      const journeyKey = this.generateJourneyKey(config);
      const previousState = this.previousStates.get(journeyKey);
      
      // Determine if state has changed
      const stateChanged = previousState !== undefined && previousState !== result.available;
      const isNewState = previousState === undefined;
      
      // Update previous state
      this.previousStates.set(journeyKey, result.available);
      
      return {
        ...result,
        stateChanged: stateChanged,
        isNewState: isNewState,
        previousState: previousState,
        currentState: result.available,
        journeyKey: journeyKey,
        config: config,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to check availability:', error);
      throw error;
    }
  }

  /**
   * Start monitoring a journey
   */
  startMonitoring(config, checkInterval = 60000) { // Default 60 seconds
    const journeyKey = this.generateJourneyKey(config);
    
    // Reset previous state for this journey
    this.previousStates.set(journeyKey, undefined);
    
    // Set monitoring state
    this.monitoringState.set(journeyKey, {
      config: config,
      interval: checkInterval,
      active: true,
      startTime: new Date().toISOString(),
      lastCheck: null,
      nextCheck: null,
      lastResult: null,
      history: []
    });
    
    return journeyKey;
  }

  /**
   * Stop monitoring a journey
   */
  stopMonitoring(journeyKey) {
    if (this.monitoringState.has(journeyKey)) {
      const state = this.monitoringState.get(journeyKey);
      state.active = false;
      this.monitoringState.set(journeyKey, state);
      return true;
    }
    return false;
  }

  /**
   * Get monitoring status for a journey
   */
  getMonitoringStatus(journeyKey) {
    return this.monitoringState.get(journeyKey) || null;
  }

  /**
   * Get all active monitoring tasks
   */
  getActiveMonitoringTasks() {
    const tasks = [];
    for (const [key, state] of this.monitoringState) {
      if (state.active) {
        tasks.push({
          key: key,
          config: state.config,
          lastCheck: state.lastCheck,
          nextCheck: state.nextCheck,
          lastResult: state.lastResult
        });
      }
    }
    return tasks;
  }

  /**
   * Update monitoring state with check result
   */
  updateMonitoringState(journeyKey, result) {
    if (this.monitoringState.has(journeyKey)) {
      const state = this.monitoringState.get(journeyKey);
      
      // Store previous result for history
      if (state.lastResult) {
        state.history.push(state.lastResult);
      }
      
      // Keep only last 100 results
      if (state.history.length > 100) {
        state.history = state.history.slice(-100);
      }
      
      state.lastCheck = result.timestamp;
      state.lastResult = result;
      state.nextCheck = new Date(Date.now() + state.interval).toISOString();
      
      this.monitoringState.set(journeyKey, state);
    }
  }

  /**
   * Clear previous states for a journey
   */
  clearPreviousState(journeyKey) {
    this.previousStates.delete(journeyKey);
  }

  /**
   * Reset all monitoring data
   */
  resetAll() {
    this.monitoringState.clear();
    this.previousStates.clear();
  }
}