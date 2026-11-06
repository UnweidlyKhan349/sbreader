// login.html, signup.html and forgot-password.html, laid out like QB
// Reader's: one form each, an eye button to show the password, and a
// message line above the form. Logging in (or signing up when the project
// doesn't ask for email confirmation) goes back to the page you came from.
(function () {
  const $ = (id) => document.getElementById(id);
  const form = document.querySelector('[data-auth-form]');
  const msg = $('authMsg');
  function message(text, kind) {
    msg.textContent = text;
    msg.className = 'alert alert-' + (kind || 'info');
    msg.hidden = !text;
  }

  // Show / hide the password.
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.classList.toggle('active', show);
    });
  });

  // Where to go after logging in: the page you came from on this site,
  // unless that was one of these pages; otherwise the home page.
  function goBack() {
    let to = 'index.html';
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && !/(login|signup|forgot-password)\.html$/.test(ref.pathname)) to = ref.href;
    } catch (e) { /* home page */ }
    location.replace(to);
  }

  function busy(on) { form.querySelectorAll('button, input').forEach((x) => { x.disabled = on; }); }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(true);
    message('');
    try {
      if (form.id === 'loginForm') {
        await SBAccount.signIn($('loginEmail').value.trim(), $('loginPassword').value);
        goBack();
      } else if (form.id === 'signupForm') {
        if ($('signupPassword').value.length < 8) throw new Error('Your password must be at least 8 characters.');
        const res = await SBAccount.signUp($('signupEmail').value.trim(), $('signupPassword').value, $('signupName').value.trim());
        if (res && res.session) goBack();
        else message('Check your email for a link to confirm your account, then log in.', 'success');
      } else if (form.id === 'forgotForm') {
        await SBAccount.resetPassword($('forgotEmail').value.trim());
        message('If that email has an account, a link to reset the password is on its way.', 'success');
      }
    } catch (err) {
      message(err.message || String(err), 'danger');
    } finally {
      busy(false);
    }
  });

  if (!SBAccount.enabled) {
    $('authDisabled').hidden = false;
    form.hidden = true;
    return;
  }
  // Already logged in: nothing to do here.
  SBAccount.ready.then(() => { if (SBAccount.user() && form.id !== 'forgotForm') location.replace('account.html'); });
})();
