(function () {
    function setupMobileNav() {
        const toggle = document.querySelector("[data-nav-toggle]");
        const tabs = document.querySelector("[data-nav-menu]");

        if (!toggle || !tabs) {
            return;
        }

        toggle.addEventListener("click", () => {
            const isOpen = tabs.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", String(isOpen));
        });

        tabs.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                tabs.classList.remove("is-open");
                toggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    function setupTypingAnimation() {
        const typedTarget = document.querySelector("[data-typed]");

        if (!typedTarget) {
            return;
        }

        let phrases;
        try {
            phrases = JSON.parse(typedTarget.dataset.typed);
        } catch (error) {
            phrases = [];
        }

        if (!Array.isArray(phrases) || !phrases.length) {
            return;
        }

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            typedTarget.textContent = phrases[0];
            return;
        }

        let phraseIndex = 0;
        let charIndex = 0;
        let deleting = false;

        function tick() {
            const currentPhrase = phrases[phraseIndex];

            if (!deleting) {
                charIndex += 1;
                typedTarget.textContent = currentPhrase.slice(0, charIndex);

                if (charIndex === currentPhrase.length) {
                    deleting = true;
                    window.setTimeout(tick, 1400);
                    return;
                }

                window.setTimeout(tick, 70);
                return;
            }

            charIndex -= 1;
            typedTarget.textContent = currentPhrase.slice(0, charIndex);

            if (charIndex === 0) {
                deleting = false;
                phraseIndex = (phraseIndex + 1) % phrases.length;
                window.setTimeout(tick, 260);
                return;
            }

            window.setTimeout(tick, 42);
        }

        tick();
    }

    setupMobileNav();
    setupTypingAnimation();
}());
