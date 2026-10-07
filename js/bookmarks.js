(function () {
  const { QTYPE_LABELS, FORMAT_LABELS, escapeHtml } = SBData;
  const labelFor = SBData.subjectLabel;


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

    // Unbookmarking here doesn't remove the card from the page - it just
    // un-highlights the star, so an accidental click is easy to undo (click
    // the star again to re-bookmark) without the card jumping out from
    // under you. The card only actually disappears from this list the next
    // time it's loaded (a refresh), once storage no longer has it.
    actions.appendChild(SBData.bookmarkButton(q.id, updateCount));

    card.appendChild(actions);
    return card;
  }

  function updateCount() {
    const n = SBData.bookmarks.count();
    document.getElementById('resultCount').textContent = n
      ? `${n.toLocaleString()} bookmarked question${n === 1 ? '' : 's'}`
      : "You haven't bookmarked any questions yet — star a question in the catalog or during practice to save it here.";
    document.getElementById('practiceBtn').disabled = !n;
  }

  SBData.load().then(() => {
    const ids = SBData.bookmarks.getAll();
    const results = document.getElementById('results');
    results.innerHTML = '';
    const questions = [...ids].map((id) => SBData.byId.get(id)).filter(Boolean);
    if (!questions.length) {
      results.innerHTML = '<div class="empty-state">No bookmarks yet.</div>';
    } else {
      questions.forEach((q) => results.appendChild(renderCard(q)));
    }
    updateCount();
    document.getElementById('practiceBtn').addEventListener('click', () => {
      if (SBData.bookmarks.count()) location.href = 'solo.html?bookmarked=1';
    });
  }).catch((err) => {
    document.getElementById('resultCount').textContent = 'Failed to load question data: ' + err.message;
  });
})();
