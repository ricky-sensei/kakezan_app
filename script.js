(() => {
  const STORAGE_KEY = "kakezan-app-problem-stats-v1";
  const MAX_INPUT_LENGTH = 2;

  const AUDIO_FILES = {
    correct: "./sounds/correct.mp3",
    wrong: "./sounds/wrong.mp3",
    clear: "./sounds/clear.mp3",
    gameOver: "./sounds/gameOver.mp3",
  };
  const BGM_FILE = "./sounds/clock.mp3";

  const timeLeftEl = document.querySelector("#timeLeft");
  const correctCountEl = document.querySelector("#correctCount");
  const scoreTotalEl = document.querySelector("#scoreTotal");
  const questionEl = document.querySelector("#question");
  const feedbackEl = document.querySelector("#feedback");
  const answerDisplayEl = document.querySelector("#answerDisplay");
  const bombEl = document.querySelector("#bomb");
  const overlayEl = document.querySelector("#resultOverlay");
  const resultTitleEl = document.querySelector("#resultTitle");
  const resultMessageEl = document.querySelector("#resultMessage");
  const retryButton = document.querySelector("#retryButton");
  const menuButton = document.querySelector("#menuButton");
  const enterButton = document.querySelector("#enterButton");
  const clearButton = document.querySelector("#clearButton");
  const countdownOverlayEl = document.querySelector("#countdownOverlay");
  const countdownNumberEl = document.querySelector("#countdownNumber");

  const settings = readSettings();

  const audioSlots = Object.fromEntries(
    Object.entries(AUDIO_FILES).map(([name, src]) => [name, src ? new Audio(src) : null]),
  );

  const bgm = new Audio(BGM_FILE);
  bgm.loop = true;

  const problems = createProblems(settings.dan);

  function readSettings() {
    const params = new URLSearchParams(window.location.search);
    const seconds = Number(params.get("seconds"));
    const target = Number(params.get("target"));
    const danParam = params.get("dan") || "all";
    const dan = danParam === "all" ? "all" : Number(danParam);

    return {
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 30,
      target: Number.isInteger(target) && target > 0 ? target : 10,
      dan: dan === "all" || (Number.isInteger(dan) && dan >= 1 && dan <= 9) ? dan : "all",
      sound: params.get("sound") !== "off",
    };
  }

  function createProblems(dan) {
    const list = [];
    const leftStart = dan === "all" ? 1 : dan;
    const leftEnd = dan === "all" ? 9 : dan;

    for (let left = leftStart; left <= leftEnd; left += 1) {
      for (let right = 1; right <= 9; right += 1) {
        list.push({
          id: `${left}x${right}`,
          left,
          right,
          product: left * right,
        });
      }
    }
    return list;
  }

  let stats = loadStats();
  let currentProblem = null;
  let hiddenPart = "product";
  let input = "";
  let correctCount = 0;
  let startTime = 0;
  let timerId = 0;
  let isRunning = false;
  let lastProblemId = "";

  function loadStats() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveStats() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // 保存できない環境でもゲーム本体は続ける。
    }
  }

  function playSound(name) {
    const audio = audioSlots[name];
    if (!settings.sound || !audio) return;

    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function startBgm() {
    if (!settings.sound) return;
    bgm.currentTime = 0;
    bgm.play().catch(() => {
      // 自動再生が止められたときは、最初のタップで鳴らし始める。
      document.addEventListener(
        "pointerdown",
        () => {
          if (isRunning) bgm.play().catch(() => {});
        },
        { once: true },
      );
    });
  }

  function stopBgm() {
    bgm.pause();
    bgm.currentTime = 0;
  }

  function getProblemWeight(problem) {
    const problemStats = stats[problem.id];
    if (!problemStats) return 1;

    const wrong = problemStats.wrong || 0;
    const total = (problemStats.correct || 0) + wrong;
    if (total === 0) return 1;

    const wrongRate = wrong / total;
    return 1 + wrongRate * 2.2;
  }

  function pickProblem() {
    const weighted = problems.map((problem) => ({
      problem,
      weight: getProblemWeight(problem) * (problem.id === lastProblemId ? 0.25 : 1),
    }));
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * totalWeight;

    for (const item of weighted) {
      cursor -= item.weight;
      if (cursor <= 0) {
        lastProblemId = item.problem.id;
        return item.problem;
      }
    }

    return weighted[weighted.length - 1].problem;
  }

  function pickHiddenPart() {
    const parts = settings.dan === "all" ? ["left", "right", "product"] : ["right", "product"];
    return parts[Math.floor(Math.random() * parts.length)];
  }

  function getAnswer(problem, part) {
    if (part === "left") return problem.left;
    if (part === "right") return problem.right;
    return problem.product;
  }

  function termHtml(value, part) {
    if (hiddenPart === part) {
      return `<span class="blank">${input || ""}</span>`;
    }
    return `<span class="term">${value}</span>`;
  }

  function renderQuestion() {
    questionEl.innerHTML = [
      termHtml(currentProblem.left, "left"),
      '<span class="operator">×</span>',
      termHtml(currentProblem.right, "right"),
      '<span class="operator">=</span>',
      termHtml(currentProblem.product, "product"),
    ].join("");
  }

  function updateAnswerDisplay() {
    answerDisplayEl.textContent = input || "_";
    renderQuestion();
  }

  function setFeedback(message, type) {
    feedbackEl.textContent = message;
    feedbackEl.className = `feedback${type ? ` ${type}` : ""}`;
  }

  function nextQuestion() {
    currentProblem = pickProblem();
    hiddenPart = pickHiddenPart();
    input = "";
    updateAnswerDisplay();
    setFeedback("", "");
  }

  function recordAnswer(isCorrect) {
    const problemStats = stats[currentProblem.id] || { correct: 0, wrong: 0 };
    if (isCorrect) {
      problemStats.correct += 1;
    } else {
      problemStats.wrong += 1;
    }
    stats[currentProblem.id] = problemStats;
    saveStats();
  }

  function submitAnswer() {
    if (!isRunning || input.length === 0) return;

    const answer = Number(input);
    const expected = getAnswer(currentProblem, hiddenPart);
    const isCorrect = answer === expected;
    recordAnswer(isCorrect);

    if (isCorrect) {
      correctCount += 1;
      correctCountEl.textContent = String(correctCount);
      setFeedback("せいかい!", "correct");
      playSound("correct");

      if (correctCount >= settings.target) {
        endGame(true);
        return;
      }

      window.setTimeout(() => {
        if (isRunning) nextQuestion();
      }, 280);
    } else {
      setFeedback("もういちど", "wrong");
      input = "";
      updateAnswerDisplay();
      playSound("wrong");
    }
  }

  function updateTimer() {
    if (!isRunning) return;

    const elapsed = (performance.now() - startTime) / 1000;
    const remaining = Math.max(0, settings.seconds - elapsed);
    const progress = Math.min(1, elapsed / settings.seconds);

    timeLeftEl.textContent = remaining.toFixed(1);
    bombEl.style.setProperty("--bomb-scale", (0.7 + progress * 1.55).toFixed(3));
    bombEl.classList.toggle("warning", remaining <= 8);

    if (remaining <= 0) {
      endGame(false);
      return;
    }

    timerId = window.requestAnimationFrame(updateTimer);
  }

  function endGame(isClear) {
    if (!isRunning) return;

    isRunning = false;
    window.cancelAnimationFrame(timerId);
    stopBgm();
    bombEl.classList.remove("warning");

    if (isClear) {
      resultTitleEl.textContent = "クリア!";
      resultMessageEl.textContent = `${correctCount}もん せいかい`;
      playSound("clear");
    } else {
      timeLeftEl.textContent = "0.0";
      bombEl.classList.add("exploded");
      resultTitleEl.textContent = "GAME OVER";
      resultMessageEl.textContent = `${correctCount}もん せいかい`;
      playSound("gameOver");
    }

    window.setTimeout(() => {
      overlayEl.hidden = false;
    }, isClear ? 150 : 520);
  }

  function resetGame() {
    correctCount = 0;
    input = "";
    isRunning = false;

    correctCountEl.textContent = "0";
    scoreTotalEl.textContent = `/${settings.target}`;
    timeLeftEl.textContent = settings.seconds.toFixed(1);
    answerDisplayEl.textContent = "_";
    overlayEl.hidden = true;
    countdownOverlayEl.hidden = false;
    bombEl.classList.remove("warning", "exploded");
    bombEl.style.setProperty("--bomb-scale", "0.7");

    nextQuestion();
    window.cancelAnimationFrame(timerId);
    startCountdown();
  }

  function startCountdown() {
    let count = 3;
    countdownNumberEl.textContent = String(count);
    restartCountdownAnimation();

    const countdownId = window.setInterval(() => {
      count -= 1;

      if (count <= 0) {
        window.clearInterval(countdownId);
        countdownOverlayEl.hidden = true;
        startTime = performance.now();
        isRunning = true;
        timerId = window.requestAnimationFrame(updateTimer);
        startBgm();
        return;
      }

      countdownNumberEl.textContent = String(count);
      restartCountdownAnimation();
    }, 900);
  }

  function restartCountdownAnimation() {
    countdownNumberEl.style.animation = "none";
    countdownNumberEl.offsetHeight;
    countdownNumberEl.style.animation = "";
  }

  function appendNumber(numberText) {
    if (!isRunning) return;
    if (input.length >= MAX_INPUT_LENGTH) return;
    if (input === "0") {
      input = numberText;
    } else {
      input += numberText;
    }
    updateAnswerDisplay();
  }

  document.querySelectorAll("[data-number]").forEach((button) => {
    button.addEventListener("click", () => appendNumber(button.dataset.number));
  });

  clearButton.addEventListener("click", () => {
    if (!isRunning) return;
    input = "";
    updateAnswerDisplay();
    setFeedback("", "");
  });

  enterButton.addEventListener("click", submitAnswer);
  retryButton.addEventListener("click", resetGame);
  menuButton.addEventListener("click", () => {
    window.location.href = "./index.html";
  });

  resetGame();
})();
