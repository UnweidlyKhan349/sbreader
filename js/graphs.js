// graphs.html: the account's stats plotted by day, as QB Reader's graphs
// pages, with Chart.js: questions heard and how they went, points per
// question, the share answered right and the share missed, and celerity.
// "Show cumulative view" adds the counts up over time; days with fewer than
// 5 questions are left out unless that switch is turned off.
(function () {
  const $ = (id) => document.getElementById(id);
  const core = window.SBAccountCore;
  if (!window.Chart) {
    $('graphNote').textContent = 'Could not load the charts. Check your connection and refresh.';
    $('graphNote').hidden = false;
    SBUserStats.markNav();
    return;
  }

  // QB Reader's line colours.
  const COLORS = { total: '#3e95cd', right: '#8e5ea2', zero: '#3cba9f', dead: '#e8c3b9', neg: '#c45850' };
  // A day ("2026-11-09") as a point in time: local noon.
  const timeOf = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
  const dateLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  // On the axis: "Nov 9" (the year is in the tooltip).
  const tickLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const phone = window.innerWidth < 576;
  const DAY = 24 * 60 * 60 * 1000;
  // The date axis is labelled on whole days, an even step apart: the
  // smallest of these steps (in days) that needs no more labels than fit.
  // (Left to Chart.js, labels fell at uneven times, "Sep 2, Sep 5, Sep 7",
  // and the same day could be labelled twice.)
  const STEPS = [1, 2, 3, 7, 14, 30, 61, 91, 182, 365, 730];
  const MAX_TICKS = phone ? 4 : 6;
  function dayTicks(axis) {
    const { min, max } = axis;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const span = Math.round((max - min) / DAY);
    const step = STEPS.find((s) => span / s <= MAX_TICKS - 1) || Math.ceil(span / (MAX_TICKS - 1));
    const ticks = [];
    // min is a day's noon (a day before the first day played), so every
    // label falls at noon and names its own day.
    for (let t = min; t <= max + DAY / 2; t += step * DAY) ticks.push({ value: t });
    axis.ticks = ticks;
  }

  function makeChart(id, y) {
    return new Chart($(id), {
      type: 'line',
      data: { datasets: [] },
      options: {
        animation: false,
        // The chart fills its box (.chart-box sets the height), so it stays
        // a readable size on a phone, where a 2:1 chart would be a sliver.
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            afterBuildTicks: dayTicks,
            ticks: { maxRotation: 0, callback: (v) => tickLabel(v) },
          },
          y: y || { beginAtZero: true, ticks: { precision: 0 } },
        },
        plugins: { legend: { labels: { boxWidth: phone ? 10 : 24, padding: phone ? 6 : 10 } }, tooltip: { callbacks: { title: (items) => (items.length ? dateLabel(items[0].parsed.x) : '') } } },
      },
    });
  }
  const charts = {
    count: makeChart('question-count'),
    ppq: makeChart('ppq', { min: -4, max: 4 }),
    result: makeChart('result-per-question', { min: 0, max: 100 }),
    celerity: makeChart('celerity', { min: 0, max: 1 }),
  };

  // Text and grid colours follow the page's theme.
  function themeCharts() {
    const style = getComputedStyle(document.body);
    const text = style.getPropertyValue('--bs-body-color').trim() || style.color;
    const grid = style.getPropertyValue('--bs-border-color').trim() || 'rgba(128,128,128,.3)';
    Object.values(charts).forEach((c) => {
      if (!c) return;
      c.options.color = text;
      Object.values(c.options.scales).forEach((s) => {
        s.ticks = { ...s.ticks, color: text };
        s.grid = { ...s.grid, color: grid };
      });
      c.update();
    });
  }
  new MutationObserver(themeCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });

  function accumulate(values) {
    let sum = 0;
    return values.map((v) => (sum += v));
  }

  function draw(rows) {
    let days = core.dailyStats(rows);
    const played = days.length;
    if ($('filter').checked) days = days.filter((d) => d.count >= 5);
    const note = $('graphNote');
    note.hidden = days.length > 0;
    if (!days.length) {
      note.textContent = played
        ? 'No day has 5 or more questions yet. Turn off "Exclude days with fewer than 5 data points" to see them all.'
        : `Nothing to plot yet. Questions you answer in Play and Multiplayer while logged in show up here.`;
    }
    const xs = days.map((d) => timeOf(d.key));
    const cumulative = $('cumulative').checked;
    const line = (label, color, values) => ({
      label, borderColor: color, backgroundColor: color, fill: false, tension: 0,
      data: values.map((y, i) => ({ x: xs[i], y })),
    });
    const counts = (pick) => { const v = days.map(pick); return cumulative ? accumulate(v) : v; };
    charts.count.data.datasets = [
      line('Total', COLORS.total, counts((d) => d.count)),
      line('4s', COLORS.right, counts((d) => d.fours)),
      line('0s', COLORS.zero, counts((d) => d.zeros)),
      line('Dead', COLORS.dead, counts((d) => d.dead)),
      line('Negs', COLORS.neg, counts((d) => d.negs)),
    ];
    charts.ppq.data.datasets = [line('Points per Question', COLORS.total, days.map((d) => d.ppq))];
    charts.result.data.datasets = [
      line('Correct Percentage', COLORS.total, days.map((d) => 100 * d.fours / d.count)),
      line('Neg or Dead Percentage', COLORS.right, days.map((d) => 100 * (d.negs + d.dead) / d.count)),
    ];
    if (charts.celerity) {
      charts.celerity.data.datasets = [
        line('Average Correct Celerity', COLORS.total, days.map((d) => d.celerity)),
        line('Average Buzzpoint', COLORS.right, days.map((d) => d.buzzpoint)),
      ];
    }
    // A day of room either side, so a single day sits mid-chart. With
    // nothing to plot, the charts still show, with their legends, over the
    // past week (with no dates the axis began at 1970: every label read "Jan 1").
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const min = xs.length ? xs[0] - DAY : today - 6 * DAY;
    const max = xs.length ? xs[xs.length - 1] + DAY : today;
    Object.values(charts).forEach((c) => {
      if (!c) return;
      c.options.scales.x.min = min;
      c.options.scales.x.max = max;
    });
    themeCharts();
  }

  let latest = [];
  $('cumulative').addEventListener('change', () => draw(latest));
  $('filter').addEventListener('change', () => draw(latest));
  SBUserStats.init((rows) => { latest = rows; draw(rows); });
})();
