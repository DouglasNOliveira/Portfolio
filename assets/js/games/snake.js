(function () {
    class SnakeGame {
        constructor(env) {
            this.env = env;
            this.storageKey = "portfolio-snake-high-score";
            this.meta = {
                title: "Snake",
                scoreLabel: "Pontuacao",
                highScoreLabel: "Recorde"
            };
            this.gridSize = 20;
            this.columns = 32;
            this.rows = 18;
            this.stepMs = 150;
            this.highScore = Number(localStorage.getItem(this.storageKey) || 0);
            this.accumulator = 0;
            this.resetState();
        }

        resetState() {
            this.snake = [
                { x: 10, y: 9 },
                { x: 9, y: 9 },
                { x: 8, y: 9 }
            ];
            this.direction = { x: 1, y: 0 };
            this.queuedDirection = { x: 1, y: 0 };
            this.food = { x: 10, y: 10 };
            this.score = 0;
            this.accumulator = 0;
            this.placeFood();
        }

        getMeta() {
            return this.meta;
        }

        activate() {
            this.env.clearParticles();
            this.resetState();
            this.env.configureCanvas(this.columns * this.gridSize, this.rows * this.gridSize);
            this.env.setScoreboard(0, this.highScore, this.meta);
            this.env.setStatus("Snake pronto.");
            this.render();
        }

        start() {
            this.env.clearParticles();
            this.resetState();
            this.env.setScoreboard(0, this.highScore, this.meta);
            this.env.setStatus("Jogando.");
            this.render();
        }

        resize() {
            this.env.configureCanvas(this.columns * this.gridSize, this.rows * this.gridSize);
            this.render();
        }

        randomCell(max) {
            return Math.floor(Math.random() * max);
        }

        placeFood() {
            do {
                this.food = {
                    x: this.randomCell(this.columns),
                    y: this.randomCell(this.rows)
                };
            } while (this.snake.some((segment) => segment.x === this.food.x && segment.y === this.food.y));
        }

        updateScore(nextScore) {
            this.score = nextScore;

            if (this.score > this.highScore) {
                this.highScore = this.score;
                localStorage.setItem(this.storageKey, String(this.highScore));
            }

            this.env.setScoreboard(this.score, this.highScore, this.meta);
        }

        setDirection(directionName) {
            const directions = {
                up: { x: 0, y: -1 },
                down: { x: 0, y: 1 },
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 }
            };
            const candidate = directions[directionName];

            if (!candidate) {
                return;
            }

            const isOpposite =
                candidate.x === -this.direction.x &&
                candidate.y === -this.direction.y;

            if (!isOpposite) {
                this.queuedDirection = candidate;
                this.env.ensureRunning();
            }
        }

        handleKeyDown(event) {
            const directionMap = {
                ArrowUp: "up",
                ArrowDown: "down",
                ArrowLeft: "left",
                ArrowRight: "right"
            };
            const nextMove = directionMap[event.key];

            if (nextMove) {
                event.preventDefault();
                this.setDirection(nextMove);
            }
        }

        handleKeyUp() {}

        handlePadDown(directionName) {
            this.setDirection(directionName);
        }

        handlePadUp() {}

        stepOnce() {
            this.direction = this.queuedDirection;
            const head = {
                x: (this.snake[0].x + this.direction.x + this.columns) % this.columns,
                y: (this.snake[0].y + this.direction.y + this.rows) % this.rows
            };

            const hitSelf = this.snake.some((segment) => segment.x === head.x && segment.y === head.y);
            if (hitSelf) {
                this.render();
                this.env.stopLoop();
                this.env.setStatus(`Fim de jogo. ${this.score} pontos.`);
                return false;
            }

            this.snake.unshift(head);

            if (head.x === this.food.x && head.y === this.food.y) {
                this.updateScore(this.score + 10);
                this.env.emitParticles(
                    head.x * this.gridSize + this.gridSize / 2,
                    head.y * this.gridSize + this.gridSize / 2,
                    "#ff8a80",
                    12,
                    5,
                    5
                );
                this.placeFood();
                this.env.setStatus("Mais 10 pontos.");
            } else {
                this.snake.pop();
            }

            return true;
        }

        update(deltaMs) {
            this.accumulator += deltaMs;

            while (this.accumulator >= this.stepMs) {
                const shouldContinue = this.stepOnce();
                this.accumulator -= this.stepMs;

                if (!shouldContinue) {
                    break;
                }
            }
        }

        drawCell(x, y, color, radius) {
            const context = this.env.context;
            context.fillStyle = color;
            context.beginPath();
            context.roundRect(
                x * this.gridSize + 2,
                y * this.gridSize + 2,
                this.gridSize - 4,
                this.gridSize - 4,
                radius,
            );
            context.fill();
        }

        render() {
            const context = this.env.context;
            const logicalWidth = this.columns * this.gridSize;
            const logicalHeight = this.rows * this.gridSize;
            context.clearRect(0, 0, logicalWidth, logicalHeight);
            context.fillStyle = "#10263b";
            context.fillRect(0, 0, logicalWidth, logicalHeight);
            context.strokeStyle = "rgba(255, 255, 255, 0.05)";
            context.lineWidth = 1;

            for (let index = 0; index <= this.columns; index += 1) {
                const position = index * this.gridSize;
                context.beginPath();
                context.moveTo(position, 0);
                context.lineTo(position, logicalHeight);
                context.stroke();
            }

            for (let index = 0; index <= this.rows; index += 1) {
                const position = index * this.gridSize;
                context.beginPath();
                context.moveTo(0, position);
                context.lineTo(logicalWidth, position);
                context.stroke();
            }

            this.drawCell(this.food.x, this.food.y, "#ff6b6b", 10);

            this.snake.forEach((segment, index) => {
                this.drawCell(segment.x, segment.y, index === 0 ? "#7ef29a" : "#36c275", 6);
            });

            this.env.drawParticles();
        }
    }

    window.MiniGamesSnake = SnakeGame;
}());
