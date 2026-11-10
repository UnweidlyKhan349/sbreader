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

  // Show / hide the password, as on QB Reader: the eye (Bootstrap Icons'
  // eye) shows it and turns into a crossed-out eye (eye-slash), which hides
  // it again.
  const EYE_SLASH = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">'
    + '<path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/>'
    + '<path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/>'
    + '<path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/></svg>';
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    const eye = btn.innerHTML;
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_SLASH : eye;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.classList.toggle('active', show);
    });
  });

  // Where to go after logging in: the page you came from on this site,
  // unless that was one of these pages; otherwise the home page.
  function goBack() {
    let to = './';
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && !/(login|signup|forgot-password)(\.html)?$/.test(ref.pathname)) to = ref.href;
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
        // An email that already has an account: the account service answers
        // as if it had signed up (a user with no identities, no session) and
        // sends nothing, so "check your email" would leave you waiting for a
        // link that never comes.
        const taken = res && res.user && Array.isArray(res.user.identities) && res.user.identities.length === 0;
        if (taken) {
          msg.innerHTML = 'That email already has an account. <a href="login" class="alert-link">Log in</a>, or <a href="forgot-password" class="alert-link">reset your password</a> if you\'ve forgotten it.';
          msg.className = 'alert alert-warning';
          msg.hidden = false;
        } else if (res && res.session) goBack();
        else message('Check your email for a link to confirm your account, then log in.', 'success');
      } else if (form.id === 'forgotForm') {
        const email = $('forgotEmail').value.trim();
        await SBAccount.resetPassword(email);
        message(`A link to reset your password has been sent to ${email}. Check your inbox (and your spam folder).`, 'success');
      }
    } catch (err) {
      message(SBAccount.friendlyError(err), 'danger');
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
  SBAccount.ready.then(() => { if (SBAccount.user() && form.id !== 'forgotForm') location.replace('account'); });
})();
