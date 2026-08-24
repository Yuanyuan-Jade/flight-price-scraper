# flight-price-scraper

从表格里的航线（出发地-目的地）批量在 trip.com 上查询各航空公司机票价格，
并把结果（东航是否展示、东航价格、两家主要共飞航司及价格）写回 Excel。

## 已知限制 —— 请先读这段

这份脚本是在一个**无法直接访问 trip.com 的沙箱环境**里写的：该环境出口代理与
Chromium 的 TLS 1.3 握手不兼容，强制降级到 TLS 1.2 后又会被 trip.com 的反爬
（Akamai / whaleguard）在连接层直接拦截（`HTTP 432`），JS 都还没跑就被拒绝了。
也就是说 **trip.com 页面的实际 DOM 结构、搜索结果接口的真实 JSON 格式，本脚本作者从未实际见过**，
是基于 Trip.com/Ctrip 系网站的通用模式和抓取经验搭的架子，不是照着真实页面抠出来的选择器。

因此：

1. 首次运行请**不要用 `--headless`**（默认就是有头模式），肉眼确认搜索流程走到哪一步卡住。
2. 如果自动搜索失败，加 `--debug` 参数，会把每条航线的截图、完整 HTML、抓到的网络 JSON
   存到 `./debug/` 目录，把这些发给我（或自己对照）就能针对性修正 `lib/tripSearch.js`
   里的选择器和 `lib/extractPrices.js` 里的字段名匹配规则。
3. 价格提取优先解析页面加载过程中的网络请求 JSON（更稳定），解析不到时才会退化成从页面
   可见文字里用正则猜"航司二字码 + 金额"的组合（`--debug` 输出里会标注 `[text-fallback, verify manually]`），
   这部分**建议人工抽查几条核对**。

如果第一次跑通有问题，把 `debug/` 目录发给我，我可以照着真实结构把选择器和解析规则改准。

## 使用方法

```bash
npm install
npx playwright install chromium   # 本机需要真实下载一次 Chromium（沙箱环境已预装，本机没有）

node scrape.js --input data/routes.xlsx --output data/routes.out.xlsx
```

常用参数：

```
--only AMS-BJS,AMS-CAN     只跑指定的几条航线（逗号分隔），调试时用
--year 2026                 表格"查询日期"列是 9.4 这种"月.日"格式，没有年份，这里指定年份
--carrier MU                 要重点检查"是否展示/价格"的航司二字码，默认 MU（东航）
--headless                   无头模式运行（默认有头，更不容易被识别成机器人）
--debug                      保存每条航线的截图/HTML/抓到的JSON到 ./debug
--delay-min / --delay-max    航线之间的随机等待毫秒数（默认 6000-15000），别调太小
```

跑完后 `--output` 指定的 Excel 里，原表 TRIP 那一列区块（G:L：东航是否展示 / 东航价格 /
共飞1航司 / 共飞1价格 / 共飞2航司 / 共飞2价格）会被更新；查询失败的行会在"东航是否展示"
格子写 `ERROR: ...`，其余字段清空，避免和上次跑的旧数据混在一起看不出来。

## 数据来源与逻辑

- 航线：读表格 E 列"OD"（如 `AMS-BJS`），按 `-` 拆成出发地/目的地两个三字码。
- 出发日期：表格 F 列"查询日期"（如 `9.4`）按"月.日"解析，年份由 `--year` 指定。
- 东航是否展示/价格：搜索结果里若出现目标航司（默认 MU）的航班，取其**最低价**。
- 共飞航司1/2：搜索结果里除目标航司外，**价格最低的两家**航司及其价格。

## 目录结构

```
scrape.js              命令行入口
lib/readRoutes.js      读取 Excel，解析航线和日期
lib/tripSearch.js       Playwright 驱动 trip.com 搜索（深链接优先，失败则走首页搜索框）
lib/extractPrices.js   从网络 JSON / 页面文字里提取"航司二字码 -> 最低价"
lib/writeResults.js    把结果写回 Excel 对应列
```

## 使用须知

请遵守 trip.com 的服务条款和当地法律法规，控制查询频率（默认已加了随机延迟），
仅用于合理的内部比价/监控用途，不要用于大规模高频抓取或转售数据。
