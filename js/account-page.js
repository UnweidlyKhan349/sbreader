// account.html: manage the account (logging in, signing up and resetting a
// password have their own pages, as on QB Reader).
(function () {
  const $ = (id) => document.getElementById(id);
  function show(id) {
    ['acctLoading', 'acctDisabled', 'acctLoggedIn'].forEach((x) => { $(x).hidden = x !== id; });
  }
  function message(el, text, kind) {
    el.textContent = text;
    el.className = 'alert alert-' + (kind || 'info');
    el.hidden = !text;
  }

  function busy(form, on) { form.querySelectorAll('button, input').forEach((x) => { x.disabled = on; }); }
  function onSubmit(id, fn) {
    $(id).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      busy(form, true);
      try { await fn(); } catch (err) {
        message($('acctMsgIn'), err.message || String(err), 'danger');
      } finally { busy(form, false); }
    });
  }

  onSubmit('nameForm', async () => {
    await SBAccount.updateUsername($('newName').value.trim());
    message($('acctMsgIn'), 'Username saved.', 'success');
  });
  onSubmit('passwordForm', async () => {
    await SBAccount.updatePassword($('newPassword').value);
    $('newPassword').value = '';
    message($('acctMsgIn'), 'Password changed.', 'success');
  });
  $('logoutBtn').addEventListener('click', () => SBAccount.signOut());
  $('deleteDataBtn').addEventListener('click', async () => {
    if (!confirm('Delete your stats and the bookmarks and settings saved to your account? This can\'t be undone.')) return;
    try {
      await SBAccount.deleteMyData();
      message($('acctMsgIn'), 'Your data was deleted.', 'success');
    } catch (err) { message($('acctMsgIn'), err.message, 'danger'); }
  });

  function render(user) {
    if (!SBAccount.enabled) { show('acctDisabled'); return; }
    // Logged out: the account page is the log in page.
    if (!user) { location.replace('login'); return; }
    show('acctLoggedIn');
    $('acctName').textContent = SBAccount.displayName(user);
    $('acctEmail').textContent = user.email || '';
    $('newName').value = SBAccount.displayName(user);
    // Arriving from a password-reset email: the link logs you in, so ask
    // for the new password here.
    if (/type=recovery/.test(location.hash)) {
      message($('acctMsgIn'), 'Choose a new password below.', 'info');
      $('newPassword').focus();
    }
  }
  SBAccount.onChange(render);
  SBAccount.ready.then(() => render(SBAccount.user()));
})();
