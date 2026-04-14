"use strict";

(function() {
    function updateViewportMode() {
        const mobile = window.matchMedia("(max-width: 900px)").matches;
        document.body.classList.toggle("web-mobile", mobile);
        document.body.classList.toggle("web-desktop", !mobile);
    }

    function softenTVFocusOnPointer() {
        document.addEventListener("pointerdown", () => {
            const focused = document.querySelectorAll(".focused");
            focused.forEach((el) => el.classList.remove("focused"));
        }, true);
    }

    function enhanceWebInputBehavior() {
        // In browser mode, Backspace inside inputs should not trigger app back handlers.
        document.addEventListener("keydown", (e) => {
            const t = e.target;
            const isInput = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
            if (isInput && (e.key === "Backspace" || e.key === "Delete")) {
                e.stopPropagation();
            }
        }, true);
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.body.classList.add("web-mode");
        updateViewportMode();
        softenTVFocusOnPointer();
        enhanceWebInputBehavior();
        window.addEventListener("resize", updateViewportMode);
    });
})();
