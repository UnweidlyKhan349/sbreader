(function () {
  // Unbookmarking here doesn't remove the card from the page - it just
  // un-highlights the star, so an accidental click is easy to undo (click
  // the star again to re-bookmark) without the card jumping out from under
  // you. The card only disappears from this list the next time it's loaded.
  function renderCard(q) {
    return SBData.questionCard(q, { hideAnswer: true, onBookmark: updateCount });
  }

  function updateCount() {
    const n = SBData.bookmarks.count();
    document.getElementById('resultCount').textContent = n
      ? `${n.toLocaleString()} bookmarked question${n === 1 ? '' : 's'}`
      : "You haven't bookmarked any questions yet — star a question in the catalog or during practice to save it here.";
    document.getElementById('practiceBtn').disabled = !n;
  }

  function renderAll() {
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
  }

  // Logging in merges in the account's bookmarks, which can live in
  // tournaments this page hasn't loaded yet.
  window.addEventListener('sb-bookmarks-synced', () => {
    SBData.loadIds([...SBData.bookmarks.getAll()]).then(renderAll);
  });

  SBData.loadBookmarked().then(() => {
    renderAll();
    document.getElementById('practiceBtn').addEventListener('click', () => {
      if (SBData.bookmarks.count()) location.href = 'solo.html?bookmarked=1';
    });
  }).catch((err) => {
    document.getElementById('resultCount').textContent = 'Failed to load question data: ' + err.message;
  });
})();
