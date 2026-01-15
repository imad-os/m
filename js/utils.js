"use strict";

window.Utils = (function() {

    // --- Image loading optimizations (TV-friendly) ---
    // Uses IntersectionObserver when available; falls back to eager loading.
    // Also de-duplicates concurrent loads by URL.
    const IMG_PLACEHOLDER =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const _imgPromises = new Map();
    const _imgLoaded = new Set();

    function preloadImage(url) {
        const u = (url || '').trim();
        if (!u) return Promise.resolve(false);
        if (_imgLoaded.has(u)) return Promise.resolve(true);
        if (_imgPromises.has(u)) return _imgPromises.get(u);

        const p = new Promise((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => { _imgLoaded.add(u); resolve(true); };
            img.onerror = () => resolve(false);
            img.src = u;
        });
        _imgPromises.set(u, p);
        return p;
    }

    function applyLazyImg(imgEl) {
        if (!imgEl || imgEl.dataset && imgEl.dataset._lazyBound) return;
        const url = imgEl.getAttribute('data-src') || '';
        if (!url) return;
        if (!imgEl.getAttribute('src')) imgEl.setAttribute('src', IMG_PLACEHOLDER);
        imgEl.setAttribute('decoding', 'async');
        imgEl.setAttribute('loading', 'lazy');
        imgEl.dataset._lazyBound = '1';

        const loadNow = async () => {
            // Hide placeholder artifact until the real image has painted.
            imgEl.classList.add('img-loading');
            if (!imgEl.style.opacity) imgEl.style.opacity = '0';

            const ok = await preloadImage(url);
            if (!ok) {
                imgEl.classList.remove('img-loading');
                imgEl.classList.add('img-loaded');
                imgEl.style.opacity = '1';
                return;
            }

            imgEl.onload = () => {
                imgEl.classList.remove('img-loading');
                imgEl.classList.add('img-loaded');
                imgEl.style.opacity = '1';
                imgEl.onload = null;
            };
            imgEl.onerror = () => {
                imgEl.classList.remove('img-loading');
                imgEl.classList.add('img-loaded');
                imgEl.style.opacity = '1';
                imgEl.onerror = null;
            };

            imgEl.src = url;
        };

        // If already in viewport or IO unavailable, load immediately.
        if (!('IntersectionObserver' in window)) {
            loadNow();
            return;
        }

        ImageLoader._ensureObserver();
        ImageLoader._observer.observe(imgEl);
        imgEl._loadNow = loadNow;
    }

    const ImageLoader = {
        _observer: null,
        _ensureObserver: () => {
            if (ImageLoader._observer || !('IntersectionObserver' in window)) return;
            ImageLoader._observer = new IntersectionObserver((entries) => {
                for (const ent of entries) {
                    if (!ent.isIntersecting) continue;
                    const el = ent.target;
                    try {
                        if (el && typeof el._loadNow === 'function') el._loadNow();
                    } finally {
                        ImageLoader._observer.unobserve(el);
                    }
                }
            }, { root: null, rootMargin: '200px', threshold: 0.01 });
        },
        scan: (root) => {
            const scope = root || document;
            const imgs = scope.querySelectorAll('img[data-src]');
            imgs.forEach(applyLazyImg);
        },
        // Helper for renderers: emits an <img> tag that participates in lazy loading.
        tag: (url, alt = '', className = '', extraAttrs = '') => {
            const safeAlt = String(alt || '').replace(/"/g, '&quot;');
            const safeUrl = String(url || '').replace(/"/g, '&quot;');
            const cls = (`lazy-img ${className || ''}`).trim();
            return `<img class="${cls}" src="${IMG_PLACEHOLDER}" data-src="${safeUrl}" alt="${safeAlt}" ${extraAttrs || ''}>`;
        }
    };
    
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
    function fullDate(date){
        const matchDate = new Date(date);
        return `${matchDate.getFullYear()}/${matchDate.getMonth()+1}/${matchDate.getDate()}`;
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
    function isSoon(m){
        
        const matchTime = new Date(m.fixture.date).getTime();
        const hour1 = Date.now() + 1*60*60*1000;
        const matcheStatus = new Set(['NS']);

        return (
            matchTime <= hour1 &&
            matcheStatus.has(m.fixture.status.short)
          );
    }
    function isRefreshNeeeded(){
        const now = Date.now() + 5 * 60 * 1000;

        const finishedStatus = new Set(['FT', 'AET', 'PEN']);
        const filteredMatches = window.AppState.renderedMatches.filter(m => {
            const matchTime = new Date(m.fixture.date).getTime();
          
            return (
              matchTime <= now &&
              !finishedStatus.has(m.fixture.status.short)
            );
        });
        console.log("[isRefreshNeeeded] : ", filteredMatches.length > 0)
        return filteredMatches.length > 0;
    }
    return {
        // image
        IMG_PLACEHOLDER,
        preloadImage,
        ImageLoader,
        playSound,
        formTimeString,
        getRatingClass,
        updateClock,
        isTracked,
        removeTracked,
        addTracked,
        saveTrackedMatches,
        isRefreshNeeeded,
        fullDate,
        isSoon,
    };
})();