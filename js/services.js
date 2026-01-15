"use strict";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyClgzoMBEKizx-r7abMvAmLgGpk_p748IU", 
    authDomain: "iptv-8b60c.firebaseapp.com",
    projectId: "iptv-8b60c",
    storageBucket: "iptv-8b60c.firebasestorage.app",
    messagingSenderId: "259048691910",
    appId: "1:259048691910:web:b57f9eeda5546ce4d8dfc7"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// Cloud Function Proxy
const CLOUD_FUNCTION_URL = `https://f.geekspro.us/footballRequest/`;

// Global State
const State = {
    currentUser: null,
    appConfig: { favorite_teams: [], favorite_leagues: [], favorite_players: [], theme: 'dark-bleu' },
    globalSettings: { allowed_leagues: [] },
    hasLoadedSettings: false
};

const Helpers = {
    formatDate: (date) => date.toLocaleDateString("en-CA"),
    getCurrentSeason: () => {
        const today = new Date();
        return (today.getMonth() < 6) ? today.getFullYear() - 1 : today.getFullYear();
    },
    isFav: (type, id) => {
        // Backward-compatible helper; delegates to FavoritesService.
        try {
            if (window.AppServices && window.AppServices.FavoritesService) {
                return window.AppServices.FavoritesService.isFavorite(type, id);
            }
        } catch (e) {}

        // Fallback (should rarely be used)
        const idNum = Number(id);
        const { appConfig } = State;
        if (type === 'team') return !!(appConfig.favorite_teams && appConfig.favorite_teams.some(team => team.id === idNum));
        if (type === 'league') return !!(appConfig.favorite_leagues && appConfig.favorite_leagues.some(league => league.id === idNum));
        if (type === 'player') return !!(appConfig.favorite_players && appConfig.favorite_players.some(p => p.id === idNum));
        return false;
    },
    
    // --- NEW: Toast Notification Helper ---
    showToast: (message, type = 'info') => {
        let container = document.getElementById('toast-container');
        if (!container) {
            // Fallback if index.html wasn't updated manually
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        
        let icon = 'ph-info';
        if (type === 'error') icon = 'ph-warning-circle';
        if (type === 'success') icon = 'ph-check-circle';
        if (type === 'alert') icon = 'ph-bell-ringing';

        toast.innerHTML = `<i class="ph ${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.style.animation = 'fadeOutToast 0.5s ease-out';
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    },

    // --- NEW: Page Error Helper ---
    showPageError: (message) => {
        const container = document.getElementById('content-container');
        if (!container) return;

        container.innerHTML = `
            <div class="page-error">
                <i class="ph ph-warning-octagon"></i>
                <h2>Oops! Something went wrong.</h2>
                <p>${message}</p>
                <button class="styled-button focusable" onclick="window.AppRouter.go('home')">Reload App</button>
            </div>
        `;
        // Try to focus the reload button for TV remote accessibility
        const btn = container.querySelector('button');
        if (btn && Navigation) Navigation.focus(container.querySelector('button'));
    }
};
var API_BACKEND = "local";//"google_functions"
const API = {
    fetch: async (endpointUrl) => {
        const [path, queryString] = endpointUrl.split('?');
        let data = null;
        const params = {};
        if (queryString) {
            new URLSearchParams(queryString).forEach((value, key) => {
                params[key] = value;
            });
        }
        try {
            if (API_BACKEND=="google_functions"){
                const response = await fetch(CLOUD_FUNCTION_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: path, params: params })
                });
                if (!response.ok) {
                    throw new Error(`Server returned status: ${response.status}`);
               }
               data = await response.json();
   
            }else if (API_BACKEND=="local"){
                data = await FootballClient.fetchData(path, params);
            }

            
            // Partial-error handling (non-destructive):
            // - Keep rendering whatever response is available.
            // - Surface errors via toast (and store them for debugging).
            API.lastErrors = null;
            if (data && data.errors && Object.keys(data.errors).length > 0) {
                API.lastErrors = data.errors;
                let msg = "Some data may be missing due to API partial errors.";
                if (State.currentUser && State.currentUser.email === "imad@gmail.com") {
                    msg = "API partial errors: " + JSON.stringify(data.errors);
                }
                console.warn("API returned partial errors:", data.errors);
                // Do not nuke the page; show a non-blocking notification.
                Helpers.showToast(msg, 'alert');
            }

            return (data && data.response) ? data.response : [];
        } catch (error) {
            console.error("API Error detected in fetch:", error, data);
            
            // Detect if we are in a 'Loading' state to decide where to show the error
            const container = document.getElementById('content-container');
            const isLoading = container && (container.querySelector('.skeleton-row') || container.querySelector('.skeleton-detail-header'));

            let errorMessages = error.message || "Failed to load data.";
            if(State.currentUser && State.currentUser.email === "imad@gmail.com"){
                errorMessages = data && data.errors ? " Details: " + JSON.stringify(data.errors) : errorMessages;
            }
            if (isLoading) {
                // If loading skeletons are visible, we are likely initializing a page -> Show Page Error
                Helpers.showPageError(errorMessages );
            } else {
                // Otherwise (e.g. background refresh, live update) -> Show Toast
                Helpers.showToast(errorMessages, 'error');
            }

            // Return null to signal the app that the error was handled
            return null;
        }
    }
};

// --- FavoritesService (single source of truth for favorites) ---
const FavoritesService = {
    // Normalizes historical key variants to the current ones.
    // Supported variants:
    // - favourite_leagues / favourit_teams (old typos)
    // - favorite_* (current)
    normalizeConfig: (cfg) => {
        const c = cfg || {};
        const toArr = (v) => Array.isArray(v) ? v : [];
        const mergeUniqueById = (a, b) => {
            const out = [];
            const seen = new Set();
            [...toArr(a), ...toArr(b)].forEach(it => {
                const id = Number(it && it.id);
                if (!id || seen.has(id)) return;
                seen.add(id);
                out.push({ ...it, id });
            });
            return out;
        };

        // Teams
        c.favorite_teams = mergeUniqueById(c.favorite_teams, c.favourit_teams);
        // Leagues
        c.favorite_leagues = mergeUniqueById(c.favorite_leagues, c.favourite_leagues);
        // Players
        c.favorite_players = mergeUniqueById(c.favorite_players, c.favourite_players);

        // Cleanup legacy keys (keep them in-memory only; do not persist)
        delete c.favourit_teams;
        delete c.favourite_leagues;
        delete c.favourite_players;
        return c;
    },

    ensure: () => {
        State.appConfig = FavoritesService.normalizeConfig(State.appConfig || {});
        State.appConfig.favorite_teams = State.appConfig.favorite_teams || [];
        State.appConfig.favorite_leagues = State.appConfig.favorite_leagues || [];
        State.appConfig.favorite_players = State.appConfig.favorite_players || [];
        return State.appConfig;
    },

    _keyForType: (type) => ({ team: 'favorite_teams', league: 'favorite_leagues', player: 'favorite_players' }[type] || 'favorite_teams'),

    list: (type) => {
        const cfg = FavoritesService.ensure();
        return cfg[FavoritesService._keyForType(type)] || [];
    },

    isFavorite: (type, id) => {
        const idNum = Number(id);
        if (!idNum) return false;
        const arr = FavoritesService.list(type);
        return arr.some(x => Number(x.id) === idNum);
    },

    add: async (type, item) => {
        if (!State.currentUser) return false;
        const id = Number(item && item.id);
        if (!id) return false;
        const cfg = FavoritesService.ensure();
        const key = FavoritesService._keyForType(type);
        const arr = cfg[key] || [];
        if (arr.some(x => Number(x.id) === id)) return false;
        arr.push({ ...item, id });
        cfg[key] = arr;
        State.appConfig = cfg;
        await Storage.saveUserConfig(State.currentUser.uid, cfg);
        return true;
    },

    remove: async (type, id) => {
        if (!State.currentUser) return false;
        const idNum = Number(id);
        if (!idNum) return false;
        const cfg = FavoritesService.ensure();
        const key = FavoritesService._keyForType(type);
        cfg[key] = (cfg[key] || []).filter(x => Number(x.id) !== idNum);
        State.appConfig = cfg;
        await Storage.saveUserConfig(State.currentUser.uid, cfg);
        return true;
    },

    toggle: async (type, item) => {
        const id = Number(item && item.id);
        if (!id) return { active: false, changed: false };
        if (FavoritesService.isFavorite(type, id)) {
            const ok = await FavoritesService.remove(type, id);
            return { active: false, changed: ok };
        }
        const ok = await FavoritesService.add(type, item);
        return { active: true, changed: ok };
    }
};

const Storage = {
    // Simplified Collection Reference
    getCollection: () => {
        return db.collection('usersSettings');
    },
    saveUserConfigLocally: (config) => {
        try {
            localStorage.setItem('appConfig', JSON.stringify(config || State.appConfig));
        } catch (e) { console.error("Local Save Error:", e); }
    },

    loadUserConfigLocally: () => {
        try {
            const configStr = localStorage.getItem('appConfig');
            return configStr ? JSON.parse(configStr) : State.appConfig;
        } catch (e) { 
            console.error("Local Load Error:", e);
            return null; 
        }
    },
    loadUserConfig: async (uid) => {
        if (!uid) return null;
        try {
            // Path: usersSettings/{uid}
            const doc = await Storage.getCollection().doc(uid).get();
            const config = doc.exists ? doc.data() : null;
            Storage.saveUserConfigLocally(config);
            return config;
        } catch (e) { 
            console.error("Load Config Error:", e);
            return null; 
        }
    },

    saveUserConfig: async (uid, config) => {
        if (!uid) return;
        try {
            // Path: usersSettings/{uid}
            await Storage.getCollection().doc(uid).set(config, { merge: true });
            State.appConfig = config;
            Storage.saveUserConfigLocally(config);
            console.log("Config saved successfully.");
        } catch (e) { console.error("Save Config Error:", e); }
    },

    loadGlobalSettings: async () => {
        try {
            // Path: usersSettings/global
            const doc = await Storage.getCollection().doc('global').get();
            const data = doc.exists ? doc.data() : { allowed_leagues: [] };
            State.globalSettings = data;
            return data;
        } catch (e) { 
            console.warn("Global Settings Load Error (using defaults):", e);
            return { allowed_leagues: [] }; 
        }
    }
};

State.appConfig = Storage.loadUserConfigLocally() || State.appConfig;
// Normalize config keys for backward compatibility
State.appConfig = FavoritesService.normalizeConfig(State.appConfig);
State.appConfig.favorite_teams = State.appConfig.favorite_teams || [];
State.appConfig.favorite_leagues = State.appConfig.favorite_leagues || [];
State.appConfig.favorite_players = State.appConfig.favorite_players || [];

window.AppServices = { db, auth, State, API, Storage, Helpers, FavoritesService };