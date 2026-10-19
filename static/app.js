const usd = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const $ = (id) => document.getElementById(id);

let chart;
let currentValue = 391000;
let currentAddress = null;
let searchTimer;

async function init() {
  const budget = await fetch("/api/budget").then((r) => r.json());
  $("fy").textContent = `(${budget.fiscal_year})`;
  for (const c of budget.classes) {
    const opt = new Option(c.label, c.id);
    if (c.id === "median") opt.selected = true;
    $("class-select").add(opt);
  }
  $("go").onclick = load;
  $("class-select").onchange = () => { $("value-input").value = ""; load(); };
  $("ask-form").onsubmit = ask;
  $("address-input").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(suggest, 250);
  };
  load();
}

async function suggest() {
  const q = $("address-input").value.trim();
  const list = $("suggestions");
  if (q.length < 3) return (list.hidden = true);
  const { results = [], error } = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
  list.innerHTML = "";
  if (error || !results.length) {
    list.innerHTML = `<li class="empty">${error || "No Raleigh addresses found"}</li>`;
  }
  for (const r of results) {
    const li = document.createElement("li");
    li.textContent = r.address + (r.type ? ` (${r.type})` : "");
    li.onclick = () => {
      $("address-input").value = r.address;
      list.hidden = true;
      loadProperty(r.pin);
    };
    list.append(li);
  }
  list.hidden = false;
}

async function loadProperty(pin) {
  const data = await fetch(`/api/property?pin=${pin}`).then((r) => r.json());
  if (data.error) return alert(data.error);
  const p = data.property;
  currentAddress = p.address;
  $("property").hidden = false;
  $("property").innerHTML = `
    <strong>${p.address}</strong>, ${p.city}<br>
    Assessed value: ${usd(data.assessed_value)} (land ${usd(p.land_value || 0)}, building ${usd(p.building_value || 0)})
    ${p.year_built ? `· built ${p.year_built}` : ""}<br>
    ${p.exemption ? `<span class="warn">Exemption on file: ${p.exemption}. Actual bill may be lower or $0.</span><br>` : ""}
    <a href="${p.wake_url}" target="_blank" rel="noopener">View official Wake County record</a>`;
  render(data);
}

async function load() {
  const v = $("value-input").value;
  const qs = v ? `value=${encodeURIComponent(v)}` : `class=${$("class-select").value}`;
  const data = await fetch(`/api/breakdown?${qs}`).then((r) => r.json());
  if (data.error) return alert(data.error);
  currentAddress = null;
  $("property").hidden = true;
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
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, value: currentValue, address: currentAddress }),
  }).then((r) => r.json());
  $("answer").textContent = res.answer || res.error;
}

init();
