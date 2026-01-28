"use strict";

window.AppComponents = (function() {
    const Utils = window.Utils;
    const { State, Helpers } = window.AppServices;
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
        m.league.season = m.league.season || (new Date(m.fixture.date)).getFullYear();
        const matchDate = new Date(m.fixture.date);
        const isToday = matchDate.toDateString() === new Date().toDateString();
        const timeStr = matchDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const homeFav = Helpers.isFav('team', m.teams.home.id) ? "favorite" :"";
        const awayFav = Helpers.isFav('team', m.teams.away.id) ? "favorite" :"";
        let match_status_cls="";
        if (isActuallyLive) {
            if (m.fixture.status.short === 'HT'){
                statusText = `Half Time`;
            }else if (m.fixture.status.elapsed){
                statusText = Utils.formTimeString(m.fixture.status);
            }else{
                statusText = 'LIVE';
            }
            match_status_cls = "live-time";
        } else if (m.fixture.status.short === 'NS') {
            statusText = isToday ? timeStr : `${matchDate.getMonth()+1}/${matchDate.getDate()} ${timeStr}`;
        } else if (['FT', 'AET', 'PEN'].includes(m.fixture.status.short)) {
            statusText = isToday ? timeStr : `${matchDate.getFullYear()}/${matchDate.getMonth()+1}/${matchDate.getDate()}`;
            Utils.removeTracked(m.fixture.id)
        }else if(['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(m.fixture.status.short)){
            Utils.removeTracked(m.fixture.id);
            match_status_cls = "status-cancelled";
        }

        const homeScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.home ?? 0);
        const awayScore = m.fixture.status.short === 'NS' ? '-' : (m.goals.away ?? 0);
        const badgeHtml = showBadge ? `<div class="card-league-badge">${Utils.ImageLoader.tag(m.league.logo, m.league.name, 'league-logo')}<span>${m.league.name}</span></div>` : '';
        
        const trackIndicator = Utils.isTracked(m.fixture.id) ? `<div class="track-indicator"></div>` : '';
        const soonIndicator = Utils.isSoon(m) ? `<div class="starting-soon"><svg class="hourglass-pulse"><use href="#icon-hourglass"></use></svg></div>` : '';
        let penIndicator = '';
        if (m.score.penalty.home !== null && m.score.penalty.away !== null) penIndicator = `<div style="font-size:0.8em; color:#aaa;">(P: ${m.score.penalty.home}-${m.score.penalty.away})</div>`;

        return `
        <div id="match-card-${m.fixture.id}" class="match-card focusable ${isActuallyLive?'is-live':''}" tabindex="0" data-action="open-match" data-id="${m.fixture.id}" data-season="${m.league.season}">
            ${trackIndicator}
            ${soonIndicator}
            ${badgeHtml}
            <div class="match-status ${match_status_cls}">${statusText}</div>
            <div class="card-teams">
                <div class="card-team ${homeFav}"><div class="card-team-info">${Utils.ImageLoader.tag(m.teams.home.logo, m.teams.home.name, 'team-logo')}<span>${m.teams.home.name}</span></div><span class="card-score">${homeScore}</span></div>
                <div class="card-team ${awayFav}"><div class="card-team-info">${Utils.ImageLoader.tag(m.teams.away.logo, m.teams.away.name, 'team-logo')}<span>${m.teams.away.name}</span></div><span class="card-score">${awayScore}</span></div>
            </div>
            ${penIndicator}
        </div>`;
    }

    function renderKnockout(matches) {
        if (!matches || matches.length === 0) {
            return '<div class="scrollable-content focusable" tabindex="0">No Knockout Stage available.</div>';
        }

        // Group matches by round label
        const groups = {};
        matches.forEach(m => {
            const r = (m?.league?.round || 'Knockout').trim();
            if (!groups[r]) groups[r] = [];
            groups[r].push(m);
        });

        // Preferred ordering (API-Football common labels)
        const roundOrder = [
            'Round of 32',
            'Round of 16',
            '8th Finals',
            'Quarter-finals',
            'Semi-finals',
            'Final',
            '3rd Place Final',
            'Match for 3rd place'
        ];

        const sortedKeys = Object.keys(groups).sort((a, b) => {
            const idxA = roundOrder.findIndex(k => a.includes(k));
            const idxB = roundOrder.findIndex(k => b.includes(k));
            const va = idxA === -1 ? 999 : idxA;
            const vb = idxB === -1 ? 999 : idxB;
            if (va !== vb) return va - vb;
            // fallback: stable sort by name
            return a.localeCompare(b);
        });

        // Sort matches inside each round by date
        sortedKeys.forEach(k => {
            groups[k].sort((x, y) => {
                const dx = new Date(x?.fixture?.date || 0).getTime();
                const dy = new Date(y?.fixture?.date || 0).getTime();
                return dx - dy;
            });
        });

        // Bracket layout (Google-style): absolute-positioned match boxes per round.
        // IMPORTANT: Keep these in sync with CSS (.kb-match height).
        // The visual organization must follow the "path to the final".
        // We do that by ordering EACH earlier round based on the round AFTER it (back-propagation),
        // then positioning later rounds between their source matches.
        const MATCH_H = 132; // px
        const GAP = 34;      // px (slightly roomier on TV)
        const VSTEP = MATCH_H + GAP;

        const roundCount = sortedKeys.length;

        // --- 1) Assign Y positions per match based on the bracket path ---
        // positionsByRound[r] = Map(fixtureId -> topPx)
        const positionsByRound = [];

        // NOTE: Team IDs may be strings or numbers depending on API/client.
        // Normalize to numbers so cross-round matching always works.
        const getTeams = (m) => {
            const hRaw = m?.teams?.home?.id;
            const aRaw = m?.teams?.away?.id;
            const h = (hRaw === null || hRaw === undefined || hRaw === '') ? null : Number(hRaw);
            const a = (aRaw === null || aRaw === undefined || aRaw === '') ? null : Number(aRaw);
            return { h, a };
        };

        const hasKnownTeams = (m) => {
            const { h, a } = getTeams(m);
            return !!h && !!a;
        };

        const matchHasTeam = (m, teamId) => {
            if (!teamId) return false;
            const { h, a } = getTeams(m);
            return h === teamId || a === teamId;
        };

        // Reorder a previous round so it follows the bracket shows in the NEXT round.
        // This is the key requirement: the earlier column must be organized by the later column,
        // so the viewer can follow a team's path to the final.
        const reorderPrevByNext = (prevMatches, nextMatches) => {
            if (!prevMatches || !prevMatches.length) return prevMatches || [];
            if (!nextMatches || !nextMatches.length) return prevMatches;

            // If the next round is not yet determined (in-progress tournament), keep current ordering.
            const anyKnown = nextMatches.some(hasKnownTeams);
            if (!anyKnown) return prevMatches;

            const used = new Set();
            const out = [];

            const pushMatch = (m) => {
                const id = m?.fixture?.id;
                if (!id || used.has(id)) return;
                used.add(id);
                out.push(m);
            };

            for (const nm of nextMatches) {
                const { h, a } = getTeams(nm);
                if (!h || !a) continue;

                // Find the 2 source matches from the previous round.
                const srcA = prevMatches.find(pm => matchHasTeam(pm, h));
                const srcB = prevMatches.find(pm => matchHasTeam(pm, a) && pm?.fixture?.id !== srcA?.fixture?.id);

                if (srcA) pushMatch(srcA);
                if (srcB) pushMatch(srcB);
            }

            // Append remaining matches (not referenced by next round) in their current order.
            for (const pm of prevMatches) pushMatch(pm);

            return out;
        };

        const findPrevMatchTop = (prevPositions, prevRoundMatches, teamId) => {
            if (!teamId) return null;
            // Find the match in the previous round that contains this team.
            // We prefer the earliest match (stable) if duplicates exist (rare).
            for (const pm of prevRoundMatches) {
                const { h, a } = getTeams(pm);
                if (h === teamId || a === teamId) {
                    const top = prevPositions.get(pm.fixture?.id);
                    if (Number.isFinite(top)) return top;
                }
            }
            return null;
        };

        const resolveCollisions = (tops, minGap) => {
            // tops: Array<{ id, top }>
            tops.sort((x, y) => x.top - y.top);
            for (let i = 1; i < tops.length; i++) {
                const prev = tops[i - 1];
                const cur = tops[i];
                if (cur.top < prev.top + minGap) {
                    cur.top = prev.top + minGap;
                }
            }
            // Normalize so smallest top is 0
            const minTop = tops.length ? tops[0].top : 0;
            if (minTop > 0) {
                for (const t of tops) t.top -= minTop;
            }
            return tops;
        };

        // --- 1A) Back-propagate ordering: earlier round is reordered based on the next round ---
        // Example: Round of 16 is ordered by the Quarter-finals pairings.
        for (let r = roundCount - 1; r >= 1; r--) {
            const nextKey = sortedKeys[r];
            const prevKey = sortedKeys[r - 1];
            groups[prevKey] = reorderPrevByNext(groups[prevKey] || [], groups[nextKey] || []);
        }

        // Round 0: after back-propagation, the order is already bracket-correct.
        const r0Key = sortedKeys[0];
        const r0 = (groups[r0Key] || []).slice();

        const r0Pos = new Map();
        r0.forEach((m, i) => r0Pos.set(m?.fixture?.id, i * VSTEP));
        positionsByRound[0] = r0Pos;

        // Next rounds: derive top positions from previous round team paths
        for (let r = 1; r < roundCount; r++) {
            const key = sortedKeys[r];
            const prevKey = sortedKeys[r - 1];
            const prevMatches = (groups[prevKey] || []);
            const prevPos = positionsByRound[r - 1] || new Map();
            const list = (groups[key] || []).slice();

            const pos = new Map();
            const computed = [];

            list.forEach((m, idx) => {
                const { h, a } = getTeams(m);
                const hTop = findPrevMatchTop(prevPos, prevMatches, h);
                const aTop = findPrevMatchTop(prevPos, prevMatches, a);

                let top = null;
                if (Number.isFinite(hTop) && Number.isFinite(aTop) && hTop !== aTop) {
                    top = (hTop + aTop) / 2;
                } else if (Number.isFinite(hTop)) {
                    top = hTop;
                } else if (Number.isFinite(aTop)) {
                    top = aTop;
                } else {
                    // Fallback: sequential placement (keeps UI usable even if API data is odd)
                    top = idx * (VSTEP * 2);
                }

                computed.push({ id: m?.fixture?.id, top });
            });

            // Collision resolution inside the round column
            const fixed = resolveCollisions(computed, VSTEP);
            fixed.forEach(t => pos.set(t.id, t.top));

            // Persist ordering back: sort by resolved top so DOM order matches visual order
            list.sort((x, y) => (pos.get(x?.fixture?.id) ?? 0) - (pos.get(y?.fixture?.id) ?? 0));
            groups[key] = list;

            positionsByRound[r] = pos;
        }

        // --- 2) Compute canvas height from positioned elements ---
        let maxBottom = 0;
        for (let r = 0; r < roundCount; r++) {
            const key = sortedKeys[r];
            const list = groups[key] || [];
            const pos = positionsByRound[r] || new Map();
            for (const m of list) {
                const top = pos.get(m?.fixture?.id) ?? 0;
                const bottom = top + MATCH_H;
                if (bottom > maxBottom) maxBottom = bottom;
            }
        }
        if (!Number.isFinite(maxBottom) || maxBottom < MATCH_H) maxBottom = MATCH_H;

        const safeTitle = (s) => (s || '').replace('Regular Season - ', '').trim();

        const teamRow = (team, score) => {
            const name = team?.name || '-';
            const logo = team?.logo || '';
            const logoTag = (Utils?.ImageLoader?.tag)
                ? Utils.ImageLoader.tag(logo, name, 'kb-team-logo')
                : `<img class="kb-team-logo" src="${logo}" alt="${name}">`;

            const winnerClass = team.winner ? ' winner' : '';
            return `
                <div class="kb-team${winnerClass}">
                    <div class="kb-team-left">
                        ${logoTag}
                        <span class="kb-team-name">${name}</span>
                    </div>
                    <span class="kb-team-score">${score}</span>
                </div>`;
        };

        const matchBox = (m, topPx) => {
            const h = m?.goals?.home;
            const a = m?.goals?.away;
            const homeScore = (m?.fixture?.status?.short === 'NS' || h === null || h === undefined) ? '-' : (h ?? 0);
            const awayScore = (m?.fixture?.status?.short === 'NS' || a === null || a === undefined) ? '-' : (a ?? 0);

            // Winner highlight when finished
            const isDone = ['FT', 'AET', 'PEN'].includes(m?.fixture?.status?.short);
            // Small date / time label for final column focus
            const d = m?.fixture?.date ? new Date(m.fixture.date) : null;
            const timeStr = d ? d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
            const dayStr = d ? `${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString([], {month:'short'})}` : '';

            const status = m?.fixture?.status?.short || '';
            const badge = status && ['1H','HT','2H','ET','P','BT'].includes(status)
                ? `<span class="kb-live">LIVE</span>`
                : '';

            return `
                <div class="kb-match focusable" tabindex="0" data-action="open-match" data-id="${m?.fixture?.id}" style="top:${topPx}px;">
                    <div class="kb-meta">
                        <span class="kb-date">${dayStr}</span>
                        <span class="kb-time">${timeStr}</span>
                        ${badge}
                    </div>
                    ${teamRow(m?.teams?.home, homeScore)}
                    ${teamRow(m?.teams?.away, awayScore)}
                </div>`;
        };

        let html = `
            <div class="scrollable-content focusable knockout-scroll" tabindex="0">
                <div class="kb-wrapper stage-block" style="height:100%;">
        `;

        sortedKeys.forEach((roundName, r) => {
            const list = groups[roundName] || [];
            const pos = positionsByRound[r] || new Map();
            html += `<div class="kb-round" data-round-index="${r}">
                        <div class="kb-round-title">${safeTitle(roundName)}</div>
                        <div class="kb-round-canvas ${roundName.toLocaleLowerCase()}">`;

            list.forEach((m, i) => {
                const coef = (2 ** r) - 1;
                let top = pos.get(m?.fixture?.id) ?? (i * VSTEP);
                top += coef*(VSTEP/2);
                html += matchBox(m, top);
            });

            html += `   </div>
                    </div>`;
        });

        html += `
                </div>
            </div>`;

        return html;
    }

    function _parseStageAndSub(roundStr) {
        const raw = (roundStr || '').trim();
        if (!raw) return { stage: 'Matches', sub: '' };

        // Common API-Football round formats:
        // - "Regular Season - 12"
        // - "Group Stage - Group A - 3"
        // - "Semi-finals" / "Final" / "Match for 3rd place"
        const parts = raw.split(' - ').map(s => (s || '').trim()).filter(Boolean);
        const stage = parts[0] || 'Matches';
        const tail = parts.slice(1);

        if (!tail.length) return { stage, sub: '' };

        // Heuristics for nicer sub labels
        const lowerStage = stage.toLowerCase();
        if (lowerStage.includes('regular season') && tail.length === 1 && /^\d+$/.test(tail[0])) {
            return { stage, sub: `Matchday ${tail[0]}` };
        }

        if (lowerStage.includes('group stage')) {
            // e.g. "Group Stage - Group A - 2" => "Group A" (optionally with "Match 2")
            const group = tail.find(x => /^group\s+/i.test(x));
            const num = tail.find(x => /^\d+$/.test(x));
            if (group && num) return { stage, sub: `${group} · Match ${num}` };
            if (group) return { stage, sub: group };
        }

        return { stage, sub: tail.join(' - ') };
    }

    function renderMatchesByStage(fixtures, opts = {}) {
        const limit = Number.isFinite(opts.limit) ? opts.limit : 200;
        if (!fixtures || !fixtures.length) {
            return '<div class="scrollable-content focusable" tabindex="0">No matches available.</div>';
        }

        // Sort by most recent first for performance and relevance.
        const sorted = fixtures
            .slice()
            .sort((a, b) => (b.fixture?.timestamp || 0) - (a.fixture?.timestamp || 0));

        const total = sorted.length;
        const trimmed = sorted.slice(0, Math.max(10, limit));

        // Group by stage -> sub
        const stageMap = new Map();
        for (const m of trimmed) {
            const { stage, sub } = _parseStageAndSub(m?.league?.round);
            if (!stageMap.has(stage)) stageMap.set(stage, new Map());
            const subMap = stageMap.get(stage);
            const subKey = sub || '__nosub__';
            if (!subMap.has(subKey)) subMap.set(subKey, []);
            subMap.get(subKey).push(m);
        }

        // Stable stage ordering: prefer knockout-ish names first when they exist, otherwise keep insertion order.
        const stageOrder = [
            'Final',
            '3rd place',
            'Semi-finals',
            'Quarter-finals',
            'Round of 16',
            '8th Finals',
            'Group Stage',
            'Regular Season',
            'Play-offs',
            'Relegation',
        ];
        const stages = Array.from(stageMap.keys());
        stages.sort((a, b) => {
            const ia = stageOrder.findIndex(x => a.toLowerCase() === x.toLowerCase());
            const ib = stageOrder.findIndex(x => b.toLowerCase() === x.toLowerCase());
            const va = ia === -1 ? 999 : ia;
            const vb = ib === -1 ? 999 : ib;
            if (va !== vb) return va - vb;
            return a.localeCompare(b);
        });

        let html = '<div class="scrollable-content focusable" tabindex="0" style="padding-bottom:2rem;">';
        if (total > trimmed.length) {
            html += `<div class="matches-limit-note">Showing latest ${trimmed.length} of ${total} matches.</div>`;
        }

        for (const stage of stages) {
            const subMap = stageMap.get(stage);
            html += `<div class="stage-block">`;
            html += `<div class="stage-title">${stage}</div>`;

            const subKeys = Array.from(subMap.keys());
            // Put no-sub first, then natural sort.
            subKeys.sort((a, b) => {
                if (a === '__nosub__') return -1;
                if (b === '__nosub__') return 1;
                return !a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });

            for (const subKey of subKeys) {
                const list = subMap.get(subKey) || [];
                // Within each group, sort by time descending (recent first)
                list.sort((a, b) => (b.fixture?.timestamp || 0) - (a.fixture?.timestamp || 0));

                if (subKey !== '__nosub__') {
                    html += `<div class="stage-subtitle">${subKey}</div>`;
                }

                html += `<div class="matches-container stage-matches">${list.map(m => card(m)).join('')}</div>`;
            }

            html += `</div>`;
        }

        html += '</div>';
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
        const _events = events.sort((a, b) => {
            const timeA = a.time.elapsed + (a.time.extra ?? 0);
            const timeB = b.time.elapsed + (b.time.extra ?? 0);
            return timeB - timeA; // recent first
          });
        const timelineHtml = _events.map(e => {
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
        const countGrid = (xi) => xi && xi.filter ? xi.filter(x => x.player && x.player.grid).length : 0;
        const usePitch = countGrid(l[0].startXI) > 7 && countGrid(l[1].startXI) > 7;
        const getClassBestPlayer = (pid) => pid === BestPlayer ? ' best-player' : '';
        const playersFav = State.appConfig.favorite_players.map(t=>t.id) ;
        const renderListRow = (p) => {
            if (!p) return '';
            const rating = getRating(p.id);
            const ratingClass = Utils.getRatingClass(rating);
            const rHtml = rating ? `<span class="sub-rating ${getClassBestPlayer(p?.id)} ${ratingClass}">${rating}</span>` : '';
            return `<div class="sub-row ${playersFav.includes(p.id)?"favorite":""}"><span class="sub-num">${p.number || '-'}</span><span style="flex-grow:1; text-align:left; padding-left:1rem;">${p.name}</span>${rHtml}</div>`;
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
            let home_xi = l[1]?.startXI?.map ? l[0]?.startXI?.map(s => renderListRow(s.player)).join('') : 0;
            let away_xi = l[0]?.startXI?.map ? l[1]?.startXI?.map(s => renderListRow(s.player)).join('') : 0;
            /*
            l[0].team.name
            const teamsNames = document.getElementsByClassName("details-team");
            console.log("teamsNames==", teamsNames[0])
            if(teamsNames && teamsNames.length){
                if(teamsNames[0].innerText === l[1].team.name){
                    const home_xi_ori =  home_xi;
                    home_xi = away_xi;
                    away_xi = home_xi_ori;
                }
            }
            */
            
            mainContent = `
                <div class="subs-container" style="border-top:none; margin-top:0; padding-top:0;">
                    <div class="subs-team"><h4 style="margin-bottom:0.5rem; color:#fff; border-bottom:1px solid #333; padding-bottom:0.5rem;">${l[0].team.name} XI</h4>
                        ${home_xi || "-"}
                    </div>
                    <div class="subs-team"><h4 style="margin-bottom:0.5rem; color:#fff; border-bottom:1px solid #333; padding-bottom:0.5rem;">${l[1].team.name} XI</h4>
                        ${away_xi || "-"}
                    </div>
                </div>`;
        }

        const renderSubsList = (teamIdx) => l[teamIdx]?.substitutes?.map(s => renderListRow(s.player)).join('');
        const home_subs= renderSubsList(0);
        const away_subs= renderSubsList(1);
        return `
        <div class="scrollable-content focusable" tabindex="0">${mainContent}
            <div class="subs-container">
                <div class="subs-team">
                    <h4>${l[0].team.name} Subs</h4>
                    ${ home_subs || "-" }
                </div>
                <div class="subs-team">
                    <h4>${l[1].team.name} Subs</h4>
                    ${ away_subs || "-"}
                </div>
            </div>
        </div>`;
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
                    <div style="display:flex; align-items:center; gap:0.5rem;">${Utils.ImageLoader.tag(teamHome.logo, teamHome.name, '', 'style="width:35px; height:35px; object-fit:contain;"')}<span style="font-size:1.2em; font-weight:bold; color:#4cd964">${homeWins} Wins</span></div>
                    <div style="font-size:1.2em; font-weight:bold; color:#aaa; padding:0 1rem; border-left:1px solid #444; border-right:1px solid #444;">${draws} Draws</div>
                    <div style="display:flex; align-items:center; gap:0.5rem;"><span style="font-size:1.2em; font-weight:bold; color:#e50914">${awayWins} Wins</span>${Utils.ImageLoader.tag(teamAway.logo, teamAway.name, '', 'style="width:35px; height:35px; object-fit:contain;"')}</div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:1.5rem; justify-content:center;">${h.map(m=>card(m)).join('')}</div>
            </div>`;
    }

    function renderStandings(s) {
        if (!s || !s.length) return '<div class="scrollable-content focusable" tabindex="0">No Standings Available.</div>';
        let html = '<div class="scrollable-content focusable" tabindex="0" style="padding-bottom: 2rem;">';
        const teamsFav = State.appConfig.favorite_teams.map(t=>t.id) ;
        s.forEach(group => {
            const group_html = group.map(t => `<tr class="${teamsFav.includes(t.team.id)?"favorite":""}"><td>${t.rank}</td><td style="text-align:left; display:flex; align-items:center; gap:0.5rem;">${Utils.ImageLoader.tag(t.team.logo, t.team.name, '', 'style="width:50px; height:50px; object-fit:contain;"')}${t.team.name}</td><td>${t.all.played}</td><td>${t.all.win}</td><td>${t.all.draw}</td><td>${t.all.lose}</td><td>${t.goalsDiff}</td><td><b>${t.points}</b></td></tr>`).join('');
            if (s.length > 1) html += `<h3 style="margin-top: 1rem; color: var(--bg-focus); padding-left: 0.5rem;">${group[0].group}</h3>`;
            html += `<table class="standings-table"><thead><tr><th style="width:10%">#</th><th style="text-align:left">Team</th><th style="width:10%">P</th><th style="width:10%">W</th><th style="width:10%">D</th><th style="width:10%">L</th><th style="width:10%">GD</th><th style="width:10%">Pts</th></tr></thead><tbody>${group_html}</tbody></table>`;
        });
        html += '</div>'; return html;
    }

    function renderPlayerStats(data, type) {
        if (!data || !data.length) return '<div class="scrollable-content focusable" tabindex="0">No Player Stats Available.</div>';
        const posMap = { "Goalkeeper": "GK", "Defender": "DF", "Midfielder": "MF", "Attacker": "FW" };
        const mainStat = type === 'goals' ? 'Goals' : 'Assists';
        const playersFav = State.appConfig.favorite_players.map(t=>t.id) ;
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
                    return `<tr class="${playersFav.includes(p.id)?"favorite":""}" ><td>${index + 1}</td><td class="player-info-cell"><div class="player-info-avatar">${Utils.ImageLoader.tag(s.team.logo, s.team.name, 'player-avatar-team-logo-small')} ${Utils.ImageLoader.tag(p.photo, p.name, 'player-avatar-photo-small')}</div><div style="line-height:1.2"><div style="font-weight:bold;">${p.name}</div><div style="font-size:0.8em; color:#aaa;">${s.team.name} | [${natStr}]</div></div></td><td>${pos}</td><td>${s.games.appearences||0}</td><td> <span  class="sub-rating ${ratingClass}">${rating}</span></td><td>${shots}</td><td style="font-weight:bold; font-size:1.2em; color:var(--bg-focus);">${mainVal}</td></tr>`;
                }).join('')}</tbody>
            </table></div>`;
    }

    return {
        card,
        renderKnockout,
        renderMatchesByStage,
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