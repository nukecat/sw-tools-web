export const drop_zones = {};

const PICKER_COOLDOWN_MS = 800; // tweak if needed

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[drop-zone]").forEach((zone) => {
        const inputId = zone.dataset.input;
        const infoId = zone.dataset.info;

        const fileInput = document.getElementById(inputId);
        const infoEl = infoId ? document.getElementById(infoId) : null;

        if (!fileInput) return;

        fileInput.value = "";
        zone.classList.remove("has-file");
        if (infoEl) infoEl.textContent = "No file";

        let lastOpen = 0;

        drop_zones[inputId] = {
            zone,
            fileInput,
            get file() {
                return fileInput.files?.[0] || null;
            }
        };

        // --- Click (time-based guard) ---
        zone.addEventListener("click", () => {
            const now = Date.now();
            if (now - lastOpen < PICKER_COOLDOWN_MS) return;

            lastOpen = now;
            fileInput.click();
        });

        // --- Drag & drop ---
        zone.addEventListener("dragover", e => {
            e.preventDefault();
            zone.classList.add("drag-over");
        });

        zone.addEventListener("dragleave", () => {
            zone.classList.remove("drag-over");
        });

        zone.addEventListener("drop", e => {
            e.preventDefault();
            zone.classList.remove("drag-over");

            const file = e.dataTransfer.files?.[0];
            if (!file) return;

            fileInput.files = e.dataTransfer.files;
            fileInput.dispatchEvent(new Event("change"));
        });

        // --- Picker result ---
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            handleFile(file);
        });

        function handleFile(file) {
            if (infoEl) infoEl.textContent = file.name;
            zone.classList.add("has-file");
        }
    });
});
