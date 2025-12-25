"use strict";

(function() {
    if (!window.AppServices) { console.error("AppServices not loaded!"); return; }

    const { State, API, Storage, Helpers, auth } = window.AppServices;
    
    let currentDate = new Date();
    let isLiveMode = false;
    let homePageLoadAllState = false; 
    
    // --- CACHE STATE ---
    let matchesCache = null;
    let lastEndpoint = null;
    
    // --- BACKGROUND MONITORING STATE ---
    let monitoredMatches = new Set();
    try {
        const saved = localStorage.getItem('tracked_matches');
        if (saved) monitoredMatches = new Set(JSON.parse(saved));
    } catch(e) { console.error("Error loading tracked matches", e); }

    let matchStates = {}; 

    const sounds = {
        goal: document.getElementById('snd-goal'),
        card: document.getElementById('snd-whistle'),
        ft: document.getElementById('snd-whistle')
    };
    // --- INTERNAL ROUTER (No Hash) ---
    const Router = {
        stack: [],
        current: { name: 'home', params: null },

        go: function(name, params = null) {
            this.stack.push(this.current);
            this.current = { name, params };
            this.render();
        },

        back: function() {
            if (this.stack.length > 0) {
                this.current = this.stack.pop();
                this.render();
            } else {
                if (this.current.name !== 'home') {
                    this.go('home');
                } else {
                    const sidebar = document.querySelector('#sidebar .active');
                    if (sidebar) Navigation.focus(sidebar);
                }
            }
        },

        render: function() {
            const container = document.getElementById('content-container');
            
            if (this.current.name === 'home') {
                Views.renderHome(container);
            } else if (this.current.name === 'match') {
                Views.renderDetails(container, this.current.params);
            } else if (this.current.name === 'league') {
                Views.renderLeaguePage(container, this.current.params);
            }
        }
    };
    function updateClock(){
        const now = new Date();
        document.getElementById('clock').textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    function saveTrackedMatches() {
        localStorage.setItem('tracked_matches', JSON.stringify([...monitoredMatches]));
    }

    // --- WORKER TIMER ---
    const workerBlob = new Blob([`
        self.onmessage = function(e) {
            if (e.data === 'start') {
                setInterval(() => postMessage('tick'), 30000);
            }
        };
    `], { type: 'application/javascript' });
    const timerWorker = new Worker(URL.createObjectURL(workerBlob));
    
    timerWorker.onmessage = () => {
        checkLiveMatches();
    };
    timerWorker.postMessage('start');

    // --- SOUND ENGINE ---
    // const audioCtx = ... (Oscillator code can remain or be removed, we override playSound below)

    function playSound(type) {
        try {
            const audio = sounds[type];
            if (!audio) return;

            audio.pause();           // stop if already playing
            audio.currentTime = 0;   // rewind for instant replay
            audio.volume = 0.5;

            const playPromise = audio.play();
            if (playPromise) {
                playPromise.catch(err => {
                    console.warn('Audio play failed:', err);
                });
            }
        } catch (e) {
            console.error('Sound Error:', e);
        }
    }



    const initialSettingsPromise = Storage.loadGlobalSettings();

    function registerTizenKeys() {
        if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
            try {
                const keys = ['ChannelUp', 'ChannelDown', 'MediaPlayPause', 'Guide'];
                keys.forEach(k => tizen.tvinputdevice.registerKey(k));
            } catch (e) { console.error("Error registering keys:", e); }
        }
    }

    // --- ALERT SYSTEM ---
    function showAlert(title, desc, matchData, type, isSilent = false) {
        if (!isSilent) playSound(type);

        if (document.hidden) {
            if (!isSilent) console.log(`${title}: ${desc}`);
            return; 
        }

        const alertEl = document.getElementById('live-alert');
        if (!alertEl) return;

        const homeScore = matchData.goals.home ?? 0;
        const awayScore = matchData.goals.away ?? 0;
        
        alertEl.innerHTML = `
            <div class="alert-header">
                <span class="alert-event-type">${title}</span>
                <span class="alert-time">${matchData.fixture.status.elapsed}'</span>
            </div>
            <div class="alert-teams">
                <div class="alert-team">
                    <img src="${matchData.teams.home.logo}">
                    <span>${matchData.teams.home.name}</span>
                </div>
                <div class="alert-score-board">
                    ${homeScore} - ${awayScore}
                </div>
                <div class="alert-team">
                    <img src="${matchData.teams.away.logo}">
                    <span>${matchData.teams.away.name}</span>
                </div>
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

        alertEl.onclick = () => {
            Router.go('match', matchData.fixture.id);
            closeAlert();
        };

        setTimeout(closeAlert, 10000);
    }

    async function checkLiveMatches() {
        try {
            const liveData = await API.fetch('fixtures?live=all');
            const allowedLeagues = State.globalSettings.allowed_leagues || [];
            const allowedIds = new Set(allowedLeagues.map(l => l.id));
            const favTeams = new Set((State.appConfig.favourit_teams || []).map(t => t.id));
            const favLeagues = new Set((State.appConfig.favourite_leagues || []).map(l => l.id));

            for (const m of liveData) {
                const mid = m.fixture.id;
                const isTracked = monitoredMatches.has(mid);
                const isFav = favTeams.has(m.teams.home.id) || favTeams.has(m.teams.away.id) || favLeagues.has(m.league.id);
                const isAllowed = allowedIds.has(m.league.id);

                if (!isTracked && !isFav && !isAllowed) continue;

                const oldState = matchStates[mid];
                const newScore = `${m.goals.home}-${m.goals.away}`;
                const newStatusShort = m.fixture.status.short;

                const card = document.getElementById(`match-card-${mid}`);
                if (card) {
                    const statusEl = card.querySelector('.match-status');
                    const scoreEls = card.querySelectorAll('.card-score');
                    
                    if (scoreEls.length === 2) {
                        const h = m.goals.home ?? 0;
                        const a = m.goals.away ?? 0;
                        if (scoreEls[0].textContent != h) scoreEls[0].textContent = h;
                        if (scoreEls[1].textContent != a) scoreEls[1].textContent = a;
                    }

                    if (statusEl) {
                        let statusText = m.fixture.status.long;
                        if (['1H','HT','2H','ET','P','BT'].includes(newStatusShort)) {
                            const time = newStatusShort === 'HT' ? 'HT' : (m.fixture.status.elapsed ? `<span class="live-time">${m.fixture.status.elapsed}'</span>` : 'LIVE');
                            if (statusEl.innerHTML !== time) statusEl.innerHTML = time;
                        } else {
                            if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
                        }
                    }
                }

                if (!oldState) {
                    matchStates[mid] = { score: newScore, status: newStatusShort };
                    continue;
                }

                if (oldState.score !== newScore) {
                    let desc = "Goal!";
                    try {
                        const events = await API.fetch(`fixtures/events?fixture=${mid}`);
                        if(events && events.length) {
                            const goals = events.filter(e => e.type === 'Goal');
                            if(goals.length > 0) {
                                const lastGoal = goals[goals.length-1];
                                desc = `Goal by ${lastGoal.player.name}`;
                                if(lastGoal.assist.name) desc += ` (Assist: ${lastGoal.assist.name})`;
                            }
                        }
                    } catch(e) {}

                    showAlert('GOAL!', desc, m, 'goal', !isTracked);
                }
                
                if (newStatusShort !== oldState.status) {
                    if (['FT', 'AET', 'PEN'].includes(newStatusShort)) {
                        const desc = `Finished: ${newScore}`;
                        showAlert('Full Time', desc, m, 'ft', !isTracked);
                        if(isTracked) {
                            monitoredMatches.delete(mid);
                            saveTrackedMatches();
                            if(card) {
                                const dot = card.querySelector('.track-indicator');
                                if(dot) dot.remove();
                            }
                        }
                    }
                }

                matchStates[mid] = { score: newScore, status: newStatusShort };
            }
        } catch(e) { console.warn("Monitor check failed", e); }
    }

    const Views = {
        renderHome: async (container) => {
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'flex';

            const dateStr = Helpers.formatDate(currentDate);
            const displayDate = isLiveMode ? "Live Matches" : (currentDate.toDateString() === new Date().toDateString() ? "Today, " + dateStr : dateStr);
            document.getElementById('date-header').textContent = displayDate;

            const endpoint = isLiveMode ? 'fixtures?live=all' : `fixtures?date=${dateStr}&season=${Helpers.getCurrentSeason()}`;
            
            let matches = null;

            if (matchesCache && lastEndpoint === endpoint) {
                matches = matchesCache;
            } else {
                container.innerHTML = `
                    <div class="skeleton-row"><div class="skeleton-header"><div class="shimmer"></div></div><div class="skeleton-rail"><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div></div></div>
                    <div class="skeleton-row"><div class="skeleton-header"><div class="shimmer"></div></div><div class="skeleton-rail"><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div></div></div>
                `;
                
                try {
                    const settingsPromise = !State.hasLoadedSettings ? initialSettingsPromise : Promise.resolve(State.globalSettings);
                    const matchesPromise = API.fetch(endpoint);
                    const [settings, fetchedMatches] = await Promise.all([settingsPromise, matchesPromise]);
                    
                    if (!State.hasLoadedSettings) { State.globalSettings = settings; State.hasLoadedSettings = true; }
                    
                    matches = fetchedMatches;
                    matchesCache = matches;
                    lastEndpoint = endpoint;

                } catch (e) { container.innerHTML = "Error loading matches."; console.error(e); return; }
            }

            try {
                const favTeams = new Set((State.appConfig.favourit_teams || []).map(t => t.id));
                const favLeagues = new Set((State.appConfig.favourite_leagues || []).map(l => l.id));
                const allowedLeagues = State.globalSettings.allowed_leagues || [];
                const allowedIds = new Set(allowedLeagues.map(l => l.id));
                const hasRestrictions = allowedIds.size > 0;

                const teamFavorites = []; 
                const leagueMatches = []; 

                matches.forEach(m => {
                    const isFavTeam = favTeams.has(m.teams.home.id) || favTeams.has(m.teams.away.id);
                    const isFavLeague = favLeagues.has(m.league.id);
                    const isAllowed = allowedIds.has(m.league.id);

                    if (isFavTeam) {
                        teamFavorites.push(m);
                    } 
                    
                    if (hasRestrictions) {
                        if (isAllowed || isFavLeague) {
                            leagueMatches.push(m);
                        }
                    } else {
                        leagueMatches.push(m);
                    }
                });

                const rows = [];
                if (teamFavorites.length > 0) rows.push({ title: "Favorites", matches: teamFavorites, isSpecial: true });
                
                const liveMatches = [...teamFavorites, ...leagueMatches].filter(m => ['1H','HT','2H','ET','P','BT'].includes(m.fixture.status.short));
                const uniqueLive = Array.from(new Map(liveMatches.map(item => [item.fixture.id, item])).values());
                if (uniqueLive.length > 0) rows.push({ title: "Live Now", matches: uniqueLive, isSpecial: true });

                const leagueGroups = {};
                leagueMatches.forEach(m => {
                    if (!leagueGroups[m.league.id]) leagueGroups[m.league.id] = { ...m.league, matches: [] };
                    leagueGroups[m.league.id].matches.push(m);
                });

                const sortedKeys = Object.keys(leagueGroups).sort((a, b) => {
                    const isA = favLeagues.has(Number(a));
                    const isB = favLeagues.has(Number(b));
                    if (isA && !isB) return -1;
                    if (!isA && isB) return 1;
                    return 0;
                });

                let processedKeys = sortedKeys;
                if (!hasRestrictions && !homePageLoadAllState && processedKeys.length > 5) {
                    processedKeys = sortedKeys.slice(0, 5); 
                }

                const orphanMatches = [];

                processedKeys.forEach(key => {
                    const group = leagueGroups[key];
                    if (favLeagues.has(group.id) || group.matches.length >= 2) {
                        rows.push({ title: group.name, matches: group.matches, logo: group.logo, id: group.id, isSpecial: false });
                    } else {
                        orphanMatches.push(...group.matches);
                    }
                });

                if (orphanMatches.length > 0) {
                    rows.push({ title: "More Matches", matches: orphanMatches, isSpecial: true, isMixed: true });
                }

                if (rows.length === 0) {
                     container.innerHTML = `<div style="padding:4rem; text-align:center; height:60vh; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                            <h2 style="margin-bottom:1rem;">No Matches Found</h2>
                            <button id="btn-reload-empty" class="styled-button focusable" tabindex="0">Reload</button></div>`;
                     document.getElementById('btn-reload-empty').onclick = () => { matchesCache = null; Views.renderHome(container); };
                } else {
                    const htmlParts = [];
                    rows.forEach((row, index) => {
                        const headerHtml = row.isSpecial 
                            ? `<div class="row-header-content focusable" tabindex="0"><span>${row.title}</span></div>`
                            : `<div class="row-header-content clickable focusable" tabindex="0" data-action="open-league" data-id="${row.id}">
                                ${row.logo ? `<img src="${row.logo}" class="row-league-logo">` : ''} <span>${row.title}</span>
                               </div>
                               <div class="fav-toggle focusable ${Helpers.isFav('league', row.id) ? 'active' : ''}" tabindex="0" data-type="league" data-id="${row.id}" data-name="${row.title}">
                                <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                               </div>`;
                        
                        const cardsHtml = row.matches.map(m => Components.card(m, row.isMixed)).join('');
                        htmlParts.push(`<div class="row-section" data-row-index="${index}"><div class="row-header" style="padding-left:0.5rem;">${headerHtml}</div><div class="rail">${cardsHtml}</div></div>`);
                    });
                    
                    if (!hasRestrictions && !homePageLoadAllState && sortedKeys.length > 5) {
                        htmlParts.push(`<div style="text-align:center; padding: 2rem; margin-bottom: 2rem;"><button id="btn-load-all" class="styled-button focusable" tabindex="0">Load All Leagues</button></div>`);
                    }
                    container.innerHTML = htmlParts.join('');
                }
                
                if(document.getElementById('btn-load-all')) {
                    document.getElementById('btn-load-all').onclick = () => { matchesCache = null; homePageLoadAllState = true; Views.renderHome(container); };
                }
                Navigation.scan();
            } catch (e) { container.innerHTML = "Error processing matches."; console.error(e); }
        },

        renderDetails: async (container, id) => {
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'none';

            container.innerHTML = `<div class="page-container"><div class="skeleton-detail-header"><div class="shimmer"></div></div><div class="skeleton-detail-tabs"><div class="shimmer"></div></div><div class="skeleton-detail-list"><div class="shimmer"></div></div></div>`;
            try {
                const [matchData, events, lineups, stats, h2h] = await Promise.all([
                    API.fetch(`fixtures?id=${id}`),
                    API.fetch(`fixtures/events?fixture=${id}`),
                    API.fetch(`fixtures/lineups?fixture=${id}`),
                    API.fetch(`fixtures/statistics?fixture=${id}`),
                    API.fetch(`fixtures/headtohead?h2h=${id}`)
                ]);

                if (!matchData || matchData.length === 0) throw new Error("Match not found");
                const { fixture, teams, goals, league, score } = matchData[0];
                const h2hData = await API.fetch(`fixtures/headtohead?h2h=${teams.home.id}-${teams.away.id}`);

                // --- CHECK IF FINISHED ---
                const isFinished = ['FT', 'AET', 'PEN'].includes(fixture.status.short);

                const tabs = [
                    { id: 'track', label: 'Track', show: !isFinished, isAction: true }, 
                    { id: 'ev', label: 'Events', show: events && events.length > 0 },
                    { id: 'ln', label: 'Lineups', show: lineups && lineups.length >= 2 },
                    { id: 'st', label: 'Stats', show: stats && stats.length >= 2 },
                    { id: 'h2h', label: 'H2H', show: h2hData && h2hData.length > 0 }
                ].filter(t => t.show);

                const activeTabId = tabs.find(t => !t.isAction)?.id || 'ev';
                const tabsHtml = tabs.map(t => {
                    if (t.isAction) return `<button class="tab-button focusable ${monitoredMatches.has(fixture.id) ? 'track-active' : ''}" id="btn-track-toggle" tabindex="0" data-mid="${fixture.id}">Track</button>`;
                    return `<button class="tab-button ${t.id === activeTabId ? 'active' : ''} focusable" data-tab="${t.id}" tabindex="0">${t.label}</button>`;
                }).join('');

                let statusDisplay = fixture.status.long;
                if (['1H','HT','2H','ET','P','BT'].includes(fixture.status.short)) {
                    const time = fixture.status.short === 'HT' ? 'HT' : (fixture.status.elapsed ? `${fixture.status.elapsed}'` : 'LIVE');
                    statusDisplay = `<span class="live-time">${time}</span>`;
                }

                let penaltyDisplay = '';
                if (score.penalty.home !== null && score.penalty.away !== null) {
                    penaltyDisplay = `<div style="font-size:1.2rem; color:#aaa; margin-top:0.5rem;">(Pen: ${score.penalty.home} - ${score.penalty.away})</div>`;
                }

                container.innerHTML = `
                    <div class="page-container">
                        <div class="details-hero" style="align-items:center; text-align:center;">
                            <div class="details-hero-league" style="position:absolute; top:2rem; left:4rem; right:auto; margin:0;">
                                <img src="${league.logo}"> <span>${league.name}</span>
                            </div>
                            <div class="details-hero-content" style="justify-content:center; padding:0;">
                                <div class="details-team">
                                    <img src="${teams.home.logo}">
                                    <h2>${teams.home.name}</h2>
                                </div>
                                <div class="details-score-box">
                                    <div class="details-score">${goals.home??0} - ${goals.away??0}</div>
                                    ${penaltyDisplay}
                                    <div class="details-status">${statusDisplay}</div>
                                </div>
                                <div class="details-team">
                                    <img src="${teams.away.logo}">
                                    <h2>${teams.away.name}</h2>
                                </div>
                            </div>
                        </div>
                        <div class="tabs">${tabsHtml}</div>
                        <div id="ev" class="tab-content ${activeTabId === 'ev' ? 'active' : ''}">${Components.renderEvents(events, teams.home.id)}</div>
                        <div id="ln" class="tab-content ${activeTabId === 'ln' ? 'active' : ''}">${Components.renderLineups(lineups)}</div>
                        <div id="st" class="tab-content ${activeTabId === 'st' ? 'active' : ''}">${Components.renderStats(stats)}</div>
                        <div id="h2h" class="tab-content ${activeTabId === 'h2h' ? 'active' : ''}">${Components.renderH2H(h2hData)}</div>
                    </div>
                `;
                Navigation.scan();
            } catch(e) { container.innerHTML = `<div class="error-message">Error: ${e.message}</div>`; }
        },

        renderLeaguePage: async (container, id) => {
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'none';

            container.innerHTML = `<div class="page-container"><div class="skeleton-detail-header"><div class="shimmer"></div></div><div class="skeleton-detail-tabs"><div class="shimmer"></div></div><div class="skeleton-detail-list"><div class="shimmer"></div></div></div>`;
            try {
                const season = Helpers.getCurrentSeason();
                const [standingsData, fixtures] = await Promise.all([
                    API.fetch(`standings?league=${id}&season=${season}`),
                    API.fetch(`fixtures?league=${id}&season=${season}`)
                ]);
                const league = standingsData[0]?.league || fixtures[0]?.league;
                if(!league) throw new Error("League unavailable");
                const standings = standingsData[0]?.league?.standings || [];
                const tabs = [
                    { id: 'l-std', label: 'Standings', show: standings && standings.length > 0 },
                    { id: 'l-mat', label: 'Matches', show: fixtures && fixtures.length > 0 }
                ].filter(t => t.show);
                const activeTabId = tabs.length > 0 ? tabs[0].id : null;
                const tabsHtml = tabs.map(t => `<button class="tab-button ${t.id === activeTabId ? 'active' : ''} focusable" data-tab="${t.id}" tabindex="0">${t.label}</button>`).join('');
                
                container.innerHTML = `
                    <div class="page-container">
                        <div class="details-hero" style="align-items:center; justify-content:center;">
                            <img src="${league.logo}" style="height:100px; margin-bottom:1rem;">
                            <h1 style="margin:0; font-size:2.5em;">${league.name}</h1>
                            <span class="fav-toggle focusable ${Helpers.isFav('league', league.id) ? 'active' : ''}" tabindex="0" data-type="league" data-id="${league.id}" data-name="${league.name}" style="margin-top:1rem;">
                                <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                            </span>
                        </div>
                        <div class="tabs">${tabsHtml}</div>
                        <div id="l-std" class="tab-content ${activeTabId === 'l-std' ? 'active' : ''}">
                             <div class="scrollable-content focusable" tabindex="0">${Components.renderStandings(standings)}</div>
                        </div>
                        <div id="l-mat" class="tab-content ${activeTabId === 'l-mat' ? 'active' : ''}">
                             <div class="scrollable-content focusable" tabindex="0">
                                <div class="matches-container" style="display:flex; flex-wrap:wrap; gap:1rem; justify-content:center;">
                                    ${fixtures.slice(0, 50).map(f => Components.card(f)).join('')}
                                </div>
                             </div>
                        </div>
                    </div>`;
                Navigation.scan();
            } catch(e) { container.innerHTML = `<div class="error-message">Error: ${e.message}</div>`; }
        }
    };

    const Components = {
        card: (m, showBadge = false) => {
            const isActuallyLive = ['1H','HT','2H','ET','P','BT'].includes(m.fixture.status.short);
            let statusText = m.fixture.status.long;
            
            if (isActuallyLive) {
                if (m.fixture.status.short === 'HT') statusText = 'HT';
                else if (m.fixture.status.elapsed) statusText = `<span class="live-time">${m.fixture.status.elapsed}'</span>`;
                else statusText = 'LIVE';
            } else if (m.fixture.status.short === 'NS') {
                const matchDate = new Date(m.fixture.date);
                const isToday = matchDate.toDateString() === new Date().toDateString();
                const timeStr = matchDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                statusText = isToday ? timeStr : `${matchDate.getMonth()+1}/${matchDate.getDate()} ${timeStr}`;
            }

            const homeScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.home ?? 0);
            const awayScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.away ?? 0);
            const badgeHtml = showBadge ? `<div class="card-league-badge"><img src="${m.league.logo}"><span>${m.league.name}</span></div>` : '';
            
            const trackIndicator = monitoredMatches.has(m.fixture.id) ? `<div class="track-indicator"></div>` : '';

            let penIndicator = '';
            if (m.score.penalty.home !== null && m.score.penalty.away !== null) {
                penIndicator = `<div style="font-size:0.8em; color:#aaa;">(P: ${m.score.penalty.home}-${m.score.penalty.away})</div>`;
            }

            return `
            <div id="match-card-${m.fixture.id}" class="match-card focusable ${isActuallyLive?'is-live':''}" tabindex="0" data-action="open-match" data-id="${m.fixture.id}">
                ${trackIndicator}
                ${badgeHtml}
                <div class="match-status">${statusText}</div>
                <div class="card-teams">
                    <div class="card-team"><div class="card-team-info"><img src="${m.teams.home.logo}"><span>${m.teams.home.name}</span></div><span class="card-score">${homeScore}</span></div>
                    <div class="card-team"><div class="card-team-info"><img src="${m.teams.away.logo}"><span>${m.teams.away.name}</span></div><span class="card-score">${awayScore}</span></div>
                </div>
                ${penIndicator}
            </div>`;
        },
        renderEvents: (events, homeId) => {
            if(!events || !events.length) return '<div class="scrollable-content focusable" tabindex="0">No events available.</div>';
            return `<div class="scrollable-content focusable" tabindex="0"><div class="events-list">${events.map(e => {
                const isHome = e.team.id === homeId;
                const icon = e.type==='Goal'?'⚽':(e.type==='Card'? (e.detail==='Yellow Card'?'🟨':'🟥') : '•');
                return `<div style="display:flex; padding:0.8rem; border-bottom:1px solid #333; ${isHome?'':'flex-direction:row-reverse; text-align:right;'}"><div style="font-weight:bold; width:40px;">${e.time.elapsed}'</div><div style="flex-grow:1;">${icon} ${e.player.name} <small style="color:#888">${e.detail||''}</small></div></div>`;
            }).join('')}</div></div>`;
        },
        renderLineups: (l) => (!l||l.length<2)?'<div class="scrollable-content focusable" tabindex="0">No Lineups.</div>':`<div class="scrollable-content focusable" tabindex="0"><div style="display:flex; gap:2rem; justify-content:center;"><div><h3>${l[0].team.name}</h3>${l[0].startXI.map(p=>`<div>${p.player.number}. ${p.player.name}</div>`).join('')}</div><div><h3>${l[1].team.name}</h3>${l[1].startXI.map(p=>`<div>${p.player.number}. ${p.player.name}</div>`).join('')}</div></div></div>`,
        renderStats: (s) => (!s||s.length<2)?'<div class="scrollable-content focusable" tabindex="0">No Stats.</div>':`<div class="scrollable-content focusable" tabindex="0"><div style="max-width:600px; margin:0 auto;">${s[0].statistics.map((stat,i) => `<div style="display:flex; justify-content:space-between; padding:0.5rem; border-bottom:1px solid #333;"><span style="font-weight:bold">${stat.value??0}</span><span style="color:#aaa">${stat.type}</span><span style="font-weight:bold">${s[1].statistics[i].value??0}</span></div>`).join('')}</div></div>`,
        renderH2H: (h) => (!h||h.length===0)?'<div class="scrollable-content focusable" tabindex="0">No Data.</div>':`<div class="scrollable-content focusable" tabindex="0"><div style="display:flex; flex-wrap:wrap; gap:1.5rem; justify-content:center;">${h.map(m=>Components.card(m)).join('')}</div></div>`,
        renderStandings: (s) => (!s||!s.length)?'<p>No Standings.</p>':`<table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>Pts</th></tr></thead><tbody>${s[0].map(t=>`<tr><td>${t.rank}</td><td><img src="${t.team.logo}" width="20"> ${t.team.name}</td><td>${t.all.played}</td><td><b>${t.points}</b></td></tr>`).join('')}</tbody></table>`
    };

    function setupDelegatedEvents(container) {
        container.addEventListener('click', async (e) => {
            const target = e.target;

            const tabBtn = target.closest('.tab-button');
            if (tabBtn) {
                if (tabBtn.id === 'btn-track-toggle') {
                     const mid = Number(tabBtn.dataset.mid);
                     if (monitoredMatches.has(mid)) monitoredMatches.delete(mid);
                     else monitoredMatches.add(mid);
                     saveTrackedMatches();
                     
                     if (monitoredMatches.has(mid)) tabBtn.classList.add('track-active');
                     else tabBtn.classList.remove('track-active');
                } else {
                    const parent = tabBtn.closest('.page-container');
                    if (parent) {
                        parent.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                        parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        tabBtn.classList.add('active');
                        const content = parent.querySelector('#'+tabBtn.dataset.tab);
                        if(content) content.classList.add('active');
                    }
                }
                return;
            }

            const card = target.closest('.match-card');
            if (card) {
                const action = card.dataset.action;
                const id = card.dataset.id;
                if (action === 'open-match' && id) {
                    Router.go('match', id);
                }
                return;
            }

            const leagueHeader = target.closest('.row-header-content');
            if (leagueHeader) {
                const action = leagueHeader.dataset.action;
                const id = leagueHeader.dataset.id;
                if (action === 'open-league' && id) {
                    Router.go('league', id);
                }
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
                const type = favBtn.dataset.type; 
                const id = Number(favBtn.dataset.id); 
                const name = favBtn.dataset.name || 'Unknown';
                const cfg = State.appConfig;
                const arr = type === 'team' ? (cfg.favourit_teams || []) : (cfg.favourite_leagues || []);
                if (!cfg.favourit_teams) cfg.favourit_teams = []; if (!cfg.favourite_leagues) cfg.favourite_leagues = [];
                const idx = arr.findIndex(x => x.id === id);
                
                if(idx > -1) { 
                    arr.splice(idx, 1); 
                    favBtn.classList.remove('active');
                } else { 
                    arr.push({id, name: name}); 
                    favBtn.classList.add('active');
                }
                
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
        if(authEmail) authEmail.value = "imad@gmail.com";
        if(authPass) authPass.value = "198922";
        
        document.addEventListener('nav-back', () => {
            Router.back();
        });

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
            if (Router.current.name === 'home') {
                 const content = document.querySelector('#content-container .focusable');
                 if(content) Navigation.focus(content);
            } else {
                 Router.go('home'); 
            }
        };

        const updateDate = () => {
            document.getElementById('modal-current-date').textContent = Helpers.formatDate(currentDate);
            Router.go('home'); 
        };

        document.getElementById('btn-prev-day').onclick = () => { currentDate.setDate(currentDate.getDate()-1); 
            matchesCache = null; updateDate(); };
        document.getElementById('btn-next-day').onclick = () => { currentDate.setDate(currentDate.getDate()+1); 
            matchesCache = null; updateDate(); };
        document.getElementById('btn-live-toggle').onclick = () => { isLiveMode = !isLiveMode; 
            matchesCache = null; updateDate(); };

        document.querySelectorAll('.modal-close').forEach(b => b.onclick = closeModal);

        const authErr = document.getElementById('auth-error');
        let isLogin = true;

        document.getElementById('btn-toggle-mode').onclick = () => {
            isLogin = !isLogin;
            document.getElementById('auth-title').textContent = isLogin ? "Sign In" : "Register";
            document.getElementById('btn-auth-submit').textContent = isLogin ? "Sign In" : "Sign Up";
            document.getElementById('btn-toggle-mode').textContent = isLogin ? "Create Account" : "Back to Login";
        };

        document.getElementById('btn-auth-submit').onclick = async () => {
            authErr.textContent = "";
            try {
                if(isLogin) await auth.signInWithEmailAndPassword(authEmail.value, authPass.value);
                else await auth.createUserWithEmailAndPassword(authEmail.value, authPass.value);
                closeModal();
            } catch(e) { authErr.textContent = e.message; }
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
            } else {
                if (avatar) avatar.remove();
            }

            if(user) {
                document.getElementById('auth-form').style.display='none';
                document.getElementById('auth-logged-in').style.display='block';
                const cfg = await Storage.loadUserConfig(user.uid);
                if(cfg) { State.appConfig = cfg; }
            } else {
                document.getElementById('auth-form').style.display='block';
                document.getElementById('auth-logged-in').style.display='none';
            }
        });

        document.addEventListener('keydown', (e) => {
            const key = Navigation.normalizeKey(e);

            if (key === 'ChannelUp') { 
                e.preventDefault(); 
                currentDate.setDate(currentDate.getDate()+1); 
                matchesCache = null; 
                updateDate(); 
                return; 
            }
            if (key === 'ChannelDown') { 
                e.preventDefault(); 
                currentDate.setDate(currentDate.getDate()-1); 
                matchesCache = null; 
                updateDate(); 
                return; 
            }
            if (key === 'MediaPlayPause') { 
                 e.preventDefault();
                 const current = document.activeElement;
                 if (current.classList.contains('row-header-content')) { const toggle = current.parentElement.querySelector('.fav-toggle'); if(toggle) toggle.click(); }
                 else if (current.classList.contains('fav-toggle')) { current.click(); }
                 return;
            }
            if (key === 'Guide') {
                e.preventDefault();
                const current = document.activeElement;
                if (current.classList.contains('match-card') && current.dataset.id) {
                    const mid = parseInt(current.dataset.id);
                    if (mid) {
                        // Check match status from cache or current view logic
                        let canTrack = true;
                        if (matchesCache) {
                            const m = matchesCache.find(x => x.fixture.id === mid);
                            if (m) {
                                // Only allow tracking if Live or Not Started
                                const s = m.fixture.status.short;
                                if (['FT', 'AET', 'PEN'].includes(s)) canTrack = false;
                            }
                        }
                        
                        if (canTrack) {
                            if (monitoredMatches.has(mid)) monitoredMatches.delete(mid);
                            else monitoredMatches.add(mid);
                            
                            const hasIndicator = current.querySelector('.track-indicator');
                            if(hasIndicator) hasIndicator.remove();
                            else {
                                const dot = document.createElement('div');
                                dot.className = 'track-indicator';
                                current.appendChild(dot);
                            }
                            saveTrackedMatches();
                        } else {
                            console.log("Match finished, cannot track");
                        }
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

        Router.render();
        updateClock();
        setInterval(() => {
            updateClock();
        }, 60000);
    });
})();