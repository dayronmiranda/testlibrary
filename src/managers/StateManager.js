const fs = require('fs').promises;
const path = require('path');

/**
 * StateManager - Centralized state management for calls, polls, locations, etc.
 * Single source of truth for application state
 */
class StateManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        
        // State containers
        this.callStates = new Map();
        this.pollStates = new Map();
        this.liveLocationTrackers = new Map();
        this.browserTabs = new Map();
        this.activeTimeouts = new Set();
        
        // State persistence
        this.stateFile = path.join(config.errorHandling?.logPath || './logs', 'application_state.json');
        this.isInitialized = false;
    }

    async initialize() {
        try {
            await this.loadPersistedState();
            this.isInitialized = true;
            await this.logger.info('StateManager initialized successfully');
        } catch (error) {
            await this.logger.error('Failed to initialize StateManager:', error);
            throw error;
        }
    }

    async loadPersistedState() {
        try {
            const stateData = await fs.readFile(this.stateFile, 'utf8');
            const state = JSON.parse(stateData);
            
            // Restore state (excluding non-serializable data like intervals)
            if (state.callStates) {
                for (const [key, value] of Object.entries(state.callStates)) {
                    this.callStates.set(key, value);
                }
            }
            
            if (state.pollStates) {
                for (const [key, value] of Object.entries(state.pollStates)) {
                    // Restore votes as Map
                    if (value.votes && Array.isArray(value.votes)) {
                        value.votes = new Map(value.votes);
                    }
                    this.pollStates.set(key, value);
                }
            }
            
            if (state.browserTabs) {
                for (const [key, value] of Object.entries(state.browserTabs)) {
                    this.browserTabs.set(key, value);
                }
            }
            
            await this.logger.info('Application state restored from persistence');
        } catch (error) {
            await this.logger.info('No persisted state found, starting with clean state');
        }
    }

    async persistState() {
        try {
            const state = {
                callStates: Object.fromEntries(this.callStates),
                pollStates: Object.fromEntries(
                    Array.from(this.pollStates.entries()).map(([key, value]) => [
                        key,
                        {
                            ...value,
                            votes: value.votes ? Array.from(value.votes.entries()) : []
                        }
                    ])
                ),
                browserTabs: Object.fromEntries(this.browserTabs),
                timestamp: new Date().toISOString()
            };
            
            await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
            await this.logger.debug('Application state persisted');
        } catch (error) {
            await this.logger.error('Failed to persist application state:', error);
        }
    }

    // Call State Management
    addCall(callId, callData) {
        this.callStates.set(callId, {
            ...callData,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        });
        this.persistState(); // Async, but don't wait
    }

    updateCall(callId, updates) {
        const existingCall = this.callStates.get(callId);
        if (existingCall) {
            this.callStates.set(callId, {
                ...existingCall,
                ...updates,
                lastUpdated: new Date().toISOString()
            });
            this.persistState();
        }
    }

    removeCall(callId) {
        const removed = this.callStates.delete(callId);
        if (removed) {
            this.persistState();
        }
        return removed;
    }

    getCall(callId) {
        return this.callStates.get(callId);
    }

    getAllCalls() {
        return Array.from(this.callStates.values());
    }

    getActiveCalls() {
        return Array.from(this.callStates.values()).filter(call => 
            ['incoming', 'outgoing', 'active'].includes(call.status)
        );
    }

    // Poll State Management
    addPoll(pollId, pollData) {
        this.pollStates.set(pollId, {
            ...pollData,
            votes: new Map(),
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            totalVotes: 0
        });
        this.persistState();
    }

    updatePoll(pollId, updates) {
        const existingPoll = this.pollStates.get(pollId);
        if (existingPoll) {
            this.pollStates.set(pollId, {
                ...existingPoll,
                ...updates,
                lastUpdated: new Date().toISOString()
            });
            this.persistState();
        }
    }

    addPollVote(pollId, voterId, voteData) {
        const poll = this.pollStates.get(pollId);
        if (poll) {
            poll.votes.set(voterId, voteData);
            poll.totalVotes = poll.votes.size;
            poll.lastVoteAt = new Date().toISOString();
            poll.lastUpdated = new Date().toISOString();
            this.persistState();
            return true;
        }
        return false;
    }

    getPoll(pollId) {
        return this.pollStates.get(pollId);
    }

    getAllPolls() {
        return Array.from(this.pollStates.entries()).map(([id, poll]) => ({
            id,
            ...poll,
            votes: Array.from(poll.votes.values())
        }));
    }

    getActivePollsCount() {
        return this.pollStates.size;
    }

    // Live Location Tracking Management
    addLiveLocationTracker(trackerId, trackerData) {
        this.liveLocationTrackers.set(trackerId, {
            ...trackerData,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        });
        this.persistState();
    }

    updateLiveLocationTracker(trackerId, updates) {
        const tracker = this.liveLocationTrackers.get(trackerId);
        if (tracker) {
            this.liveLocationTrackers.set(trackerId, {
                ...tracker,
                ...updates,
                lastUpdated: new Date().toISOString()
            });
            this.persistState();
        }
    }

    removeLiveLocationTracker(trackerId) {
        const removed = this.liveLocationTrackers.delete(trackerId);
        if (removed) {
            this.persistState();
        }
        return removed;
    }

    getLiveLocationTracker(trackerId) {
        return this.liveLocationTrackers.get(trackerId);
    }

    getAllLiveLocationTrackers() {
        return Array.from(this.liveLocationTrackers.entries()).map(([id, tracker]) => ({
            id,
            ...tracker,
            interval: undefined // Don't serialize the interval
        }));
    }

    getActiveLiveLocationTrackersCount() {
        return Array.from(this.liveLocationTrackers.values()).filter(
            tracker => tracker.status === 'active'
        ).length;
    }

    // Browser Tab Management
    addBrowserTab(tabId, tabData) {
        this.browserTabs.set(tabId, {
            ...tabData,
            status: 'open',
            createdAt: new Date().toISOString()
        });
        this.persistState();
    }

    removeBrowserTab(tabId) {
        const removed = this.browserTabs.delete(tabId);
        if (removed) {
            this.persistState();
        }
        return removed;
    }

    getBrowserTab(tabId) {
        return this.browserTabs.get(tabId);
    }

    getAllBrowserTabs() {
        return Array.from(this.browserTabs.entries()).map(([id, tab]) => ({
            id,
            url: tab.url,
            createdAt: tab.createdAt,
            status: tab.status
        }));
    }

    clearBrowserTabs() {
        this.browserTabs.clear();
        this.persistState();
    }

    // Timeout Management
    addTimeout(timeoutId) {
        this.activeTimeouts.add(timeoutId);
    }

    removeTimeout(timeoutId) {
        return this.activeTimeouts.delete(timeoutId);
    }

    clearAllTimeouts() {
        for (const timeoutId of this.activeTimeouts) {
            clearTimeout(timeoutId);
        }
        this.activeTimeouts.clear();
    }

    // Location Data Management
    async saveLocationData(locationData) {
        if (!this.config.locations?.saveLocationData) return;

        try {
            const locationFile = path.join(
                this.config.locations.locationDataPath,
                `locations_${new Date().toISOString().split('T')[0]}.jsonl`
            );
            
            const logEntry = JSON.stringify({
                ...locationData,
                savedAt: new Date().toISOString()
            }) + '\n';
            
            await fs.appendFile(locationFile, logEntry);
            await this.logger.debug('Location data saved');
        } catch (error) {
            await this.logger.error('Failed to save location data:', error);
            throw error;
        }
    }

    // State Statistics and Health
    async getStats() {
        return {
            isInitialized: this.isInitialized,
            callStates: {
                total: this.callStates.size,
                active: this.getActiveCalls().length
            },
            pollStates: {
                total: this.pollStates.size,
                totalVotes: Array.from(this.pollStates.values()).reduce((sum, poll) => sum + poll.totalVotes, 0)
            },
            liveLocationTrackers: {
                total: this.liveLocationTrackers.size,
                active: this.getActiveLiveLocationTrackersCount()
            },
            browserTabs: {
                total: this.browserTabs.size
            },
            activeTimeouts: this.activeTimeouts.size,
            lastPersisted: await this.getLastPersistedTime()
        };
    }

    async getLastPersistedTime() {
        try {
            const stats = await fs.stat(this.stateFile);
            return stats.mtime.toISOString();
        } catch (error) {
            return null;
        }
    }

    // State Export/Import for debugging
    async exportState() {
        return {
            callStates: Object.fromEntries(this.callStates),
            pollStates: Object.fromEntries(
                Array.from(this.pollStates.entries()).map(([key, value]) => [
                    key,
                    {
                        ...value,
                        votes: Array.from(value.votes.entries())
                    }
                ])
            ),
            liveLocationTrackers: Object.fromEntries(this.liveLocationTrackers),
            browserTabs: Object.fromEntries(this.browserTabs),
            exportedAt: new Date().toISOString()
        };
    }

    async clearAllState() {
        this.callStates.clear();
        this.pollStates.clear();
        this.liveLocationTrackers.clear();
        this.browserTabs.clear();
        this.clearAllTimeouts();
        await this.persistState();
        await this.logger.info('All application state cleared');
    }

    async cleanup() {
        try {
            this.clearAllTimeouts();
            await this.persistState();
            await this.logger.info('StateManager cleanup completed');
        } catch (error) {
            await this.logger.error('StateManager cleanup failed:', error);
        }
    }
}

module.exports = StateManager;