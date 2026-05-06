(function () {
    class ArkanoidGame {
        constructor(env) {
            this.env = env;
            this.storageKey = "portfolio-arkanoid-high-score";
            this.secretCode = "douglas";
            this.debugWinCode = "vencer";
            this.meta = {
                title: "Arkanoid",
                lives: 2,
                scoreLabel: "Pontos",
                highScoreLabel: "Recorde"
            };
            this.width = 640;
            this.height = 360;
            this.paddleWidth = 96;
            this.paddleHeight = 14;
            this.paddleSpeed = 8;
            this.ballSize = 10;
            this.highScore = Number(localStorage.getItem(this.storageKey) || 0);
            this.resetState();
        }

        resetState() {
            this.score = 0;
            this.lives = 2;
            this.secretBuffer = "";
            this.hasWon = false;
            this.moveDirection = 0;
            this.powerUps = [];
            this.paddleX = (this.width - this.paddleWidth) / 2;
            this.paddleY = this.height - 32;
            this.ballSpeedCap = 5.2;
            this.bricks = this.createBricks();
            this.resetBall();
        }

        createBall(x, y, vx, vy) {
            return {
                x,
                y,
                vx,
                vy,
                size: this.ballSize
            };
        }

        resetBall() {
            this.paddleX = (this.width - this.paddleWidth) / 2;
            this.balls = [
                this.createBall(
                    this.width / 2 - this.ballSize / 2,
                    this.paddleY - this.ballSize - 10,
                    Math.random() > 0.5 ? 2.8 : -2.8,
                    -2.8
                )
            ];
            this.powerUps = [];
        }

        createBricks() {
            const rows = 5;
            const columns = 12;
            const brickWidth = 42;
            const brickHeight = 14;
            const gap = 6;
            const startY = 28;
            const colors = ["#ff7b72", "#ffad5a", "#ffd166", "#73d29a", "#73c9ff"];
            const bricks = [];
            const totalWidth = columns * brickWidth + (columns - 1) * gap;
            const startX = (this.width - totalWidth) / 2;

            for (let row = 0; row < rows; row += 1) {
                for (let column = 0; column < columns; column += 1) {
                    const strength = rows - row;
                    bricks.push({
                        x: startX + column * (brickWidth + gap),
                        y: startY + row * (brickHeight + gap),
                        width: brickWidth,
                        height: brickHeight,
                        alive: true,
                        color: colors[row % colors.length],
                        strength,
                        maxStrength: strength
                    });
                }
            }

            return bricks;
        }

        activate() {
            this.env.clearParticles();
            this.resetState();
            this.env.configureCanvas(this.width, this.height);
            this.syncHud();
            this.env.setStatus("Arkanoid pronto.");
            this.render();
        }

        start() {
            this.env.clearParticles();
            this.resetState();
            this.syncHud();
            this.env.setStatus("Jogando.");
            this.render();
        }

        resize() {
            this.env.configureCanvas(this.width, this.height);
            this.render();
        }

        updateScore(nextScore) {
            this.score = nextScore;

            if (this.score > this.highScore) {
                this.highScore = this.score;
                localStorage.setItem(this.storageKey, String(this.highScore));
            }

            this.env.setScoreboard(this.score, this.highScore, this.meta);
        }

        syncHud() {
            this.meta.lives = this.lives;
            this.env.setScoreboard(this.score, this.highScore, this.meta);
        }

        maybeSpawnPowerUp(brick) {
            const roll = Math.random();
            let type = null;

            if (roll < 0.1) {
                type = "multiball";
            } else if (roll < 0.125) {
                type = "extra-life";
            }

            if (!type) {
                return;
            }

            this.powerUps.push({
                type,
                x: brick.x + brick.width / 2 - 16,
                y: brick.y + brick.height / 2 - 16,
                width: 32,
                height: 18,
                vy: 2.15
            });
        }

        spawnMultiball(sourceBall) {
            const baseSpeed = Math.max(2.8, Math.min(this.ballSpeedCap, Math.hypot(sourceBall.vx, sourceBall.vy)));
            const directions = [-0.9, 0.9];

            directions.forEach((direction) => {
                if (this.balls.length >= 3) {
                    return;
                }

                this.balls.push(
                    this.createBall(
                        sourceBall.x,
                        sourceBall.y,
                        baseSpeed * direction,
                        -Math.abs(baseSpeed * 0.92)
                    )
                );
            });

            this.env.setStatus("Multiball ativado.");
        }

        updatePowerUps(frameFactor) {
            const nextPowerUps = [];

            this.powerUps.forEach((powerUp) => {
                powerUp.y += powerUp.vy * frameFactor;

                const touchesPaddle =
                    powerUp.y + powerUp.height >= this.paddleY &&
                    powerUp.y <= this.paddleY + this.paddleHeight &&
                    powerUp.x + powerUp.width >= this.paddleX &&
                    powerUp.x <= this.paddleX + this.paddleWidth;

                if (touchesPaddle) {
                    if (powerUp.type === "multiball") {
                        this.spawnMultiball(this.balls[0] || this.createBall(this.paddleX, this.paddleY, 2.8, -2.8));
                    }

                    if (powerUp.type === "extra-life") {
                        this.lives += 1;
                        this.syncHud();
                        this.env.setStatus(`Vida extra: ${this.lives} vidas.`);
                    }

                    this.env.emitParticles(
                        powerUp.x + powerUp.width / 2,
                        powerUp.y + powerUp.height / 2,
                        powerUp.type === "extra-life" ? "#ff6b8a" : "#73c9ff",
                        12,
                        6,
                        6
                    );
                    return;
                }

                if (powerUp.y <= this.height) {
                    nextPowerUps.push(powerUp);
                }
            });

            this.powerUps = nextPowerUps;
        }

        trackSecretCode(key) {
            this.secretBuffer = `${this.secretBuffer}${String(key).toLowerCase()}`
                .slice(-Math.max(this.secretCode.length, this.debugWinCode.length));

            if (this.secretBuffer.endsWith(this.secretCode)) {
                this.secretBuffer = "";
                this.lives += 1;
                this.syncHud();
                this.env.setStatus(`Codigo secreto: ${this.lives} vidas.`);
                return;
            }

            if (this.secretBuffer.endsWith(this.debugWinCode)) {
                this.secretBuffer = "";
                this.forceWin();
            }
        }

        forceWin() {
            this.bricks.forEach((brick) => {
                brick.alive = false;
                brick.strength = 0;
            });
            this.hasWon = true;
            this.syncHud();
            this.render();
            this.env.stopLoop();
            this.moveDirection = 0;
            this.env.setStatus("Codigo debug: vitoria instantanea.");
        }

        handleKeyDown(event) {
            if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
                this.trackSecretCode(event.key);
            }

            if (event.key === "ArrowLeft") {
                event.preventDefault();
                this.setMoveDirection("left", true);
            }

            if (event.key === "ArrowRight") {
                event.preventDefault();
                this.setMoveDirection("right", true);
            }
        }

        handleKeyUp(event) {
            if (event.key === "ArrowLeft") {
                this.setMoveDirection("left", false);
            }

            if (event.key === "ArrowRight") {
                this.setMoveDirection("right", false);
            }
        }

        handlePadDown(directionName) {
            this.setMoveDirection(directionName, true);
        }

        handlePadUp(directionName) {
            this.setMoveDirection(directionName, false);
        }

        setMoveDirection(directionName, isPressed) {
            const validDirections = {
                left: -1,
                right: 1
            };
            const resolvedDirection = validDirections[directionName];

            if (!resolvedDirection) {
                return;
            }

            if (!isPressed) {
                if (this.moveDirection === resolvedDirection) {
                    this.moveDirection = 0;
                }
                return;
            }

            this.moveDirection = resolvedDirection;
            this.env.ensureRunning();
        }

        updatePaddle(frameFactor) {
            if (this.moveDirection === 0) {
                return;
            }

            this.paddleX += this.moveDirection * this.paddleSpeed * frameFactor;
            this.paddleX = Math.max(0, Math.min(this.width - this.paddleWidth, this.paddleX));
        }

        collideBallWithBrick(ball, previousX, previousY) {
            const ballLeft = ball.x;
            const ballRight = ball.x + ball.size;
            const ballTop = ball.y;
            const ballBottom = ball.y + ball.size;
            const previousLeft = previousX;
            const previousRight = previousX + ball.size;
            const previousTop = previousY;
            const previousBottom = previousY + ball.size;

            for (const brick of this.bricks) {
                if (!brick.alive) {
                    continue;
                }

                const overlaps =
                    ballRight >= brick.x &&
                    ballLeft <= brick.x + brick.width &&
                    ballBottom >= brick.y &&
                    ballTop <= brick.y + brick.height;

                if (!overlaps) {
                    continue;
                }

                brick.strength -= 1;
                this.env.emitParticles(
                    brick.x + brick.width / 2,
                    brick.y + brick.height / 2,
                    brick.color,
                    10,
                    6,
                    6
                );

                if (brick.strength <= 0) {
                    brick.alive = false;
                    this.updateScore(this.score + 10);
                    this.maybeSpawnPowerUp(brick);
                    this.env.setStatus("Bloco destruido.");
                } else {
                    this.env.setStatus(`Bloco resistente: ${brick.strength}.`);
                }

                const hitFromLeft = previousRight <= brick.x;
                const hitFromRight = previousLeft >= brick.x + brick.width;
                const hitFromTop = previousBottom <= brick.y;
                const hitFromBottom = previousTop >= brick.y + brick.height;

                if (hitFromLeft || hitFromRight) {
                    ball.vx *= -1;
                } else if (hitFromTop || hitFromBottom) {
                    ball.vy *= -1;
                } else {
                    ball.vy *= -1;
                }

                const speedBoost = 0.03;
                ball.vx = Math.max(-this.ballSpeedCap, Math.min(this.ballSpeedCap, ball.vx * (1 + speedBoost)));
                ball.vy = Math.max(-this.ballSpeedCap, Math.min(this.ballSpeedCap, ball.vy * (1 + speedBoost)));
                return true;
            }

            return false;
        }

        update(deltaMs, frameFactor) {
            this.updatePaddle(frameFactor);
            const nextBalls = [];

            this.balls.forEach((ball) => {
                const previousX = ball.x;
                const previousY = ball.y;

                ball.x += ball.vx * frameFactor;
                ball.y += ball.vy * frameFactor;

                if (ball.x <= 0) {
                    ball.x = 0;
                    ball.vx *= -1;
                }

                if (ball.x + ball.size >= this.width) {
                    ball.x = this.width - ball.size;
                    ball.vx *= -1;
                }

                if (ball.y <= 0) {
                    ball.y = 0;
                    ball.vy *= -1;
                }

                const hitsPaddle =
                    ball.y + ball.size >= this.paddleY &&
                    ball.y <= this.paddleY + this.paddleHeight &&
                    ball.x + ball.size >= this.paddleX &&
                    ball.x <= this.paddleX + this.paddleWidth &&
                    ball.vy > 0;

                if (hitsPaddle) {
                    const paddleCenter = this.paddleX + this.paddleWidth / 2;
                    const ballCenter = ball.x + ball.size / 2;
                    const offset = (ballCenter - paddleCenter) / (this.paddleWidth / 2);
                    ball.y = this.paddleY - ball.size;
                    ball.vy = -Math.abs(ball.vy);
                    ball.vx = Math.max(-this.ballSpeedCap, Math.min(this.ballSpeedCap, offset * 4.1));
                    this.env.emitParticles(ballCenter, this.paddleY, "#73c9ff", 8, 6, 5);
                }

                this.collideBallWithBrick(ball, previousX, previousY);

                if (ball.y <= this.height) {
                    nextBalls.push(ball);
                }
            });

            this.balls = nextBalls;
            this.updatePowerUps(frameFactor);

            if (this.bricks.every((brick) => !brick.alive)) {
                this.hasWon = true;
                this.render();
                this.env.stopLoop();
                this.moveDirection = 0;
                this.env.setStatus(`Voce venceu. ${this.score} pontos.`);
                return;
            }

            if (this.balls.length === 0) {
                this.moveDirection = 0;
                this.lives -= 1;

                if (this.lives <= 0) {
                    this.render();
                    this.syncHud();
                    this.env.stopLoop();
                    this.env.setStatus(`Fim de jogo. ${this.score} pontos.`);
                    return;
                }

                this.resetBall();
                this.syncHud();
                this.env.setStatus(`${this.lives} ${this.lives === 1 ? "vida restante." : "vidas restantes."}`);
            }
        }

        render() {
            const context = this.env.context;
            context.clearRect(0, 0, this.width, this.height);
            context.fillStyle = "#0f1f30";
            context.fillRect(0, 0, this.width, this.height);

            context.strokeStyle = "rgba(255, 255, 255, 0.05)";
            context.lineWidth = 1;

            for (let x = 0; x <= this.width; x += 20) {
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, this.height);
                context.stroke();
            }

            for (let y = 0; y <= this.height; y += 20) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(this.width, y);
                context.stroke();
            }

            this.bricks.forEach((brick) => {
                if (!brick.alive) {
                    return;
                }

                const alpha = 0.45 + (brick.strength / brick.maxStrength) * 0.55;
                context.fillStyle = brick.color;
                context.globalAlpha = alpha;
                context.beginPath();
                context.roundRect(brick.x, brick.y, brick.width, brick.height, 6);
                context.fill();
                context.globalAlpha = 1;

                if (brick.strength > 1) {
                    context.fillStyle = "#0f1f30";
                    context.font = "700 11px Manrope, sans-serif";
                    context.textAlign = "center";
                    context.textBaseline = "middle";
                    context.fillText(
                        String(brick.strength),
                        brick.x + brick.width / 2,
                        brick.y + brick.height / 2 + 0.5
                    );
                }
            });

            context.fillStyle = "#7ef29a";
            context.beginPath();
            context.roundRect(this.paddleX, this.paddleY, this.paddleWidth, this.paddleHeight, 10);
            context.fill();

            this.balls.forEach((ball) => {
                context.fillStyle = "#ff6b6b";
                context.beginPath();
                context.arc(
                    ball.x + ball.size / 2,
                    ball.y + ball.size / 2,
                    ball.size / 2,
                    0,
                    Math.PI * 2
                );
                context.fill();
            });

            this.powerUps.forEach((powerUp) => {
                context.fillStyle = powerUp.type === "extra-life" ? "#ff6b8a" : "#73c9ff";
                context.beginPath();
                context.roundRect(powerUp.x, powerUp.y, powerUp.width, powerUp.height, 8);
                context.fill();

                context.fillStyle = "#0f1f30";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.font = "800 11px Manrope, sans-serif";
                context.fillText(
                    powerUp.type === "extra-life" ? "+1" : "3x",
                    powerUp.x + powerUp.width / 2,
                    powerUp.y + powerUp.height / 2 + 0.5
                );
            });

            if (this.hasWon) {
                context.fillStyle = "rgba(7, 17, 28, 0.72)";
                context.fillRect(112, 134, 416, 92);
                context.fillStyle = "#ffffff";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.font = "800 28px Manrope, sans-serif";
                context.fillText("Você venceu!", this.width / 2, 168);
                context.font = "700 20px Manrope, sans-serif";
                context.fillStyle = "#7ef29a";
                context.fillText("Me contrata aí", this.width / 2, 200);
            }

            this.env.drawParticles();
        }
    }

    window.MiniGamesArkanoid = ArkanoidGame;
}());
