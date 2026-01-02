"use strict";

(function() {
    if (!window.AppServices) { console.error("AppServices not loaded!"); return; }

    const { State, API, Storage, Helpers, auth } = window.AppServices;
    const Components = window.AppComponents;
    const Utils = window.Utils;
    // Router is now on window.AppRouter

    // --- GLOBAL APP STATE INITIALIZATION ---
    window.AppState = {
        currentDate: new Date(),
        isLiveMode: false,
        homePageLoadAllState: false,
        matchesCache: null,
        lastEndpoint: null,
        currentLeagueStats: { scorers: [], assists: [] },
        currentTab: null,
        currentMatchId: null,
        monitoredMatches: new Set(),
        matchStates: {},
        renderedMatches:[],
    };
    const MS_lLiveCheck = 30000;
    var MS_left = MS_lLiveCheck;
    // Load tracked matches
    try {
        const saved = localStorage.getItem('tracked_matches');
        if (saved) window.AppState.monitoredMatches = new Set(JSON.parse(saved));
    } catch(e) { console.error("Error loading tracked matches", e); }

    setInterval(() => { MS_left = MS_lLiveCheck;checkLiveMatches(); }, MS_lLiveCheck);
    setInterval(() => {
        MS_left=MS_left>=1000 ? MS_left-1000 : 0;
        const percent = parseInt( (MS_left/MS_lLiveCheck)*100 );
        document.querySelector("#refreshTimer .progress-fill").style.width = `${percent}%`;
    }, 1000);

    function registerTizenKeys() {
        if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
            try {
                const keys = ['ChannelUp', 'ChannelDown', 'MediaPlayPause', 'Guide'];
                keys.forEach(k => tizen.tvinputdevice.registerKey(k));
            } catch (e) { console.error("Error registering keys:", e); }
        }
    }

    function removeTrackedMatch(mid, cards=null) {
        if (Utils.isTracked(mid)) {
            Utils.removeTracked(mid);
            const _cards = cards || document.querySelectorAll(`#match-card-${mid}`);
            if(_cards && _cards.length) {
                for (const card of cards) {
                    const dot = card.querySelector('.track-indicator'); if(dot) dot.remove(); 
                }
            }
        }
    }

    function showAlert(title, desc, matchData, type, isSilent = false) {
        if (!isSilent) Utils.playSound(type);
        if (document.hidden) return; 

        const alertEl = document.getElementById('live-alert');
        if (!alertEl) return;

        const homeScore = matchData.goals.home ?? 0;
        const awayScore = matchData.goals.away ?? 0;
        
        alertEl.innerHTML = `
            <div class="alert-header"><span class="alert-event-type">${title}</span><span class="alert-time">${Utils.formTimeString(matchData.fixture.status)}'</span></div>
            <div class="alert-teams">
                <div class="alert-team"><img src="${matchData.teams.home.logo}"><span>${matchData.teams.home.name}</span></div>
                <div class="alert-score-board">${homeScore} - ${awayScore}</div>
                <div class="alert-team"><img src="${matchData.teams.away.logo}"><span>${matchData.teams.away.name}</span></div>
            </div>
            <div class="alert-desc">${desc}</div>
        `;
        
        alertEl.style.display = 'flex';
        void alertEl.offsetWidth; 
        alertEl.classList.add('visible');
        if (!isSilent) Navigation.focus(alertEl, false);

        const closeAlert = () => {
            alertEl.classList.remove('visible');
            setTimeout(() => alertEl.style.display = 'none', 300);
        };
        alertEl.onclick = () => { window.AppRouter.go('match', matchData.fixture.id); closeAlert(); };
        setTimeout(closeAlert, 10000);
    }

    async function checkLiveMatches() {
        try {
            if (!Utils.isRefreshNeeeded()){
                return ;
            }
            const liveData = await API.fetch('fixtures?live=all');
            if (liveData === null) return;

            const allowedLeagues = State.globalSettings.allowed_leagues || [];
            const allowedIds = new Set(allowedLeagues.map(l => l.id));
            const favTeams = new Set((State.appConfig.favourit_teams || []).map(t => t.id));
            const favLeagues = new Set((State.appConfig.favourite_leagues || []).map(l => l.id));

            for (const m of liveData) {
                const mid = m.fixture.id;
                const isTracked = Utils.isTracked(mid);
                const isFav = favTeams.has(m.teams.home.id) || favTeams.has(m.teams.away.id) || favLeagues.has(m.league.id);
                const isAllowed = allowedIds.has(m.league.id);
                const isCurrentMatch = (window.AppState.currentMatchId === mid);

                const oldState = window.AppState.matchStates[mid];
                const newScore = `${m.goals.home}-${m.goals.away}`;
                const newStatusShort = m.fixture.status.short;
                const cards = document.querySelectorAll(`#match-card-${mid}`);
                
                if (!isTracked && !isFav && !isAllowed && !isCurrentMatch && !cards.length) continue;

                window.AppState.renderedMatches = window.AppState.renderedMatches?.map(mc => {
                    if(mc.fixture.id === mid) return m;
                    return mc;
                }) || null;

                window.AppState.matchesCache = window.AppState.matchesCache?.map(mc => {
                    if(mc.fixture.id === mid) return m;
                    return mc;
                }) || null;


                if (cards.length) {
                    for (const card of cards) {
                        const statusEl = card.querySelector('.match-status');
                        const scoreEls = card.querySelectorAll('.card-score');
                        if (scoreEls.length === 2) {
                            const h = m.goals.home ?? 0; const a = m.goals.away ?? 0;
                            if (scoreEls[0].textContent != h) scoreEls[0].textContent = h;
                            if (scoreEls[1].textContent != a) scoreEls[1].textContent = a;
                        }
                        if (statusEl) {
                            let statusText = m.fixture.status.long;
                            if (['1H','HT','2H','ET','P','BT'].includes(newStatusShort)) {
                                const time = newStatusShort === 'HT' ? 'HT' : (m.fixture.status.elapsed ? `<span class="live-time">${Utils.formTimeString(m.fixture.status)}</span>` : 'LIVE');
                                if (statusEl.innerHTML !== time) statusEl.innerHTML = time;
                            } else if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
                        }
                    }
                }

                if(isCurrentMatch) {
                    const scoreEl = document.querySelector('.details-score-box .details-score');
                    const statusEl = document.querySelector('.details-score-box .details-status');
                    if (scoreEl) {
                        const h = m.goals.home ?? 0; const a = m.goals.away ?? 0;
                        const newScoreText = `${h} - ${a}`;
                        if (scoreEl.textContent != newScoreText) scoreEl.textContent = newScoreText;
                    }
                    if (statusEl) {
                        let statusText = m.fixture.status.long;
                        if (['1H','HT','2H','ET','P','BT'].includes(newStatusShort)) {
                            const time = newStatusShort === 'HT' ? 'HT' : (m.fixture.status.elapsed ? `<span class="live-time">${Utils.formTimeString(m.fixture.status)}</span>` : 'LIVE');
                            if (statusEl.innerHTML !== time) statusEl.innerHTML = time;
                        } else if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
                    }
                }

                if (!oldState) { window.AppState.matchStates[mid] = { score: newScore, status: newStatusShort }; continue; }

                if (oldState.score !== newScore) {
                    let desc = "Goal!";
                    try {
                        const events = await API.fetch(`fixtures/events?fixture=${mid}`);
                        if(events && events.length) {
                            const goals = events.filter(e => e.type === 'Goal');
                            if(goals.length > 0) {
                                const lastGoal = goals[goals.length-1];
                                desc = `Goal by ${lastGoal.player.name}${lastGoal.assist.name ? ` (Assist: ${lastGoal.assist.name})` : ''}`;
                            }
                        }
                    } catch(e) {}
                    showAlert('GOAL!', desc, m, 'goal', !isTracked);
                }
                
                if (newStatusShort !== oldState.status) {
                    if (['FT', 'AET', 'PEN'].includes(newStatusShort)) {
                        const desc = `Finished: ${newScore}`;
                        showAlert('Full Time', desc, m, 'ft', !isTracked);
                        if(isTracked) removeTrackedMatch(mid, cards);
                    }
                }
                window.AppState.matchStates[mid] = { score: newScore, status: newStatusShort };
            }
        } catch(e) { console.warn("Monitor check failed", e); }
    }

    function setupDelegatedEvents(container) {
        container.addEventListener('click', async (e) => {
            const target = e.target;
            const sortHeader = target.closest('.sort-header');
            if (sortHeader) {
                const table = sortHeader.closest('table');
                const type = table.dataset.type;
                const sortKey = sortHeader.dataset.sort;
                let data = type === 'goals' ? [...window.AppState.currentLeagueStats.scorers] : [...window.AppState.currentLeagueStats.assists];
                data.sort((a, b) => {
                    const sA = a.statistics[0]; const sB = b.statistics[0];
                    let valA, valB;
                    switch(sortKey) {
                        case 'pos': valA = sA.games.position; valB = sB.games.position; break;
                        case 'app': valA = sA.games.appearences || 0; valB = sB.games.appearences || 0; break;
                        case 'rating': valA = parseFloat(sA.games.rating || 0); valB = parseFloat(sB.games.rating || 0); break;
                        case 'shots': valA = sA.shots.total || 0; valB = sB.shots.total || 0; break;
                        case 'main': valA = type === 'goals' ? (sA.goals.total||0) : (sA.goals.assists||0); valB = type === 'goals' ? (sB.goals.total||0) : (sB.goals.assists||0); break;
                    }
                    return valA < valB ? 1 : (valA > valB ? -1 : 0);
                });
                const tabId = type === 'goals' ? 'l-scr' : 'l-ast';
                const tabContent = document.getElementById(tabId);
                if (tabContent) { tabContent.innerHTML = Components.renderPlayerStats(data, type); Navigation.scan(); }
                return;
            }

            const tabBtn = target.closest('.tab-button');
            if (tabBtn) {
                if (tabBtn.id === 'btn-track-toggle') {
                     const mid = Number(tabBtn.dataset.mid);
                     if (Utils.isTracked(mid)) Utils.removeTracked(mid); else Utils.addTracked(mid);
                     if (Utils.isTracked(mid)) tabBtn.classList.add('track-active'); else tabBtn.classList.remove('track-active');
                } else {
                    const parent = tabBtn.closest('.page-container');
                    if (parent) {
                        parent.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                        parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        tabBtn.classList.add('active');
                        const contentId = tabBtn.dataset.tab;
                        const content = parent.querySelector('#'+contentId);
                        if(content) {
                            content.classList.add('active');
                            if (contentId === 'ln' && window.AppState.currentTab==='ln') {
                                content.classList.add('full-screen-mode');
                                if (!content.querySelector('.fs-close-btn')) {
                                    const closeBtn = document.createElement('button');
                                    closeBtn.className = 'fs-close-btn focusable';
                                    closeBtn.innerText = 'Close Full Screen';
                                    closeBtn.tabIndex = 0;
                                    closeBtn.onclick = (e) => {
                                        e.stopPropagation(); 
                                        content.classList.remove('full-screen-mode');
                                        closeBtn.remove();
                                        Navigation.focus(tabBtn);
                                    };
                                    content.prepend(closeBtn);
                                    setTimeout(() => Navigation.focus(closeBtn), 50);
                                }
                            } else {
                                parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('full-screen-mode'));
                                const existingBtn = parent.querySelector('.fs-close-btn');
                                if(existingBtn) existingBtn.remove();
                            }
                        }
                        window.AppState.currentTab = target.dataset.tab || null;
                    }
                }
                return;
            }
            
            const card = target.closest('.match-card, .bracket-match');
            if (card) {
                const action = card.dataset.action; const id = card.dataset.id;
                if (action === 'open-match' && id) window.AppRouter.go('match', id);
                return;
            }

            const leagueHeader = target.closest('.row-header-content');
            if (leagueHeader) {
                const action = leagueHeader.dataset.action; const id = leagueHeader.dataset.id;
                if (action === 'open-league' && id) window.AppRouter.go('league', id);
                return;
            }

            const favBtn = target.closest('.fav-toggle');
            if (favBtn) {
                e.preventDefault(); e.stopPropagation();
                if (!State.currentUser) {
                     const m = document.getElementById('auth-modal');
                     document.getElementById('modal-overlay').classList.add('visible');
                     document.querySelectorAll('.modal-content').forEach(d => d.style.display='none');
                     m.style.display='block';
                     Navigation.setScope(m);
                     return;
                }
                const type = favBtn.dataset.type; const id = Number(favBtn.dataset.id); 
                const name = favBtn.dataset.name || 'Unknown';
                const cfg = State.appConfig;
                const arr = type === 'team' ? (cfg.favourit_teams || []) : (cfg.favourite_leagues || []);
                if (!cfg.favourit_teams) cfg.favourit_teams = []; if (!cfg.favourite_leagues) cfg.favourite_leagues = [];
                const idx = arr.findIndex(x => x.id === id);
                if(idx > -1) { arr.splice(idx, 1); favBtn.classList.remove('active'); } else { arr.push({id, name: name}); favBtn.classList.add('active'); }
                if (type === 'team') cfg.favourit_teams = arr; else cfg.favourite_leagues = arr;
                State.appConfig = cfg; await Storage.saveUserConfig(State.currentUser.uid, cfg);
                return;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        registerTizenKeys();
        Navigation.init();
        
        const container = document.getElementById('content-container');
        setupDelegatedEvents(container);
        
        const authEmail = document.getElementById('auth-email');
        const authPass = document.getElementById('auth-password');
        const btnSignUp = document.getElementById('btn-signup-submit');
        const btnSignIn = document.getElementById('btn-signin-submit');
        if(authEmail) authEmail.value = "imad";
        if(authPass) authPass.value = "198922";
        
        document.addEventListener('nav-back', () => { window.AppRouter.back(); });

        const showModal = (id) => {
            const overlay = document.getElementById('modal-overlay');
            const target = document.getElementById(id);
            document.querySelectorAll('.modal-content').forEach(d => d.style.display='none');
            overlay.classList.add('visible');
            target.style.display = 'block';
            Navigation.setScope(target);
        };

        const closeModal = () => {
             document.getElementById('modal-overlay').classList.remove('visible');
             Navigation.setScope(null); 
             const activeNav = document.querySelector('#sidebar .active');
             if(activeNav) Navigation.focus(activeNav);
        };

        document.getElementById('nav-calendar').onclick = () => showModal('date-modal');
        document.getElementById('nav-auth').onclick = () => showModal('auth-modal');
        document.getElementById('nav-home').onclick = () => { 
            if (window.AppRouter.current.name === 'home') { const content = document.querySelector('#content-container .focusable'); if(content) Navigation.focus(content); } 
            else window.AppRouter.go('home'); 
        };

        const updateDate = () => { document.getElementById('modal-current-date').textContent = Helpers.formatDate(window.AppState.currentDate); window.AppRouter.go('home'); };
        document.getElementById('btn-prev-day').onclick = () => { window.AppState.currentDate.setDate(window.AppState.currentDate.getDate()-1); window.AppState.matchesCache = null; updateDate(); };
        document.getElementById('btn-next-day').onclick = () => { window.AppState.currentDate.setDate(window.AppState.currentDate.getDate()+1); window.AppState.matchesCache = null; updateDate(); };
        document.getElementById('btn-live-toggle').onclick = () => { window.AppState.isLiveMode = !window.AppState.isLiveMode; window.AppState.matchesCache = null; updateDate(); };
        document.querySelectorAll('.modal-close').forEach(b => b.onclick = closeModal);

        const authErr = document.getElementById('auth-error');

        btnSignUp.onclick = btnSignIn.onclick = async (e) => {
            authErr.textContent = "";
            const isLogin = e.target.id=="btn-signin-submit";
            try {
                [authEmail,authPass,btnSignUp,btnSignIn].map(e=>{
                    e.setAttribute("disabled",true);
                    e.classList.add("disabled");
                });
                let username = authEmail.value;
                if(!username.includes("@")){
                    username=`${username}@user.com`;
                }
                if(isLogin){
                    await auth.signInWithEmailAndPassword(username, authPass.value);
                }else{
                    await auth.createUserWithEmailAndPassword(username, authPass.value);
                }
                closeModal();
            } catch(e) { authErr.textContent = e.message; }
            [authEmail,authPass,btnSignUp,btnSignIn].map(e=>{
                e.removeAttribute("disabled");
                e.classList.remove("disabled");
            });
        };

        document.getElementById('btn-logout').onclick = () => { auth.signOut(); closeModal(); };

        auth.onAuthStateChanged(async (user) => {
            State.currentUser = user;
            const sidebar = document.getElementById('sidebar');
            const logo = sidebar.querySelector('.sidebar-logo');
            let avatar = document.getElementById('user-avatar-badge');
            
            if (user && user.email) {
                if (!avatar) { 
                    avatar = document.createElement('div'); 
                    avatar.id = 'user-avatar-badge'; 
                    avatar.className = 'user-avatar-badge'; 
                    if (logo) logo.parentNode.insertBefore(avatar, logo.nextSibling); 
                    else sidebar.prepend(avatar); 
                }
                avatar.textContent = user.email.charAt(0).toUpperCase();
            } else { if (avatar) avatar.remove(); }

            if(user) { document.getElementById('auth-form').style.display='none'; document.getElementById('auth-logged-in').style.display='block'; const cfg = await Storage.loadUserConfig(user.uid); if(cfg) { State.appConfig = cfg; } }
            else { document.getElementById('auth-form').style.display='block'; document.getElementById('auth-logged-in').style.display='none'; }
        });

        document.addEventListener('keydown', (e) => {
            const key = Navigation.normalizeKey(e);
        
            if (key === 'Return' || key === 'Escape') {
                const fsContent = document.querySelector('.tab-content.full-screen-mode');
                if (fsContent) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    fsContent.classList.remove('full-screen-mode');
                    const btn = fsContent.querySelector('.fs-close-btn');
                    if(btn) btn.remove();
                    
                    const lnTab = document.querySelector('.tab-button[data-tab="ln"]');
                    if (lnTab) Navigation.focus(lnTab);
                    return;
                }
            }

            if (key === 'ChannelUp') { e.preventDefault(); window.AppState.currentDate.setDate(window.AppState.currentDate.getDate()+1); window.AppState.matchesCache = null; updateDate(); return; }
            if (key === 'ChannelDown') { e.preventDefault(); window.AppState.currentDate.setDate(window.AppState.currentDate.getDate()-1); window.AppState.matchesCache = null; updateDate(); return; }
            if (key === 'MediaPlayPause') { e.preventDefault(); const current = document.activeElement; if (current.classList.contains('row-header-content')) { const toggle = current.parentElement.querySelector('.fav-toggle'); if(toggle) toggle.click(); } else if (current.classList.contains('fav-toggle')) { current.click(); } return; }
            if (key === 'Guide') {
                e.preventDefault(); const current = document.activeElement;
                if (current.classList.contains('match-card') && current.dataset.id) {
                    const mid = parseInt(current.dataset.id);
                    if (mid) {
                        let canTrack = true;
                        if (window.AppState.matchesCache) { const m = window.AppState.matchesCache.find(x => x.fixture.id === mid); if (m && ['FT', 'AET', 'PEN'].includes(m.fixture.status.short)) canTrack = false; }
                        if (canTrack) {
                            if (Utils.isTracked(mid)) Utils.removeTracked(mid); else Utils.addTracked(mid);
                            const hasIndicator = current.querySelector('.track-indicator'); 
                            if(hasIndicator) hasIndicator.remove(); 
                            else { const dot = document.createElement('div'); dot.className = 'track-indicator'; current.appendChild(dot); }
                        } else console.log("Match finished, cannot track");
                    }
                }
            }
            
            const current = document.activeElement;
            const sidebar = current.closest('#sidebar');
            if (sidebar && (key === 'Right' || key === 'Enter')) {
                 if (key === 'Enter' && current.id !== 'nav-home') return; 
                 e.preventDefault(); e.stopImmediatePropagation();
                 const t = document.querySelector('#content-container .focusable');
                 if(t) Navigation.focus(t);
            }
        }, true);

        window.AppRouter.render();
        Utils.updateClock();
        setInterval(() => { Utils.updateClock(); }, 60000);
    });
})();