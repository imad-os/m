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
    let currentLeagueStats = { scorers: [], assists: [] }; 
    let currentTab = null;
    let currentMatchId = null;
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
            console.log("Router render:", this.current);
            currentMatchId = null;
            const container = document.getElementById('content-container');
            if (this.current.name === 'home') Views.renderHome(container);
            else if (this.current.name === 'match') Views.renderDetails(container, this.current.params);
            else if (this.current.name === 'league') Views.renderLeaguePage(container, this.current.params);
        }
    };
    function formTimeString(status) {
        const extra = status.extra ? `+${status.extra}` : '';
        return `${status.elapsed}${extra}'`;
        
    }
    function updateClock(){
        const now = new Date();
        const clock = document.getElementById('clock');
        if(clock) clock.textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    
    function saveTrackedMatches() {
        localStorage.setItem('tracked_matches', JSON.stringify([...monitoredMatches]));
    }

    const workerBlob = new Blob([`
        self.onmessage = function(e) {
            if (e.data === 'start') { setInterval(() => postMessage('tick'), 30000); }
        };
    `], { type: 'application/javascript' });
    const timerWorker = new Worker(URL.createObjectURL(workerBlob));
    timerWorker.onmessage = () => { checkLiveMatches(); };
    timerWorker.postMessage('start');

    function playSound(type) {
        try {
            const audio = sounds[type];
            if (!audio) return;
            audio.pause(); audio.currentTime = 0; audio.volume = 0.5;
            const playPromise = audio.play();
            if (playPromise) playPromise.catch(err => console.warn('Audio play failed:', err));
        } catch (e) { console.error('Sound Error:', e); }
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
    function removeTrackedMatch(mid,cards=null) {
        if (monitoredMatches.has(mid)) {
            monitoredMatches.delete(mid);
            saveTrackedMatches();
            const _cards = cards || document.querySelectorAll(`#match-card-${mid}`);
            if(_cards && _cards.length) {
                for (const card of cards) {
                    const dot = card.querySelector('.track-indicator'); if(dot) dot.remove(); 
                }
            }
        }
    }
    function showAlert(title, desc, matchData, type, isSilent = false) {
        if (!isSilent) playSound(type);
        if (document.hidden) return; 

        const alertEl = document.getElementById('live-alert');
        if (!alertEl) return;

        const homeScore = matchData.goals.home ?? 0;
        const awayScore = matchData.goals.away ?? 0;
        
        alertEl.innerHTML = `
            <div class="alert-header"><span class="alert-event-type">${title}</span><span class="alert-time">${formTimeString(matchData.fixture.status)}'</span></div>
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
        alertEl.onclick = () => { Router.go('match', matchData.fixture.id); closeAlert(); };
        setTimeout(closeAlert, 10000);
    }

    async function checkLiveMatches() {
        try {
            const liveData = await API.fetch('fixtures?live=all');
            
            // ERROR CHECK: If API handled error and returned null
            if (liveData === null) return;

            const allowedLeagues = State.globalSettings.allowed_leagues || [];
            const allowedIds = new Set(allowedLeagues.map(l => l.id));
            const favTeams = new Set((State.appConfig.favourit_teams || []).map(t => t.id));
            const favLeagues = new Set((State.appConfig.favourite_leagues || []).map(l => l.id));

            for (const m of liveData) {
                const mid = m.fixture.id;
                const isTracked = monitoredMatches.has(mid);
                const isFav = favTeams.has(m.teams.home.id) || favTeams.has(m.teams.away.id) || favLeagues.has(m.league.id);
                const isAllowed = allowedIds.has(m.league.id);
                const isCurrentMatch = (currentMatchId === mid);


                const oldState = matchStates[mid];
                const newScore = `${m.goals.home}-${m.goals.away}`;
                const newStatusShort = m.fixture.status.short;
                const cards = document.querySelectorAll(`#match-card-${mid}`);

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
                                const time = newStatusShort === 'HT' ? 'HT' : (m.fixture.status.elapsed ? `<span class="live-time">${formTimeString(m.fixture.status)}</span>` : 'LIVE');
                                if (statusEl.innerHTML !== time) statusEl.innerHTML = time;
                            } else if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
                        }
                    }
                }

                if (!isTracked && !isFav && !isAllowed && !isCurrentMatch) continue;

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
                            const time = newStatusShort === 'HT' ? 'HT' : (m.fixture.status.elapsed ? `<span class="live-time">${formTimeString(m.fixture.status)}</span>` : 'LIVE');
                            if (statusEl.innerHTML !== time) statusEl.innerHTML = time;
                        } else if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
                    }
                }

                if (!oldState) { matchStates[mid] = { score: newScore, status: newStatusShort }; continue; }

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
                        if(isTracked) {
                            removeTrackedMatch(mid, cards);
                        }
                    }
                }
                matchStates[mid] = { score: newScore, status: newStatusShort };
            }
        } catch(e) { console.warn("Monitor check failed", e); }
    }

    const Views = {
        renderHome: async (container) => {
            console.log("Rendering Home View");
            currentMatchId = null;
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'flex';

            const dateStr = Helpers.formatDate(currentDate);
            const displayDate = isLiveMode ? "Live Matches" : (currentDate.toDateString() === new Date().toDateString() ? "Today, " + dateStr : dateStr);
            document.getElementById('date-header').textContent = displayDate;

            const endpoint = isLiveMode ? 'fixtures?live=all' : `fixtures?date=${dateStr}&season=${Helpers.getCurrentSeason()}`;
            
            let matches = null;
            if (matchesCache && lastEndpoint === endpoint) matches = matchesCache;
            else {
                container.innerHTML = `<div class="skeleton-row"><div class="skeleton-header"><div class="shimmer"></div></div><div class="skeleton-rail"><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div></div></div>`;
                try {
                    const settingsPromise = !State.hasLoadedSettings ? initialSettingsPromise : Promise.resolve(State.globalSettings);
                    const matchesPromise = API.fetch(endpoint);
                    const [settings, fetchedMatches] = await Promise.all([settingsPromise, matchesPromise]);
                    
                    // --- ERROR HANDLING START ---
                    // Check if fetchedMatches is null (meaning API.fetch handled an error display)
                    console.log("Fetched Matches:", fetchedMatches);
                    if (fetchedMatches === null) {
                        return; // Stop rendering; page error is already visible
                    }
                    // --- ERROR HANDLING END ---

                    if (!State.hasLoadedSettings) { State.globalSettings = settings; State.hasLoadedSettings = true; }
                    matches = fetchedMatches; matchesCache = matches; lastEndpoint = endpoint;
                } catch (e) { 
                    // Fallback catch if Promise.all itself fails strangely
                    container.innerHTML = "Error loading matches."; console.error(e); return; 
                }
            }

            try {
                const favTeams = new Set((State.appConfig.favourit_teams || []).map(t => t.id));
                const favLeagues = new Set((State.appConfig.favourite_leagues || []).map(l => l.id));
                const allowedLeagues = State.globalSettings.allowed_leagues || [];
                const allowedIds = new Set(allowedLeagues.map(l => l.id));
                const hasRestrictions = allowedIds.size > 0;
                const teamFavorites = []; const leagueMatches = []; 

                matches.forEach(m => {
                    const isFavTeam = favTeams.has(m.teams.home.id) || favTeams.has(m.teams.away.id);
                    const isFavLeague = favLeagues.has(m.league.id);
                    const isAllowed = allowedIds.has(m.league.id);
                    if (isFavTeam) teamFavorites.push(m);
                    if (hasRestrictions) { if (isAllowed || isFavLeague) leagueMatches.push(m); } 
                    else leagueMatches.push(m);
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
                    const isA = favLeagues.has(Number(a)); const isB = favLeagues.has(Number(b));
                    if (isA && !isB) return -1; if (!isA && isB) return 1; return 0;
                });

                let processedKeys = sortedKeys;
                if (!hasRestrictions && !homePageLoadAllState && processedKeys.length > 5) processedKeys = sortedKeys.slice(0, 5);

                const orphanMatches = [];
                processedKeys.forEach(key => {
                    const group = leagueGroups[key];
                    if (favLeagues.has(group.id) || group.matches.length >= 2) rows.push({ title: group.name, matches: group.matches, logo: group.logo, id: group.id, isSpecial: false });
                    else orphanMatches.push(...group.matches);
                });

                if (orphanMatches.length > 0) rows.push({ title: "More Matches", matches: orphanMatches, isSpecial: true, isMixed: true });

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
                    if (!hasRestrictions && !homePageLoadAllState && sortedKeys.length > 5) htmlParts.push(`<div style="text-align:center; padding: 2rem; margin-bottom: 2rem;"><button id="btn-load-all" class="styled-button focusable" tabindex="0">Load All Leagues</button></div>`);
                    container.innerHTML = htmlParts.join('');
                }
                if(document.getElementById('btn-load-all')) document.getElementById('btn-load-all').onclick = () => { matchesCache = null; homePageLoadAllState = true; Views.renderHome(container); };
                Navigation.scan();
            } catch (e) { container.innerHTML = "Error processing matches."; console.error(e); }
        },

        renderDetails: async (container, id) => {
            currentMatchId = parseInt(id) || null;
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'none';

            container.innerHTML = `<div class="page-container"><div class="skeleton-detail-header"><div class="shimmer"></div></div><div class="skeleton-detail-tabs"><div class="shimmer"></div></div><div class="skeleton-detail-list"><div class="shimmer"></div></div></div>`;
            try {
                // ADDED: Fetch player stats to get ratings
                // Note: If one of these fails, API.fetch catches it and returns null.
                const results = await Promise.all([
                    API.fetch(`fixtures?id=${id}`),
                    API.fetch(`fixtures/events?fixture=${id}`),
                    API.fetch(`fixtures/lineups?fixture=${id}`),
                    API.fetch(`fixtures/statistics?fixture=${id}`),
                    API.fetch(`predictions?fixture=${id}`),
                    API.fetch(`fixtures/players?fixture=${id}`) 
                ]);

                // --- ERROR HANDLING ---
                // If any critical fetch failed (e.g. matchData), it returned null.
                // We check results[0] (matchData) as the critical path.
                if (results[0] === null) return; 

                const [matchData, events, lineups, stats, predictions, playerStats] = results;

                if (!matchData || matchData.length === 0) throw new Error("Match not found");
                const { fixture, teams, goals, league, score } = matchData[0];
                
                // H2H Fetch (nested because it depends on team IDs)
                const h2hData = await API.fetch(`fixtures/headtohead?h2h=${teams.home.id}-${teams.away.id}`);
                // H2H is non-critical, so we can tolerate failure, but if API.fetch triggered page error, we stop?
                // Actually h2hData will be null if error. That's fine for the H2H tab content.

                const isFinished = ['FT', 'AET', 'PEN'].includes(fixture.status.short);
                const isNotStarted = ['NS', 'TBD'].includes(fixture.status.short);

                // Build tabs, potentially putting predictions first if NS
                let tabs = [];
                
                // Track tab
                if (!isFinished) tabs.push({ id: 'track', label: 'Track', show: true, isAction: true });

                // Predictions logic
                const hasPred = predictions && predictions.length > 0;
                
                // If NS, push predictions first (if available)
                if (isNotStarted && hasPred) {
                    tabs.push({ id: 'pred', label: 'Predictions', show: true });
                }

                tabs.push({ id: 'ev', label: 'Events', show: events && events.length > 0 });
                tabs.push({ id: 'ln', label: 'Lineups', show: lineups && lineups.length >= 2 });
                tabs.push({ id: 'st', label: 'Stats', show: stats && stats.length >= 2 });
                tabs.push({ id: 'h2h', label: 'H2H', show: h2hData && h2hData.length > 0 });

                // If NOT NS but data exists, push predictions last or wherever suited
                if (!isNotStarted && hasPred) {
                    tabs.push({ id: 'pred', label: 'Predictions', show: true });
                }

                tabs = tabs.filter(t => t.show);

                let activeTabId = tabs.find(t => !t.isAction)?.id;
                if (isNotStarted && hasPred) activeTabId = 'pred';
                else if (events && events.length > 0) activeTabId = 'ev'; // Default fallback

                const tabsHtml = tabs.map(t => {
                    if (t.isAction) return `<button class="tab-button focusable ${monitoredMatches.has(fixture.id) ? 'track-active' : ''}" id="btn-track-toggle" tabindex="0" data-mid="${fixture.id}">Track</button>`;
                    return `<button class="tab-button ${t.id === activeTabId ? 'active' : ''} focusable" data-tab="${t.id}" tabindex="0">${t.label}</button>`;
                }).join('');

                let statusDisplay = fixture.status.long;
                if (['1H','HT','2H','ET','P','BT'].includes(fixture.status.short)) {
                    const time = fixture.status.short === 'HT' ? 'HT' : (fixture.status.elapsed ? `${formTimeString(fixture.status)}` : 'LIVE');
                    statusDisplay = `<span class="live-time">${time}</span>`;
                }

                let penaltyDisplay = '';
                if (score.penalty.home !== null && score.penalty.away !== null) penaltyDisplay = `<div style="font-size:1.2rem; color:#aaa; margin-top:0.5rem;">(Pen: ${score.penalty.home} - ${score.penalty.away})</div>`;
                const venue = fixture.venue.city ? `${fixture.venue.city}, ${fixture.venue.name}` : fixture?.venue?.name;
                container.innerHTML = `
                    <div class="page-container">
                        <div class="details-hero" style="align-items:center; text-align:center;">
                            <div class="details-hero-league" style="position:absolute; top:1rem; left:4rem; right:auto; margin:0;">
                                <img src="${league.logo}"> <span>${league.name}</span>
                            </div>
                            <div class="details-hero-content" style="justify-content:center; padding:0;">
                                <div class="details-team"><img src="${teams.home.logo}"><h2>${teams.home.name}</h2></div>
                                <div class="details-score-box">
                                    <div class="details-score">${goals.home?? "-"} - ${goals.away?? "-"}</div>
                                    ${penaltyDisplay}
                                    <div class="details-status">${statusDisplay}</div>
                                </div>
                                <div class="details-team"><img src="${teams.away.logo}"><h2>${teams.away.name}</h2></div>
                            </div>
                            <div class="venue">${venue}</div>
                        </div>
                        <div class="tabs">${tabsHtml}</div>
                        <div id="pred" class="tab-content ${activeTabId === 'pred' ? 'active' : ''}">${hasPred ? Components.renderPredictions(predictions[0]) : ''}</div>
                        <div id="ev" class="tab-content ${activeTabId === 'ev' ? 'active' : ''}">${Components.renderEvents(events, teams.home.id)}</div>
                        <div id="ln" class="tab-content ${activeTabId === 'ln' ? 'active' : ''}">${Components.renderLineups(lineups, playerStats)}</div>
                        <div id="st" class="tab-content ${activeTabId === 'st' ? 'active' : ''}">${Components.renderStats(stats)}</div>
                        <div id="h2h" class="tab-content ${activeTabId === 'h2h' ? 'active' : ''}">${Components.renderH2H(h2hData, teams.home, teams.away)}</div>
                    </div>
                `;
                Navigation.scan();
            } catch(e) { 
                // Fallback for non-fetch errors
                container.innerHTML = `<div class="error-message">Error: ${e.message}</div>`; 
                console.error(e);
            }
        },

        renderLeaguePage: async (container, id) => {
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'none';

            container.innerHTML = `<div class="page-container"><div class="skeleton-detail-header"><div class="shimmer"></div></div><div class="skeleton-detail-tabs"><div class="shimmer"></div></div><div class="skeleton-detail-list"><div class="shimmer"></div></div></div>`;
            try {
                const season = Helpers.getCurrentSeason();
                const results = await Promise.all([
                    API.fetch(`standings?league=${id}&season=${season}`),
                    API.fetch(`fixtures?league=${id}&season=${season}`),
                    API.fetch(`players/topscorers?league=${id}&season=${season}`),
                    API.fetch(`players/topassists?league=${id}&season=${season}`)
                ]);
                
                // --- ERROR HANDLING ---
                // If the primary data (standings or fixtures) is null, abort.
                // It's possible for scorers to fail while standings work, but API.fetch shows a toast and returns null.
                // If it was a critical page load, it likely triggered the Page Error.
                // We check if results contain any nulls, which might break destructuring if we aren't careful?
                // Actually destructuring works on arrays of nulls.
                // But we should check if *all* are null or if critical ones are.
                if (results[0] === null && results[1] === null) return; 

                const [standingsData, fixtures, scorers, assists] = results;
                
                const league = standingsData?.[0]?.league || fixtures?.[0]?.league || scorers?.[0]?.statistics?.[0]?.league;
                if(!league) throw new Error("League unavailable");
                
                currentLeagueStats = { scorers: scorers || [], assists: assists || [] };
                const standings = standingsData?.[0]?.league?.standings || [];
                
                // Identify Knockout Matches from Fixtures
                // We look for round names that indicate knockouts
                const knockoutKeywords = ['Round of 16', '8th Finals', 'Quarter-finals', 'Semi-finals', 'Final'];
                const knockoutMatches = fixtures ? fixtures.filter(f => {
                    const r = f.league.round || '';
                    return knockoutKeywords.some(k => r.includes(k));
                }) : [];

                const tabs = [
                    { id: 'l-std', label: 'Standings', show: standings && standings.length > 0 },
                    { id: 'l-ko', label: 'Knockout Stage', show: knockoutMatches.length > 0 }, // NEW BUTTON
                    { id: 'l-mat', label: 'Matches', show: fixtures && fixtures.length > 0 },
                    { id: 'l-scr', label: 'Top Scorers', show: scorers && scorers.length > 0 },
                    { id: 'l-ast', label: 'Top Assists', show: assists && assists.length > 0 }
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
                        <div id="l-std" class="tab-content ${activeTabId === 'l-std' ? 'active' : ''}">${Components.renderStandings(standings)}</div>
                        <div id="l-ko" class="tab-content ${activeTabId === 'l-ko' ? 'active' : ''}">${Components.renderKnockout(knockoutMatches)}</div>
                        <div id="l-mat" class="tab-content ${activeTabId === 'l-mat' ? 'active' : ''}">
                             <div class="scrollable-content focusable" tabindex="0">
                                <div class="matches-container" style="display:flex; flex-wrap:wrap; gap:1rem; justify-content:center;">
                                    ${fixtures ? fixtures.slice(0, 50).map(f => Components.card(f)).join('') : 'No Matches'}
                                </div>
                             </div>
                        </div>
                        <div id="l-scr" class="tab-content ${activeTabId === 'l-scr' ? 'active' : ''}">${Components.renderPlayerStats(scorers, 'goals')}</div>
                        <div id="l-ast" class="tab-content ${activeTabId === 'l-ast' ? 'active' : ''}">${Components.renderPlayerStats(assists, 'assists')}</div>
                    </div>`;
                Navigation.scan();
            } catch(e) { 
                container.innerHTML = `<div class="error-message">Error: ${e.message}</div>`; 
                console.error(e);
            }
        }
    };

    const Components = {
        card: (m, showBadge = false) => {
            const isActuallyLive = ['1H','HT','2H','ET','P','BT'].includes(m.fixture.status.short);
            let statusText = m.fixture.status.long;

            const matchDate = new Date(m.fixture.date);
            const isToday = matchDate.toDateString() === new Date().toDateString();
            const timeStr = matchDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

            if (isActuallyLive) {
                if (m.fixture.status.short === 'HT') statusText = 'HT';
                else if (m.fixture.status.elapsed) statusText = `<span class="live-time">${formTimeString(m.fixture.status)}</span>`;
                else statusText = 'LIVE';
            } else if (m.fixture.status.short === 'NS') {
                statusText = isToday ? timeStr : `${matchDate.getMonth()+1}/${matchDate.getDate()} ${timeStr}`;
            } else if (['FT', 'AET', 'PEN'].includes(m.fixture.status.short)) {
                statusText = isToday ? timeStr : `${matchDate.getFullYear()}/${matchDate.getMonth()+1}/${matchDate.getDate()}`;
            }

            const homeScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.home ?? 0);
            const awayScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.away ?? 0);
            const badgeHtml = showBadge ? `<div class="card-league-badge"><img src="${m.league.logo}"><span>${m.league.name}</span></div>` : '';
            
            const trackIndicator = monitoredMatches.has(m.fixture.id) ? `<div class="track-indicator"></div>` : '';
            let penIndicator = '';
            if (m.score.penalty.home !== null && m.score.penalty.away !== null) penIndicator = `<div style="font-size:0.8em; color:#aaa;">(P: ${m.score.penalty.home}-${m.score.penalty.away})</div>`;

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

        // NEW: Knockout Bracket Renderer
        renderKnockout: (matches) => {
            if (!matches || matches.length === 0) return '<div class="scrollable-content focusable" tabindex="0">No Knockout Stage available.</div>';

            // Group by Round
            const groups = {};
            matches.forEach(m => {
                const r = m.league.round;
                if (!groups[r]) groups[r] = [];
                groups[r].push(m);
            });

            // Order: Round of 16 -> Quarter -> Semi -> Final
            const roundOrder = ['Round of 16', '8th Finals', 'Quarter-finals', 'Semi-finals', 'Final'];
            
            // Sort keys based on known order
            const sortedKeys = Object.keys(groups).sort((a, b) => {
                const idxA = roundOrder.findIndex(key => a.includes(key));
                const idxB = roundOrder.findIndex(key => b.includes(key));
                // If not found, put at end
                const va = idxA === -1 ? 99 : idxA;
                const vb = idxB === -1 ? 99 : idxB;
                return va - vb;
            });

            let html = `<div class="scrollable-content focusable" tabindex="0" style="display:flex; flex-direction:column;">
                          <div class="bracket-container">`;

            sortedKeys.forEach(roundName => {
                // Filter matches in this round that are actual matches (avoid dupes if any)
                const roundsMatches = groups[roundName];
                
                html += `<div class="bracket-round">
                            <div class="bracket-round-title">${roundName.replace('Regular Season - ', '')}</div>`;
                
                roundsMatches.forEach(m => {
                   const hScore = m.goals.home ?? '-';
                   const aScore = m.goals.away ?? '-';
                   const date = new Date(m.fixture.date).toLocaleDateString();
                   const hClass = (m.goals.home > m.goals.away) ? 'bracket-winner' : '';
                   const aClass = (m.goals.away > m.goals.home) ? 'bracket-winner' : '';

                   html += `<div class="bracket-match focusable" tabindex="0" data-action="open-match" data-id="${m.fixture.id}">
                                <div class="bracket-match-date">${date}</div>
                                <div class="bracket-team">
                                    <div class="bracket-team-info"><img src="${m.teams.home.logo}"><span>${m.teams.home.name}</span></div>
                                    <span class="bracket-score ${hClass}">${hScore}</span>
                                </div>
                                <div class="bracket-team">
                                    <div class="bracket-team-info"><img src="${m.teams.away.logo}"><span>${m.teams.away.name}</span></div>
                                    <span class="bracket-score ${aClass}">${aScore}</span>
                                </div>
                            </div>`; 
                });

                html += `</div>`; // Close column
            });

            html += `</div></div>`;
            return html;
        },
        
        // NEW: Centralized Bar Renderer for Stats & Predictions
        renderStatBar: (label, homeValRaw, awayValRaw, isPercent = false) => {
             const cleanVal = (v) => {
                 if (typeof v === 'string') return parseFloat(v.replace('%','')) || 0;
                 return parseFloat(v) || 0;
             };

             const hNum = cleanVal(homeValRaw);
             const aNum = cleanVal(awayValRaw);
             const total = hNum + aNum;
             
             // Calculate percentages for bar widths
             let hPct, aPct;
             if (isPercent) {
                 hPct = hNum;
                 aPct = aNum;
             } else {
                 if (total === 0) { hPct = 0; aPct = 0; }
                 else {
                     hPct = (hNum / total) * 100;
                     aPct = (aNum / total) * 100;
                 }
             }

             // Visual Logic: If one side dominates, ensure bar shows at least a sliver
             if(hPct > 0 && hPct < 10) hPct = 10;
             if(aPct > 0 && aPct < 10) aPct = 10;
             
             return `
             <div class="stat-row">
                <div class="stat-val home">${homeValRaw}</div>
                <div class="stat-bar-wrapper">
                    <div class="stat-bar-home" style="width:${hPct}%"></div>
                    <div class="stat-bar-away" style="width:${aPct}%"></div>
                    <div class="stat-label-overlay">${label}</div>
                </div>
                <div class="stat-val away">${awayValRaw}</div>
             </div>
             `;
        },

        renderPredictions: (data) => {
            if (!data) return '<div class="scrollable-content focusable" tabindex="0">No predictions available.</div>';
            
            const { predictions, comparison } = data;
            
            // Clean up advice text
            let advice = predictions.advice || 'No advice available.';
            advice = advice.replace(/Combo Double chance : /i, ''); 
            
            const winner = predictions.winner ? `${predictions.winner.name} (${predictions.winner.comment || ''})` : '-';
            const winOrDraw = predictions.win_or_draw ? 'Yes' : 'No';
            const underOver = predictions.under_over || '-';
            
            let html = `<div class="scrollable-content focusable" tabindex="0" style="padding: 1rem 2rem 3rem;">`;

            if (comparison) {
                html += `<h3 style="margin-bottom:1rem; text-align:center;">Head-to-Head Comparison</h3>`;
                html += `<div style="max-width:800px; margin:0 auto;">`;
                html += Components.renderStatBar('Total', comparison.total.home, comparison.total.away, true);
                html += Components.renderStatBar('Form', comparison.form.home, comparison.form.away, true);
                html += Components.renderStatBar('Attacking', comparison.att.home, comparison.att.away, true);
                html += Components.renderStatBar('Defending', comparison.def.home, comparison.def.away, true);
                html += Components.renderStatBar('H2H', comparison.h2h.home, comparison.h2h.away, true);
                html += Components.renderStatBar('Goals', comparison.goals.home, comparison.goals.away, true);
                html += Components.renderStatBar('Poisson Dist.', comparison.poisson_distribution.home, comparison.poisson_distribution.away, true);
                html += `</div>`;
            }

            html += `
                <div style="background:#222; padding:1rem; border-radius:8px; border:1px solid #333; margin-bottom:1.5rem; text-align:center;">
                    <div style="font-size:1.3em; font-weight:bold; margin-bottom:0.5rem; color:var(--bg-focus);">${advice}</div>
                    <div style="display:flex; justify-content:space-around; margin-top:1rem; flex-wrap:wrap; gap:0.5rem;">
                        <div class="pred-stat-box">
                            <span class="pred-stat-label">Winner</span>
                            <span class="pred-stat-val">${winner || '-'}</span>
                        </div>
                        <div class="pred-stat-box">
                            <span class="pred-stat-label">Win/Draw</span>
                            <span class="pred-stat-val">${winOrDraw}</span>
                        </div>
                        <div class="pred-stat-box">
                            <span class="pred-stat-label">Goals</span>
                            <span class="pred-stat-val">${underOver}</span>
                        </div>
                    </div>
                </div>
            `;

            html += `</div>`;
            return html;
        },
        
        // REWRITTEN: New Timeline Event Renderer
        renderEvents: (events, homeId) => {
            if(!events || !events.length) return '<div class="scrollable-content focusable" tabindex="0">No events available.</div>';
            
            // Build the timeline HTML
            const timelineHtml = events.map(e => {
                const isHome = e.team.id === homeId;
                const type = e.type.toLowerCase(); // goal, card, subst, var
                const detail = e.detail || '';
                
                // Determine styling and icon based on event type
                let icon = '•';
                let importanceClass = 'normal';
                let divclass1 = 'event-player';
                let divclass2 = 'event-subtext';
                let assistText = 'Asst: ';
                if (type === 'goal') { 
                    icon = '⚽'; 
                    importanceClass = 'high'; 
                } else if (type === 'card') { 
                    icon = detail.includes('Red') ? '🟥' : '🟨'; 
                    importanceClass = 'medium';
                } else if (type === 'subst') { 
                    icon = '🔄'; 
                    importanceClass = 'low'; 
                    divclass1 = 'subst-out';
                    divclass2 = 'subst-in';
                    assistText= '';
                } else if (type === 'var') { 
                    icon = '📺'; 
                    importanceClass = 'low'; 
                }

                // Inner content of the event bubble
                const contentHtml = `
                    <div class="event-box ${importanceClass}">
                        <div class="event-icon">${icon}</div>
                        <div class="event-info">
                            <div class="${divclass1}">${e.player.name}</div>
                            ${e.assist.name ? `<div class="${divclass2}">${assistText}${e.assist.name}</div>` : ''}
                            ${detail && type !== 'goal' ? `<div class="event-subtext">${detail}</div>` : ''}
                        </div>
                    </div>
                `;

                return `
                <div class="timeline-row">
                    <div class="timeline-side home">${isHome ? contentHtml : ''}</div>
                    <div class="timeline-center">
                        <div class="timeline-time">${e.time.elapsed}'${e.time.extra ? `+${e.time.extra}` : ''}</div>
                        <div class="timeline-dot"></div>
                    </div>
                    <div class="timeline-side away">${!isHome ? contentHtml : ''}</div>
                </div>`;
            }).join('');

            return `<div class="scrollable-content focusable" tabindex="0">
                        <div class="timeline-container">
                            <div class="timeline-vertical-line"></div>
                            ${timelineHtml}
                        </div>
                    </div>`;
        },
        
        // UPDATED: Now resilient to missing Grid info
        renderLineups: (l, playerStats) => {
            if(!l || l.length < 2) return '<div class="scrollable-content focusable" tabindex="0">No Lineups.</div>';
            let BestPlayer = null;
            // Map ratings if available
            const ratingsMap = {};
            if (playerStats && playerStats.length) {
                playerStats.forEach(teamGroup => {
                    if(teamGroup.players) {
                        teamGroup.players.forEach(p => {
                            if(p.statistics && p.statistics[0] && p.statistics[0].games.rating) {
                                ratingsMap[p.player.id] = p.statistics[0].games.rating;
                                BestPlayer = !BestPlayer || parseFloat(p.statistics[0].games.rating) > parseFloat(ratingsMap[BestPlayer]) ? p.player.id : BestPlayer;
                            }
                        });
                    }
                });
            }

            const getRating = (playerId) => ratingsMap[playerId] || null;

            // CHECK: Do we have enough grid info to show the pitch?
            // We check if at least 7 players in starting XI have grid data.
            const countGrid = (xi) => xi.filter(x => x.player && x.player.grid).length;
            const usePitch = countGrid(l[0].startXI) > 7 && countGrid(l[1].startXI) > 7;

            // HELPER: Render a single row for List View (XI fallback or Subs)
            const renderListRow = (p) => {
                if (!p) return '';
                const rating = getRating(p.id);
                const rHtml = rating ? `<span class="sub-rating ${parseFloat(rating)>=7?'high':'mid'}">${rating}</span>` : '';
                return `
                <div class="sub-row">
                    <span class="sub-num">${p.number || '-'}</span>
                    <span style="flex-grow:1; text-align:left; padding-left:1rem;">${p.name}</span>
                    ${rHtml}
                </div>`;
            };

            let mainContent = '';

            if (usePitch) {
                // --- PITCH MODE ---
                const createDot = (player, isHome) => {
                    const teamData = isHome ? l[0].team : l[1].team;
                    const colors = player.pos === 'G' ? teamData?.colors?.goalkeeper : teamData?.colors?.player;
                    const bgColor = colors && colors.primary ? '#' + colors.primary : (isHome ? '#e50914' : '#fff');
                    const numColor = colors && colors.number ? '#' + colors.number : (isHome ? '#fff' : '#000');
                    const borderColor = colors && colors.border ? '#' + colors.border : '#000';
                    
                    return {
                        name: player.name,
                        number: player.number,
                        id: player.id,
                        grid: player.grid,
                        bg: bgColor,
                        fg: numColor,
                        br: borderColor,
                        rating: getRating(player.id)
                    };
                };
                
                const processTeam = (teamIndex) => {
                    const xi = l[teamIndex].startXI.map(x => x.player);
                    const isHome = teamIndex === 0;
                    const rows = {};
                    xi.forEach(p => {
                        if(!p || !p.grid) return;
                        const parts = p.grid.split(':');
                        if (parts.length < 2) return;
                        const r = parts[0];
                        if(!rows[r]) rows[r] = [];
                        rows[r].push(p);
                    });
                    
                    Object.keys(rows).forEach(r => {
                        rows[r].sort((a,b) => {
                            const ga = a.grid ? parseInt(a.grid.split(':')[1]) : 0;
                            const gb = b.grid ? parseInt(b.grid.split(':')[1]) : 0;
                            return ga - gb;
                        });
                    });
                    
                    return xi.map(p => {
                        if(!p || !p.grid) return {}; 
                        let data = createDot(p, isHome);
                        let style = '';
                        if (p.grid) {
                            const parts = p.grid.split(':');
                            const r = parseInt(parts[0]);
                            const rowPlayers = rows[r];
                            if (!rowPlayers) return {}; 

                            const idx = rowPlayers.indexOf(p);
                            const count = rowPlayers.length;
                            const seg = 100 / (count + 1);
                            const topPct = seg * (idx + 1);
                            
                            let leftPct;
                            if (isHome) {
                                leftPct = 5 + ((r-1) * 10); 
                            } else {
                                leftPct = 95 - ((r-1) * 10);
                            }
                            style = `left:${leftPct}%; top:${topPct}%;`;
                        }
                        return { ...data, style };
                    });
                };

                const homePlayers = processTeam(0);
                const awayPlayers = processTeam(1);
                const bestPlayerStar = '<use href="#icon-star" xlink:href="#icon-star"></use></div>';
                const renderRatingBadge = (p) => {
                    if(!p?.rating) return '';
                    const rVal = parseFloat(p.rating);
                    let colorClass = 'low';
                    switch (true) {
                        case (rVal >= 9.0):
                            colorClass = 'super';
                            break;
                        case (rVal >= 8.0):
                            colorClass = 'high';
                            break;
                        case (rVal >= 7.0):
                            colorClass = 'good';
                            break;
                        case (rVal >= 6.0):
                            colorClass = 'mid';
                            break;
                        default:
                            colorClass = 'low';
                    }
                    //return `<div class="player-rating-badge ${colorClass}">${p.rating} ${p.id===BestPlayer?bestPlayerStar:''}`;
                    return `<div class="player-rating-badge ${colorClass}">${p.rating}</div>`;
                };

                const renderDot = (p) => {
                    if (!p.style) return '';
                    return `
                    <div class="pitch-player" style="${p.style}">
                        <div class="player-dot" style="background:${p.bg}; color:${p.fg}; border-color:${p.br}">${p.number}</div>
                        ${renderRatingBadge(p)}
                        <div class="player-name">${p.name.split(' ').pop()}</div>
                    </div>`;
                };
                const home_formation = l[0].formation || '';
                const away_formation = l[1].formation || '';
                mainContent = `
                    <div class="soccer-pitch">
                        <div class="pitch-fomation home">${home_formation}</div>
                        <div class="pitch-fomation away">${away_formation}</div>
                        <div class="pitch-line pitch-center-line"></div>
                        <div class="pitch-line pitch-center-circle"></div>
                        <div class="pitch-line pitch-penalty-area-left"></div>
                        <div class="pitch-line pitch-penalty-area-right"></div>
                        
                        ${homePlayers.map(renderDot).join('')}
                        ${awayPlayers.map(renderDot).join('')}
                    </div>`;
            } else {
                // --- LIST MODE (Fallback) ---
                // Renders Starting XI as simple lists
                mainContent = `
                    <div class="subs-container" style="border-top:none; margin-top:0; padding-top:0;">
                        <div class="subs-team">
                            <h4 style="margin-bottom:0.5rem; color:#fff; border-bottom:1px solid #333; padding-bottom:0.5rem;">${l[0].team.name} XI</h4>
                            ${l[0].startXI.map(s => renderListRow(s.player)).join('')}
                        </div>
                        <div class="subs-team">
                            <h4 style="margin-bottom:0.5rem; color:#fff; border-bottom:1px solid #333; padding-bottom:0.5rem;">${l[1].team.name} XI</h4>
                            ${l[1].startXI.map(s => renderListRow(s.player)).join('')}
                        </div>
                    </div>
                `;
            }

            // Always render Subs below
            const renderSubsList = (teamIdx) => l[teamIdx].substitutes.map(s => renderListRow(s.player)).join('');

            return `
                <div class="scrollable-content focusable" tabindex="0">
                    ${mainContent}
                    
                    <div class="subs-container">
                        <div class="subs-team">
                            <h4>${l[0].team.name} Subs</h4>
                            ${renderSubsList(0)}
                        </div>
                        <div class="subs-team">
                            <h4>${l[1].team.name} Subs</h4>
                            ${renderSubsList(1)}
                        </div>
                    </div>
                </div>
            `;
        },

        // UPDATED: Now uses the centralized bar renderer
        renderStats: (s) => {
            if(!s||s.length<2) return '<div class="scrollable-content focusable" tabindex="0">No Stats.</div>';
            
            // s[0] is home, s[1] is away
            const homeStats = s[0].statistics;
            const awayStats = s[1].statistics;
            
            let html = `<div class="scrollable-content focusable" tabindex="0" style="padding: 1rem 2rem 3rem;">
                <div style="max-width:800px; margin:0 auto;">`;
            
            homeStats.forEach((stat, i) => {
                // Find matching stat in away array (usually same index, but safer to match type)
                // Note: API-Football usually guarantees order, but raw index is risky if filtered.
                // Assuming standard array alignment for simplicity as per original code.
                const hVal = stat.value ?? 0;
                const aVal = awayStats[i].value ?? 0;
                const type = stat.type;
                
                html += Components.renderStatBar(type, hVal, aVal);
            });

            html += `</div></div>`;
            return html;
        },
        
        renderH2H: (h, teamHome, teamAway) => {
            if(!h||h.length===0) return '<div class="scrollable-content focusable" tabindex="0">No Data.</div>';
            
            let homeWins = 0;
            let awayWins = 0;
            let draws = 0;
            
            h.forEach(m => {
                if (m.goals.home === null || m.goals.away === null) return; // Skip if no score
                const hGoal = m.goals.home ?? 0;
                const aGoal = m.goals.away ?? 0;
                if (hGoal === aGoal) {
                    draws++;
                } else {
                    const winnerId = hGoal > aGoal ? m.teams.home.id : m.teams.away.id;
                    if (winnerId === teamHome.id) homeWins++;
                    else if (winnerId === teamAway.id) awayWins++;
                }
            });

            return `
                <div class="scrollable-content focusable" tabindex="0">
                    <div style="display:flex; align-items:center; justify-content:center; gap:1.5rem; background:#222; padding:0.8rem; border-radius:8px; margin-bottom:1rem; border:1px solid #333;">
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <img src="${teamHome.logo}" style="width:35px; height:35px; object-fit:contain;">
                            <span style="font-size:1.2em; font-weight:bold; color:#4cd964">${homeWins} Wins</span>
                        </div>
                        <div style="font-size:1.2em; font-weight:bold; color:#aaa; padding:0 1rem; border-left:1px solid #444; border-right:1px solid #444;">${draws} Draws</div>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <span style="font-size:1.2em; font-weight:bold; color:#e50914">${awayWins} Wins</span>
                            <img src="${teamAway.logo}" style="width:35px; height:35px; object-fit:contain;">
                        </div>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:1.5rem; justify-content:center;">
                        ${h.map(m=>Components.card(m)).join('')}
                    </div>
                </div>`;
        },
        
        renderStandings: (s) => {
            if (!s || !s.length) return '<div class="scrollable-content focusable" tabindex="0">No Standings Available.</div>';
            
            let html = '<div class="scrollable-content focusable" tabindex="0" style="padding-bottom: 2rem;">';
            s.forEach(group => {
                if (s.length > 1) html += `<h3 style="margin-top: 1rem; color: var(--bg-focus); padding-left: 0.5rem;">${group[0].group}</h3>`;
                html += `<table class="standings-table">
                    <thead><tr><th style="width:10%">#</th><th style="text-align:left">Team</th><th style="width:10%">P</th><th style="width:10%">W</th><th style="width:10%">D</th><th style="width:10%">L</th><th style="width:10%">GD</th><th style="width:10%">Pts</th></tr></thead>
                    <tbody>${group.map(t => `<tr><td>${t.rank}</td><td style="text-align:left; display:flex; align-items:center; gap:0.5rem;"><img src="${t.team.logo}" style="width:50px; height:50px; object-fit:contain;">${t.team.name}</td><td>${t.all.played}</td><td>${t.all.win}</td><td>${t.all.draw}</td><td>${t.all.lose}</td><td>${t.goalsDiff}</td><td><b>${t.points}</b></td></tr>`).join('')}</tbody>
                </table>`;
            });
            html += '</div>'; return html;
        },

        renderPlayerStats: (data, type) => {
            if (!data || !data.length) return '<div class="scrollable-content focusable" tabindex="0">No Player Stats Available.</div>';
            const posMap = { "Goalkeeper": "GK", "Defender": "DF", "Midfielder": "MF", "Attacker": "FW" };
            const mainStat = type === 'goals' ? 'Goals' : 'Assists';
            return `<div class="scrollable-content focusable" tabindex="0" style="padding-bottom: 2rem;">
                <table class="standings-table player-stats-table" data-type="${type}">
                    <thead><tr><th>#</th><th style="text-align:left">Player</th><th class="focusable clickable sort-header" tabindex="0" data-sort="pos">Pos</th><th class="focusable clickable sort-header" tabindex="0" data-sort="app">App</th><th class="focusable clickable sort-header" tabindex="0" data-sort="rating">Rate</th><th class="focusable clickable sort-header" tabindex="0" data-sort="shots">Shots (On)</th><th class="focusable clickable sort-header" tabindex="0" data-sort="main">${mainStat}</th></tr></thead>
                    <tbody>${data.map((item, index) => {
                        const p = item?.player; const s = item.statistics[0];
                        const pos = posMap[s?.games?.position] || s?.games?.position?.substring(0,3);
                        const rating = s.games.rating ? parseFloat(s.games.rating).toFixed(1) : '-';
                        const shots = s.shots.total === null ? '-' : `${s.shots.on}/${s.shots.total}`;
                        const mainVal = type === 'goals' ? (s.goals.total||0) : (s.goals.assists||0);
                        
                        // NEW: Extract Nationality (first 3 chars)
                        const natStr = p.nationality ? p.nationality.substring(0,3).toUpperCase() : '';

                        return `<tr><td>${index + 1}</td><td style="text-align:left; display:flex; align-items:center; gap:10px;"><div style="position:relative; width:60px; height:50px; margin-right:10px;"><img src="${s.team.logo}" style="position:absolute; left:0; bottom:0; width:30px; height:30px; object-fit:contain; z-index:2; background:#111; border-radius:50%;"><img src="${p.photo}" style="position:absolute; right:0; top:0; width:50px; height:50px; object-fit:cover; border-radius:50%; border:1px solid #333;"><div class="player-nat-badge">${natStr}</div></div><div style="line-height:1.2"><div style="font-weight:bold;">${p.name}</div><div style="font-size:0.8em; color:#aaa;">${s.team.name}</div></div></td><td>${pos}</td><td>${s.games.appearences||0}</td><td style="color:${rating>=7.0?'var(--live-color)':(rating<6.0?'#f55':'#fff')}">${rating}</td><td>${shots}</td><td style="font-weight:bold; font-size:1.2em; color:var(--bg-focus);">${mainVal}</td></tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`;
        }
    };

    function setupDelegatedEvents(container) {
        container.addEventListener('click', async (e) => {
            const target = e.target;
            const sortHeader = target.closest('.sort-header');
            if (sortHeader) {
                const table = sortHeader.closest('table');
                const type = table.dataset.type;
                const sortKey = sortHeader.dataset.sort;
                let data = type === 'goals' ? [...currentLeagueStats.scorers] : [...currentLeagueStats.assists];
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
                     if (monitoredMatches.has(mid)) monitoredMatches.delete(mid); else monitoredMatches.add(mid);
                     saveTrackedMatches();
                     if (monitoredMatches.has(mid)) tabBtn.classList.add('track-active'); else tabBtn.classList.remove('track-active');
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
                            if (contentId === 'ln' && currentTab==='ln') {
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
                        currentTab = target.dataset.tab || null;
                    }
                }
                return;
            }
            
            // Handle both match-card and bracket-match
            const card = target.closest('.match-card, .bracket-match');
            if (card) {
                const action = card.dataset.action; const id = card.dataset.id;
                if (action === 'open-match' && id) Router.go('match', id);
                return;
            }

            const leagueHeader = target.closest('.row-header-content');
            if (leagueHeader) {
                const action = leagueHeader.dataset.action; const id = leagueHeader.dataset.id;
                if (action === 'open-league' && id) Router.go('league', id);
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
        if(authEmail) authEmail.value = "imad@gmail.com";
        if(authPass) authPass.value = "198922";
        
        document.addEventListener('nav-back', () => { Router.back(); });

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
            if (Router.current.name === 'home') { const content = document.querySelector('#content-container .focusable'); if(content) Navigation.focus(content); } 
            else Router.go('home'); 
        };

        const updateDate = () => { document.getElementById('modal-current-date').textContent = Helpers.formatDate(currentDate); Router.go('home'); };
        document.getElementById('btn-prev-day').onclick = () => { currentDate.setDate(currentDate.getDate()-1); matchesCache = null; updateDate(); };
        document.getElementById('btn-next-day').onclick = () => { currentDate.setDate(currentDate.getDate()+1); matchesCache = null; updateDate(); };
        document.getElementById('btn-live-toggle').onclick = () => { isLiveMode = !isLiveMode; matchesCache = null; updateDate(); };
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
                if (!avatar) { avatar = document.createElement('div'); avatar.id = 'user-avatar-badge'; avatar.className = 'user-avatar-badge'; if (logo) logo.parentNode.insertBefore(avatar, logo.nextSibling); else sidebar.prepend(avatar); }
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

        if (key === 'ChannelUp') { e.preventDefault(); currentDate.setDate(currentDate.getDate()+1); matchesCache = null; updateDate(); return; }
            if (key === 'ChannelDown') { e.preventDefault(); currentDate.setDate(currentDate.getDate()-1); matchesCache = null; updateDate(); return; }
            if (key === 'MediaPlayPause') { e.preventDefault(); const current = document.activeElement; if (current.classList.contains('row-header-content')) { const toggle = current.parentElement.querySelector('.fav-toggle'); if(toggle) toggle.click(); } else if (current.classList.contains('fav-toggle')) { current.click(); } return; }
            if (key === 'Guide') {
                e.preventDefault(); const current = document.activeElement;
                if (current.classList.contains('match-card') && current.dataset.id) {
                    const mid = parseInt(current.dataset.id);
                    if (mid) {
                        let canTrack = true;
                        if (matchesCache) { const m = matchesCache.find(x => x.fixture.id === mid); if (m && ['FT', 'AET', 'PEN'].includes(m.fixture.status.short)) canTrack = false; }
                        if (canTrack) {
                            if (monitoredMatches.has(mid)) monitoredMatches.delete(mid); else monitoredMatches.add(mid);
                            const hasIndicator = current.querySelector('.track-indicator'); if(hasIndicator) hasIndicator.remove(); else { const dot = document.createElement('div'); dot.className = 'track-indicator'; current.appendChild(dot); }
                            saveTrackedMatches();
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

        Router.render();
        updateClock();
        setInterval(() => { updateClock(); }, 60000);
    });
})();