"use strict";

const Navigation = (function() {
    let focusableSelector = '.focusable';
    let currentFocus = null;
    let activeScope = null; 
    let scrollThrottle = null;
    let scrollHold = { active: false, el: null, dir: 0, raf: 0, lastTs: 0 };

    const KEYS_MAP = [
        { name: 'Up', keys: ['ArrowUp', 'Up', 38] },
        { name: 'Down', keys: ['ArrowDown', 'Down', 40] },
        { name: 'Left', keys: ['ArrowLeft', 'Left', 37] },
        { name: 'Right', keys: ['ArrowRight', 'Right', 39] },
        { name: 'Enter', keys: ['Enter', 'Select', 13] },
        { name: 'Return', keys: ['Return', 'Escape', 'Backspace', 'XF86Back', 10009, 461, 27, 8] },
        { name: 'ChannelUp', keys: ['ChannelUp', 'XF86RaiseChannel', 'PageUp', 33, 427] },
        { name: 'ChannelDown', keys: ['ChannelDown', 'XF86LowerChannel', 'PageDown', 34, 428] },
        { name: 'MediaPlayPause', keys: ['MediaPlayPause', 'XF86AudioPlay', 'XF86PlayBack', 'MediaPlay', 'MediaPause', 19, 415] },
        { name: 'Guide', keys: ['Guide', 'Epg', 'XF86ChannelGuide', 457] }
    ];

    function normalizeKey(e) {
        const k = e.key;
        const c = e.keyCode;
        for (const map of KEYS_MAP) {
            if (map.keys.includes(k) || map.keys.includes(c)) return map.name;
        }
        return k;
    }

    function init() {
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest(focusableSelector);
            if (target && target !== currentFocus) {
                focus(target, false);
            }
        });
    }

    function stopScrollHold() {
        scrollHold.active = false;
        scrollHold.el = null;
        scrollHold.dir = 0;
        scrollHold.lastTs = 0;
        if (scrollHold.raf) {
            cancelAnimationFrame(scrollHold.raf);
            scrollHold.raf = 0;
        }
    }

    function startScrollHold(el, dir) {
        if (!el) return;
        // Ensure immediate/fast scroll on TVs (avoid CSS smooth)
        if (el.style.scrollBehavior !== 'auto') el.style.scrollBehavior = 'auto';

        scrollHold.el = el;
        scrollHold.dir = dir;
        if (scrollHold.active) return;
        scrollHold.active = true;
        scrollHold.lastTs = 0;

        const ratePxPerMs = 0.65; // ~650px/s
        const tick = (ts) => {
            if (!scrollHold.active || !scrollHold.el) return;
            if (!scrollHold.lastTs) scrollHold.lastTs = ts;
            const dt = Math.min(32, ts - scrollHold.lastTs);
            scrollHold.lastTs = ts;

            const step = dt * ratePxPerMs * scrollHold.dir;
            const maxScroll = scrollHold.el.scrollHeight - scrollHold.el.clientHeight;

            if (maxScroll <= 0) {
                stopScrollHold();
                return;
            }

            const next = Math.max(0, Math.min(maxScroll, scrollHold.el.scrollTop + step));
            scrollHold.el.scrollTop = next;

            // Stop at bounds to avoid "sticky" key-hold feeling
            if ((scrollHold.dir < 0 && next <= 0) || (scrollHold.dir > 0 && next >= maxScroll)) {
                stopScrollHold();
                return;
            }

            scrollHold.raf = requestAnimationFrame(tick);
        };

        scrollHold.raf = requestAnimationFrame(tick);
    }

    function handleKeyUp(e) {
        const key = normalizeKey(e);
        if (key === 'Up' || key === 'Down') {
            stopScrollHold();
        }
    }

    function setScope(element) {
        activeScope = element;
        if (element) {
            const first = element.querySelector(focusableSelector);
            if (first) focus(first);
        }
    }

    function scan() {
        const root = activeScope || document.body;

        if (currentFocus && document.body.contains(currentFocus)) {
            if (!activeScope || activeScope.contains(currentFocus)) return;
        }

        if (root === document.body) {
            const alert = document.getElementById('live-alert');
            if (alert && alert.classList.contains('visible')) {
                focus(alert);
                return;
            }

            let candidate = document.querySelector('#content-container .tab-button.active');
            if (!candidate) candidate = document.querySelector('#content-container .focusable');

            if (candidate && candidate.offsetParent !== null) {
                focus(candidate);
                return;
            }
        }

        const visible = root.querySelector(focusableSelector);
        if (visible) focus(visible);
    }

    function focus(element, scroll = true) {
        if (!element) return;
        if (currentFocus) currentFocus.classList.remove('focused');

        currentFocus = element;
        currentFocus.classList.add('focused');
        currentFocus.focus({ preventScroll: true });

        if (scroll) {
            element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
        }
    }

    function findClosestX(targetList, referenceRect) {
        let best = null;
        let minDiff = Infinity;
        const refX = referenceRect.left + (referenceRect.width / 2);

        targetList.forEach(el => {
            const r = el.getBoundingClientRect();
            const elX = r.left + (r.width / 2);
            const diff = Math.abs(elX - refX);
            if (diff < minDiff) {
                minDiff = diff;
                best = el;
            }
        });
        return best;
    }

    // NEW: robust Up/Down handling for Account Page grids (fav sections)
    function tryAccountGridMove(direction, rect) {
        const accountPage = currentFocus ? currentFocus.closest('.account-page') : null;
        if (!accountPage) return false;
        if (direction !== 'Up' && direction !== 'Down') return false;

        const sections = Array.from(accountPage.querySelectorAll('.account-section'));
        if (!sections.length) return false;

        const currentSection = currentFocus.closest('.account-section');
        if (!currentSection) return false;

        const visibleFocusable = (root) => Array.from(root.querySelectorAll(focusableSelector))
            .filter(el => el !== currentFocus && el.offsetParent !== null);

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // 1) Try move inside SAME section first (true grid behavior)
        {
            const inSection = visibleFocusable(currentSection);
            // candidates strictly above/below
            const candidates = inSection.filter(el => {
                const r = el.getBoundingClientRect();
                const elCy = r.top + r.height / 2;
                if (direction === 'Down') return elCy > cy + 2;
                return elCy < cy - 2;
            });

            if (candidates.length) {
                // Prefer nearest row (Y) then closest X
                candidates.sort((a, b) => {
                    const ra = a.getBoundingClientRect();
                    const rb = b.getBoundingClientRect();
                    const aCy = ra.top + ra.height / 2;
                    const bCy = rb.top + rb.height / 2;
                    const dyA = Math.abs(aCy - cy);
                    const dyB = Math.abs(bCy - cy);
                    if (dyA !== dyB) return dyA - dyB;
                    const aCx = ra.left + ra.width / 2;
                    const bCx = rb.left + rb.width / 2;
                    return Math.abs(aCx - cx) - Math.abs(bCx - cx);
                });

                focus(candidates[0]);
                return true;
            }
        }

        // 2) If we're at the edge (last/first row), jump to NEXT/PREV section (closest X)
        const idx = sections.indexOf(currentSection);
        const targetIdx = direction === 'Down' ? idx + 1 : idx - 1;
        if (targetIdx < 0 || targetIdx >= sections.length) return false;

        const targetSection = sections[targetIdx];

        // Prefer grid items first (cards/actions), then header actions (like add)
        let targets = [];
        const grid = targetSection.querySelector('.fav-grid');
        if (grid) targets = visibleFocusable(grid);

        if (!targets.length) {
            const header = targetSection.querySelector('.account-section-header');
            if (header) targets = visibleFocusable(header);
        }

        if (!targets.length) return false;

        const best = findClosestX(targets, rect) || targets[0];
        if (best) {
            focus(best);
            return true;
        }
        return false;
    }

    function move(direction) {
        if (!currentFocus) { scan(); return; }

        const rect = currentFocus.getBoundingClientRect();

        const currentRail = currentFocus.closest('.rail');
        const currentSidebar = currentFocus.closest('.sidebar-menu');
        const currentRow = currentFocus.closest('.row-section');
        const isHeader = currentFocus.classList.contains('row-header-content') || currentFocus.closest('.row-header');

        // CASE 1: Horizontal navigation inside rails
        if (direction === 'Left' || direction === 'Right') {
            if (currentRail) {
                const siblings = Array.from(currentRail.querySelectorAll(focusableSelector));
                const idx = siblings.indexOf(currentFocus);

                if (direction === 'Right') {
                    if (idx < siblings.length - 1) focus(siblings[idx + 1]);
                    return;
                }

                if (direction === 'Left') {
                    if (idx > 0) focus(siblings[idx - 1]);
                    return;
                }
            }
        }

        // CASE 2: Vertical navigation inside Home rails/rows
        if (direction === 'Up' || direction === 'Down') {
            if (currentRow) {
                const allRows = Array.from(document.querySelectorAll('.row-section'));
                const currentRowIdx = allRows.indexOf(currentRow);

                let targetRow = null;
                let targetIsHeader = false;

                if (direction === 'Down') {
                    if (isHeader) {
                        targetRow = currentRow;
                        targetIsHeader = false;
                    } else {
                        if (currentRowIdx < allRows.length - 1) {
                            targetRow = allRows[currentRowIdx + 1];
                            targetIsHeader = true;
                        }
                    }
                } else if (direction === 'Up') {
                    if (isHeader) {
                        if (currentRowIdx > 0) {
                            targetRow = allRows[currentRowIdx - 1];
                            targetIsHeader = false;
                        } else {
                            const dateHeader = document.getElementById('date-header-wrapper');
                            if (dateHeader) {
                                const headerFocusable = dateHeader.querySelector(focusableSelector);
                                if (headerFocusable) { focus(headerFocusable); return; }
                            }
                        }
                    } else {
                        targetRow = currentRow;
                        targetIsHeader = true;
                    }
                }

                if (targetRow) {
                    if (targetIsHeader) {
                        const header = targetRow.querySelector('.row-header-content.focusable');
                        if (header) { focus(header); return; }
                    } else {
                        let candidates = Array.from(targetRow.querySelectorAll('.rail .focusable'));
                        if (candidates.length === 0) candidates = Array.from(targetRow.querySelectorAll('.focusable'));
                        candidates = candidates.filter(c => !c.classList.contains('row-header-content'));

                        if (candidates.length > 0) {
                            const best = findClosestX(candidates, rect);
                            if (best) { focus(best); return; }
                        }
                    }
                }
            }

            // never go to sidebar menus from rows with up/down
            if (currentRail) return;

            // NEW: Account page grid navigation override
            if (tryAccountGridMove(direction, rect)) return;
        }

        // Fallback: Generic spatial
        let root = activeScope || document.body;
        if (currentSidebar) root = document.querySelector('#sidebar');

        if (activeScope && (direction === 'Down' || direction === 'Up')) {
            const allInScope = Array.from(activeScope.querySelectorAll(focusableSelector));
            const currentIdx = allInScope.indexOf(currentFocus);
            if (currentIdx !== -1) {
                if (direction === 'Down' && currentIdx < allInScope.length - 1) { focus(allInScope[currentIdx + 1]); return; }
                if (direction === 'Up' && currentIdx > 0) { focus(allInScope[currentIdx - 1]); return; }
            }
        }

        const candidates = Array.from(root.querySelectorAll(focusableSelector)).filter(el =>
            el !== currentFocus && el.offsetParent !== null
        );

        let bestCandidate = null;
        let minDistance = Infinity;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        for (const el of candidates) {
            const r = el.getBoundingClientRect();
            const elCx = r.left + r.width / 2;
            const elCy = r.top + r.height / 2;

            if (direction === 'Down' && elCy <= cy) continue;
            if (direction === 'Up' && elCy >= cy) continue;
            if (direction === 'Right' && elCx <= cx) continue;
            if (direction === 'Left' && elCx >= cx) continue;

            const xDist = Math.abs(elCx - cx);
            const yDist = Math.abs(elCy - cy);

            let dist = Infinity;
            if (direction === 'Left' || direction === 'Right') {
                dist = Math.abs((direction==='Right'? r.left : r.right) - (direction==='Right'? rect.right : rect.left)) + (yDist * 3);
            } else {
                dist = Math.abs((direction==='Down'? r.top : r.bottom) - (direction==='Down'? rect.bottom : rect.top)) + (xDist * 3);
            }

            if (dist < minDistance) {
                minDistance = dist;
                bestCandidate = el;
            }
        }

        if (bestCandidate && bestCandidate.closest('#sidebar')) {
            if (currentFocus && currentFocus.closest('.page-container')) return;
        }

        if (bestCandidate) focus(bestCandidate);
    }

    function handleKeyDown(e) {
        const key = normalizeKey(e);
        const current = document.activeElement;

        // Scrollable containers: keep Up/Down as scroll (and smooth on hold)
        if (current.classList.contains('scrollable-content') && (key === 'Up' || key === 'Down')) {
            const maxScroll = current.scrollHeight - current.clientHeight;

            // If we're at a hard boundary, allow navigation to escape (fall-through)
            if (key === 'Up' && current.scrollTop <= 0) {
                stopScrollHold();
            } else if (key === 'Down' && maxScroll > 0 && current.scrollTop >= maxScroll - 1) {
                stopScrollHold();
            } else {
                e.preventDefault();
                e.stopImmediatePropagation();

                // Minimal debounce for noisy repeat events; actual movement handled by rAF.
                if (scrollThrottle) return;
                scrollThrottle = setTimeout(() => { scrollThrottle = null; }, 25);

                startScrollHold(current, key === 'Down' ? 1 : -1);
                return;
            }
        }

        if (key === 'Right' || key === 'Left' || key === 'Up' || key === 'Down') {
            e.preventDefault();
            move(key);
        }
        else if (key === 'Enter' && currentFocus) {
            e.preventDefault();
            currentFocus.click();
        }
        else if (key === 'Return') {
            if (activeScope) {
                const closeBtn = activeScope.querySelector('.modal-close');
                if (closeBtn) closeBtn.click();
            } else {
                document.dispatchEvent(new CustomEvent('nav-back'));
            }
        }
    }

    return { init, scan, focus, setScope, normalizeKey };
})();
