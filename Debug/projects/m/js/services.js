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
            if (!response.ok) return [];
            const data = await response.json();
            return data.response || [];
        } catch (error) {
            console.error("API Error:", error);
            return [];
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

const Helpers = {
    formatDate: (date) => date.toISOString().split('T')[0],
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
    }
};

State.appConfig = Storage.loadUserConfigLocally();
window.AppServices = { db, auth, State, API, Storage, Helpers };