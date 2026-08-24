const dateInput = document.getElementById('date');
const routeSelect = document.getElementById('route');
const searchButton = document.getElementById('search');
const statusEl = document.getElementById('status');

let routes = [];

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

async function init() {
  const today = new Date();
  dateInput.value = today.toISOString().slice(0, 10);

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
