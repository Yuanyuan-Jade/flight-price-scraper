const dateInput = document.getElementById('date');
const routeSelect = document.getElementById('route');
const searchButton = document.getElementById('search');
const statusEl = document.getElementById('status');

let routes = [];

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

function nextWeekFriday(from = new Date()) {
  const jsDay = from.getDay(); // 0=Sun..6=Sat
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  const thisMonday = new Date(from);
  thisMonday.setDate(from.getDate() - (isoDay - 1));
  const friday = new Date(thisMonday);
  friday.setDate(thisMonday.getDate() + 7 + 4); // next week's Monday + 4 days = next week's Friday
  return friday;
}

async function init() {
  dateInput.value = nextWeekFriday().toISOString().slice(0, 10);

  const result = await window.api.loadRoutes();
  if (!result.ok) {
    setStatus(result.error, 'error');
    searchButton.disabled = true;
    return;
  }

  routes = result.routes;
  if (routes.length === 0) {
    setStatus('config/routes.xlsx 里没有找到任何航线，请检查该文件。', 'error');
    searchButton.disabled = true;
    return;
  }

  routeSelect.innerHTML = routes
    .map((r, i) => `<option value="${i}">${r.od}${r.office ? `（${r.office}）` : ''}</option>`)
    .join('');
}

searchButton.addEventListener('click', async () => {
  searchButton.disabled = true;
  setStatus('正在打开...', '');

  const routeIndex = Number(routeSelect.value);
  const date = dateInput.value;
  const result = await window.api.search(routeIndex, date);

  if (!result.ok) {
    setStatus(result.error, 'error');
  } else {
    const lines = result.opened.map(
      (o) => `${o.name}${o.isTemplated ? '' : '（未提供模板，打开的是首页，需手动搜索）'}`,
    );
    setStatus(`已为 ${result.route} 打开 ${result.opened.length} 个网站：\n${lines.join('\n')}`, 'ok');
  }

  searchButton.disabled = false;
});

init();
