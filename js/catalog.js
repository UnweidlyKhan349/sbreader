(function () {
  const PAGE_SIZE = 40;
  const RANDOM_COUNT = 40; // questions the Random button shows
  const state = {
    subjects: new Set(),
    qtypes: new Set(),
    formats: new Set(),
    levels: new Set(),
    visuals: new Set(),
    tournaments: new Set(),
    search: '',
    // Where to search (all text, question only, answer only) and whether the
    // words may come in any order, as on QB Reader's database.
    searchType: 'all',
    ignoreWordOrder: true,
    // Only whole words count: "p waves" finds "P-waves", not "capillary waves".
    exactWords: false,
    // [first, last] years, or null for every year.
    yearRange: null,
    // From a frequency list: only questions whose answer is this one (its
    // key, SBData.answerKey), until the search box is changed.
    exactAnswer: '',
    page: 1,
    roundRange: null,
    includeUnlabeled: true,
    hideAnswers: readHideAnswers(),
    // Random (QB Reader's green button): a random handful of the matches,
    // kept until Search is pressed; changing a filter draws a new handful.
    random: false,
    randomPick: null,
    randomKey: '',
  };

  // The "Hide answers" switch is remembered on this device.
  function readHideAnswers() {
    try { return localStorage.getItem('sb_hide_answers') === '1'; } catch (e) { return false; }
  }
  function saveHideAnswers(on) {
    try { localStorage.setItem('sb_hide_answers', on ? '1' : '0'); } catch (e) { /* not saved */ }
  }

  const { QTYPE_LABELS, FORMAT_LABELS, escapeHtml } = SBData;
  const labelFor = SBData.subjectLabel;

  function buildChips(container, items, key, labelFn) {
    container.innerHTML = '';
    items.forEach((item) => {
      // A real button (Tab, Enter and Space work, and screen readers hear
      // "toggle button, pressed"), styled as a chip.
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('aria-pressed', 'false');
      if (item.subjectAttr) chip.dataset.subject = item.subjectAttr;
      chip.textContent = labelFn(item);
      chip.addEventListener('click', () => {
        if (state[key].has(item.value)) state[key].delete(item.value);
        else state[key].add(item.value);
        state.page = 1;
        render();
      });
      container.appendChild(chip);
      item._el = chip;
    });
  }

  let subjectItems, qtypeItems, formatItems, levelItems, visualItems, roundSliderApi, yearSliderApi;

  function init() {
    SBData.load().then(() => {
      subjectItems = SBData.meta.subjects.map((s) => ({ value: s.key, label: s.label, subjectAttr: s.key }));
      buildChips(document.getElementById('subjectChips'), subjectItems, 'subjects', (i) => i.label);

      qtypeItems = SBData.meta.qtypes.map((q) => ({ value: q, label: QTYPE_LABELS[q] || q }));
      buildChips(document.getElementById('qtypeChips'), qtypeItems, 'qtypes', (i) => i.label);

      formatItems = SBData.meta.formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] || f }));
      buildChips(document.getElementById('formatChips'), formatItems, 'formats', (i) => i.label);

      levelItems = SBData.meta.levels.map((l) => ({ value: l, label: SBData.LEVEL_LABELS[l] || l }));
      buildChips(document.getElementById('levelChips'), levelItems, 'levels', (i) => i.label);

      visualItems = SBData.VISUAL_KEYS.map((v) => ({ value: v, label: SBData.VISUAL_LABELS[v] }));
      buildChips(document.getElementById('visualChips'), visualItems, 'visuals', (i) => i.label);

      // Wired after subject/qtype/format items exist: wireRoundRangeSlider fires
      // onChange -> render() -> syncChipVisuals() synchronously on setup, which
      // reads every chip group's items.
      const maxRound = Math.max(1, ...(SBData.meta.rounds && SBData.meta.rounds.length ? SBData.meta.rounds : [1]));
      roundSliderApi = SBData.wireRoundRangeSlider({
        minInput: document.getElementById('roundMin'),
        maxInput: document.getElementById('roundMax'),
        fillEl: document.getElementById('roundSliderFill'),
        labelEl: document.getElementById('roundRangeLabel'),
        maxRound,
        onChange: (lo, hi) => { state.roundRange = [lo, hi]; state.page = 1; render(); },
      });
      // Years, to the right of the rounds: the tournaments' years.
      const [firstYear, lastYear] = SBData.yearSpan();
      yearSliderApi = SBData.wireRoundRangeSlider({
        minInput: document.getElementById('yearMin'),
        maxInput: document.getElementById('yearMax'),
        fillEl: document.getElementById('yearSliderFill'),
        labelEl: document.getElementById('yearRangeLabel'),
        min: firstYear,
        maxRound: lastYear,
        label: (lo, hi) => (lo === hi ? `Year ${lo}` : `Years ${lo}-${hi}`),
        onChange: (lo, hi) => { state.yearRange = lo === firstYear && hi === lastYear ? null : [lo, hi]; state.page = 1; render(); },
      });
      document.getElementById('includeUnlabeledRounds').addEventListener('change', (e) => {
        state.includeUnlabeled = e.target.checked;
        state.page = 1;
        render();
      });

      const tSelect = document.getElementById('tournamentSelect');
      SBData.meta.tournaments.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.slug;
        opt.textContent = `${t.name} (${t.count})`;
        tSelect.appendChild(opt);
      });
      tSelect.addEventListener('change', () => {
        state.tournaments = new Set(tSelect.getMultiValues());
        state.page = 1;
        render();
      });
      SBData.enhanceMultiSelect(tSelect);

      // catalog.html?tournament=<slug>[,<slug>] (the set list's links)
      // opens with those tournaments picked.
      const wanted = (new URLSearchParams(location.search).get('tournament') || '')
        .split(',').map((x) => x.trim()).filter((slug) => SBData.meta.tournaments.some((t) => t.slug === slug));
      if (wanted.length) {
        state.tournaments = new Set(wanted);
        tSelect.setMultiValues(wanted);
      }

      const searchBox = document.getElementById('searchBox');
      // catalog.html?answer=<answer>&subject=<key>[&qtype=][&level=] (the
      // frequency list's links): that answer's questions.
      const url = new URLSearchParams(location.search);
      if (url.get('answer')) {
        searchBox.value = url.get('answer');
        state.search = url.get('answer');
        state.exactAnswer = SBData.answerKey({ answer: { text: url.get('answer') } });
      }
      [['subject', 'subjects'], ['qtype', 'qtypes'], ['level', 'levels']].forEach(([param, key]) => {
        if (url.get(param)) state[key].add(url.get(param));
      });
      const runSearch = () => {
        state.exactAnswer = '';
        state.search = searchBox.value;
        state.page = 1;
        render();
      };
      searchBox.addEventListener('input', debounce(runSearch, 220));
      searchBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); state.random = false; runSearch(); } });
      document.getElementById('searchBtn').addEventListener('click', () => { state.random = false; runSearch(); });
      document.getElementById('randomBtn').addEventListener('click', () => {
        if (searchBox.value !== state.search) state.exactAnswer = '';
        state.search = searchBox.value;
        state.random = true;
        state.randomPick = null;
        state.page = 1;
        render();
      });

      const typeRadios = [...document.querySelectorAll('input[name="searchType"]')];
      typeRadios.forEach((r) => r.addEventListener('change', () => { if (r.checked) { state.searchType = r.value; state.page = 1; render(); } }));
      const ignoreOrder = document.getElementById('ignoreWordOrder');
      ignoreOrder.addEventListener('change', () => { state.ignoreWordOrder = ignoreOrder.checked; state.page = 1; render(); });

      const exactWords = document.getElementById('exactWords');
      exactWords.addEventListener('change', () => { state.exactWords = exactWords.checked; state.page = 1; render(); });

      const hideAnswers = document.getElementById('hideAnswers');
      hideAnswers.checked = state.hideAnswers;
      hideAnswers.addEventListener('change', () => {
        state.hideAnswers = hideAnswers.checked;
        saveHideAnswers(state.hideAnswers);
        render();
      });

      document.getElementById('clearFilters').addEventListener('click', () => {
        state.subjects.clear();
        state.qtypes.clear();
        state.formats.clear();
        state.levels.clear();
        state.visuals.clear();
        state.tournaments.clear();
        state.search = '';
        state.exactAnswer = '';
        state.page = 1;
        state.ignoreWordOrder = true;
        state.exactWords = false;
        exactWords.checked = false;
        state.searchType = 'all';
        typeRadios.forEach((r) => { r.checked = r.value === 'all'; });
        document.getElementById('searchBox').value = '';
        ignoreOrder.checked = true;
        tSelect.setMultiValues([]);
        if (roundSliderApi) roundSliderApi.reset();
        if (yearSliderApi) yearSliderApi.reset();
        state.yearRange = null;
        document.getElementById('includeUnlabeledRounds').checked = true;
        state.includeUnlabeled = true;
        render();
      });

      render();
      SBData.prepareSearch();
    }).catch((err) => {
      document.getElementById('resultCount').textContent = 'Failed to load question data: ' + err.message;
    });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function syncChipVisuals() {
    [
      [subjectItems, state.subjects],
      [qtypeItems, state.qtypes],
      [formatItems, state.formats],
      [levelItems, state.levels],
      [visualItems, state.visuals],
    ].forEach(([items, set]) => {
      items.forEach((i) => { i._el.classList.toggle('active', set.has(i.value)); i._el.setAttribute('aria-pressed', String(set.has(i.value))); });
    });
  }

  function render() {
    syncChipVisuals();
    if (roundSliderApi) {
      const moved = roundSliderApi.setMax(SBData.maxRoundFor(state.tournaments));
      if (moved) state.roundRange = moved;
    }
    const started = performance.now();
    // With no tournament picked, newest tournaments come first; picking
    // tournaments lists them A-Z, as in the picker.
    const filtered = SBData.sortByPacketOrder(SBData.filterQuestions({
      subjects: state.subjects,
      roundRange: state.roundRange,
      includeUnlabeled: state.includeUnlabeled,
      qtypes: state.qtypes,
      formats: state.formats,
      levels: state.levels,
      visuals: state.visuals,
      tournaments: state.tournaments,
      yearRange: state.yearRange,
      search: state.exactAnswer ? '' : state.search,
      searchType: state.searchType,
      ignoreWordOrder: state.ignoreWordOrder,
      exactWords: state.exactWords,
    }).filter((q) => !state.exactAnswer || SBData.answerKey(q) === state.exactAnswer), { recent: state.tournaments.size === 0 });

    let pageItems;
    let totalPages = 1;
    if (state.random) {
      const key = [state.search, state.searchType, state.ignoreWordOrder, state.exactWords, state.yearRange, [...state.subjects], [...state.qtypes], [...state.formats], [...state.levels], [...state.visuals], [...state.tournaments], state.roundRange, state.includeUnlabeled].map(String).join('|');
      if (!state.randomPick || state.randomKey !== key) {
        state.randomPick = SBData.shuffle(filtered).slice(0, RANDOM_COUNT);
        state.randomKey = key;
      }
      pageItems = state.randomPick;
    } else {
      totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (state.page > totalPages) state.page = totalPages;
      const start = (state.page - 1) * PAGE_SIZE;
      pageItems = filtered.slice(start, start + PAGE_SIZE);
    }
    // As on QB Reader: "Showing 25 of 2111 results (1.59 seconds)".
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    document.getElementById('resultCount').textContent = `Showing ${pageItems.length} of ${filtered.length} results (${seconds} seconds)`;

    const resultsEl = document.getElementById('results');
    resultsEl.innerHTML = '';
    if (!pageItems.length) {
      resultsEl.innerHTML = '<div class="empty-state">No questions match these filters. Try widening your search.</div>';
    } else {
      pageItems.forEach((q) => resultsEl.appendChild(renderCard(q)));
    }

    renderPagination(totalPages);
  }

  // Changes page from the pager under the results and, as on QB Reader,
  // scrolls back up to the first result (just under the result count).
  function goToPage(n) {
    state.page = n;
    render();
    const top = document.getElementById('resultCount').getBoundingClientRect().top + window.scrollY - 100;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // Bootstrap pagination: Prev, the first and last pages, a few pages
  // around the current one, Next, and a box to jump to any page.
  function renderPagination(totalPages) {
    const el = document.getElementById('pagination');
    el.innerHTML = '';
    if (totalPages <= 1) return;
    const wrap = document.createElement('div');
    wrap.className = 'd-flex flex-wrap justify-content-center align-items-center gap-2';
    const ul = document.createElement('ul');
    ul.className = 'pagination mb-0 flex-wrap';

    function item(label, page, { active = false, disabled = false, aria } = {}) {
      const li = document.createElement('li');
      li.className = 'page-item' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-link';
      btn.textContent = label;
      if (aria) btn.setAttribute('aria-label', aria);
      if (active) btn.setAttribute('aria-current', 'page');
      if (disabled || active) btn.disabled = true;
      else btn.addEventListener('click', () => goToPage(page));
      li.appendChild(btn);
      ul.appendChild(li);
    }

    item('«', state.page - 1, { disabled: state.page <= 1, aria: 'Previous page' });
    const pages = new Set([1, totalPages]);
    for (let n = state.page - 2; n <= state.page + 2; n++) if (n >= 1 && n <= totalPages) pages.add(n);
    let last = 0;
    [...pages].sort((x, y) => x - y).forEach((n) => {
      if (n - last > 1) item('…', 0, { disabled: true });
      item(String(n), n, { active: n === state.page });
      last = n;
    });
    item('»', state.page + 1, { disabled: state.page >= totalPages, aria: 'Next page' });
    wrap.appendChild(ul);

    const jump = document.createElement('div');
    jump.className = 'input-group input-group-sm page-jump';
    const label = document.createElement('span');
    label.className = 'input-group-text';
    label.textContent = 'Page';
    const pageInput = document.createElement('input');
    pageInput.type = 'number';
    pageInput.className = 'form-control page-jump-input';
    pageInput.min = '1';
    pageInput.max = String(totalPages);
    pageInput.value = String(state.page);
    pageInput.setAttribute('aria-label', `Page number, 1 to ${totalPages}`);
    const of = document.createElement('span');
    of.className = 'input-group-text';
    of.textContent = `of ${totalPages}`;
    function jumpToInput() {
      let n = parseInt(pageInput.value, 10);
      if (!Number.isFinite(n)) n = state.page;
      n = Math.min(totalPages, Math.max(1, n));
      if (n !== state.page) {
        goToPage(n);
      } else {
        pageInput.value = String(state.page);
      }
    }
    pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); jumpToInput(); pageInput.blur(); }
    });
    pageInput.addEventListener('blur', jumpToInput);
    jump.append(label, pageInput, of);
    wrap.appendChild(jump);
    el.appendChild(wrap);
  }

  function renderCard(q) {
    const card = SBData.questionCard(q, { hideAnswer: state.hideAnswers });
    // Marked only where the search looked (the question text, or the
    // answer); a phrase as a whole when word order counts.
    const where = { question: [...card.querySelectorAll('.q-text, .choices')], answer: [...card.querySelectorAll('.a-text')] }[state.searchType] || [card];
    const terms = state.ignoreWordOrder ? SBData.searchWords(state.search) : [SBData.searchPhrase(state.search)].filter(Boolean);
    where.forEach((root) => highlightMatches(root, terms, state.exactWords));
    return card;
  }

  // Wraps every occurrence of each search term (a word, or the whole
  // phrase) in a <mark>, compared as the search compares them (SBData.searchFold:
  // no case, accents or curly quotes); only whole words when `exact`.
  // Works on the rendered DOM's text nodes rather than the HTML string, so
  // the <sup>/<sub> math markup and escaped characters stay intact. Buttons
  // are skipped (their labels aren't searched).
  function highlightMatches(root, words, exact) {
    if (!words.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('button')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      const lower = SBData.searchFold(text);
      // Every match of every word, sorted, with overlapping ones merged
      // ("sod" and "sodium" both hitting "sodium" give one mark).
      const hits = [];
      words.forEach((w) => {
        const next = exact ? (from) => SBData.wholeWordIndex(lower, w, from) : (from) => lower.indexOf(w, from);
        for (let idx = next(0); idx !== -1; idx = next(idx + 1)) hits.push([idx, idx + w.length]);
      });
      if (!hits.length) return;
      hits.sort((a, b) => a[0] - b[0]);
      const ranges = [hits[0]];
      hits.slice(1).forEach(([start, end]) => {
        const prev = ranges[ranges.length - 1];
        if (start <= prev[1]) prev[1] = Math.max(prev[1], end);
        else ranges.push([start, end]);
      });
      const frag = document.createDocumentFragment();
      let last = 0;
      ranges.forEach(([start, end]) => {
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        last = end;
      });
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }



  init();
})();
