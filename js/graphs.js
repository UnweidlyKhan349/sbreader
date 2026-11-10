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
            ticks: { maxTicksLimit: phone ? 4 : 6, maxRotation: 0, callback: (v) => tickLabel(v) },
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
    // A day of room either side, so a single day sits mid-chart.
    const min = xs.length ? xs[0] - DAY : undefined;
    const max = xs.length ? xs[xs.length - 1] + DAY : undefined;
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
