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
    } catch (e) { /* storage blocked: fall through to auto */ }
    return 'auto';
  }
  function resolved(theme) {
    if (theme === 'auto') return darkQuery && darkQuery.matches ? 'dark' : 'light';
    return theme;
  }
  function apply(theme) {
    document.documentElement.setAttribute('data-bs-theme', resolved(theme));
  }

  apply(storedTheme());
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
    });
    const active = document.querySelector('.theme-icon-active');
    if (active) active.innerHTML = ICONS[theme] || ICONS.auto;
  }

  function wireNavbar() {
    // Dropdowns: a toggle with data-sb-dropdown opens the .dropdown-menu
    // beside it; a click elsewhere or Esc closes it.
    document.querySelectorAll('[data-sb-dropdown]').forEach((toggle) => {
      const menu = toggle.parentElement.querySelector('.dropdown-menu');
      if (!menu) return;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = !menu.classList.contains('show');
        closeAllDropdowns(menu);
        menu.classList.toggle('show', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-menu')) closeAllDropdowns();
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
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('#navbar-navigation a[href]').forEach((link) => {
      const href = (link.getAttribute('href') || '').split('?')[0].toLowerCase();
      if (href !== page) return;
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
