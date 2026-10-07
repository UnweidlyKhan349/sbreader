(function () {
  const PAGE_SIZE = 40;
  const state = {
    subjects: new Set(),
    qtypes: new Set(),
    formats: new Set(),
    levels: new Set(),
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

  let subjectItems, qtypeItems, formatItems, levelItems, roundSliderApi;

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

      // Wired after subject/qtype/format items exist: wireRoundRangeSlider fires
      // onChange -> render() -> syncChipVisuals() synchronously on setup, which
      // reads all three item arrays.
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
        state.tournaments.clear();
        state.search = '';
        state.page = 1;
        document.getElementById('searchBox').value = '';
        tSelect.setMultiValues([]);
        if (roundSliderApi) roundSliderApi.reset();
        document.getElementById('includeUnlabeledRounds').checked = true;
        state.includeUnlabeled = true;
        render();
      });

      render();
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
    ].forEach(([items, set]) => {
      items.forEach((i) => i._el.classList.toggle('active', set.has(i.value)));
    });
  }

  function render() {
    syncChipVisuals();
    const filtered = SBData.sortByPacketOrder(SBData.filterQuestions({
      subjects: state.subjects,
      roundRange: state.roundRange,
      includeUnlabeled: state.includeUnlabeled,
      qtypes: state.qtypes,
      formats: state.formats,
      levels: state.levels,
      tournaments: state.tournaments,
      search: state.search,
      includeVisual: true,
    }));

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

  function renderPagination(totalPages) {
    const el = document.getElementById('pagination');
    el.innerHTML = '';
    if (totalPages <= 1) return;
    const prev = document.createElement('button');
    prev.className = 'btn small';
    prev.textContent = '← Prev';
    prev.disabled = state.page <= 1;
    prev.onclick = () => { state.page--; render(); window.scrollTo({top:0, behavior:'smooth'}); };
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
        state.page = n;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
    next.onclick = () => { state.page++; render(); window.scrollTo({top:0, behavior:'smooth'}); };
    el.appendChild(next);
  }

  function renderCard(q) {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.appendChild(SBData.questionMetaRow(q, { visualTag: true }));
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

  // Wraps every case-insensitive occurrence of the search term in a <mark>.
  // Works on the rendered DOM's text nodes rather than the HTML string, so
  // the <sup>/<sub> math markup and escaped characters stay intact. Buttons
  // are skipped (their labels aren't searched).
  function highlightMatches(root, term) {
    const needle = (term || '').trim().toLowerCase();
    if (!needle) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('button, .actions')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(needle);
      if (idx === -1) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(idx, idx + needle.length);
        frag.appendChild(mark);
        last = idx + needle.length;
        idx = lower.indexOf(needle, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }



  init();
})();
