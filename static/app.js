const usd = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const $ = (id) => document.getElementById(id);

// Sentry: browser errors, page/API performance traced through to Flask, and a replay of
// the session whenever an error happens. Skipped if no DSN is configured.
if (window.Sentry && window.SENTRY_CONFIG?.dsn) {
  Sentry.init({
    ...window.SENTRY_CONFIG,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

// fetch JSON; network failures and 5xx responses get reported with what the user was doing
async function api(url, opts) {
  try {
    const r = await fetch(url, opts);
    const data = await r.json();
    if (r.status >= 500) {
      window.Sentry?.addBreadcrumb({ category: "api", level: "error", message: `${r.status} ${url}` });
    }
    return data;
  } catch (err) {
    window.Sentry?.captureException(err, { extra: { url } });
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

const DEFAULT_VALUE = 391000; // median Raleigh assessed value

let chart;
let currentValue = DEFAULT_VALUE;
let currentAddress = null;
let searchTimer;

async function init() {
  const budget = await api("/api/budget");
  $("fy").textContent = `(${budget.fiscal_year})`;
  $("ask-form").onsubmit = ask;
  $("address-input").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(suggest, 250);
  };
  $("address-input").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const first = $("suggestions").querySelector("li[data-pick]");
    if (first) first.click();
  };
  loadValue(DEFAULT_VALUE, "Median Raleigh home");
}

// "$391,000", "391000", "391k", "1.2m" -> number; anything with other letters -> null
function parseValue(text) {
  const m = text.trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  return n >= 10000 ? n : null; // short numbers are probably house numbers
}

function addOption(list, text, onPick) {
  const li = document.createElement("li");
  li.textContent = text;
  li.dataset.pick = "";
  li.onclick = () => {
    list.hidden = true;
    onPick();
  };
  list.append(li);
}

async function suggest() {
  const q = $("address-input").value.trim();
  const list = $("suggestions");
  if (q.length < 3) return (list.hidden = true);

  list.innerHTML = "";
  const value = parseValue(q);
  if (value) addOption(list, `Estimate for a ${usd(value)} home`, () => loadValue(value));

  const { results = [], error } = await api(`/api/search?q=${encodeURIComponent(q)}`);
  for (const r of results) {
    addOption(list, r.address + (r.type ? ` (${r.type})` : ""), () => {
      $("address-input").value = r.address;
      loadProperty(r.pin);
    });
  }
  if (!list.children.length) {
    list.innerHTML = `<li class="empty">${error || "No Raleigh addresses found"}</li>`;
  }
  list.hidden = false;
}

async function loadProperty(pin) {
  const data = await api(`/api/property?pin=${pin}`);
  if (data.error) return alert(data.error);
  const p = data.property;
  currentAddress = p.address;
  $("property").innerHTML = `
    <strong>${p.address}</strong>, ${p.city}<br>
    Assessed value: ${usd(data.assessed_value)} (land ${usd(p.land_value || 0)}, building ${usd(p.building_value || 0)})
    ${p.year_built ? `· built ${p.year_built}` : ""}<br>
    ${p.exemption ? `<span class="warn">Exemption on file: ${p.exemption}. Actual bill may be lower or $0.</span><br>` : ""}
    <a href="${p.wake_url}" target="_blank" rel="noopener">View official Wake County record</a>`;
  render(data);
}

async function loadValue(value, label) {
  const data = await api(`/api/breakdown?value=${value}`);
  if (data.error) return alert(data.error);
  currentAddress = null;
  $("property").innerHTML = `<strong>${label || "Home valued at " + usd(value)}</strong> (assessed value ${usd(value)})`;
  render(data);
}

function render(data) {
  currentValue = data.assessed_value;

  $("city-tax").textContent = usd(data.city_tax);
  $("county-tax").textContent = usd(data.county_tax);
  $("total-tax").textContent = usd(data.total_tax);

  renderChart(data.departments);
  $("projects").innerHTML = data.capital_projects
    .map((p) => `<li><span>${p.name}</span><strong>${usd(p.your_dollars)}</strong></li>`)
    .join("");
}

function renderChart(depts) {
  const cfg = {
    type: "doughnut",
    data: {
      labels: depts.map((d) => d.name),
      datasets: [{ data: depts.map((d) => +d.your_dollars.toFixed(2)) }],
    },
    options: {
      plugins: {
        legend: { position: "right" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${usd(ctx.raw)}` } },
      },
    },
  };
  if (chart) chart.destroy();
  chart = new Chart($("dept-chart"), cfg);
}

async function ask(e) {
  e.preventDefault();
  const question = $("question").value.trim();
  if (!question) return;
  $("answer").textContent = "Thinking...";
  const res = await api("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, value: currentValue, address: currentAddress }),
  });
  $("answer").textContent = res.answer || res.error;
}

init();
