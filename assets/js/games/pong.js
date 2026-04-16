(function () {
    class PongGame {
        constructor(env) {
            this.env = env;
            this.storageKey = "portfolio-pong-high-score";
            this.meta = {
                title: "Pong",
                scoreLabel: "Pontos",
                highScoreLabel: "Melhor placar"
            };
            this.width = 640;
            this.height = 360;
            this.paddleHeight = 84;
            this.paddleWidth = 14;
            this.paddleSpeed = 8;
            this.aiSpeed = 3.2;
            this.ballSize = 12;
            this.highScore = Number(localStorage.getItem(this.storageKey) || 0);
            this.difficulty = "medium";
            this.difficultyConfig = {
                easy: { aiSpeed: 2.3, aimError: 120, retargetNear: 20, retargetFar: 34, deadZone: 24 },
                medium: { aiSpeed: 3.2, aimError: 90, retargetNear: 12, retargetFar: 20, deadZone: 18 },
                hard: { aiSpeed: 4.4, aimError: 56, retargetNear: 8, retargetFar: 14, deadZone: 12 }
            };
            this.resetState();
        }

        resetState() {
            this.score = 0;
            this.playerY = (this.height - this.paddleHeight) / 2;
            this.aiY = (this.height - this.paddleHeight) / 2;
            this.ballX = this.width / 2;
            this.ballY = this.height / 2;
            this.ballVX = 4;
            this.ballVY = 3;
            this.moveDirection = 0;
            this.aiTargetY = this.aiY;
            this.aiRetargetFrames = 0;
        }

        getMeta() {
            return this.meta;
        }

        activate() {
            this.env.clearParticles();
            this.resetState();
            this.applyDifficulty();
            this.env.configureCanvas(this.width, this.height);
            this.env.setScoreboard(0, this.highScore, this.meta);
            this.env.setStatus("Pong pronto.");
            this.render();
        }

        start() {
            this.env.clearParticles();
            this.resetState();
            this.applyDifficulty();
            this.resetBall(-1);
            this.env.setScoreboard(0, this.highScore, this.meta);
            this.env.setStatus("Jogando.");
            this.render();
        }

        resize() {
            this.env.configureCanvas(this.width, this.height);
            this.render();
        }

        applyDifficulty() {
            const config = this.difficultyConfig[this.difficulty];
            this.aiSpeed = config.aiSpeed;
        }

        updateScore(nextScore) {
            this.score = nextScore;

            if (this.score > this.highScore) {
                this.highScore = this.score;
                localStorage.setItem(this.storageKey, String(this.highScore));
            }

            this.env.setScoreboard(this.score, this.highScore, this.meta);
        }

        resetBall(directionX) {
            this.ballX = this.width / 2;
            this.ballY = this.height / 2;
            this.ballVX = 4 * directionX;
            this.ballVY = Math.random() > 0.5 ? 3 : -3;
            this.aiRetargetFrames = 0;
        }

        handleKeyDown(event) {
            if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                event.preventDefault();
                this.setMoveDirection("up", true);
            }

            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                event.preventDefault();
                this.setMoveDirection("down", true);
            }
        }

        handleKeyUp(event) {
            if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                this.setMoveDirection("up", false);
            }

            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                this.setMoveDirection("down", false);
            }
        }

        handlePadDown(directionName) {
            this.setMoveDirection(directionName, true);
        }

        handlePadUp(directionName) {
            this.setMoveDirection(directionName, false);
        }

        setMoveDirection(directionName, isPressed) {
            const resolvedDirection = directionName === "up" || directionName === "left" ? -1 : 1;

            if (!isPressed) {
                if (this.moveDirection === resolvedDirection) {
                    this.moveDirection = 0;
                }
                return;
            }

            this.moveDirection = resolvedDirection;
            this.env.ensureRunning();
        }

        updatePlayerPosition(frameFactor) {
            if (this.moveDirection === 0) {
                return;
            }

            const delta = this.moveDirection * this.paddleSpeed * frameFactor;
            this.playerY = Math.max(0, Math.min(this.height - this.paddleHeight, this.playerY + delta));
        }

        update(deltaMs, frameFactor) {
            this.updatePlayerPosition(frameFactor);
            this.ballX += this.ballVX * frameFactor;
            this.ballY += this.ballVY * frameFactor;

            if (this.ballY <= 0 || this.ballY + this.ballSize >= this.height) {
                this.ballVY *= -1;
                this.env.emitParticles(this.ballX, Math.max(0, Math.min(this.height, this.ballY)), "#73c9ff", 6, 4, 4);
            }

            const difficulty = this.difficultyConfig[this.difficulty];
            const aiCenter = this.aiY + this.paddleHeight / 2;
            const ballCenter = this.ballY + this.ballSize / 2;

            this.aiRetargetFrames -= frameFactor;
            if (this.aiRetargetFrames <= 0) {
                const randomOffset = (Math.random() - 0.5) * difficulty.aimError;
                const fallbackCenter = this.height / 2;
                const desiredCenter = this.ballVX > 0 ? ballCenter + randomOffset : fallbackCenter;
                this.aiTargetY = desiredCenter - this.paddleHeight / 2;
                this.aiRetargetFrames = this.ballVX > 0 ? difficulty.retargetNear : difficulty.retargetFar;
            }

            const aiTargetCenter = this.aiTargetY + this.paddleHeight / 2;
            if (Math.abs(aiCenter - aiTargetCenter) > difficulty.deadZone) {
                this.aiY += (aiCenter < aiTargetCenter ? this.aiSpeed : -this.aiSpeed) * frameFactor;
                this.aiY = Math.max(0, Math.min(this.height - this.paddleHeight, this.aiY));
            }

            const hitsPlayer =
                this.ballX <= 24 + this.paddleWidth &&
                this.ballX + this.ballSize >= 24 &&
                this.ballY + this.ballSize >= this.playerY &&
                this.ballY <= this.playerY + this.paddleHeight;

            const hitsAi =
                this.ballX + this.ballSize >= this.width - 24 - this.paddleWidth &&
                this.ballX <= this.width - 24 &&
                this.ballY + this.ballSize >= this.aiY &&
                this.ballY <= this.aiY + this.paddleHeight;

            if (hitsPlayer && this.ballVX < 0) {
                this.ballVX *= -1;
                this.ballVY += (this.ballY + this.ballSize / 2 - (this.playerY + this.paddleHeight / 2)) / 18;
                this.env.emitParticles(32, this.ballY + this.ballSize / 2, "#7ef29a", 8, 6, 6);
                this.env.setStatus("Boa defesa.");
            }

            if (hitsAi && this.ballVX > 0) {
                this.ballVX *= -1;
                this.ballVY += (this.ballY + this.ballSize / 2 - (this.aiY + this.paddleHeight / 2)) / 20;
                this.env.emitParticles(this.width - 32, this.ballY + this.ballSize / 2, "#73c9ff", 6, 5, 5);
            }

            if (this.ballX < 0) {
                this.render();
                this.env.stopLoop();
                this.moveDirection = 0;
                this.env.setStatus(`Fim de jogo. ${this.score} pontos.`);
                return;
            }

            if (this.ballX > this.width) {
                this.updateScore(this.score + 1);
                this.env.emitParticles(this.width - 18, this.ballY + this.ballSize / 2, "#ffd166", 18, 9, 9);
                this.resetBall(-1);
                this.env.setStatus("Ponto seu.");
            }
        }

        render() {
            const context = this.env.context;
            context.clearRect(0, 0, this.width, this.height);
            context.fillStyle = "#0f1f30";
            context.fillRect(0, 0, this.width, this.height);

            context.strokeStyle = "rgba(255, 255, 255, 0.2)";
            context.lineWidth = 3;
            context.setLineDash([10, 12]);
            context.beginPath();
            context.moveTo(this.width / 2, 0);
            context.lineTo(this.width / 2, this.height);
            context.stroke();
            context.setLineDash([]);

            context.fillStyle = "#7ef29a";
            context.fillRect(24, this.playerY, this.paddleWidth, this.paddleHeight);

            context.fillStyle = "#73c9ff";
            context.fillRect(
                this.width - 24 - this.paddleWidth,
                this.aiY,
                this.paddleWidth,
                this.paddleHeight,
            );

            context.fillStyle = "#ff6b6b";
            context.fillRect(this.ballX, this.ballY, this.ballSize, this.ballSize);
            this.env.drawParticles();
        }
    }

    window.MiniGamesPong = PongGame;
}());
