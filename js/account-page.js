// The account pages, as QB Reader's /user pages (logging in, signing up and
// resetting a password have their own):
//   account.html        Welcome, your username and email, and links to your
//                       stats, graphs and starred questions
//   edit-profile.html   username and email; reset stats / delete my data
//   edit-password.html  current, new and confirmed password
// Each page has the parts it needs; this script wires whichever are there.
(function () {
  const $ = (id) => document.getElementById(id);
  // A password-reset email's link lands on account.html already logged in;
  // noted before the account library tidies the address.
  const recovery = /type=recovery/.test(location.hash) || new URLSearchParams(location.search).has('recovery');

  function show(id) {
    ['acctLoading', 'acctDisabled', 'acctLoggedIn'].forEach((x) => { if ($(x)) $(x).hidden = x !== id; });
  }
  function message(text, kind) {
    const el = $('acctMsgIn');
    el.textContent = text;
    el.className = 'alert alert-' + (kind || 'info');
    el.hidden = !text;
  }
  function busy(form, on) { form.querySelectorAll('button, input:not([data-fixed])').forEach((x) => { x.disabled = on; }); }
  function onSubmit(id, fn) {
    const form = $(id);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.classList.add('was-validated');
      // Checked before the fields are disabled for the save: a disabled
      // field always counts as valid.
      const valid = form.checkValidity();
      busy(form, true);
      try { await fn(form, valid); } catch (err) {
        message(SBAccount.friendlyError(err), 'danger');
      } finally { busy(form, false); }
    });
  }

  /* ---------------- account.html ---------------- */
  if ($('logout')) $('logout').addEventListener('click', () => SBAccount.signOut());
  if ($('email-verification-link')) {
    $('email-verification-link').addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await SBAccount.resendVerification();
        $('email-verification-span').hidden = true;
        $('email-verification-confirmation').hidden = false;
      } catch (err) { message(SBAccount.friendlyError(err), 'danger'); }
    });
  }

  /* ---------------- edit-profile.html ---------------- */
  if ($('password')) $('password').dataset.fixed = '1';
  onSubmit('profile-form', async (form, valid) => {
    const name = $('username').value.trim();
    const email = $('email-input').value.trim();
    $('username').value = name;
    if (!name || !valid) return;
    const { emailChanged } = await SBAccount.updateProfile(name, email);
    form.classList.remove('was-validated');
    message(emailChanged ? 'Profile saved. Click the link sent to your new email address to finish changing it.' : 'Profile saved.', 'success');
  });
  if ($('resetStatsBtn')) {
    $('resetStatsBtn').addEventListener('click', async () => {
      if (!await SBSite.confirm('Delete every answer in your stats? This can\'t be undone.', { title: 'Reset stats', ok: 'Reset stats', danger: true })) return;
      try { await SBAccount.resetStats(); message('Your stats were reset.', 'success'); } catch (err) { message(SBAccount.friendlyError(err), 'danger'); }
    });
  }
  if ($('deleteDataBtn')) {
    $('deleteDataBtn').addEventListener('click', async () => {
      if (!await SBSite.confirm('Delete your stats and the starred questions and settings saved to your account? This can\'t be undone.', { title: 'Delete my data', ok: 'Delete my data', danger: true })) return;
      try { await SBAccount.deleteMyData(); message('Your data was deleted.', 'success'); } catch (err) { message(SBAccount.friendlyError(err), 'danger'); }
    });
  }

  /* ---------------- edit-password.html ---------------- */
  // Arriving from a reset email, there's no current password to ask for.
  if ($('password-form') && recovery) {
    $('old-password-row').hidden = true;
    $('old-password').required = false;
  }
  if ($('confirm-password')) {
    const match = () => $('confirm-password').setCustomValidity($('confirm-password').value === $('new-password').value ? '' : 'The passwords differ.');
    $('new-password').addEventListener('input', match);
    $('confirm-password').addEventListener('input', match);
  }
  onSubmit('password-form', async (form, valid) => {
    if (!valid) return;
    if (!recovery) await SBAccount.checkPassword($('old-password').value);
    await SBAccount.updatePassword($('new-password').value);
    form.reset();
    form.classList.remove('was-validated');
    message('Password changed.', 'success');
  });

  function render(user) {
    if (!SBAccount.enabled) { show('acctDisabled'); return; }
    // Logged out: the account pages are the log in page.
    if (!user) { location.replace('login'); return; }
    // From a reset email: straight to choosing the new password.
    if (recovery && !$('password-form')) { location.replace('edit-password?recovery=1'); return; }
    show('acctLoggedIn');
    const name = SBAccount.displayName(user);
    if ($('username-1')) {
      $('username-1').textContent = name;
      $('username-2').textContent = name;
      $('email').textContent = user.email || '';
      const verified = SBAccount.emailVerified(user);
      $('email-verified').textContent = verified ? 'Email verified' : 'Email not verified';
      if (!verified && $('email-verification-confirmation').hidden) $('email-verification-span').hidden = false;
    }
    if ($('profile-form') && !$('profile-form').dataset.filled) {
      $('profile-form').dataset.filled = '1';
      $('username').value = name;
      $('email-input').value = user.email || '';
    }
    if ($('password-form') && recovery && $('acctMsgIn').hidden) message('Choose a new password below.', 'info');
  }
  SBAccount.onChange(render);
  SBAccount.ready.then(() => render(SBAccount.user()));
})();
