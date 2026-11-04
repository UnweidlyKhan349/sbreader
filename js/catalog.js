(function () {
  const PAGE_SIZE = 40;
  const state = {
    subjects: new Set(),
    qtypes: new Set(),
    formats: new Set(),
    levels: new Set(),
    visuals: new Set(),
    tournaments: new Set(),
    search: '',
    page: 1,
    roundRange: null,
    includeUnlabeled: true,
  };

  const { QTYPE_LABELS, FORMAT_LABELS, escapeHtml } = SBData;
  const labelFor = SBData.subjectLabel;

  function buildChips(container, items, key, labelFn) {
    container.innerHTML = '';
    items.forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
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

  let subjectItems, qtypeItems, formatItems, levelItems, visualItems, roundSliderApi;

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
      buildTournamentSidebar(tSelect);

      document.getElementById('searchBox').addEventListener('input', debounce((e) => {
        state.search = e.target.value;
        state.page = 1;
        render();
      }, 220));

      document.getElementById('clearFilters').addEventListener('click', () => {
        state.subjects.clear();
        state.qtypes.clear();
        state.formats.clear();
        state.levels.clear();
        state.visuals.clear();
        state.tournaments.clear();
        state.search = '';
        state.page = 1;
        document.getElementById('searchBox').value = '';
        tSelect.setMultiValues([]);
        document.getElementById('tsSearch').value = '';
        filterTournamentSidebar();
        if (roundSliderApi) roundSliderApi.reset();
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

  // The sidebar list of tournaments shown on wide screens (CSS hides it
  // below 900px, where the dropdown in the filter panel is shown instead).
  // Both edit state.tournaments; render() keeps the two in step.
  let tsRows = [];
  function buildTournamentSidebar(tSelect) {
    const list = document.getElementById('tsList');
    list.innerHTML = '';
    tsRows = SBData.meta.tournaments.map((t) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ts-row';
      row.dataset.search = t.name.toLowerCase();
      row.setAttribute('aria-pressed', 'false');
      const check = document.createElement('span');
      check.className = 'custom-select-option-check';
      const name = document.createElement('span');
      name.className = 'ts-name';
      name.textContent = t.name;
      const count = document.createElement('span');
      count.className = 'ts-count';
      count.textContent = t.count.toLocaleString();
      row.append(check, name, count);
      row.addEventListener('click', () => {
        if (state.tournaments.has(t.slug)) state.tournaments.delete(t.slug);
        else state.tournaments.add(t.slug);
        tSelect.setMultiValues([...state.tournaments]);
        state.page = 1;
        render();
      });
      list.appendChild(row);
      return { row, slug: t.slug };
    });
    const empty = document.createElement('div');
    empty.className = 'custom-select-empty';
    empty.id = 'tsEmpty';
    empty.textContent = 'No matches';
    empty.style.display = 'none';
    list.appendChild(empty);

    document.getElementById('tsSearch').addEventListener('input', filterTournamentSidebar);
    document.getElementById('tsClearBtn').addEventListener('click', () => {
      if (!state.tournaments.size) return;
      state.tournaments.clear();
      tSelect.setMultiValues([]);
      state.page = 1;
      render();
    });
  }

  function filterTournamentSidebar() {
    const q = document.getElementById('tsSearch').value.trim().toLowerCase();
    let any = false;
    tsRows.forEach(({ row }) => {
      const match = !q || row.dataset.search.indexOf(q) !== -1;
      row.style.display = match ? '' : 'none';
      if (match) any = true;
    });
    document.getElementById('tsEmpty').style.display = any ? 'none' : '';
  }

  function syncTournamentSidebar() {
    tsRows.forEach(({ row, slug }) => {
      const on = state.tournaments.has(slug);
      row.classList.toggle('active', on);
      row.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const n = state.tournaments.size;
    document.getElementById('tsSummary').textContent =
      n === 0 ? 'All tournaments' : `${n} selected`;
    document.getElementById('tsClearBtn').disabled = n === 0;
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
      items.forEach((i) => i._el.classList.toggle('active', set.has(i.value)));
    });
  }

  function render() {
    syncChipVisuals();
    syncTournamentSidebar();
    if (roundSliderApi) {
      const moved = roundSliderApi.setMax(SBData.maxRoundFor(state.tournaments));
      if (moved) state.roundRange = moved;
    }
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
      search: state.search,
    }), { recent: state.tournaments.size === 0 });

    document.getElementById('resultCount').textContent =
      `${filtered.length.toLocaleString()} question${filtered.length === 1 ? '' : 's'} match your filters`;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    const resultsEl = document.getElementById('results');
    resultsEl.innerHTML = '';
    if (!pageItems.length) {
      resultsEl.innerHTML = '<div class="empty-state">No questions match these filters. Try widening your search.</div>';
    } else {
      pageItems.forEach((q) => resultsEl.appendChild(renderCard(q)));
    }

    renderPagination(totalPages);
  }

  // Changes page from the pager under the results. The new page is usually
  // a different height, so the window is scrolled to keep the pager where it
  // was on screen: Prev/Next can be clicked again without hunting for it.
  function goToPage(n) {
    const el = document.getElementById('pagination');
    const before = el.getBoundingClientRect().top;
    state.page = n;
    render();
    // The page scrolls inside #pageScroll, not the window.
    const scroller = document.getElementById('pageScroll') || document.scrollingElement;
    scroller.scrollTop += el.getBoundingClientRect().top - before;
  }

  function renderPagination(totalPages) {
    const el = document.getElementById('pagination');
    el.innerHTML = '';
    if (totalPages <= 1) return;
    const prev = document.createElement('button');
    prev.className = 'btn small';
    prev.textContent = '← Prev';
    prev.disabled = state.page <= 1;
    prev.onclick = () => goToPage(state.page - 1);
    el.appendChild(prev);

    const span = document.createElement('span');
    span.textContent = 'Page';
    el.appendChild(span);

    const pageInput = document.createElement('input');
    pageInput.type = 'number';
    pageInput.className = 'page-jump-input';
    pageInput.min = '1';
    pageInput.max = String(totalPages);
    pageInput.value = String(state.page);
    pageInput.setAttribute('aria-label', `Page number, 1 to ${totalPages}`);
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
    el.appendChild(pageInput);

    const ofSpan = document.createElement('span');
    ofSpan.textContent = `of ${totalPages}`;
    el.appendChild(ofSpan);

    const next = document.createElement('button');
    next.className = 'btn small';
    next.textContent = 'Next →';
    next.disabled = state.page >= totalPages;
    next.onclick = () => goToPage(state.page + 1);
    el.appendChild(next);
  }

  function renderCard(q) {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.appendChild(SBData.questionMetaRow(q));
    SBData.appendQuestionBody(card, q);

    const answerWrap = SBData.answerBlock(q, null, { source: true });
    answerWrap.style.display = 'none';
    card.appendChild(answerWrap);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn small';
    toggleBtn.textContent = 'Show answer';
    toggleBtn.onclick = () => {
      const showing = answerWrap.style.display !== 'none';
      answerWrap.style.display = showing ? 'none' : 'block';
      toggleBtn.textContent = showing ? 'Show answer' : 'Hide answer';
    };
    actions.appendChild(toggleBtn);
    actions.appendChild(SBData.bookmarkButton(q.id));

    card.appendChild(actions);
    highlightMatches(card, state.search);
    return card;
  }

  // Wraps every case-insensitive occurrence of each search word in a <mark>.
  // Works on the rendered DOM's text nodes rather than the HTML string, so
  // the <sup>/<sub> math markup and escaped characters stay intact. Buttons
  // are skipped (their labels aren't searched).
  function highlightMatches(root, term) {
    const words = SBData.searchWords(term);
    if (!words.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('button, .actions')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      // Every match of every word, sorted, with overlapping ones merged
      // ("sod" and "sodium" both hitting "sodium" give one mark).
      const hits = [];
      words.forEach((w) => {
        for (let idx = lower.indexOf(w); idx !== -1; idx = lower.indexOf(w, idx + 1)) hits.push([idx, idx + w.length]);
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
