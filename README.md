# flight-search-launcher

选一条航线和出发日期，一键在浏览器里打开各个 OTA 网站对应的搜索结果页，人工比价——
不再自动抓取/解析价格填表。

## 是什么、不是什么

- 是一个 Electron 小工具：日期框 + 航线下拉框 + 搜索按钮。点搜索后，会在你电脑默认浏览器里
  打开 `data/sites.xlsx` 里配置的每个网站对应航线的搜索结果页（各开一个标签页），程序本身
  不读取、不解析、不保存任何页面内容，价格全部由人工在浏览器里查看判断。
- 不再需要 Playwright/无头浏览器——因为不用解析页面了，只是拼 URL 丢给浏览器打开，依赖比之前
  的自动抓取版本轻得多，也不会因为网站改版导致"抓不到数据"，最多是"打开的页面不对"，容易发现。

## 使用方法（开发模式）

```bash
npm install
npm start
```

## 打包成 Windows 可执行程序

```powershell
npm run dist
```

会在 `dist/win-unpacked/` 生成一个文件夹，里面有 `FlightSearchLauncher.exe` 和一个 `data/`
子文件夹（`routes.xlsx` + `sites.xlsx`）。**把整个文件夹拷给别人/放到任意位置即可运行**，
不需要安装、不需要管理员权限——这是特意选的打包方式（`dir` 而不是安装包/portable 单文件），
因为要保证 `data/` 里的两个 Excel 文件始终在 exe 旁边、可以直接双击编辑保存，换成安装包或
单文件 portable 模式都会导致这两个文件不好找或者每次运行都在临时目录里被清掉。

## 两个可编辑的配置文件

### `data/routes.xlsx`（航线表，sheet 名 `Routes`）

列：`始发区域 | 始发责任区 | 始发责任营业部 | OD类型 | OD`。`OD` 列格式是 `出发地-目的地`
三字码（如 `AMS-BJS`），程序按 `-` 拆开用于拼 URL。增删航线直接在这个表里加行/删行即可，
改完保存，下次打开程序自动生效。

### `data/sites.xlsx`（网站表，sheet 名 `Sites`）

列：`网站名称 | 主页URL | 搜索URL模板 | 备注`。`搜索URL模板` 里用 `{origin}`、`{destination}`、
`{date}`（`date` 格式 `YYYY-MM-DD`）作为占位符，程序会替换成实际值后打开。

**当前状态**：只有 `TRIP`（trip.com）的模板经过验证，能稳定打开对应航线的搜索结果页。其余
4 个网站（SUPERSAVER / TIX / KILROY / CONNECTIONS）的模板留空——**因为没有实际验证过这几个
网站的搜索 URL 格式，不想瞎猜一个可能打开错误页面却让人误以为是对的**。模板留空时程序会打开
该网站首页，需要手动输入航线搜索。

要补上某个网站的模板：在浏览器里手动搜索一次那条航线，观察地址栏里出发地/目的地/日期分别对应
哪个参数，把对应位置换成 `{origin}`/`{destination}`/`{date}`，填进这一行的"搜索URL模板"列
保存即可，不需要改代码。

**"经停≤1次"筛选**同理，trip.com 页面上有这个筛选项，但目前不确定能否用 URL 参数直接带上
（打开链接自动生效）——如果确认了对应参数，可以直接加进 `data/sites.xlsx` 里 TRIP 那一行的
模板 URL，不用改代码；确认之前先打开页面手动点一下这个筛选。

## 目录结构

```
main.js               Electron 主进程：起窗口、读 Excel、拼 URL、调用系统浏览器打开
preload.js            渲染进程和主进程之间的安全通信桥
renderer/              界面（日期框/下拉框/按钮）
lib/dataStore.js       读取 data/routes.xlsx、data/sites.xlsx
lib/buildSearchUrl.js  拿网站模板 + 航线 + 日期拼出最终 URL（模板为空则退化成打开首页）
data/routes.xlsx        航线表（可编辑）
data/sites.xlsx         网站表（可编辑）
```
