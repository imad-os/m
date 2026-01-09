"use strict";

window.AppComponents = (function() {
    const Utils = window.Utils;
    const STAT_ORDER = [
"Total",
"Ball Possession",
"H2H",
"Attacking",
"Defending",
"expected_goals",
"goals_prevented",
"Fouls",
"Corner Kicks",
"Form",
"Goals",
"Poisson Dist.",
"Shots on Goal",
"Shots off Goal",
"Total Shots",
"Blocked Shots",
"Shots insidebox",
"Shots outsidebox",
"Offsides",
"Yellow Cards",
"Red Cards",
"Goalkeeper Saves",
"Total passes",
"Passes accurate",
"Passes %",
    ];
    const STAT_GROUPS = {
        "General": ["Ball Possession", "Fouls", "Corner Kicks", "Offsides"],
        "Expected Performance": ["expected_goals", "goals_prevented"],
        "Shooting": ["Total Shots", "Shots on Goal", "Shots off Goal", "Blocked Shots", "Shots insidebox", "Shots outsidebox"],
        "Discipline": ["Yellow Cards", "Red Cards"],
        "Defense": ["Goalkeeper Saves"],
        "Passing": ["Total passes", "Passes accurate", "Passes %"],
        "Advanced Analytics": ["Total", "H2H", "Attacking", "Defending", "Form", "Poisson Dist."]
    };
    // Helper to check if a match is tracked in the global state

    function card(m, showBadge = false) {
        const isActuallyLive = ['1H','HT','2H','ET','P','BT'].includes(m.fixture.status.short);
        let statusText = m.fixture.status.long;

        const matchDate = new Date(m.fixture.date);
        const isToday = matchDate.toDateString() === new Date().toDateString();
        const timeStr = matchDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const homeFav = State.appConfig.favourit_teams.filter(t=>t.id==m.teams.home.id).length? "favorite" :"";
        const awayFav = State.appConfig.favourit_teams.filter(t=>t.id==m.teams.away.id).length? "favorite" :"";
        if (isActuallyLive) {
            if (m.fixture.status.short === 'HT') statusText = `<span class="live-time">Half Time</span>`;
            else if (m.fixture.status.elapsed) statusText = `<span class="live-time">${Utils.formTimeString(m.fixture.status)}</span>`;
            else statusText = 'LIVE';
        } else if (m.fixture.status.short === 'NS') {
            statusText = isToday ? timeStr : `${matchDate.getMonth()+1}/${matchDate.getDate()} ${timeStr}`;
        } else if (['FT', 'AET', 'PEN'].includes(m.fixture.status.short)) {
            statusText = isToday ? timeStr : `${matchDate.getFullYear()}/${matchDate.getMonth()+1}/${matchDate.getDate()}`;
            Utils.removeTracked(m.fixture.id)
        }

        const homeScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.home ?? 0);
        const awayScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.away ?? 0);
        const badgeHtml = showBadge ? `<div class="card-league-badge"><img src="${m.league.logo}"><span>${m.league.name}</span></div>` : '';
        
        const trackIndicator = Utils.isTracked(m.fixture.id) ? `<div class="track-indicator"></div>` : '';
        const soonIndicator = Utils.isSoon(m) ? `<div class="starting-soon"><svg class="hourglass-pulse"><use href="#icon-hourglass"></use></svg></div>` : '';
        let penIndicator = '';
        if (m.score.penalty.home !== null && m.score.penalty.away !== null) penIndicator = `<div style="font-size:0.8em; color:#aaa;">(P: ${m.score.penalty.home}-${m.score.penalty.away})</div>`;

        return `
        <div id="match-card-${m.fixture.id}" class="match-card focusable ${isActuallyLive?'is-live':''}" tabindex="0" data-action="open-match" data-id="${m.fixture.id}">
            ${trackIndicator}
            ${soonIndicator}
            ${badgeHtml}
            <div class="match-status">${statusText}</div>
            <div class="card-teams">
                <div class="card-team ${homeFav}"><div class="card-team-info"><img src="${m.teams.home.logo}"><span>${m.teams.home.name}</span></div><span class="card-score">${homeScore}</span></div>
                <div class="card-team ${awayFav}"><div class="card-team-info"><img src="${m.teams.away.logo}"><span>${m.teams.away.name}</span></div><span class="card-score">${awayScore}</span></div>
            </div>
            ${penIndicator}
        </div>`;
    }

    function renderKnockout(matches) {
        if (!matches || matches.length === 0) return '<div class="scrollable-content focusable" tabindex="0">No Knockout Stage available.</div>';

        const groups = {};
        matches.forEach(m => {
            const r = m.league.round;
            if (!groups[r]) groups[r] = [];
            groups[r].push(m);
        });

        const roundOrder = ['Round of 16', '8th Finals', 'Quarter-finals', 'Semi-finals', 'Final'];
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            const idxA = roundOrder.findIndex(key => a.includes(key));
            const idxB = roundOrder.findIndex(key => b.includes(key));
            const va = idxA === -1 ? 99 : idxA;
            const vb = idxB === -1 ? 99 : idxB;
            return va - vb;
        });

        let html = `<div class="scrollable-content focusable" tabindex="0" style="display:flex; flex-direction:column;"><div class="bracket-container">`;

        sortedKeys.forEach(roundName => {
            const roundsMatches = groups[roundName];
            html += `<div class="bracket-round">
                        <div class="bracket-round-title">${roundName.replace('Regular Season - ', '')}</div>`;
            
            roundsMatches.forEach(m => {
                html+=card(m);
            });
            html += `</div>`; 
        });

        html += `</div></div>`;
        return html;
    }

    function renderStatBar(label, homeValRaw, awayValRaw, isPercent = false) {
         const cleanVal = (v) => {
             if (typeof v === 'string') return parseFloat(v.replace('%','')) || 0;
             return parseFloat(v) || 0;
         };

         const hNum = cleanVal(homeValRaw);
         const aNum = cleanVal(awayValRaw);
         const total = hNum + aNum;
         
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
         </div>`;
    }

    function renderPredictions(data) {
        if (!data) return '<div class="scrollable-content focusable" tabindex="0">No predictions available.</div>';
        
        const { predictions, comparison } = data;
        let advice = predictions.advice || 'No advice available.';
        advice = advice.replace(/Combo Double chance : /i, ''); 
        
        const winner = predictions.winner ? `${predictions.winner.name} (${predictions.winner.comment || ''})` : '-';
        const winOrDraw = predictions.win_or_draw ? 'Yes' : 'No';
        const underOver = predictions.under_over || '-';
        
        let html = `<div class="scrollable-content focusable" tabindex="0" style="padding: 1rem 2rem 3rem;">`;

        if (comparison) {
            html += `<h3 style="margin-bottom:1rem; text-align:center;">Head-to-Head Comparison</h3>`;
            html += `<div style="max-width:800px; margin:0 auto;">`;
            html += renderStatBar('Total', comparison.total.home, comparison.total.away, true);
            html += renderStatBar('Form', comparison.form.home, comparison.form.away, true);
            html += renderStatBar('Attacking', comparison.att.home, comparison.att.away, true);
            html += renderStatBar('Defending', comparison.def.home, comparison.def.away, true);
            html += renderStatBar('H2H', comparison.h2h.home, comparison.h2h.away, true);
            html += renderStatBar('Goals', comparison.goals.home, comparison.goals.away, true);
            html += renderStatBar('Poisson Dist.', comparison.poisson_distribution.home, comparison.poisson_distribution.away, true);
            html += `</div>`;
        }

        html += `
            <div style="background:#222; padding:1rem; border-radius:8px; border:1px solid #333; margin-bottom:1.5rem; text-align:center;">
                <div style="font-size:1.3em; font-weight:bold; margin-bottom:0.5rem; color:var(--bg-focus);">${advice}</div>
                <div style="display:flex; justify-content:space-around; margin-top:1rem; flex-wrap:wrap; gap:0.5rem;">
                    <div class="pred-stat-box"><span class="pred-stat-label">Winner</span><span class="pred-stat-val">${winner || '-'}</span></div>
                    <div class="pred-stat-box"><span class="pred-stat-label">Win/Draw</span><span class="pred-stat-val">${winOrDraw}</span></div>
                    <div class="pred-stat-box"><span class="pred-stat-label">Goals</span><span class="pred-stat-val">${underOver}</span></div>
                </div>
            </div></div>`;
        return html;
    }

    function renderEvents(events, homeId) {
        if(!events || !events.length) return '<div class="scrollable-content focusable" tabindex="0">No events available.</div>';
        
        const timelineHtml = events.map(e => {
            const isHome = e.team.id === homeId;
            const type = e.type.toLowerCase();
            const detail = e.detail || '';
            
            let icon = '•';
            let importanceClass = 'normal';
            let divclass1 = 'event-player';
            let divclass2 = 'event-subtext';
            let assistText = 'Asst: ';
            
            if (type === 'goal') { icon = '⚽'; importanceClass = 'high'; }
            else if (type === 'card') { icon = detail.includes('Red') ? '🟥' : '🟨'; importanceClass = 'medium'; }
            else if (type === 'subst') { icon = '🔄'; importanceClass = 'low'; divclass1 = 'subst-out'; divclass2 = 'subst-in'; assistText= ''; }
            else if (type === 'var') { icon = '📺'; importanceClass = 'low'; }

            const contentHtml = `
                <div class="event-box ${importanceClass}">
                    <div class="event-icon">${icon}</div>
                    <div class="event-info">
                        <div class="${divclass1}">${e.player.name}</div>
                        ${e.assist.name ? `<div class="${divclass2}">${assistText}${e.assist.name}</div>` : ''}
                        ${detail && type !== 'goal' ? `<div class="event-subtext">${detail}</div>` : ''}
                    </div>
                </div>`;

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

        return `<div class="scrollable-content focusable" tabindex="0"><div class="timeline-container"><div class="timeline-vertical-line"></div>${timelineHtml}</div></div>`;
    }

    function renderLineups(l, playerStats) {
        if(!l || l.length < 2) return '<div class="scrollable-content focusable" tabindex="0">No Lineups.</div>';
        let BestPlayer = null;
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
        const countGrid = (xi) => xi.filter(x => x.player && x.player.grid).length;
        const usePitch = countGrid(l[0].startXI) > 7 && countGrid(l[1].startXI) > 7;
        const getClassBestPlayer = (pid) => pid === BestPlayer ? ' best-player' : '';

        const renderListRow = (p) => {
            if (!p) return '';
            const rating = getRating(p.id);
            const ratingClass = Utils.getRatingClass(rating);
            const rHtml = rating ? `<span class="sub-rating ${getClassBestPlayer(p?.id)} ${ratingClass}">${rating}</span>` : '';
            return `<div class="sub-row"><span class="sub-num">${p.number || '-'}</span><span style="flex-grow:1; text-align:left; padding-left:1rem;">${p.name}</span>${rHtml}</div>`;
        };

        let mainContent = '';
        if (usePitch) {
            const createDot = (player, isHome) => {
                const teamData = isHome ? l[0].team : l[1].team;
                const colors = player.pos === 'G' ? teamData?.colors?.goalkeeper : teamData?.colors?.player;
                const bgColor = colors && colors.primary ? '#' + colors.primary : (isHome ? '#e50914' : '#fff');
                const numColor = colors && colors.number ? '#' + colors.number : (isHome ? '#fff' : '#000');
                const borderColor = colors && colors.border ? '#' + colors.border : '#000';
                return { name: player.name, number: player.number, id: player.id, grid: player.grid, bg: bgColor, fg: numColor, br: borderColor, rating: getRating(player.id) };
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
                        const leftPct = isHome ? 5 + ((r-1) * 10) : 95 - ((r-1) * 10);
                        style = `left:${leftPct}%; top:${topPct}%;`;
                    }
                    return { ...data, style };
                });
            };

            const homePlayers = processTeam(0);
            const awayPlayers = processTeam(1);
            const renderRatingBadge = (p) => {
                if(!p?.rating) return '';
                const colorClass = Utils.getRatingClass(p?.rating);
                return `<div class="player-rating-badge ${getClassBestPlayer(p?.id)} ${colorClass}">${p?.rating}</div>`;
            };
            const renderDot = (p) => {
                if (!p.style) return '';
                return `<div class="pitch-player" style="${p.style}"><div class="player-dot" style="background:${p.bg}; color:${p.fg}; border-color:${p.br}">${p.number}</div>${renderRatingBadge(p)}<div class="player-name">${p.name.split(' ').pop()}</div></div>`;
            };
            mainContent = `
                <div class="soccer-pitch">
                    <div class="pitch-fomation home">${l[0].formation || ''}</div>
                    <div class="pitch-fomation away">${l[1].formation || ''}</div>
                    <div class="pitch-line pitch-center-line"></div>
                    <div class="pitch-line pitch-center-circle"></div>
                    <div class="pitch-line pitch-penalty-area-left"></div>
                    <div class="pitch-line pitch-penalty-area-right"></div>
                    ${homePlayers.map(renderDot).join('')}
                    ${awayPlayers.map(renderDot).join('')}
                </div>`;
        } else {
            mainContent = `
                <div class="subs-container" style="border-top:none; margin-top:0; padding-top:0;">
                    <div class="subs-team"><h4 style="margin-bottom:0.5rem; color:#fff; border-bottom:1px solid #333; padding-bottom:0.5rem;">${l[0].team.name} XI</h4>${l[0].startXI.map(s => renderListRow(s.player)).join('')}</div>
                    <div class="subs-team"><h4 style="margin-bottom:0.5rem; color:#fff; border-bottom:1px solid #333; padding-bottom:0.5rem;">${l[1].team.name} XI</h4>${l[1].startXI.map(s => renderListRow(s.player)).join('')}</div>
                </div>`;
        }

        const renderSubsList = (teamIdx) => l[teamIdx].substitutes.map(s => renderListRow(s.player)).join('');
        return `<div class="scrollable-content focusable" tabindex="0">${mainContent}<div class="subs-container"><div class="subs-team"><h4>${l[0].team.name} Subs</h4>${renderSubsList(0)}</div><div class="subs-team"><h4>${l[1].team.name} Subs</h4>${renderSubsList(1)}</div></div></div>`;
    }
    function renderStats(s) {
        if(!s || s.length < 2) return '<div class="scrollable-content focusable" tabindex="0">No Stats.</div>';
    
        const homeStats = s[0].statistics;
        const awayStats = s[1].statistics;
    
        let html = `<div class="scrollable-content focusable" tabindex="0" style="padding: 1rem 2rem 3rem;"><div style="max-width:800px; margin:0 auto;">`;
    
        // Loop through Categories
        for (const [groupName, statsList] of Object.entries(STAT_GROUPS)) {
            
            // Check if at least one stat in this group exists in the data
            const hasData = statsList.some(type => homeStats.find(st => st.type === type));
            
            if (hasData) {
                // Add a Group Header
                html += `<h3 class="stats-tite">${groupName}</h3>`;
    
                // Loop through the stats in this group
                statsList.forEach(type => {
                    const hStat = homeStats.find(st => st.type === type);
                    const aStat = awayStats.find(st => st.type === type);
    
                    if (hStat && aStat) {
                        const hVal = hStat.value ?? 0;
                        const aVal = aStat.value ?? 0;
                        html += renderStatBar(type, hVal, aVal);
                    }
                });
            }
        }
    
        html += `</div></div>`;
        return html;
    }
    function renderH2H(h, teamHome, teamAway) {
        if(!h||h.length===0) return '<div class="scrollable-content focusable" tabindex="0">No Data.</div>';
        let homeWins = 0; let awayWins = 0; let draws = 0;
        h.forEach(m => {
            if (m.goals.home === null || m.goals.away === null) return;
            const hGoal = m.goals.home ?? 0; const aGoal = m.goals.away ?? 0;
            if (hGoal === aGoal) draws++;
            else {
                const winnerId = hGoal > aGoal ? m.teams.home.id : m.teams.away.id;
                if (winnerId === teamHome.id) homeWins++; else if (winnerId === teamAway.id) awayWins++;
            }
        });

        return `
            <div class="scrollable-content focusable" tabindex="0">
                <div style="display:flex; align-items:center; justify-content:center; gap:1.5rem; background:#222; padding:0.8rem; border-radius:8px; margin-bottom:1rem; border:1px solid #333;">
                    <div style="display:flex; align-items:center; gap:0.5rem;"><img src="${teamHome.logo}" style="width:35px; height:35px; object-fit:contain;"><span style="font-size:1.2em; font-weight:bold; color:#4cd964">${homeWins} Wins</span></div>
                    <div style="font-size:1.2em; font-weight:bold; color:#aaa; padding:0 1rem; border-left:1px solid #444; border-right:1px solid #444;">${draws} Draws</div>
                    <div style="display:flex; align-items:center; gap:0.5rem;"><span style="font-size:1.2em; font-weight:bold; color:#e50914">${awayWins} Wins</span><img src="${teamAway.logo}" style="width:35px; height:35px; object-fit:contain;"></div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:1.5rem; justify-content:center;">${h.map(m=>card(m)).join('')}</div>
            </div>`;
    }

    function renderStandings(s) {
        if (!s || !s.length) return '<div class="scrollable-content focusable" tabindex="0">No Standings Available.</div>';
        let html = '<div class="scrollable-content focusable" tabindex="0" style="padding-bottom: 2rem;">';
        s.forEach(group => {
            const group_html =group.map(t => `<tr><td>${t.rank}</td><td style="text-align:left; display:flex; align-items:center; gap:0.5rem;"><img src="${t.team.logo}" style="width:50px; height:50px; object-fit:contain;">${t.team.name}</td><td>${t.all.played}</td><td>${t.all.win}</td><td>${t.all.draw}</td><td>${t.all.lose}</td><td>${t.goalsDiff}</td><td><b>${t.points}</b></td></tr>`).join('');
            if (s.length > 1) html += `<h3 style="margin-top: 1rem; color: var(--bg-focus); padding-left: 0.5rem;">${group[0].group}</h3>`;
            html += `<table class="standings-table"><thead><tr><th style="width:10%">#</th><th style="text-align:left">Team</th><th style="width:10%">P</th><th style="width:10%">W</th><th style="width:10%">D</th><th style="width:10%">L</th><th style="width:10%">GD</th><th style="width:10%">Pts</th></tr></thead><tbody>${group_html}</tbody></table>`;
        });
        html += '</div>'; return html;
    }

    function renderPlayerStats(data, type) {
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
                    const natStr = p.nationality ? p.nationality.substring(0,3).toUpperCase() : '';
                    const ratingClass=Utils.getRatingClass(rating);
                    return `<tr><td>${index + 1}</td><td class="player-info-cell"><div class="player-info-avatar"><img src="${s.team.logo}" class="player-avatar-team-logo-small"><img src="${p.photo}" class="player-avatar-photo-small"></div><div style="line-height:1.2"><div style="font-weight:bold;">${p.name}</div><div style="font-size:0.8em; color:#aaa;">${s.team.name} | [${natStr}]</div></div></td><td>${pos}</td><td>${s.games.appearences||0}</td><td> <span  class="sub-rating ${ratingClass}">${rating}</span></td><td>${shots}</td><td style="font-weight:bold; font-size:1.2em; color:var(--bg-focus);">${mainVal}</td></tr>`;
                }).join('')}</tbody>
            </table></div>`;
    }

    return {
        card,
        renderKnockout,
        renderStatBar,
        renderPredictions,
        renderEvents,
        renderLineups,
        renderStats,
        renderH2H,
        renderStandings,
        renderPlayerStats
    };
})();