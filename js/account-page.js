// account.html: log in, sign up, reset a password, and manage the account.
(function () {
  const $ = (id) => document.getElementById(id);
  function show(id) {
    ['acctLoading', 'acctDisabled', 'acctLoggedOut', 'acctLoggedIn'].forEach((x) => { $(x).hidden = x !== id; });
  }
  function message(el, text, kind) {
    el.textContent = text;
    el.className = 'alert alert-' + (kind || 'info');
    el.hidden = !text;
  }
  function tab(name) {
    document.querySelectorAll('[data-acct-pane]').forEach((f) => { f.hidden = f.dataset.acctPane !== name; });
    document.querySelectorAll('.nav-tabs [data-acct-tab]').forEach((b) => b.classList.toggle('active', b.dataset.acctTab === name || (name === 'reset' && b.dataset.acctTab === 'login')));
    message($('acctMsg'), '');
  }
  document.querySelectorAll('[data-acct-tab]').forEach((b) => b.addEventListener('click', () => tab(b.dataset.acctTab)));

  function busy(form, on) { form.querySelectorAll('button, input').forEach((x) => { x.disabled = on; }); }
  function onSubmit(id, fn) {
    $(id).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      busy(form, true);
      try { await fn(); } catch (err) {
        message(form.closest('#acctLoggedIn') ? $('acctMsgIn') : $('acctMsg'), err.message || String(err), 'danger');
      } finally { busy(form, false); }
    });
  }

  onSubmit('loginForm', async () => {
    await SBAccount.signIn($('loginEmail').value.trim(), $('loginPassword').value);
  });
  onSubmit('signupForm', async () => {
    const res = await SBAccount.signUp($('signupEmail').value.trim(), $('signupPassword').value, $('signupName').value.trim());
    if (!res.session) {
      tab('login');
      message($('acctMsg'), 'Check your email for a link to confirm your account, then log in here.', 'success');
    }
  });
  onSubmit('resetForm', async () => {
    await SBAccount.resetPassword($('resetEmail').value.trim());
    message($('acctMsg'), 'If that email has an account, a link to set a new password is on its way.', 'success');
  });
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
    if (!user) { show('acctLoggedOut'); return; }
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
