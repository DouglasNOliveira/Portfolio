(function () {
    const board = document.getElementById("game-board");
    const context = board.getContext("2d");
    const boardShell = document.querySelector(".snake-board-shell");
    const gameTitleElement = document.getElementById("game-title");
    const livesElement = document.getElementById("game-lives");
    const scoreElement = document.getElementById("score");
    const highScoreElement = document.getElementById("high-score");
    const statusElement = document.getElementById("game-status");
    const padButtons = document.querySelectorAll("[data-pad]");
    const frameDuration = 1000 / 60;

    const gameState = {
        running: false,
        rafId: null,
        lastTime: 0,
        particles: []
    };

    let currentGameKey = "snake";
    let currentGame = null;

    function getInitialGameKey() {
        const params = new URLSearchParams(window.location.search);
        const requestedGame = params.get("game");
        return ["snake", "pong", "arkanoid"].includes(requestedGame) ? requestedGame : "snake";
    }

    function setStatus(message) {
        statusElement.textContent = message;
    }

    function setScoreboard(score, highScore, meta) {
        scoreElement.textContent = String(score);
        highScoreElement.textContent = String(highScore);

        if (meta && meta.title) {
            gameTitleElement.textContent = meta.title;
        }

        renderLives(meta && Number.isInteger(meta.lives) ? meta.lives : null);
    }

    function renderLives(lives) {
        if (!Number.isInteger(lives)) {
            livesElement.hidden = true;
            livesElement.innerHTML = "";
            return;
        }

        livesElement.hidden = false;
        livesElement.innerHTML = "";

        for (let index = 0; index < 2; index += 1) {
            const heart = document.createElement("i");
            heart.className = `game-life-icon bx ${index < lives ? "bxs-heart" : "bx-heart empty"}`;
            heart.setAttribute("aria-hidden", "true");
            livesElement.appendChild(heart);
        }
    }

    function configureCanvas(logicalWidth, logicalHeight) {
        const scale = Math.min(window.devicePixelRatio || 1, 2);
        board.width = Math.round(logicalWidth * scale);
        board.height = Math.round(logicalHeight * scale);
        board.dataset.logicalWidth = String(logicalWidth);
        board.dataset.logicalHeight = String(logicalHeight);
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.imageSmoothingEnabled = false;
    }

    function emitParticles(x, y, color, count, spreadX, spreadY) {
        for (let index = 0; index < count; index += 1) {
            gameState.particles.push({
                x,
                y,
                vx: (Math.random() - 0.5) * spreadX,
                vy: (Math.random() - 0.5) * spreadY,
                life: 1,
                size: 2 + Math.random() * 4,
                color
            });
        }
    }

    function clearParticles() {
        gameState.particles = [];
    }

    function updateParticles(frameFactor) {
        gameState.particles = gameState.particles
            .map((particle) => ({
                ...particle,
                x: particle.x + particle.vx * frameFactor,
                y: particle.y + particle.vy * frameFactor,
                life: particle.life - 0.03 * frameFactor,
                size: Math.max(0, particle.size - 0.03 * frameFactor)
            }))
            .filter((particle) => particle.life > 0 && particle.size > 0);
    }

    function drawParticles() {
        gameState.particles.forEach((particle) => {
            context.save();
            context.globalAlpha = particle.life;
            context.fillStyle = particle.color;
            context.beginPath();
            context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            context.fill();
            context.restore();
        });
    }

    function cancelFrameLoop() {
        if (gameState.rafId !== null) {
            cancelAnimationFrame(gameState.rafId);
            gameState.rafId = null;
        }
    }

    function stopLoop() {
        cancelFrameLoop();
        gameState.running = false;
        gameState.lastTime = 0;
    }

    const env = {
        board,
        context,
        setStatus,
        setScoreboard,
        configureCanvas,
        emitParticles,
        drawParticles,
        clearParticles,
        stopLoop,
        ensureRunning() {
            if (!gameState.running) {
                startCurrentGame();
            }
        }
    };

    const games = {
        snake: new window.MiniGamesSnake(env),
        pong: new window.MiniGamesPong(env),
        arkanoid: new window.MiniGamesArkanoid(env)
    };

    function syncBoardSize() {
        if (currentGame) {
            currentGame.resize();
        }
    }

    function loop(timestamp) {
        if (!gameState.running) {
            return;
        }

        if (!gameState.lastTime) {
            gameState.lastTime = timestamp;
        }

        const deltaMs = Math.min(32, timestamp - gameState.lastTime);
        const frameFactor = deltaMs / frameDuration;
        gameState.lastTime = timestamp;

        updateParticles(frameFactor);
        currentGame.update(deltaMs, frameFactor);

        if (gameState.running) {
            currentGame.render();
            gameState.rafId = requestAnimationFrame(loop);
        }
    }

    function startLoop() {
        cancelFrameLoop();
        gameState.running = true;
        gameState.lastTime = 0;
        gameState.rafId = requestAnimationFrame(loop);
    }

    function startCurrentGame() {
        stopLoop();
        currentGame.start();
        startLoop();
    }

    function switchGame(gameName) {
        currentGameKey = gameName;
        currentGame = games[gameName];
        stopLoop();
        currentGame.activate();
    }

    document.addEventListener("keydown", (event) => {
        if (currentGame) {
            currentGame.handleKeyDown(event);
        }
    });

    document.addEventListener("keyup", (event) => {
        if (currentGame) {
            currentGame.handleKeyUp(event);
        }
    });

    padButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (currentGameKey === "snake") {
                currentGame.handlePadDown(button.dataset.pad);
            }
        });

        button.addEventListener("pointerdown", (event) => {
            if (!["pong", "arkanoid"].includes(currentGameKey)) {
                return;
            }

            event.preventDefault();
            currentGame.handlePadDown(button.dataset.pad);
        });

        ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
            button.addEventListener(eventName, () => {
                if (!["pong", "arkanoid"].includes(currentGameKey)) {
                    return;
                }

                currentGame.handlePadUp(button.dataset.pad);
            });
        });
    });

    const resizeObserver = new ResizeObserver(() => {
        syncBoardSize();
    });
    resizeObserver.observe(boardShell);

    window.addEventListener("resize", syncBoardSize);

    switchGame(getInitialGameKey());
}());
