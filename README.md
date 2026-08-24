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

会在 `dist/航线比价打开器/` 生成一个文件夹（`electron-builder` 默认会叫它 `win-unpacked`，
`npm run dist` 打包完会自动重命名成这个更好认的名字，方便直接发给不懂技术的同事），里面有
`航线比价打开器.exe` 和一个 `data/` 子文件夹（`routes.xlsx` + `sites.xlsx`）。**把整个文件夹
拷给别人/放到任意位置即可运行**，不需要安装、不需要管理员权限——这是特意选的打包方式（`dir`
而不是安装包/portable 单文件），因为要保证 `data/` 里的两个 Excel 文件始终在 exe 旁边、可以
直接双击编辑保存，换成安装包或单文件 portable 模式都会导致这两个文件不好找或者每次运行都在
临时目录里被清掉。

**发给别人用**：把整个 `航线比价打开器` 文件夹压缩成 zip 发过去，对方解压后双击文件夹里的
`航线比价打开器.exe` 就能用，不需要装 Node/npm、不需要装任何东西——`npm install`/`npm run dist`
只有你（开发/打包的人）需要跑，用的人不需要碰命令行。

## 两个可编辑的配置文件

### `data/routes.xlsx`（航线表，sheet 名 `Routes`）

列：`始发区域 | 始发责任区 | 始发责任营业部 | OD类型 | OD`。`OD` 列格式是 `出发地-目的地`
三字码（如 `AMS-BJS`），程序按 `-` 拆开用于拼 URL。增删航线直接在这个表里加行/删行即可，
改完保存，下次打开程序自动生效。

### `data/sites.xlsx`（网站表，sheet 名 `Sites`）

列：`网站名称 | 主页URL | 搜索URL模板 | 备注`。`搜索URL模板` 支持这些占位符：

```
{origin} / {destination}                  三字码原样代入，如 AMS
{originWithPrefix} / {destinationWithPrefix}  加 A-/C- 前缀（北京BJS、东京TYO这类"多机场
                                            城市代码"用 C-，其余具体机场用 A-；哪些代码算
                                            "多机场城市"在 lib/buildSearchUrl.js 的
                                            MULTI_AIRPORT_CITY_CODES 里，可以按需编辑）
{date}                                     YYYY-MM-DD
{dateDDMMYYYY}                             DD.MM.YYYY
```

**当前状态**：5 个网站里 4 个（TRIP / TIX / KILROY / CONNECTIONS）已经配了模板。TRIP 的
经过实际反复验证；另外 3 个是照着一次真实搜索跳转后的 URL 配的，字段名和拼接逻辑是对的，
但只验证过一次，没有反复测试稳不稳定，如果发现打开后结果不对，检查一下航线代码/日期是否变了、
或者网站本身改版了。

**SUPERSAVER 留空**：这个网站背后是 flightnetwork.com 的白标，搜索是靠一堆 GraphQL 请求
（不是普通的 URL 参数）实现的，没法用"拼 URL 打开"这种方式命中对应结果——模板留空时程序会
打开该网站首页，需要手动输入航线搜索，这个短期内没有更简单的解法。

要给某个网站补上/改模板：在浏览器里手动搜索一次那条航线，观察地址栏里出发地/目的地/日期分别
对应哪个参数，把对应位置换成上面的占位符，填进这一行的"搜索URL模板"列保存即可，不需要改代码。

**"经停≤1次"筛选**：已确认 trip.com 点击这个筛选后地址栏 URL 不变（纯前端筛选，没法通过
URL 参数带上），打开链接后如果需要按经停筛选，手动点一下"1 stop or fewer"即可。

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
