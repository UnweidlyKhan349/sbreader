// Shared page chrome: the colour theme and the navbar.
//
// Loaded synchronously in every page's <head>, before the stylesheet has a
// chance to paint, so the saved theme is on <html> from the very first frame
// (no flash of the light theme on a Night page). The navbar wiring waits for
// the DOM.
//
// Themes: 'light', 'dark' (shown as "Night") or 'auto' (follow the system),
// saved per device as localStorage.sb_theme. Bootstrap reads the result from
// <html data-bs-theme="light|dark">.
(function () {
  const KEY = 'sb_theme';
  const THEMES = ['light', 'dark', 'auto'];
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function storedTheme() {
    try {
      const v = localStorage.getItem(KEY);
      if (THEMES.includes(v)) return v;
    } catch (e) { /* storage blocked: fall through to the default */ }
    // A first visit (nothing saved) starts in Light, as QB Reader does;
    // Auto and Night stay a click away.
    return 'light';
  }
  function resolved(theme) {
    if (theme === 'auto') return darkQuery && darkQuery.matches ? 'dark' : 'light';
    return theme;
  }
  function apply(theme) {
    const t = resolved(theme);
    document.documentElement.setAttribute('data-bs-theme', t);
    // The browser's bar colour (phones) follows the page's theme, not the
    // device's: the theme-color tags lose their media query and take the
    // navbar colour of the theme in use.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.removeAttribute('media');
      m.setAttribute('content', t === 'dark' ? '#333333' : '#dfebfb');
    });
  }

  apply(storedTheme());
  // Again once the page is parsed: the theme-color tags come after this script.
  document.addEventListener('DOMContentLoaded', () => apply(storedTheme()));
  if (darkQuery) {
    const onChange = () => { if (storedTheme() === 'auto') apply('auto'); };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onChange);
    else if (darkQuery.addListener) darkQuery.addListener(onChange);
  }

  const ICONS = {
    light: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708"/></svg>',
    dark: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/><path d="M10.794 3.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387a1.73 1.73 0 0 0-1.097 1.097l-.387 1.162a.217.217 0 0 1-.412 0l-.387-1.162A1.73 1.73 0 0 0 9.31 6.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387a1.73 1.73 0 0 0 1.097-1.097zM13.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732l-.774-.258a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/></svg>',
    auto: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 15A7 7 0 1 0 8 1zm0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16"/></svg>',
  };

  // Small inline icons other scripts can reuse (no icon font needed).
  window.SBIcons = {
    gear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/></svg>',
    // Bootstrap Icons' star and star-fill, as QB Reader's star buttons use.
    star: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="bi bi-star"><path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z"/></svg>',
    starFill: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="bi bi-star-fill"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/></svg>',
  };

  function closeAllDropdowns(except) {
    document.querySelectorAll('.dropdown-menu.show').forEach((menu) => {
      if (except && menu === except) return;
      menu.classList.remove('show');
      const toggle = menu.parentElement && menu.parentElement.querySelector('[data-sb-dropdown]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function markTheme(theme) {
    document.querySelectorAll('[data-sb-theme-value]').forEach((btn) => {
      const on = btn.getAttribute('data-sb-theme-value') === theme;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      // A check mark beside the chosen theme, as on QB Reader.
      const check = btn.querySelector('.theme-check');
      if (check) check.classList.toggle('d-none', !on);
    });
    const active = document.querySelector('.theme-icon-active');
    if (active) active.innerHTML = ICONS[theme] || ICONS.auto;
  }

  // A toggle with data-sb-dropdown opens the .dropdown-menu beside it; a
  // click elsewhere or Esc closes it.
  function wireDropdown(toggle) {
    const menu = toggle.parentElement.querySelector('.dropdown-menu');
    if (!menu || toggle.dataset.sbWired) return;
    toggle.dataset.sbWired = '1';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = !menu.classList.contains('show');
      closeAllDropdowns(menu);
      menu.classList.toggle('show', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Applies and saves a theme chosen elsewhere (an account's settings).
  function setTheme(theme) {
    if (!THEMES.includes(theme)) return;
    try { localStorage.setItem(KEY, theme); } catch (e) { /* not saved */ }
    apply(theme);
    markTheme(theme);
  }
  // Bootstrap modals without Bootstrap's JS: show/hide with a backdrop;
  // Esc, the close buttons ([data-sb-dismiss]) and a click outside the
  // dialog close it.
  let openModalEl = null;
  let backdrop = null;
  function hideModal(el) {
    el = el || openModalEl;
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    if (backdrop) { backdrop.remove(); backdrop = null; }
    document.body.classList.remove('modal-open');
    openModalEl = null;
    el.dispatchEvent(new CustomEvent('sb-modal-hidden'));
  }
  function showModal(el) {
    if (openModalEl) hideModal(openModalEl);
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    document.body.appendChild(backdrop);
    el.style.display = 'block';
    el.removeAttribute('aria-hidden');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    el.classList.add('show');
    document.body.classList.add('modal-open');
    openModalEl = el;
    if (!el.dataset.sbModalWired) {
      el.dataset.sbModalWired = '1';
      el.addEventListener('click', (e) => {
        // (A [data-sb-static] dialog closes only by its own buttons.)
        if ((e.target === el && !el.hasAttribute('data-sb-static')) || e.target.closest('[data-sb-dismiss]')) hideModal(el);
      });
    }
    // As Bootstrap (and QB Reader) do: focus the dialog itself, not its
    // first button, so the close × doesn't open with a focus ring.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openModalEl && !openModalEl.hasAttribute('data-sb-static')) { e.stopPropagation(); hideModal(openModalEl); }
  }, true);

  // A message in a dialog on the page, as QB Reader's alert modal: centred,
  // the text and an OK button, closed only by OK (or Enter / Space on it;
  // not Esc or a click outside). Unlike window.alert it doesn't freeze the
  // page. onClose runs when it's dismissed.
  let alertEl = null;
  function showAlert(text, onClose) {
    if (!alertEl) {
      alertEl = document.createElement('div');
      alertEl.className = 'modal';
      alertEl.id = 'alert-modal';
      alertEl.tabIndex = -1;
      alertEl.setAttribute('data-sb-static', '');
      alertEl.setAttribute('aria-labelledby', 'alert-modal-text');
      alertEl.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">'
        + '<div class="modal-body"><p id="alert-modal-text" class="mb-0"></p></div>'
        + '<div class="modal-footer"><button class="btn btn-primary" id="alert-modal-close" data-sb-dismiss type="button">OK</button></div>'
        + '</div></div>';
      document.body.appendChild(alertEl);
    }
    alertEl.querySelector('#alert-modal-text').textContent = text;
    if (onClose) alertEl.addEventListener('sb-modal-hidden', () => onClose(), { once: true });
    showModal(alertEl);
    alertEl.querySelector('#alert-modal-close').focus({ preventScroll: true });
  }

  // A question in a dialog on the page, in place of window.confirm: the
  // text, Cancel, and a button named for what it does. Resolves true when
  // that button is pressed, false for Cancel, Esc or a click outside.
  // opts: { title, ok (the button's label; "OK"), danger (a red button) }
  let confirmEl = null;
  function showConfirm(text, opts) {
    opts = opts || {};
    if (!confirmEl) {
      confirmEl = document.createElement('div');
      confirmEl.className = 'modal';
      confirmEl.id = 'confirm-modal';
      confirmEl.tabIndex = -1;
      confirmEl.setAttribute('aria-labelledby', 'confirm-modal-title');
      confirmEl.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">'
        + '<div class="modal-header"><h5 class="modal-title" id="confirm-modal-title"></h5>'
        + '<button type="button" class="btn-close" data-sb-dismiss aria-label="Close"></button></div>'
        + '<div class="modal-body"><p id="confirm-modal-text" class="mb-0"></p></div>'
        + '<div class="modal-footer"><button class="btn btn-secondary" id="confirm-modal-cancel" data-sb-dismiss type="button">Cancel</button>'
        + '<button class="btn" id="confirm-modal-ok" type="button"></button></div>'
        + '</div></div>';
      document.body.appendChild(confirmEl);
    }
    confirmEl.querySelector('#confirm-modal-title').textContent = opts.title || 'Are you sure?';
    confirmEl.querySelector('#confirm-modal-text').textContent = text;
    const ok = confirmEl.querySelector('#confirm-modal-ok');
    ok.textContent = opts.ok || 'OK';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    return new Promise((resolve) => {
      let yes = false;
      ok.onclick = () => { yes = true; hideModal(confirmEl); };
      confirmEl.addEventListener('sb-modal-hidden', () => resolve(yes), { once: true });
      showModal(confirmEl);
    });
  }

  window.SBSite = { wireDropdown, setTheme, showModal, hideModal, modalOpen: () => !!openModalEl, alert: showAlert, confirm: showConfirm };

  // The service worker (sw.js, beside the pages) keeps the question bank and
  // the site's files cached for repeat visits; see sw.js. It sits next to
  // js/, so its address comes from this script's own.
  const siteScript = document.currentScript && document.currentScript.src;
  if (siteScript && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('../sw.js', siteScript).href, { scope: new URL('../', siteScript).href }).catch(() => {});
    });
  }

  // Updates after a redeploy. Each deploy writes version.json and stamps
  // its commit into every page (<meta name="sb-version">; see
  // tools/stamp-version.js). When the two differ, this page is older than
  // the site. Nothing is shown and the page is never reloaded for you: it
  // carries on as it is, and the new version arrives when you refresh or
  // next open the site. The one thing done meanwhile is fetching the new
  // service worker, so that refresh gets the new files and not cached old
  // ones. Checked on load, when the tab comes back into view, and every
  // five minutes. Pages without the meta tag (a local copy) never check.
  const pageVersion = (document.querySelector('meta[name="sb-version"]') || {}).content;
  if (siteScript && pageVersion && window.fetch) {
    const versionUrl = new URL('../version.json', siteScript).href;
    let seen = pageVersion;
    const check = async () => {
      try {
        const res = await fetch(versionUrl, { cache: 'no-store' });
        if (!res.ok) return;
        const v = String((await res.json()).version || '');
        if (!v || v === seen) return;
        seen = v;
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
          navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
        }
      } catch (e) { /* offline: try again later */ }
    };
    window.addEventListener('load', check);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 5 * 60 * 1000);
  }

  function wireNavbar() {
    document.querySelectorAll('[data-sb-dropdown]').forEach(wireDropdown);
    document.addEventListener('click', (e) => {
      if (e.target.closest('.dropdown-menu')) return;
      // A checklist dropdown (SBData.enhanceMultiSelect) opens its own menu
      // on this click; leave that one open.
      const own = e.target.closest('.dropdown-checklist');
      closeAllDropdowns(own ? own.querySelector('.dropdown-menu') : null);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllDropdowns();
    });

    // Collapsed (phone-width) navbar.
    const toggler = document.querySelector('[data-sb-collapse]');
    if (toggler) {
      const target = document.getElementById(toggler.getAttribute('data-sb-collapse'));
      toggler.addEventListener('click', () => {
        const open = !target.classList.contains('show');
        target.classList.toggle('show', open);
        toggler.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    // Theme menu.
    document.querySelectorAll('[data-sb-theme-value]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-sb-theme-value');
        try { localStorage.setItem(KEY, theme); } catch (e) { /* not saved */ }
        apply(theme);
        markTheme(theme);
        closeAllDropdowns();
      });
    });
    markTheme(storedTheme());

    // Highlight the link for the current page (and its dropdown parent).
    // Pages are linked without ".html" ("solo", "./" for the home page);
    // either form of the address counts.
    const bare = (p) => { p = (p || '').split(/[?#]/)[0].split('/').pop().toLowerCase().replace(/\.html$/, ''); return p === '' || p === '.' || p === 'index' ? 'index' : p; };
    let page = bare(location.pathname);
    // A set's and a packet's pages belong to the Set List.
    if (page === 'set' || page === 'packet') page = 'set-list';
    document.querySelectorAll('#navbar-navigation a[href]').forEach((link) => {
      if (bare(link.getAttribute('href')) !== page) return;
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
      const dropdown = link.closest('.dropdown');
      if (dropdown) {
        const toggle = dropdown.querySelector('[data-sb-dropdown]');
        if (toggle) toggle.classList.add('active');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireNavbar);
  else wireNavbar();
})();
