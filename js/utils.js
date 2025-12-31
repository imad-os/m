"use strict";

window.Utils = (function() {
    
    const sounds = {
        goal: null,
        card: null,
        ft: null
    };
    function saveTrackedMatches() {
        localStorage.setItem('tracked_matches', JSON.stringify([...window.AppState.monitoredMatches]));
    }
    function initSounds() {
        sounds.goal = document.getElementById('snd-goal');
        sounds.card = document.getElementById('snd-whistle');
        sounds.ft = document.getElementById('snd-whistle');
    }

    function playSound(type) {
        if (!sounds.goal) initSounds();
        try {
            const audio = sounds[type];
            if (!audio) return;
            audio.pause(); 
            audio.currentTime = 0; 
            audio.volume = 0.5;
            const playPromise = audio.play();
            if (playPromise) playPromise.catch(err => console.warn('Audio play failed:', err));
        } catch (e) { console.error('Sound Error:', e); }
    }

    function formTimeString(status) {
        const extra = status.extra ? `+${status.extra}` : '';
        return `${status.elapsed}${extra}'`;
    }

    function getRatingClass(rating) {
        const rVal = parseFloat(rating);
        if (rVal >= 9.0) return 'super';
        if (rVal >= 8.0) return 'high';
        if (rVal >= 7.0) return 'good';
        if (rVal >= 6.0) return 'mid';
        return 'low';
    }

    function updateClock() {
        const now = new Date();
        const clock = document.getElementById('clock');
        if(clock) clock.textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    function isTracked(mid) {
        return AppState && AppState.monitoredMatches && AppState.monitoredMatches.has(mid);
    }
    function removeTracked(mid) {
        const t = AppState?.monitoredMatches && AppState.monitoredMatches.has(mid) ? AppState.monitoredMatches.delete(mid) : false;
        saveTrackedMatches();
        return t;
    }
    function addTracked(mid) {
        const t=AppState?.monitoredMatches && !AppState.monitoredMatches.has(mid) ? AppState.monitoredMatches.add(mid) : false;
        saveTrackedMatches();
        return t;
    }
    return {
        playSound,
        formTimeString,
        getRatingClass,
        updateClock,
        isTracked,
        removeTracked,
        addTracked,
        saveTrackedMatches
    };
})();