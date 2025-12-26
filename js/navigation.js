"use strict";

const Navigation = (function() {
    let focusableSelector = '.focusable';
    let currentFocus = null;
    let activeScope = null; 

    // Centralized Key Mapping configuration
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
            // Check both key string and keyCode
            if (map.keys.includes(k) || map.keys.includes(c)) {
                return map.name;
            }
        }
        return k; // Return original if no map found
    }

    function init() {
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest(focusableSelector);
            if (target && target !== currentFocus) {
                focus(target, false); 
            }
        });
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
        
        // Priority Scan
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

    // Helper to find closest element in a specific list based on X alignment
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

    function move(direction) {
        if (!currentFocus) { scan(); return; }

        const rect = currentFocus.getBoundingClientRect();
        
        // 1. Identify Context
        const currentRail = currentFocus.closest('.rail');
        const currentSidebar = currentFocus.closest('.sidebar-menu');
        const currentRow = currentFocus.closest('.row-section');
        const isHeader = currentFocus.classList.contains('row-header-content') || currentFocus.closest('.row-header');

        // --- CASE 1: Horizontal Navigation (Strict Rail Constraint) ---
        if (direction === 'Left' || direction === 'Right') {
            if (currentRail) {
                const siblings = Array.from(currentRail.querySelectorAll(focusableSelector));
                const idx = siblings.indexOf(currentFocus);
                
                if (direction === 'Right') {
                    if (idx < siblings.length - 1) {
                        focus(siblings[idx + 1]);
                        return;
                    }
                    return; 
                } 
                
                if (direction === 'Left') {
                    if (idx > 0) {
                        focus(siblings[idx - 1]);
                        return;
                    }
                    return; 
                }
            }
        }

        // --- CASE 2: Vertical Navigation (Modified for Header Logic) ---
        if (direction === 'Up' || direction === 'Down') {
            if (currentRow) {
                const allRows = Array.from(document.querySelectorAll('.row-section'));
                const currentRowIdx = allRows.indexOf(currentRow);
                
                let targetRow = null;
                let targetIsHeader = false;

                if (direction === 'Down') {
                    if (isHeader) {
                        // Header -> Match (Same Row)
                        targetRow = currentRow;
                        targetIsHeader = false;
                    } else {
                        // Match -> Header (Next Row)
                        if (currentRowIdx < allRows.length - 1) {
                            targetRow = allRows[currentRowIdx + 1];
                            targetIsHeader = true;
                        }
                    }
                } else if (direction === 'Up') {
                    if (isHeader) {
                        // Header -> Match (Previous Row)
                        if (currentRowIdx > 0) {
                            targetRow = allRows[currentRowIdx - 1];
                            targetIsHeader = false;
                        } else {
                             // Top of list, go to Date Header
                             const dateHeader = document.getElementById('date-header-wrapper');
                             if (dateHeader) {
                                const headerFocusable = dateHeader.querySelector(focusableSelector);
                                if (headerFocusable) { focus(headerFocusable); return; }
                             }
                        }
                    } else {
                        // Match -> Header (Same Row)
                        targetRow = currentRow;
                        targetIsHeader = true;
                    }
                }

                if (targetRow) {
                    if (targetIsHeader) {
                        const header = targetRow.querySelector('.row-header-content.focusable');
                        if (header) {
                            focus(header);
                            return;
                        }
                    } else {
                        let candidates = Array.from(targetRow.querySelectorAll('.rail .focusable'));
                        if (candidates.length === 0) candidates = Array.from(targetRow.querySelectorAll('.focusable')); 
                        
                        // Filter out headers if we are looking for matches
                        candidates = candidates.filter(c => !c.classList.contains('row-header-content'));

                        if (candidates.length > 0) {
                            const best = findClosestX(candidates, rect);
                            if (best) {
                                focus(best);
                                return;
                            }
                        }
                    }
                }
            }
            // never go to sidebar menues from rows with up/down buttons
            if (currentRail) {
                return;
            }
        }

        // --- Fallback: Generic Spatial Search ---
        let root = activeScope || document.body;
        if (currentSidebar) root = document.querySelector('#sidebar');

        // NEW: DOM Order Fallback for Vertical Stacking (Modals)
        if (activeScope && (direction === 'Down' || direction === 'Up')) {
            const allInScope = Array.from(activeScope.querySelectorAll(focusableSelector));
            const currentIdx = allInScope.indexOf(currentFocus);
            if (currentIdx !== -1) {
                if (direction === 'Down' && currentIdx < allInScope.length - 1) {
                    focus(allInScope[currentIdx + 1]);
                    return;
                }
                if (direction === 'Up' && currentIdx > 0) {
                    focus(allInScope[currentIdx - 1]);
                    return;
                }
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
            
            // STRICT GEOMETRIC FILTERING
            // This prevents "Down" from finding elements to the side (like next tab)
            // We ensure candidate is strictly in the direction quadrant
            const elCx = r.left + r.width / 2;
            const elCy = r.top + r.height / 2;

            if (direction === 'Down' && elCy <= cy) continue; // Must be strictly below
            if (direction === 'Up' && elCy >= cy) continue;   // Must be strictly above
            if (direction === 'Right' && elCx <= cx) continue; // Must be strictly right
            if (direction === 'Left' && elCx >= cx) continue;  // Must be strictly left
            
            // ... distance calc ...
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

        // --- STRICT BOUNDARY: Prevent jumping from Details Page to Sidebar ---
        if (bestCandidate && bestCandidate.closest('#sidebar')) {
            // If currently in a detailed view (Match or League page), block sidebar jump
            if (currentFocus && currentFocus.closest('.page-container')) {
                return; 
            }
        }

        if (bestCandidate) focus(bestCandidate);
    }

    function handleKeyDown(e) {
        const key = normalizeKey(e);
        const current = document.activeElement;

        // --- FIX: Scrollable Tab Content Logic ---
        // Strictly trap Up/Down to scroll
        if (current.classList.contains('scrollable-content') && (key === 'Up' || key === 'Down')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            const step = 80; // Scroll speed

            if (key === 'Down') {
                current.scrollTop += step;
                return; // Strictly return, do not call move()
            }
            
            if (key === 'Up') {
                if (current.scrollTop > 0) {
                    current.scrollTop -= step;
                    return; // Strictly return
                }
                // Only allow escape if at the very top
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