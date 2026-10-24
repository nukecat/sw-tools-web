document.addEventListener("DOMContentLoaded", () => {
    const toggles = document.querySelectorAll(".collapsible-toggle");

    toggles.forEach(toggle => {
        const panel = toggle.nextElementSibling;

        toggle.addEventListener("click", () => {
            const isCollapsed = panel.classList.contains("collapsed");

            panel.classList.toggle("collapsed", !isCollapsed);
            toggle.classList.toggle("collapsed", !isCollapsed);

            if (!isCollapsed) {
                panel.style.maxHeight = "0";
            } else {
                panel.style.maxHeight = panel.scrollHeight + "px";
            }
        });

        // Initialize max-height if expanded by default
        if (!panel.classList.contains("collapsed")) {
            panel.style.maxHeight = panel.scrollHeight + "px";
        }
    });
});
