"use strict";

(function() {
    const { State, API, Helpers } = window.AppServices;
    const Components = window.AppComponents;
    const Utils = window.Utils;

    window.AppViews = {
        renderHome: async (container) => {
            console.log("Rendering Home View");
            window.AppState.currentMatchId = null;
            window.AppState.currentTab = null;
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'flex';

            const dateStr = Helpers.formatDate(window.AppState.currentDate);
            const displayDate = window.AppState.isLiveMode ? "Live Matches" : (window.AppState.currentDate.toDateString() === new Date().toDateString() ? "Today, " + dateStr : dateStr);
            document.getElementById('date-header').textContent = displayDate;

            const endpoint = window.AppState.isLiveMode ? 'fixtures?live=all' : `fixtures?date=${dateStr}&season=${Helpers.getCurrentSeason()}`;
            window.AppState.renderedMatches = [];
            let matches = null;
            if (window.AppState.matchesCache && window.AppState.lastEndpoint === endpoint) matches = window.AppState.matchesCache;
            else {
                container.innerHTML = `<div class="skeleton-row"><div class="skeleton-header"><div class="shimmer"></div></div><div class="skeleton-rail"><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div><div class="skeleton-card"><div class="shimmer"></div></div></div></div>`;
                try {
                    const settingsPromise = !State.hasLoadedSettings ? window.AppServices.Storage.loadGlobalSettings() : Promise.resolve(State.globalSettings);
                    const matchesPromise = API.fetch(endpoint);
                    const [settings, fetchedMatches] = await Promise.all([settingsPromise, matchesPromise]);
                    
                    if (fetchedMatches === null) return; 

                    if (!State.hasLoadedSettings) { State.globalSettings = settings; State.hasLoadedSettings = true; }
                    matches = fetchedMatches; 
                    window.AppState.matchesCache = matches; 
                    window.AppState.lastEndpoint = endpoint;
                } catch (e) { 
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
                if (!hasRestrictions && !window.AppState.homePageLoadAllState && processedKeys.length > 5) processedKeys = sortedKeys.slice(0, 5);

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
                     document.getElementById('btn-reload-empty').onclick = () => { window.AppState.matchesCache = null; window.AppViews.renderHome(container); };
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
                        const cardsHtml = row.matches.map(m => {
                            window.AppState.renderedMatches.push(m);
                            return Components.card(m, row.isMixed);
                        }).join('');
                        htmlParts.push(`<div class="row-section" data-row-index="${index}"><div class="row-header" style="padding-left:0.5rem;">${headerHtml}</div><div class="rail">${cardsHtml}</div></div>`);
                    });
                    if (!hasRestrictions && !window.AppState.homePageLoadAllState && sortedKeys.length > 5) htmlParts.push(`<div style="text-align:center; padding: 2rem; margin-bottom: 2rem;"><button id="btn-load-all" class="styled-button focusable" tabindex="0">Load All Leagues</button></div>`);
                    container.innerHTML = htmlParts.join('');
                }
                if(document.getElementById('btn-load-all')) document.getElementById('btn-load-all').onclick = () => { window.AppState.matchesCache = null; window.AppState.homePageLoadAllState = true; window.AppViews.renderHome(container); };
                Navigation.scan();
            } catch (e) { container.innerHTML = "Error processing matches."; console.error(e); }
        },

        renderDetails: async (container, id) => {
            window.AppState.currentMatchId = parseInt(id) || null;
            window.AppState.currentTab = null;
            const dateHeader = document.getElementById('date-header-wrapper');
            if (dateHeader) dateHeader.style.display = 'none';

            container.innerHTML = `<div class="page-container"><div class="skeleton-detail-header"><div class="shimmer"></div></div><div class="skeleton-detail-tabs"><div class="shimmer"></div></div><div class="skeleton-detail-list"><div class="shimmer"></div></div></div>`;
            try {
                const results = await Promise.all([
                    API.fetch(`fixtures?id=${id}`),
                    API.fetch(`fixtures/events?fixture=${id}`),
                    API.fetch(`fixtures/lineups?fixture=${id}`),
                    API.fetch(`fixtures/statistics?fixture=${id}`),
                    API.fetch(`predictions?fixture=${id}`),
                    API.fetch(`fixtures/players?fixture=${id}`) 
                ]);

                if (results[0] === null) return; 

                const [matchData, events, lineups, stats, predictions, playerStats] = results;

                if (!matchData || matchData.length === 0) throw new Error("Match not found");
                const { fixture, teams, goals, league, score } = matchData[0];
                
                const h2hData = await API.fetch(`fixtures/headtohead?h2h=${teams.home.id}-${teams.away.id}`);
                const isFinished = ['FT', 'AET', 'PEN'].includes(fixture.status.short);
                const isNotStarted = ['NS', 'TBD'].includes(fixture.status.short);

                let tabs = [];
                if (!isFinished) tabs.push({ id: 'track', label: 'Track', show: true, isAction: true });

                const hasPred = predictions && predictions.length > 0;
                if (isNotStarted && hasPred) tabs.push({ id: 'pred', label: 'Predictions', show: true });
                tabs.push({ id: 'ev', label: 'Events', show: events && events.length > 0 });
                tabs.push({ id: 'ln', label: 'Lineups', show: lineups && lineups.length >= 2 });
                tabs.push({ id: 'st', label: 'Stats', show: stats && stats.length >= 2 });
                tabs.push({ id: 'h2h', label: 'H2H', show: h2hData && h2hData.length > 0 });
                if (!isNotStarted && hasPred) tabs.push({ id: 'pred', label: 'Predictions', show: true });
                
                tabs = tabs.filter(t => t.show);
                let activeTabId = tabs.find(t => !t.isAction)?.id;
                if (isNotStarted && hasPred) activeTabId = 'pred';
                else if (events && events.length > 0) activeTabId = 'ev';
                
                const tabsHtml = tabs.map(t => {
                    if (t.isAction) return `<button class="tab-button focusable ${Utils.isTracked(fixture.id) ? 'track-active' : ''}" id="btn-track-toggle" tabindex="0" data-mid="${fixture.id}">Track</button>`;
                    return `<button class="tab-button ${t.id === activeTabId ? 'active' : ''} focusable" data-tab="${t.id}" tabindex="0">${t.label}</button>`;
                }).join('');

                let statusDisplay = fixture.status.long;
                let datestr = Utils.fullDate(fixture.date);
                if (['1H','HT','2H','ET','P','BT'].includes(fixture.status.short)) {
                    const time = fixture.status.short === 'HT' ? 'HT' : (fixture.status.elapsed ? `${Utils.formTimeString(fixture.status)}` : 'LIVE');
                    statusDisplay = `<span class="live-time">${time}</span>`;
                }

                let penaltyDisplay = '';
                if (score.penalty.home !== null && score.penalty.away !== null) penaltyDisplay = `<div style="font-size:1.2rem; color:#aaa; margin-top:0.5rem;">(Pen: ${score.penalty.home} - ${score.penalty.away})</div>`;
                const venue = fixture.venue.city ? `${fixture.venue.city}, ${fixture.venue.name}` : fixture?.venue?.name;
                container.innerHTML = `
                    <div class="page-container">
                        <div class="details-hero" style="align-items:center; text-align:center;">
                            <div class="details-hero-league"><img src="${league.logo}"> <span>${league.name}</span></div>
                            <div class="details-hero-content" style="justify-content:center; padding:0;">
                                <div class="details-team"><img src="${teams.home.logo}"><h2>${teams.home.name}</h2></div>
                                <div class="details-score-box">
                                    <div class="details-score">${goals.home?? "-"} - ${goals.away?? "-"}</div>
                                    ${penaltyDisplay}
                                    <div class="details-status">${statusDisplay}</div>
                                    <div class="details-date">${datestr}</div>
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
                    </div>`;
                Navigation.scan();
            } catch(e) { 
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
                
                if (results[0] === null && results[1] === null) return; 

                const [standingsData, fixtures, scorers, assists] = results;
                const league = standingsData?.[0]?.league || fixtures?.[0]?.league || scorers?.[0]?.statistics?.[0]?.league;
                if(!league) throw new Error("League unavailable");
                
                window.AppState.currentLeagueStats = { scorers: scorers || [], assists: assists || [] };
                const standings = standingsData?.[0]?.league?.standings || [];
                
                const knockoutKeywords = ['Round of 16', '8th Finals', 'Quarter-finals', 'Semi-finals', 'Final'];
                const knockoutMatches = fixtures ? fixtures.filter(f => {
                    const r = f.league.round || '';
                    return knockoutKeywords.some(k => r.includes(k));
                }) : [];
                const favBtn= `
                <span class="fav-toggle focusable ${Helpers.isFav('league', league.id) ? 'active' : ''}" tabindex="0" data-type="league" data-id="${league.id}" data-name="${league.name}">
                    <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                </span>`;
                const tabs = [
                    { id: 'l-std', label: 'Standings', show: standings && standings.length > 0 },
                    { id: 'l-ko', label: 'Knockout Stage', show: knockoutMatches.length > 0 },
                    { id: 'l-mat', label: 'Matches', show: fixtures && fixtures.length > 0 },
                    { id: 'l-scr', label: 'Top Scorers', show: scorers && scorers.length > 0 },
                    { id: 'l-ast', label: 'Top Assists', show: assists && assists.length > 0 },
                ].filter(t => t.show);
                
                const activeTabId = tabs.length > 0 ? tabs[0].id : null;
                const tabsHtml = tabs.map(t => `<button class="tab-button ${t.id === activeTabId ? 'active' : ''} focusable" data-tab="${t.id}" tabindex="0">${t.label}</button>`).join('');
                
                container.innerHTML = `
                    <div class="page-container">
                        <div class="details-hero" style="align-items:center; justify-content:center;">
                            <img src="${league.logo}" style="height:100px; margin-bottom:1rem;">
                            <h1 style="margin:0; font-size:2.5em;">${league.name}</h1>
                        </div>
                        <div class="tabs">${tabsHtml} ${favBtn}</div>
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

    window.AppRouter = {
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
            window.AppState.currentMatchId = null;
            window.AppState.currentTab = null;
            const container = document.getElementById('content-container');
            if (this.current.name === 'home') window.AppViews.renderHome(container);
            else if (this.current.name === 'match') window.AppViews.renderDetails(container, this.current.params);
            else if (this.current.name === 'league') window.AppViews.renderLeaguePage(container, this.current.params);
        }
    };
})();