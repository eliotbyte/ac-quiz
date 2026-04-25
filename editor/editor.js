// Editor (no build step).

const DATA = {
  villagersUrl: "../files/villagers.json",
  difficultyUrl: "../files/gender_difficulty.json",
};

function el(id) {
  return document.getElementById(id);
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
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of children) n.appendChild(c);
  return n;
}

function clampScore(x) {
  const n = Number(x);
  if (n === 1 || n === 2 || n === 3) return n;
  return 2;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadDatabase() {
  const [villagersRes, diffRes] = await Promise.all([
    fetch(DATA.villagersUrl, { cache: "no-store" }),
    fetch(DATA.difficultyUrl, { cache: "no-store" }).catch(() => null),
  ]);

  const villagersJson = await villagersRes.json();
  const villagersRaw = Array.isArray(villagersJson?.villagers) ? villagersJson.villagers : [];
  const villagers = villagersRaw
    .map((v) => ({
      name: String(v?.name ?? "").trim(),
      gender: String(v?.gender ?? "").trim(),
      species: String(v?.species ?? "").trim(),
      personality: String(v?.personality ?? "").trim(),
      birthday: String(v?.birthday ?? "").trim(),
      hobby: String(v?.hobby ?? "").trim(),
      image_character_url: String(v?.image_character_url ?? "").trim(),
      image_icon_url: String(v?.image_icon_url ?? "").trim(),
    }))
    .filter((v) => v.name);

  let diffMap = new Map();
  try {
    if (diffRes && diffRes.ok) {
      const diffJson = await diffRes.json();
      const rows = Array.isArray(diffJson?.difficulty) ? diffJson.difficulty : [];
      diffMap = new Map(rows.map((r) => [String(r?.name ?? "").trim(), clampScore(r?.score)]));
    }
  } catch {
    diffMap = new Map();
  }

  villagers.sort((a, b) => a.name.localeCompare(b.name, "en"));

  // Ensure every villager has a score entry (default 2)
  const difficulty = new Map();
  for (const v of villagers) difficulty.set(v.name, clampScore(diffMap.get(v.name) ?? 2));

  return { villagers, difficulty };
}

function setView(name) {
  for (const v of document.querySelectorAll("[data-view]")) {
    v.style.display = v.getAttribute("data-view") === name ? "" : "none";
  }
  for (const btn of document.querySelectorAll("[role=tab]")) {
    const is = btn.id === `tab-${name}`;
    btn.setAttribute("aria-selected", is ? "true" : "false");
  }
}

function buildRow({ v, imgUrl, rightEl }) {
  const img = mk("img", { class: "thumb", src: imgUrl || "", alt: "" });
  img.draggable = false;
  const body = mk("div", { class: "rowBody" }, [mk("div", { class: "name", text: v.name }), rightEl].filter(Boolean));
  return mk("div", { class: "row" }, [img, body]);
}

function buildUrlRow({ v, imgUrl, url }) {
  const box = mk("input", { class: "urlBox", value: url || "", readonly: "true" });
  box.addEventListener("focus", () => box.select());
  const body = mk("div", { class: "rowBody" }, [mk("div", { class: "name", text: v.name }), box]);
  return mk("div", { class: "row" }, [mk("img", { class: "thumb", src: imgUrl || "", alt: "" }), body]);
}

function buildScoreEditor({ name, score, onSet }) {
  const wrap = mk("div", { class: "seg" });
  for (const s of [1, 2, 3]) {
    const b = mk("button", {
      class: "segBtn",
      type: "button",
      "aria-pressed": s === score ? "true" : "false",
      text: String(s),
      onclick: () => onSet(s),
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function renderCharacters({ villagers }) {
  const list = el("charactersList");
  clearChildren(list);
  const frag = document.createDocumentFragment();
  for (const v of villagers) {
    const metaParts = [];
    if (v.species) metaParts.push(v.species);
    if (v.personality) metaParts.push(v.personality);
    if (v.gender) metaParts.push(v.gender === "M" ? "♂" : v.gender === "F" ? "♀" : v.gender);
    if (v.birthday) metaParts.push(v.birthday);
    if (v.hobby) metaParts.push(v.hobby);
    frag.appendChild(
      buildRow({
        v,
        imgUrl: v.image_character_url,
        rightEl: metaParts.length ? mk("div", { class: "sub", text: metaParts.join(" · ") }) : null,
      }),
    );
  }
  list.appendChild(frag);
}

function renderImages({ villagers }) {
  const list = el("imagesList");
  clearChildren(list);
  const frag = document.createDocumentFragment();
  for (const v of villagers) {
    frag.appendChild(
      buildUrlRow({
        v,
        imgUrl: v.image_character_url,
        url: v.image_character_url,
      }),
    );
  }
  list.appendChild(frag);
}

function renderIcons({ villagers }) {
  const list = el("iconsList");
  clearChildren(list);
  const frag = document.createDocumentFragment();
  for (const v of villagers) {
    frag.appendChild(
      buildUrlRow({
        v,
        imgUrl: v.image_icon_url,
        url: v.image_icon_url,
      }),
    );
  }
  list.appendChild(frag);
}

function buildExportObject({ villagers, difficulty }) {
  return {
    difficulty: villagers.map((v) => ({
      name: v.name,
      score: clampScore(difficulty.get(v.name) ?? 2),
    })),
  };
}

function renderGenderList({ villagers, difficulty, onDirty }) {
  const list = el("genderList");
  clearChildren(list);
  const frag = document.createDocumentFragment();

  for (const v of villagers) {
    const score = clampScore(difficulty.get(v.name) ?? 2);
    const editor = buildScoreEditor({
      name: v.name,
      score,
      onSet: (s) => {
        const next = clampScore(s);
        if (difficulty.get(v.name) === next) return;
        difficulty.set(v.name, next);
        onDirty(true);
        // rerender only this row buttons
        for (const btn of editor.querySelectorAll("button.segBtn")) {
          const val = Number(btn.textContent);
          btn.setAttribute("aria-pressed", val === next ? "true" : "false");
        }
      },
    });

    const body = mk("div", { class: "rowBody" }, [
      mk("div", { class: "name", text: v.name }),
      mk("div", { class: "sub", text: `difficulty: ${score}` }),
      editor,
    ]);

    frag.appendChild(
      mk("div", { class: "row" }, [mk("img", { class: "thumb", src: v.image_character_url || "", alt: "" }), body]),
    );
  }

  list.appendChild(frag);
}

function createGenderQuiz({ villagers, difficulty, onDirty }) {
  const img = el("gqImg");
  const prompt = el("gqPrompt");
  const count = el("gqCount");
  const options = el("gqOptions");
  const end = el("gqEnd");
  const backBtn = el("gqBack");
  const nextBtn = el("gqNext");

  let i = 0;
  let btns = [];

  function showAt(idx) {
    i = idx;
    const total = villagers.length;
    if (i >= total) {
      count.textContent = `${total}/${total}`;
      prompt.textContent = "Done";
      img.src = "";
      end.style.display = "";
      options.style.display = "none";
      backBtn.disabled = total === 0;
      nextBtn.disabled = true;
      return;
    }

    end.style.display = "none";
    options.style.display = "";
    const v = villagers[i];
    count.textContent = `${i + 1}/${total}`;
    prompt.textContent = v.name;
    img.alt = v.name;
    img.draggable = false;
    img.src = v.image_character_url || v.image_icon_url || "";

    const cur = clampScore(difficulty.get(v.name) ?? 2);
    for (const b of btns) {
      const val = Number(b.textContent);
      b.setAttribute("aria-pressed", val === cur ? "true" : "false");
      b.classList.remove("ping");
    }

    backBtn.disabled = i <= 0;
    nextBtn.disabled = i >= total - 1;
  }

  function answer(score) {
    const v = villagers[i];
    const next = clampScore(score);
    if (difficulty.get(v.name) !== next) {
      difficulty.set(v.name, next);
      onDirty(true);
    }
    // visual confirm, then advance
    for (const b of btns) {
      const val = Number(b.textContent);
      const on = val === next;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("ping", on);
    }
    window.setTimeout(() => showAt(i + 1), 120);
  }

  function go(delta) {
    const total = villagers.length;
    const next = Math.max(0, Math.min(total, i + delta));
    showAt(next);
  }

  clearChildren(options);
  btns = [];
  for (const s of [1, 2, 3]) {
    const b = mk("button", {
      class: "btn",
      type: "button",
      text: String(s),
      "aria-pressed": "false",
      onclick: () => answer(s),
    });
    btns.push(b);
    options.appendChild(b);
  }

  backBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(+1));

  showAt(0);

  return {
    reset: () => showAt(0),
  };
}

async function boot() {
  setStatus("loading…");
  const { villagers, difficulty } = await loadDatabase();
  setStatus("");

  let dirty = false;
  const dirtyBadge = el("dirtyBadge");
  const setDirty = (v) => {
    dirty = !!v;
    dirtyBadge.style.display = dirty ? "" : "none";
  };

  // Tabs
  el("tab-characters").addEventListener("click", () => setView("characters"));
  el("tab-images").addEventListener("click", () => setView("images"));
  el("tab-icons").addEventListener("click", () => setView("icons"));
  el("tab-gender").addEventListener("click", () => setView("gender"));

  // Silhouette toggle (global for editor)
  const silBtn = el("silhouetteToggle");
  silBtn.addEventListener("click", () => {
    const on = silBtn.getAttribute("aria-pressed") === "true";
    const next = !on;
    silBtn.setAttribute("aria-pressed", next ? "true" : "false");
    document.body.classList.toggle("silhouetteOn", next);
  });

  // Render static tabs
  renderCharacters({ villagers });
  renderImages({ villagers });
  renderIcons({ villagers });

  // Gender list
  renderGenderList({ villagers, difficulty, onDirty: setDirty });

  // Export
  const doExport = () => {
    const obj = buildExportObject({ villagers, difficulty });
    downloadJson("gender_difficulty.json", obj);
    setDirty(false);
  };
  el("exportBtn").addEventListener("click", doExport);
  el("gqExportBtn").addEventListener("click", doExport);

  // Gender modes
  const btnList = el("genderModeList");
  const btnQuiz = el("genderModeQuiz");
  const wrapList = el("genderListWrap");
  const wrapQuiz = el("genderQuizWrap");

  let quiz = null;
  function setGenderMode(mode) {
    const isQuiz = mode === "quiz";
    btnList.setAttribute("aria-pressed", isQuiz ? "false" : "true");
    btnQuiz.setAttribute("aria-pressed", isQuiz ? "true" : "false");
    wrapList.style.display = isQuiz ? "none" : "";
    wrapQuiz.style.display = isQuiz ? "" : "none";
    if (isQuiz) {
      quiz = quiz || createGenderQuiz({ villagers, difficulty, onDirty: setDirty });
      quiz.reset();
    } else {
      // keep list view reflecting latest map (cheap rerender)
      renderGenderList({ villagers, difficulty, onDirty: setDirty });
    }
  }

  btnList.addEventListener("click", () => setGenderMode("list"));
  btnQuiz.addEventListener("click", () => setGenderMode("quiz"));

  setView("characters");
  setGenderMode("list");
}

boot().catch((e) => {
  console.error(e);
  setStatus(`error: ${String(e)}`);
});

