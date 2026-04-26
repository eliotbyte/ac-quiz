// Quiz prototype (no build step).

const DATA = {
  villagersUrl: "./files/villagers.json",
  difficultyUrl: "./files/gender_difficulty.json",
};

function hashStringToU32(s) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todaySeedStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sampleOne(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function formatBirthday(birthday) {
  const s = String(birthday ?? "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/);
  const month = (parts[0] ?? "").slice(0, 3);
  const rest = parts.slice(1).join(" ");
  return rest ? `${month} ${rest}` : month;
}

function metaLine(v) {
  const parts = [];
  if (v.personality) parts.push(v.personality);
  if (v.birthday) parts.push(formatBirthday(v.birthday));
  if (v.hobby) parts.push(v.hobby);
  return parts.join(", ");
}

function genderSymbol(g) {
  if (g === "M") return "♂";
  if (g === "F") return "♀";
  return "";
}

function genderWord(g) {
  if (g === "M") return "Male";
  if (g === "F") return "Female";
  return "";
}

async function loadDatabase() {
  const [villagersRes, diffRes] = await Promise.all([
    fetch(DATA.villagersUrl, { cache: "no-store" }),
    fetch(DATA.difficultyUrl, { cache: "no-store" }).catch(() => null),
  ]);
  const villagersJson = await villagersRes.json();
  const villagers = Array.isArray(villagersJson?.villagers) ? villagersJson.villagers : [];

  let diffMap = new Map();
  try {
    if (diffRes && diffRes.ok) {
      const diffJson = await diffRes.json();
      const rows = Array.isArray(diffJson?.difficulty) ? diffJson.difficulty : [];
      diffMap = new Map(rows.map((r) => [r.name, r.score]));
    }
  } catch {
    // ignore
  }

  const db = villagers
    .map((v) => {
      const difficulty = Number(diffMap.get(v.name) ?? 2);
      return {
        name: v.name,
        gender: v.gender,
        species: v.species,
        personality: v.personality,
        birthday: v.birthday,
        hobby: v.hobby,
        page_url: v.page_url,
        main_image_url: v.image_character_url,
        difficulty: [1, 2, 3].includes(difficulty) ? difficulty : 2,
      };
    })
    .filter((v) => v.name && v.main_image_url && v.species);

  const byName = new Map(db.map((v) => [v.name, v]));
  const bySpecies = new Map();
  for (const v of db) {
    if (!bySpecies.has(v.species)) bySpecies.set(v.species, []);
    bySpecies.get(v.species).push(v);
  }

  return { db, byName, bySpecies };
}

// Question types:
// - name_image: guess name from normal image
// - name_silhouette: guess name from silhouette
// - gender: guess gender (M/F)
// - odd_species: find the one with different species (4 options)

function buildChoiceSetForName({ target, pool, rng, n = 4 }) {
  // IMPORTANT (DO NOT BREAK THIS): distractors MUST NOT share species with target.
  // If the target is a Dog, all other name options must be non-Dog, otherwise it gets confusing visually.
  const distractors = [];
  const candidates = pool.filter((v) => v.name !== target.name && v.species !== target.species);
  // remove near-duplicates just in case
  const uniq = uniqBy(candidates, (v) => v.name);
  shuffleInPlace(uniq, rng);
  for (const v of uniq) {
    distractors.push(v);
    if (distractors.length >= n - 1) break;
  }
  if (distractors.length < n - 1) {
    // fallback: allow same species (should not happen with 400+ db)
    const fallback = pool.filter((v) => v.name !== target.name);
    shuffleInPlace(fallback, rng);
    for (const v of fallback) {
      if (distractors.find((d) => d.name === v.name)) continue;
      distractors.push(v);
      if (distractors.length >= n - 1) break;
    }
  }
  const choices = shuffleInPlace([target, ...distractors], rng);
  return choices;
}

function buildOddOneOutBySpecies({ bySpecies, rng }) {
  // Pick a species with >=3 villagers
  const speciesWith3 = [...bySpecies.entries()].filter(([, vs]) => vs.length >= 3);
  const [sameSpecies, sameList] = sampleOne(speciesWith3, rng);
  const same = shuffleInPlace([...sameList], rng).slice(0, 3);

  // Pick a different species for odd one
  const otherSpecies = speciesWith3.filter(([sp]) => sp !== sameSpecies);
  const [oddSpecies, oddList] = sampleOne(otherSpecies, rng);
  const odd = sampleOne(oddList, rng);

  const options = shuffleInPlace([...same, odd], rng);
  const correctName = odd.name;
  return {
    type: "odd_species",
    prompt: "Who's the odd one out?",
    options: options.map((v) => ({ name: v.name, img: v.main_image_url, species: v.species })),
    correct: correctName,
    explain: `Three are ${sameSpecies}. The odd one is ${oddSpecies}.`,
    difficulty: 2,
  };
}

function buildOddOneOutByGender({ db, rng, hard = false }) {
  // Pick 3 villagers of one gender and 1 of the other.
  const males = db.filter((v) => v.gender === "M");
  const females = db.filter((v) => v.gender === "F");
  const majorityGender = rng() < 0.5 ? "M" : "F";
  const majorityPool = majorityGender === "M" ? males : females;
  const minorityPool = majorityGender === "M" ? females : males;

  const pick3 = (pool) => shuffleInPlace([...pool], rng).slice(0, 3);
  const pick1 = (pool) => sampleOne(pool, rng);

  let majority = pick3(majorityPool);
  let odd = pick1(minorityPool);

  if (hard) {
    // Use gender-difficulty scores (merged into v.difficulty) as a proxy for “hard to tell”.
    // We want the set to be overall higher difficulty.
    const hardMajority = majorityPool.filter((v) => v.difficulty >= 3);
    const hardMinority = minorityPool.filter((v) => v.difficulty >= 3);

    if (hardMajority.length >= 3) majority = pick3(hardMajority);
    if (hardMinority.length >= 1) odd = pick1(hardMinority);

    // fallback: accept mixed >=2.5 average
    const avg = (arr) => arr.reduce((s, v) => s + (v?.difficulty ?? 2), 0) / Math.max(1, arr.length);
    if (avg([...majority, odd]) < 2.5) {
      const maj2 = majorityPool.filter((v) => v.difficulty >= 2);
      const min2 = minorityPool.filter((v) => v.difficulty >= 2);
      if (maj2.length >= 3) majority = pick3(maj2);
      if (min2.length >= 1) odd = pick1(min2);
    }
  }

  const options = shuffleInPlace([...majority, odd], rng);
  return {
    type: "odd_gender",
    prompt: "Who's the odd one out?",
    options: options.map((v) => ({ name: v.name, img: v.main_image_url, gender: v.gender })),
    correct: odd.name,
    explain: `Three are ${majorityGender === "M" ? "male" : "female"}. The odd one is ${odd.gender === "M" ? "male" : "female"}.`,
  };
}

function buildOddOneOutQuestion({ db, bySpecies, rng, difficulty }) {
  // difficulty: 1..4
  if (difficulty === 1) {
    const q = buildOddOneOutBySpecies({ bySpecies, rng });
    q.difficulty = 1;
    return q;
  }
  if (difficulty === 2) {
    const useGender = rng() < 0.5;
    if (useGender) {
      const q = buildOddOneOutByGender({ db, rng, hard: false });
      q.difficulty = 2;
      return q;
    }
    const q = buildOddOneOutBySpecies({ bySpecies, rng });
    q.difficulty = 2;
    return q;
  }
  if (difficulty === 3) {
    const q = buildOddOneOutByGender({ db, rng, hard: true });
    q.difficulty = 3;
    return q;
  }
  const q = buildOddOneOutByGender({ db, rng, hard: true });
  q.difficulty = 4;
  return q;
}

function chooseTargetByDifficulty({ db, difficulty, rng, usedNames }) {
  const pool = db.filter((v) => v.difficulty === difficulty && !usedNames.has(v.name));
  if (pool.length) return sampleOne(pool, rng);
  // fallback: ignore used
  const pool2 = db.filter((v) => v.difficulty === difficulty);
  if (pool2.length) return sampleOne(pool2, rng);
  return sampleOne(db, rng);
}

function nextTypeWithConstraints({ rng, allowedTypes, prevTypes }) {
  // constraint: not more than 2 same type in a row
  const last = prevTypes[prevTypes.length - 1];
  const last2 = prevTypes[prevTypes.length - 2];
  const blocked = last && last2 && last === last2 ? last : null;
  const types = allowedTypes.filter((t) => t !== blocked);
  return sampleOne(types, rng);
}

function generateDailyQuestions({ db, bySpecies, rng }) {
  // 20 total: 5 easy, 8 medium, 5 hard, 2 expert
  const plan = [
    ...Array(5).fill(1),
    ...Array(8).fill(2),
    ...Array(5).fill(3),
    ...Array(2).fill(4),
  ];
  shuffleInPlace(plan, rng);

  const prevTypes = [];
  const used = new Set();
  const questions = [];

  for (let i = 0; i < 20; i++) {
    const diff = plan[i];
    const allowedTypes =
      diff === 1
        ? ["name_image", "gender", "species_silhouette", "odd_one_out"]
        : diff === 2
          ? ["name_image", "name_silhouette_2", "gender", "species_silhouette", "odd_one_out"]
          : diff === 3
            ? ["name_image", "name_silhouette_4", "gender", "odd_one_out"]
            : ["name_silhouette_4", "gender", "odd_one_out"];

    const type = nextTypeWithConstraints({ rng, allowedTypes, prevTypes });
    prevTypes.push(type);

    if (type === "odd_one_out") {
      questions.push(buildOddOneOutQuestion({ db, bySpecies, rng, difficulty: diff }));
      continue;
    }

    const target = chooseTargetByDifficulty({
      db,
      difficulty: Math.min(diff, 3),
      rng,
      usedNames: used,
    });
    used.add(target.name);

    if (type === "gender") {
      questions.push({
        type: "gender",
        prompt: "What is this villager's gender?",
        media: { img: target.main_image_url, silhouette: false },
        options: [
          { key: "M", label: "Male" },
          { key: "F", label: "Female" },
        ],
        correct: target.gender,
        explain: `${target.name}: ${genderWord(target.gender)}`,
        difficulty: diff,
        targetName: target.name,
      });
    } else if (type === "species_silhouette") {
      // easy: silhouette -> species (3-4 choices)
      const otherSpecies = uniqBy(
        shuffleInPlace(
          db.filter((v) => v.species !== target.species).map((v) => ({ species: v.species })),
          rng,
        ),
        (x) => x.species,
      )
        .map((x) => x.species)
        .slice(0, 3);
      const opts = shuffleInPlace([target.species, ...otherSpecies], rng);
      questions.push({
        type: "species_silhouette",
        prompt: "Which species is this silhouette?",
        media: { img: target.main_image_url, silhouette: true },
        options: opts.map((s) => ({ key: s, label: s })),
        correct: target.species,
        explain: `${target.name} is a ${target.species}.`,
        difficulty: diff,
        targetName: target.name,
      });
    } else {
      const silhouette = type === "name_silhouette_2" || type === "name_silhouette_4";
      const n = type === "name_silhouette_2" ? 2 : 4;
      const choices = buildChoiceSetForName({ target, pool: db, rng, n });
      questions.push({
        type,
        prompt: silhouette ? "Guess the name (silhouette)" : "Guess the name",
        media: { img: target.main_image_url, silhouette },
        options: choices.map((v) => ({ key: v.name, label: v.name })),
        correct: target.name,
        explain: `${target.name}`,
        difficulty: diff,
        targetName: target.name,
      });
    }
  }

  return questions;
}

function generateRunQuestions({ db, bySpecies, rng }) {
  // ~20, difficulty rises.
  const schedule = [
    ...Array(6).fill(1),
    ...Array(8).fill(2),
    ...Array(4).fill(3),
    ...Array(2).fill(4),
  ];
  const prevTypes = [];
  const used = new Set();
  const questions = [];

  for (let i = 0; i < 20; i++) {
    const diff = schedule[i];
    const allowedTypes =
      diff === 1
        ? ["name_image", "gender", "species_silhouette", "odd_one_out"]
        : diff === 2
          ? ["name_image", "name_silhouette_2", "gender", "species_silhouette", "odd_one_out"]
          : diff === 3
            ? ["name_image", "name_silhouette_4", "gender", "odd_one_out"]
            : ["name_silhouette_4", "gender", "odd_one_out"];
    const type = nextTypeWithConstraints({ rng, allowedTypes, prevTypes });
    prevTypes.push(type);

    if (type === "odd_one_out") {
      questions.push(buildOddOneOutQuestion({ db, bySpecies, rng, difficulty: diff }));
      continue;
    }

    const target = chooseTargetByDifficulty({
      db,
      difficulty: Math.min(diff, 3),
      rng,
      usedNames: used,
    });
    used.add(target.name);

    if (type === "gender") {
      questions.push({
        type: "gender",
        prompt: "What is this villager's gender?",
        media: { img: target.main_image_url, silhouette: false },
        options: [
          { key: "M", label: "Male" },
          { key: "F", label: "Female" },
        ],
        correct: target.gender,
        explain: `${target.name}: ${genderWord(target.gender)}`,
        difficulty: diff,
        targetName: target.name,
      });
    } else if (type === "species_silhouette") {
      const otherSpecies = uniqBy(
        shuffleInPlace(
          db.filter((v) => v.species !== target.species).map((v) => ({ species: v.species })),
          rng,
        ),
        (x) => x.species,
      )
        .map((x) => x.species)
        .slice(0, 3);
      const opts = shuffleInPlace([target.species, ...otherSpecies], rng);
      questions.push({
        type: "species_silhouette",
        prompt: "Which species is this silhouette?",
        media: { img: target.main_image_url, silhouette: true },
        options: opts.map((s) => ({ key: s, label: s })),
        correct: target.species,
        explain: `${target.name} is a ${target.species}.`,
        difficulty: diff,
        targetName: target.name,
      });
    } else {
      const silhouette = type === "name_silhouette_2" || type === "name_silhouette_4";
      const n = type === "name_silhouette_2" ? 2 : 4;
      const choices = buildChoiceSetForName({ target, pool: db, rng, n });
      questions.push({
        type,
        prompt: silhouette ? "Guess the name (silhouette)" : "Guess the name",
        media: { img: target.main_image_url, silhouette },
        options: choices.map((v) => ({ key: v.name, label: v.name })),
        correct: target.name,
        explain: `${target.name}`,
        difficulty: diff,
        targetName: target.name,
      });
    }
  }
  return questions;
}

function generateGenderQuestions({ db, rng }) {
  // Gender-only mode: exactly 20 questions, 2 types:
  // - gender (Male/Female)
  // - odd_gender (3 of one gender + 1 of the other)
  const schedule = [
    ...Array(6).fill(1),
    ...Array(8).fill(2),
    ...Array(4).fill(3),
    ...Array(2).fill(4),
  ];

  const prevTypes = [];
  const used = new Set();
  const questions = [];

  for (let i = 0; i < 20; i++) {
    const diff = schedule[i];
    const allowedTypes = ["gender", "odd_one_out_gender"];
    const type = nextTypeWithConstraints({ rng, allowedTypes, prevTypes });
    prevTypes.push(type);

    if (type === "odd_one_out_gender") {
      const q = buildOddOneOutByGender({ db, rng, hard: diff >= 3 });
      q.difficulty = diff;
      questions.push(q);
      continue;
    }

    const target = chooseTargetByDifficulty({
      db,
      difficulty: Math.min(diff, 3),
      rng,
      usedNames: used,
    });
    used.add(target.name);

    questions.push({
      type: "gender",
      prompt: "What is this villager's gender?",
      media: { img: target.main_image_url, silhouette: false },
      options: [
        { key: "M", label: "Male" },
        { key: "F", label: "Female" },
      ],
      correct: target.gender,
      explain: `${target.name}: ${genderWord(target.gender)}`,
      difficulty: diff,
      targetName: target.name,
    });
  }

  return questions;
}

function pointsForDifficulty(diff) {
  if (diff === 1) return 1;
  if (diff === 2) return 2;
  if (diff === 3) return 3;
  return 4;
}

function rankByPoints(points) {
  if (points >= 38) return "S";
  if (points >= 30) return "A";
  if (points >= 20) return "B";
  if (points >= 10) return "C";
  return "D";
}

function rankCopy(rank) {
  switch (rank) {
    case "S":
      return {
        title: "Villager Master",
        blurb: "You know every villager like a true island legend.",
      };
    case "A":
      return {
        title: "Island Expert",
        blurb: "You're one step away from total mastery.",
      };
    case "B":
      return {
        title: "Skilled Resident",
        blurb: "You know your villagers pretty well.",
      };
    case "C":
      return {
        title: "Newcomer",
        blurb: "Not bad, but there's more to discover.",
      };
    default:
      return {
        title: "Visitor",
        blurb: "Looks like you just arrived on the island.",
      };
  }
}

function el(id) {
  return document.getElementById(id);
}

function setView(name) {
  for (const v of document.querySelectorAll("[data-view]")) {
    v.style.display = v.getAttribute("data-view") === name ? "" : "none";
  }
}

function setStatus(msg) {
  el("status").textContent = msg || "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function mk(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function gameKey(mode, seedStr) {
  return `acnh_quiz_${mode}_${seedStr}`;
}

function loadProgress(mode, seedStr) {
  try {
    const raw = localStorage.getItem(gameKey(mode, seedStr));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveProgress(mode, seedStr, state) {
  localStorage.setItem(gameKey(mode, seedStr), JSON.stringify(state));
}

function resetProgress(mode, seedStr) {
  localStorage.removeItem(gameKey(mode, seedStr));
}

function renderQuestion({ q, index, total, state, onAnswer }) {
  el("qPrompt").textContent = q.prompt;
  el("qCount").textContent = `${index + 1}/${total}`;
  // per design: only show count

  const metaEl = el("qMeta");

  // media
  const img = el("qImg");
  const mediaEl = el("qMedia");
  mediaEl.classList.remove("hidden");
  mediaEl.classList.add("loading");
  // Prevent showing previous image while the new one is downloading.
  img.draggable = false;
  img.src = "";
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  img.onload = null;
  img.onerror = null;
  img.alt = q.targetName || "villager";
  // Apply silhouette class BEFORE setting src to avoid a color flash on first paint.
  img.classList.toggle("silhouette", !!q.media?.silhouette);
  img.classList.remove("reveal");
  img.src = q.media?.img || "";
  img.onload = () => mediaEl.classList.remove("loading");
  img.onerror = () => mediaEl.classList.remove("loading");

  // per design: no meta line in quiz
  metaEl.textContent = "";
  metaEl.style.display = "none";

  const optionsEl = el("qOptions");
  clearChildren(optionsEl);

  const card = el("quizCard");
  card.classList.remove("answerCorrect", "answerWrong", "burstCorrect", "burstWrong");

  const isOdd = q.type === "odd_species" || q.type === "odd_gender";
  if (isOdd) {
    mediaEl.classList.add("hidden");
    mediaEl.classList.remove("loading");
  }

  let answered = false;

  function finish(choiceKey) {
    if (answered) return;
    answered = true;

    const correct = choiceKey === q.correct;
    const gained = correct ? pointsForDifficulty(q.difficulty) : 0;

    onAnswer({ correct, gained, choiceKey });

    const isSilhouette = !!q.media?.silhouette;
    const doSwipe = () => {
      card.classList.add(correct ? "burstCorrect" : "burstWrong");
      card.classList.add(correct ? "answerCorrect" : "answerWrong");

      // auto-advance after short swipe-like feedback
      window.setTimeout(() => {
        card.classList.remove("answerCorrect", "answerWrong", "burstCorrect", "burstWrong");
        state._advance?.();
      }, 420);
    };

    if (isSilhouette) {
      // quick reveal-to-color before the swipe feedback
      img.classList.add("reveal");
      window.setTimeout(() => doSwipe(), 475);
    } else {
      doSwipe();
    }
  }

  if (isOdd) {
    optionsEl.className = "options oddGrid";
    for (const opt of q.options) {
      const btn = mk("button", { class: "opt", type: "button" });
      const oi = mk("img", { class: "optImgBig", src: opt.img, alt: "" });
      oi.draggable = false;
      btn.appendChild(oi);
      btn.addEventListener("click", () => finish(opt.name));
      optionsEl.appendChild(btn);
    }
  } else {
    optionsEl.className = q.type === "gender" ? "options genderRow" : "options grid2";
    for (const opt of q.options) {
      const btn =
        q.type === "gender"
          ? mk(
              "button",
              { class: "opt", type: "button" },
              [mk("div", { class: "optLabelCenter", text: opt.label })],
            )
          : mk("button", { class: "opt", type: "button" }, [mk("span", { text: opt.label })]);
      btn.addEventListener("click", () => finish(opt.key));
      optionsEl.appendChild(btn);
    }
  }
}

async function boot() {
  setStatus("Загружаю базу...");
  const { db, byName, bySpecies } = await loadDatabase();

  // UI wiring
  const startDaily = async () => {
    const seed = todaySeedStr();
    resetProgress("daily", seed);
    return startGame("daily", seed, db, byName, bySpecies);
  };
  const startRun = async () => startGame("run", String(Date.now()), db, byName, bySpecies);
  const startGender = async () => startGame("gender", String(Date.now()), db, byName, bySpecies);

  el("dailyBtn").addEventListener("click", startDaily);
  el("runBtn").addEventListener("click", startRun);
  el("genderBtn").addEventListener("click", startGender);
  el("homeBtn").addEventListener("click", () => {
    setView("home");
    document.body.classList.remove("inGame");
  });

  setStatus("");
  setView("home");
  document.body.classList.remove("inGame");

  async function startGame(mode, seedStr, db, dbByName, bySpecies) {
    const seed = hashStringToU32(mode === "daily" ? seedStr : `${mode}:${seedStr}`);
    const rng = mulberry32(seed);

    const questions =
      mode === "daily"
        ? generateDailyQuestions({ db, bySpecies, rng })
        : mode === "gender"
          ? generateGenderQuestions({ db, rng })
          : generateRunQuestions({ db, bySpecies, rng });

    // persist/restore for Daily only (so you can resume)
    let progress = mode === "daily" ? loadProgress(mode, seedStr) : null;
    if (!progress || !Array.isArray(progress.answers) || progress.answers.length !== questions.length) {
      progress = {
        mode,
        seedStr,
        i: 0,
        score: 0,
        correct: 0,
        answers: Array.from({ length: questions.length }, () => null),
        finished: false,
      };
    }

    const state = {
      ...progress,
      mode,
      seedStr,
      questions,
      dbByName,
    };

    function persist() {
      if (mode === "daily") {
        saveProgress(mode, seedStr, {
          mode,
          seedStr,
          i: state.i,
          score: state.score,
          correct: state.correct,
          answers: state.answers,
          finished: state.finished,
        });
      }
    }

    function showEnd() {
      setView("end");
      const total = state.questions.length;
      const maxPoints = state.questions.reduce((s, qq) => s + pointsForDifficulty(qq.difficulty), 0);
      const rank = rankByPoints(state.score);
      const rc = rankCopy(rank);

      el("endTitle").textContent = "Result";
      el("endCorrect").textContent = `${state.correct} / ${total} correct`;
      el("endPoints").textContent = `Points: ${state.score} / ${maxPoints}`;
      el("endRank").textContent = `Rank: ${rank} — ${rc.title}`;
      el("endBlurb").textContent = rc.blurb;

      el("playAgain").onclick = () => {
        if (mode === "daily") resetProgress(mode, seedStr);
        setView("home");
        document.body.classList.remove("inGame");
      };
    }

    function renderAt(i) {
      state.i = clamp(i, 0, state.questions.length);
      persist();
      if (state.i >= state.questions.length) {
        state.finished = true;
        persist();
        showEnd();
        return;
      }
      setView("quiz");
      document.body.classList.add("inGame");
      // used by renderQuestion auto-advance
      state._advance = () => renderAt(state.i + 1);
      renderQuestion({
        q: state.questions[state.i],
        index: state.i,
        total: state.questions.length,
        state,
        onAnswer: ({ correct, gained, choiceKey }) => {
          if (state.answers[state.i] !== null) return; // already answered
          state.answers[state.i] = { choiceKey, correct, gained };
          if (correct) state.correct += 1;
          state.score += gained;
          persist();
        },
      });
    }

    renderAt(progress.i ?? 0);
  }
}

boot().catch((e) => {
  console.error(e);
  setView("home");
  setStatus(`Ошибка: ${String(e)}`);
});

