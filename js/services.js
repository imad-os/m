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
    appConfig: { favourit_teams: [], favourite_leagues: [], theme: 'dark-bleu' },
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
        const idNum = Number(id);
        const { appConfig } = State;
        if (type === 'team') {
            return appConfig.favourit_teams && appConfig.favourit_teams.some(team => team.id === idNum);
        }
        if (type === 'league') {
            return appConfig.favourite_leagues && appConfig.favourite_leagues.some(league => league.id === idNum);
        }
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
                <button class="styled-button focusable" onclick="Router.go('home')">Reload App</button>
            </div>
        `;
        // Try to focus the reload button for TV remote accessibility
        const btn = container.querySelector('button');
        if (btn && Navigation) Navigation.focus(container.querySelector('button'));
    }
};

const API = {
    fetch: async (endpointUrl) => {
        const [path, queryString] = endpointUrl.split('?');
        const params = {};
        if (queryString) {
            new URLSearchParams(queryString).forEach((value, key) => {
                params[key] = value;
            });
        }
        try {
            const response = await fetch(CLOUD_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: path, params: params })
            });
            if (!response.ok) {
                 throw new Error(`Server returned status: ${response.status}`);
            }
            const data = await response.json();
            
            // Optional: Check API specific error fields if necessary
            if (data.errors && Object.keys(data.errors).length > 0) {
                let errorMessages = "Some data may be missing due to API errors.";
                if(State.currentUser && State.currentUser.email === "imad@gmail.com"){
                    errorMessages = " Details: " + JSON.stringify(data.errors);
                }
                console.warn("API returned logical errors:", data.errors);
                console.error("errorMessages:", errorMessages , State.currentUser && State.currentUser.email === "imad@gmail.com");
                 Helpers.showPageError(errorMessages, 'alert');
                 return null;
            }

            return data.response || [];
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

State.appConfig = Storage.loadUserConfigLocally();
window.AppServices = { db, auth, State, API, Storage, Helpers };