"use strict";

(function () {
  const LANGS = {
    "en": { name: "English", native: "English", region: "Reference", number: null, htmlLang: "en" },
    "ha-NG": { name: "Hausa (Nigeria)", native: "Hausa", region: "Nigeria", number: "112", htmlLang: "ha" },
    "bn-BD": { name: "Bengali (Bangladesh)", native: "বাংলা", region: "Bangladesh", number: "999", htmlLang: "bn" },
    "bn-IN": { name: "Bengali (India)", native: "বাংলা", region: "India", number: "112", htmlLang: "bn" }
  };

  const SCENARIOS = {
    choking: "Choking",
    bleeding: "Heavy bleeding",
    burns: "Burns and scalds",
    drowning: "Drowning and CPR",
    heat: "Heat exhaustion and heat stroke",
    general: "Medicine and diagnosis requests"
  };

  const INTENTS = {
    steps: "What to do",
    followup: "Follow-up",
    escalate: "When to get help",
    myth: "Common myth",
    signs: "Warning signs",
    refuse: "Needs a professional",
    clarify: "Clarifying question"
  };

  const EVAL_LANGS = {
    en: { name: "English", native: "English", meta: "No country number", htmlLang: "en", number: null },
    ha: { name: "Hausa (Nigeria)", native: "Hausa", meta: "Nigeria · 112", htmlLang: "ha", number: "112" },
    bn: { name: "Bengali (Bangladesh)", native: "বাংলা", meta: "Bangladesh · 999", htmlLang: "bn", number: "999" },
    bnin: { name: "Bengali (India)", native: "বাংলা", meta: "India · 112", htmlLang: "bn", number: "112" }
  };

  const EVAL_SYSTEMS = {
    plain: { title: "Model on its own", note: "No dataset rows" },
    translated: { title: "Plain translation rows", note: "English rows put through plain machine translation" },
    improved: { title: "MotherTongue Aid rows", note: "Rows from this dataset" }
  };

  const DEFAULT_EVAL = { id: "eval-016", lang: "ha" };

  const MATCH_THRESHOLD = 0.28;
  const PAGE_SIZE = 10;
  const EXAMPLE_SCENARIOS = ["choking", "bleeding", "burns"];

  const $ = (id) => document.getElementById(id);

  const state = { lang: "en", page: 1, data: null, index: null, eval: null, evalLang: DEFAULT_EVAL.lang };

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function inline(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function renderAnswer(text) {
    const out = [];
    let list = null;
    const close = () => {
      if (list) out.push(list.type === "steps" ? "</ol>" : "</ul>");
      list = null;
    };
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const step = line.match(/^([0-9০-৯]+)[.)]\s+(.*)$/);
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (!line || /^([-*_])\1{2,}$/.test(line) || /^\|[\s:|-]+\|$/.test(line)) {
        close();
      } else if (heading) {
        close();
        out.push(`<p class="h">${inline(heading[1])}</p>`);
      } else if (line.startsWith("|")) {
        close();
        out.push(`<p>${inline(line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).join(" · "))}</p>`);
      } else if (step) {
        if (!list || list.type !== "steps") { close(); list = { type: "steps" }; out.push('<ol class="steps">'); }
        out.push(`<li><span class="n">${escapeHtml(step[1])}</span><span>${inline(step[2])}</span></li>`);
      } else if (bullet) {
        if (!list || list.type !== "bullets") { close(); list = { type: "bullets" }; out.push('<ul class="bullets">'); }
        out.push(`<li>${inline(bullet[1])}</li>`);
      } else {
        close();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    close();
    return out.join("");
  }

  function normalize(text) {
    return text
      .normalize("NFC")
      .toLowerCase()
      .replace(/ƙ/g, "k").replace(/ɗ/g, "d").replace(/ɓ/g, "b").replace(/ƴ/g, "y")
      .replace(/['’`]/g, "")
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
      .trim();
  }

  function trigrams(text) {
    const padded = ` ${normalize(text)} `;
    const counts = new Map();
    const chars = Array.from(padded);
    for (let i = 0; i + 3 <= chars.length; i++) {
      const gram = chars[i] + chars[i + 1] + chars[i + 2];
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    return counts;
  }

  function weigh(counts, idf, unseenIdf) {
    const vec = new Map();
    let norm = 0;
    for (const [gram, tf] of counts) {
      const w = tf * (idf.get(gram) || unseenIdf);
      vec.set(gram, w);
      norm += w * w;
    }
    return { vec, norm: Math.sqrt(norm) };
  }

  function buildIndex(items) {
    const docs = [];
    for (const item of items) {
      for (const lang of Object.keys(item.p)) docs.push({ item, lang, counts: trigrams(item.p[lang]) });
    }
    const df = new Map();
    for (const doc of docs) for (const gram of doc.counts.keys()) df.set(gram, (df.get(gram) || 0) + 1);
    const idf = new Map();
    for (const [gram, n] of df) idf.set(gram, Math.log(1 + docs.length / n));
    const unseenIdf = Math.log(1 + docs.length);
    for (const doc of docs) Object.assign(doc, weigh(doc.counts, idf, unseenIdf));
    return { docs, idf, unseenIdf };
  }

  function search(query) {
    const { docs, idf, unseenIdf } = state.index;
    const q = weigh(trigrams(query), idf, unseenIdf);
    if (!q.norm) return [];
    const best = new Map();
    for (const doc of docs) {
      let dot = 0;
      for (const [gram, w] of q.vec) {
        const d = doc.vec.get(gram);
        if (d) dot += w * d;
      }
      const score = dot / (q.norm * doc.norm);
      const prev = best.get(doc.item.id);
      if (!prev || score > prev.score) best.set(doc.item.id, { item: doc.item, lang: doc.lang, score });
    }
    return Array.from(best.values()).sort((a, b) => b.score - a.score);
  }

  function answerKey(id) {
    return id.replace(/-\d+$/, "");
  }

  function scenarioLabel(code) {
    return SCENARIOS[code] || code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");
  }

  function intentLabel(code) {
    return INTENTS[code] || code;
  }

  function langInfo(code) {
    return LANGS[code] || { name: code, native: code, region: "", number: null, htmlLang: code.split("-")[0] };
  }

  function callBadge(code) {
    const number = langInfo(code).number;
    const label = number ? `<span>Call</span><span class="num">${number}</span>` : "<span>Call your local emergency number</span>";
    return `<span class="call"><span class="ring"><svg><use href="#i-phone"/></svg></span>${label}</span>`;
  }

  function sourceLink(item) {
    if (!item.url) {
      return `<span class="source"><svg><use href="#i-link"/></svg>Written by the dataset team, CC BY 4.0</span>`;
    }
    const title = item.section ? ` title="${escapeHtml(item.section)}"` : "";
    return `<a class="source" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"${title}><svg><use href="#i-link"/></svg>Health New Zealand, CC BY 4.0</a>`;
  }

  function answerText(item, lang) {
    return state.data.texts[item.c[lang]];
  }

  function renderLangPicker() {
    const picker = $("lang-picker");
    picker.innerHTML = state.data.languages.map((code) => {
      const info = langInfo(code);
      const meta = info.number ? `${info.region} · ${info.number}` : info.region;
      return `<button type="button" class="lang-option" role="radio" data-lang="${code}" aria-checked="${code === state.lang}">
        <span class="native" lang="${info.htmlLang}">${escapeHtml(info.native)}</span><span class="meta">${escapeHtml(meta)}</span></button>`;
    }).join("");
    picker.onclick = (event) => {
      const btn = event.target.closest(".lang-option");
      if (!btn) return;
      state.lang = btn.dataset.lang;
      for (const el of picker.children) el.setAttribute("aria-checked", String(el === btn));
      renderExamples();
      const query = $("ask-input").value.trim();
      if (query && $("answer").innerHTML) ask(query);
    };
  }

  function renderExamples() {
    const items = state.data.items;
    const picks = EXAMPLE_SCENARIOS
      .map((s) => items.find((it) => it.scenario === s && it.intent === "steps" && it.p[state.lang]))
      .filter(Boolean);
    const list = picks.length ? picks : items.filter((it) => it.p[state.lang]).slice(0, 3);
    const htmlLang = langInfo(state.lang).htmlLang;
    $("examples").innerHTML = list
      .map((it) => `<button type="button" class="chip" lang="${htmlLang}">${escapeHtml(it.p[state.lang])}</button>`)
      .join("");
  }

  function showAnswer(match, alternatives) {
    const { item } = match;
    const lang = state.lang;
    const htmlLang = langInfo(lang).htmlLang;
    const also = alternatives.length
      ? `<div class="also"><span class="examples-label">Also close</span><div class="chips">${alternatives
          .map((alt) => `<button type="button" class="chip" data-id="${escapeHtml(alt.item.id)}" lang="${htmlLang}">${escapeHtml(alt.item.p[lang] || alt.item.p.en)}</button>`)
          .join("")}</div></div>`
      : "";
    $("answer").innerHTML = `<article class="answer-card">
      <div class="answer-top">${callBadge(lang)}
        <div class="tags"><span class="tag">${escapeHtml(scenarioLabel(item.scenario))}</span><span class="tag soft">${escapeHtml(intentLabel(item.intent))}</span></div>
      </div>
      <p class="matched">Closest checked question: <q lang="${htmlLang}">${escapeHtml(item.p[lang] || item.p.en)}</q> · match ${Math.round(match.score * 100)}%</p>
      <div class="body" lang="${htmlLang}">${renderAnswer(answerText(item, lang))}</div>
      <div class="answer-foot">${sourceLink(item)}
        <button type="button" class="btn-ghost" data-compare="${escapeHtml(item.id)}"><svg><use href="#i-columns"/></svg>Compare languages</button>
      </div>
      ${also}
    </article>`;
  }

  function showFallback() {
    const number = langInfo(state.lang).number;
    const call = number
      ? `<p>Call <strong>${number}</strong> now if someone is in danger.</p>`
      : "<p>Call <strong>your local emergency number</strong> now if someone is in danger.</p>";
    $("answer").innerHTML = `<div class="fallback" role="alert">
      <span class="icon"><svg><use href="#i-alert"/></svg></span>
      <div><h3>No checked answer for this question</h3>
        <p>This assistant only answers with checked first-aid steps, and none of them matches your question closely enough.</p>
        ${call}
        <p>Try describing what happened in a few words, for example "baby choking" or "burn from hot water".</p>
      </div></div>`;
  }

  function ask(query) {
    const results = search(query);
    const top = results[0];
    if (!top || top.score < MATCH_THRESHOLD) {
      showFallback();
      return;
    }
    const seen = new Set([answerKey(top.item.id)]);
    const alternatives = [];
    for (const r of results.slice(1)) {
      if (alternatives.length === 2 || r.score < MATCH_THRESHOLD) break;
      const key = answerKey(r.item.id);
      if (!seen.has(key) && r.item.p[state.lang]) {
        seen.add(key);
        alternatives.push(r);
      }
    }
    showAnswer(top, alternatives);
  }

  function showItem(id) {
    const item = state.data.items.find((it) => it.id === id);
    if (item) showAnswer({ item, score: 1 }, []);
  }

  function setupAsk() {
    const input = $("ask-input");
    $("ask-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (query) ask(query);
      else input.focus();
    });
    $("examples").addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      input.value = chip.textContent;
      ask(chip.textContent);
    });
    $("answer").addEventListener("click", (event) => {
      const chip = event.target.closest(".chip[data-id]");
      if (chip) {
        input.value = chip.textContent;
        showItem(chip.dataset.id);
        return;
      }
      const compare = event.target.closest("[data-compare]");
      if (compare) {
        $("compare-select").value = compare.dataset.compare;
        renderCompare();
        $("compare").scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  function scenarioOrder() {
    const seen = [];
    for (const it of state.data.items) if (!seen.includes(it.scenario)) seen.push(it.scenario);
    return seen;
  }

  function setupCompare() {
    const select = $("compare-select");
    select.innerHTML = scenarioOrder().map((s) => {
      const options = state.data.items
        .filter((it) => it.scenario === s)
        .map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.p.en || Object.values(it.p)[0])}</option>`)
        .join("");
      return `<optgroup label="${escapeHtml(scenarioLabel(s))}">${options}</optgroup>`;
    }).join("");
    select.addEventListener("change", renderCompare);
    renderCompare();
  }

  function renderCompare() {
    const item = state.data.items.find((it) => it.id === $("compare-select").value);
    if (!item) return;
    $("compare-meta").innerHTML = `<span class="tag">${escapeHtml(scenarioLabel(item.scenario))}</span>
      <span class="tag soft">${escapeHtml(intentLabel(item.intent))}</span>
      <span class="tag soft">${escapeHtml(item.id)}</span>${sourceLink(item)}`;
    $("compare-grid").innerHTML = state.data.languages.filter((code) => item.p[code]).map((code) => {
      const info = langInfo(code);
      return `<article class="lang-card${code === "en" ? " reference" : ""}" lang="${info.htmlLang}">
        <header><h3 lang="en">${escapeHtml(info.name)}${code === "en" ? " · reference" : ""}</h3>${callBadge(code)}</header>
        <p class="q">${escapeHtml(item.p[code])}</p>
        <div class="body">${renderAnswer(answerText(item, code))}</div>
      </article>`;
    }).join("");
    const seed = $("compare-seed");
    seed.hidden = !item.seed;
    if (item.seed) {
      $("compare-seed-body").innerHTML = `<p class="q">${escapeHtml(item.seed[0])}</p>
        <div class="body">${renderAnswer(state.data.texts[item.seed[1]])}</div>`;
    }
  }

  function allRows() {
    const rows = [];
    for (const item of state.data.items) {
      for (const lang of state.data.languages) {
        if (item.p[lang]) rows.push({ item, lang, haystack: `${item.id} ${item.p[lang]} ${answerText(item, lang)}`.toLowerCase() });
      }
    }
    return rows;
  }

  function setupBrowse() {
    const rows = allRows();
    const langs = state.data.languages;
    $("lang-counts").innerHTML = langs.map((code) => {
      const n = rows.filter((r) => r.lang === code).length;
      return `<span class="count"><b>${n}</b>${escapeHtml(langInfo(code).name)}</span>`;
    }).join("");
    $("f-lang").innerHTML = `<option value="">All languages</option>` +
      langs.map((code) => `<option value="${code}">${escapeHtml(langInfo(code).name)}</option>`).join("");
    $("f-scenario").innerHTML = `<option value="">All emergencies</option>` +
      scenarioOrder().map((s) => `<option value="${s}">${escapeHtml(scenarioLabel(s))}</option>`).join("");

    const render = () => {
      const lang = $("f-lang").value;
      const scenario = $("f-scenario").value;
      const text = $("f-text").value.trim().toLowerCase();
      const filtered = rows.filter((r) => (!lang || r.lang === lang) && (!scenario || r.item.scenario === scenario) && (!text || r.haystack.includes(text)));
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      const slice = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
      $("result-count").textContent = `${filtered.length} ${filtered.length === 1 ? "row" : "rows"}`;
      $("rows").innerHTML = slice.length ? slice.map(({ item, lang: code }, i) => {
        const info = langInfo(code);
        return `<li><details class="row" style="animation-delay:${i * 25}ms">
          <summary>
            <span class="tags"><span class="tag">${escapeHtml(info.name)}</span><span class="tag soft">${escapeHtml(scenarioLabel(item.scenario))}</span><span class="tag soft">${escapeHtml(intentLabel(item.intent))}</span></span>
            <span class="prompt" lang="${info.htmlLang}">${escapeHtml(item.p[code])}</span>
            <span class="id">${escapeHtml(item.id)}</span>
          </summary>
          <div class="row-body"><div class="body" lang="${info.htmlLang}">${renderAnswer(answerText(item, code))}</div>${sourceLink(item)}</div>
        </details></li>`;
      }).join("") : `<li class="empty">No rows match these filters.</li>`;
      $("page-info").textContent = `Page ${state.page} of ${pages}`;
      $("prev").disabled = state.page <= 1;
      $("next").disabled = state.page >= pages;
    };

    const reset = () => { state.page = 1; render(); };
    $("f-lang").addEventListener("change", reset);
    $("f-scenario").addEventListener("change", reset);
    $("f-text").addEventListener("input", reset);
    $("prev").addEventListener("click", () => { state.page -= 1; render(); });
    $("next").addEventListener("click", () => { state.page += 1; render(); });
    render();
  }

  function pct(part, total) {
    if (!total) return "n/a";
    const tenths = (1000 * part) / total;
    const floor = Math.floor(tenths);
    const rounded = tenths - floor === 0.5 ? floor + (floor % 2) : Math.round(tenths);
    return `${(rounded / 10).toFixed(1)}%`;
  }

  function badge(kind, icon, text, title) {
    const tip = title ? ` title="${escapeHtml(title)}"` : "";
    return `<span class="badge ${kind}"${tip}><svg aria-hidden="true"><use href="#${icon}"/></svg><span>${escapeHtml(text)}</span></span>`;
  }

  function evalItem() {
    return state.eval.items.find((it) => it.id === $("diff-question").value) || state.eval.items[0];
  }

  function systemsFor(lang) {
    return state.eval.systems.filter((sys) => state.eval.items.some((it) => it.a[lang][sys]));
  }

  function renderDiffLangs() {
    $("diff-lang").innerHTML = state.eval.langs.map((code) => {
      const info = EVAL_LANGS[code];
      return `<button type="button" class="lang-option" role="radio" data-lang="${code}" aria-checked="${code === state.evalLang}">
        <span class="native" lang="${info.htmlLang}">${escapeHtml(info.native)}</span><span class="meta">${escapeHtml(info.meta)}</span></button>`;
    }).join("");
  }

  function meterStat(kind, count, total, label) {
    return `<div class="sum-stat ${kind}"><span class="sum-num">${pct(count, total)}</span><span class="sum-label">${escapeHtml(label)}</span>
      <span class="meter" aria-hidden="true"><span style="width:${total ? (100 * count) / total : 0}%"></span></span></div>`;
  }

  function renderDiffSummary() {
    const lang = state.evalLang;
    const info = EVAL_LANGS[lang];
    const cards = systemsFor(lang).map((sys) => {
      const rows = state.eval.items.map((it) => it.a[lang][sys]).filter(Boolean);
      const dangerous = rows.filter((r) => r.d).length;
      const right = rows.filter((r) => r.n).length;
      return `<div class="sum-card sys-${sys}">
        <h3>${escapeHtml(EVAL_SYSTEMS[sys].title)}</h3>
        ${meterStat("danger", dangerous, rows.length, "dangerous")}
        ${info.number ? meterStat("number", right, rows.length, `right number ${info.number}`) : ""}
      </div>`;
    }).join("");
    $("diff-summary").innerHTML = `<p class="sum-title">All ${state.eval.items.length} test questions in ${escapeHtml(info.name)}</p><div class="sum-grid">${cards}</div>`;
  }

  function diffCard(sys, entry, lang) {
    const info = EVAL_LANGS[lang];
    const meta = EVAL_SYSTEMS[sys];
    const reasons = entry.r || [];
    const badges = [
      entry.d ? badge("bad", "i-alert", "Dangerous", reasons.join(" | ")) : badge("good", "i-check", "No danger found"),
      info.number
        ? (entry.n ? badge("good", "i-phone", `Right number ${info.number}`) : badge("bad", "i-x", `No right number ${info.number}`))
        : "",
      entry.f ? badge("good", "i-check", "Calls for help first") : badge("bad", "i-x", "Help not called first"),
      entry.s === null ? "" : badge("neutral", "i-steps", `Required steps ${entry.s}%`)
    ].join("");
    const why = reasons.length
      ? `<div class="why"><span class="why-label">Why it is dangerous</span><ul>${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></div>`
      : "";
    const translation = entry.t
      ? `<details class="tr"><summary><svg aria-hidden="true"><use href="#i-globe"/></svg><span>English translation</span><svg class="chev" aria-hidden="true"><use href="#i-chevron"/></svg></summary>
          <div class="body" lang="en">${renderAnswer(entry.t)}</div></details>`
      : "";
    return `<article class="diff-card sys-${sys}${entry.d ? " is-dangerous" : ""}">
      <header><h3>${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.note)}</p></header>
      <div class="badges">${badges}</div>
      ${why}
      <div class="body answer-scroll" lang="${info.htmlLang}" tabindex="0" role="region" aria-label="${escapeHtml(meta.title)}: answer">${renderAnswer(entry.a)}</div>
      ${translation}
    </article>`;
  }

  function renderDiff() {
    const item = evalItem();
    const lang = state.evalLang;
    const info = EVAL_LANGS[lang];
    const english = lang === "en" ? "" : `<p class="en-q" lang="en">${escapeHtml(item.q.en)}</p>`;
    $("diff-asked").innerHTML = `<div class="tags"><span class="tag">${escapeHtml(scenarioLabel(item.scenario))}</span><span class="tag soft">${escapeHtml(item.id)}</span><span class="tag soft">${escapeHtml(info.name)}</span></div>
      <p class="asked" lang="${info.htmlLang}">${escapeHtml(item.q[lang])}</p>${english}`;
    const systems = state.eval.systems.filter((sys) => item.a[lang][sys]);
    const grid = $("diff-grid");
    grid.style.setProperty("--cols", systems.length);
    grid.innerHTML = systems.map((sys) => diffCard(sys, item.a[lang][sys], lang)).join("");
  }

  function setupDifference() {
    const select = $("diff-question");
    const groups = [];
    for (const it of state.eval.items) if (!groups.includes(it.scenario)) groups.push(it.scenario);
    select.innerHTML = groups.map((s) => `<optgroup label="${escapeHtml(scenarioLabel(s))}">${state.eval.items
      .filter((it) => it.scenario === s)
      .map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.q.en)}</option>`)
      .join("")}</optgroup>`).join("");
    if (state.eval.items.some((it) => it.id === DEFAULT_EVAL.id)) select.value = DEFAULT_EVAL.id;
    select.addEventListener("change", renderDiff);
    $("diff-lang").addEventListener("click", (event) => {
      const btn = event.target.closest(".lang-option");
      if (!btn) return;
      state.evalLang = btn.dataset.lang;
      for (const el of $("diff-lang").children) el.setAttribute("aria-checked", String(el === btn));
      renderDiffSummary();
      renderDiff();
    });
    renderDiffLangs();
    renderDiffSummary();
    renderDiff();
  }

  async function loadEval() {
    try {
      const response = await fetch("eval.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.eval = await response.json();
    } catch (error) {
      const box = $("diff-error");
      box.hidden = false;
      box.textContent = `Could not load eval.json (${error.message}): run "python scripts/build_demo.py", then serve the demo folder with "python -m http.server".`;
      return;
    }
    setupDifference();
  }

  function renderStats() {
    const { items, languages } = state.data;
    const rows = items.reduce((n, it) => n + Object.keys(it.p).length, 0);
    $("stats").textContent = `${items.length} questions × ${languages.length} languages = ${rows} rows`;
  }

  async function init() {
    loadEval();
    try {
      const response = await fetch("data.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
    } catch (error) {
      const box = $("load-error");
      box.hidden = false;
      box.textContent = `Could not load data.json (${error.message}): run "python scripts/build_demo.py", then serve the demo folder with "python -m http.server".`;
      return;
    }
    state.index = buildIndex(state.data.items);
    renderStats();
    renderLangPicker();
    renderExamples();
    setupAsk();
    setupCompare();
    setupBrowse();
  }

  init();
})();
