# 史前动物博物馆 SEO 改进报告

> 审计日期为 2026-08-26。
> 范围包括 `leon-made-this.work` 的个人站与博物馆、公开 GitHub 仓库、`museum.s7ea.com` 对照站，以及当前产品仓库的生成逻辑。
> 本文把可直接核验的 HTTP、HTML、sitemap、公开 API 和源码记为“事实”，把无法从 Search Console 或 Google 排名系统直接证实的解释记为“推断”，待执行事项记为“建议”。搜索结果会随地区、设备、语言和时间变化，用户在匿名窗口看到的页码只作为问题线索，不作为稳定 KPI。

## 结论摘要

官网没有明显的 robots、`noindex`、canonical 或 sitemap 阻断。当前最值得处理的三个问题都涉及页面内容和链接信号，继续添加 meta 标签的收益很有限。

1. **部分自有链接仍指向动态语言入口。** `/museum/` 返回 `302`，响应的 `Vary` 字段包含 Cookie 和 Accept-Language。Google 明确建议多语言站使用独立 URL，避免依据推测的语言自动重定向，Googlebot 通常也不发送 `Accept-Language`。目前个人站中文作品页、中文制作故事以及公开 README 仍有链接指向这个动态入口，没有直接指向对应语言首页。
2. **官方首页在完成预渲染后，首屏 HTML 主要表达“今天认识剑龙”，整馆说明过薄。** 首页已有清晰 H1、18 个可抓取动物链接、独立 title 和 description，这些是优点；但“这是什么、适合谁、与普通恐龙内容有什么不同、如何使用、科学资料如何处理”等整馆价值没有成为持续可见的首页正文。
3. **动物详情页有正确 URL 与元数据，但正文价值没有完整暴露。** 详情页已有 H1、独立 title/description、自指 canonical、双语 `hreflang`、图片和 WebPage JSON-LD；然而年代、地区、体型、食性、分类、复原不确定性与科学来源主要在交互抽屉里。若这些资料需要点击后才注入页面，Googlebot 不会代替用户触发交互。Google 官方文档建议在最终渲染 HTML 中提供需要索引的正文。

因此，短期策略应是先统一规范 URL 与入口链接，再把已有的真实内容正式放进首页和动物详情页，最后用 Search Console 观察哪些中文、英文查询获得曝光。不要把“反复提交 sitemap”“堆关键词”或“大量生成薄页面”当作主要手段。

## 一、当前状态审计

### 1. 抓取、索引与 sitemap

| 项目 | 事实 | 判断 |
| --- | --- | --- |
| `robots.txt` | [官网 robots.txt](https://leon-made-this.work/robots.txt) 允许全站抓取，并指向根 sitemap | 正常 |
| 根 sitemap | [根 sitemap](https://leon-made-this.work/sitemap.xml) 是 sitemap index，包含个人站与博物馆两个子 sitemap | 正常，只提交根 sitemap 即可 |
| 个人站 sitemap | [个人站 sitemap](https://leon-made-this.work/sitemaps/personal-site.xml) 当前列出 5 个页面 | 正常 |
| 博物馆 sitemap | [博物馆 sitemap](https://leon-made-this.work/museum/sitemap.xml) 当前列出 38 个 canonical URL，即 2 个语言首页和 18 个动物的中英文详情页 | 正常 |
| 重复提交 | 用户已于 2026-08-26 重新提交根 sitemap；Search Console 的 Last read 尚未更新 | 属于正常等待，不需要再单独提交博物馆 sitemap |

Google 说明 sitemap index 可以只提交一个索引文件；sitemap 是发现与 canonical 偏好的提示，不保证立即抓取、收录或提高排名。重复请求同一 URL 也不会让它更快抓取。[Google sitemap 官方指南](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[请求重新抓取](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)

### 2. Canonical 与 `hreflang`

**事实**

- [中文首页](https://leon-made-this.work/museum/zh-CN/) 与 [英文首页](https://leon-made-this.work/museum/en/) 都有自指 canonical。
- 两个首页互相声明 `zh-CN`、`en`，并把 `/museum/` 声明为 `x-default`。
- 当前动物详情页在中英文之间做了互相对应的 `hreflang`，canonical 指向各自语言的详情 URL。
- sitemap 只列入这些规范 URL，没有列入带查询参数的动物状态 URL。

**判断**

这套 localized URL、canonical 和 reciprocal `hreflang` 的基础结构是正确的。动物详情页没有 `x-default` 不构成错误，`x-default` 是可选补充。需要改善的是 `/museum/` 本身的行为，以及所有可控制链接是否直接落到规范语言页。

Google 说明 `hreflang` 用于关联本地化版本；每个版本应列出自己和其他版本。Google 同时建议不要按浏览器语言自动跳转，因为这可能让搜索引擎无法发现所有版本。[本地化版本指南](https://developers.google.com/search/docs/specialty/international/localized-versions)、[多语言站点指南](https://developers.google.com/search/docs/advanced/crawling/managing-multi-regional-sites)

### 3. `/museum/` 动态入口

**事实**

- 2026-08-26 的 HTTP 检查显示 `/museum/` 返回 `302`，响应含 `Vary: Cookie, Accept-Language` 和 `Cache-Control: private, no-store`；实际目标随请求语言条件变化。
- `/museum/zh-CN/` 与 `/museum/en/` 均返回 `200`，是可独立访问的内容页。
- 个人站的中文项目页、中文制作故事以及仓库中当前 README 仍链接 `/museum/`。GitHub About 已改为直接链接英文首页，这是正确调整。

**建议**

`/museum/zh-CN/` 和 `/museum/en/` 才是分别承载中文、英文搜索需求的整馆首页。`/museum/` 只负责语言分流，不需要承担主要排名任务。

更清晰的长期方案是把 `/museum/` 改为返回 `200` 的轻量双语选择页，并保留它作为 `x-default`。页面直接提供两个普通 `<a>` 链接。

- `简体中文` → `/museum/zh-CN/`
- `English` → `/museum/en/`

如果产品体验需要保留当前自动跳转，可以继续使用 `302`，但自有链接应直接落到对应语言首页，并通过 Search Console URL Inspection 验证 Google 实际看到的结果。改成 `200` 选择页属于结构清理，优先级低于补全两个语言首页的正文。

### 4. 首页信息架构

**事实**

- 当前中文、英文首页均有准确 H1，且初始 HTML 中包含 18 个动物详情的普通 `<a href>` 链接，站内发现能力良好。
- 首页 title 与 description 已本地化。中文 title 为“史前动物博物馆 | 亲子 3D 史前动物展”，英文 title 为 “Prehistoric Animal Museum | A 3D Family Adventure”。
- 生成流程先创建一份包含整馆介绍、隐私说明和分展厅目录的静态 SEO shell，随后 [预渲染脚本](../scripts/prerender-localized-museum.ts) 会删除该 shell，并用实际 React 应用标记替换。最终官网 HTML 主要呈现默认剑龙展项；该行为也被 [预渲染测试](../tests/prerender-document.test.ts) 明确断言。

**推断**

对于“史前动物博物馆”或 “prehistoric animal museum”这种整馆查询，当前官网虽然主题明确，但页面主体给搜索系统的可见解释更像一个剑龙互动展项。它能够证明“这里有动物”，却没有充分回答“这座馆是什么、为什么值得家庭使用”。这会削弱首页对宽泛整馆查询的相关性，尤其英文站几乎没有独立站外信号时更明显。

**建议的首页结构**

保留现在的 3D 首屏，在首屏之后增加真正可见、随 HTML 一起预渲染的整馆区块。

1. **一段完整定位。** 面向 2 至 6 岁孩子与家长、免费、无需账号、无广告、双语、可旋转缩放、声音不自动播放。
2. **为什么做。** 用简短真实故事解释“孩子可以自己控制靠近、声音和停留时间”。
3. **怎么玩。** 选择动物、转动观察、主动听旁白、打开家长资料。
4. **海陆空藏品。** 用可见文本分组，并继续使用真实详情链接。
5. **科学与复原。** 说明资料来源、群体级展项、化石证据的边界，以及颜色、软组织和动作中的不确定性。
6. **作者与原始项目。** 明确 Leon 是创作者，链接个人主页与 GitHub 原始仓库。

这些内容应为用户而写，不应隐藏、关键词堆砌或只留给爬虫。Google 的 people-first 指南强调原创、完整、可信、有明确作者与来源的内容。[Google 有帮助内容指南](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

首页 title 也可以围绕真实用途做一次测试。中文可用 `史前动物博物馆｜给 2 至 6 岁孩子的免费 3D 恐龙与古生物网站`，英文可用 `Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits`。上线后至少观察数周，再依据 Search Console 的查询和 CTR 决定是否保留。标题应准确、简洁且各页不同，避免为了覆盖词语而不断加长。[Google title link 指南](https://developers.google.com/search/docs/appearance/title-link)

### 5. 动物详情页与长尾搜索

**已有优势**

- 每只动物已有中英文独立 URL、独立 title、描述、H1、图片、canonical、`hreflang` 和来源数据。
- 首页和详情页之间已有标准 HTML 链接，不依赖 URL fragment。
- title 采用“动物名 | 博物馆名”的清晰结构。

**主要缺口**

当前详情页初始正文主要是动物名、短旁白与 3D 互动。年代、化石发现地区、体型、食性、分类、科学来源和复原说明没有作为持续可见的详情正文输出。仓库的 [SEO 文档生成器](../scripts/multilingual-seo.ts) 原本能生成这些完整字段，但后续预渲染会用应用界面替换详情 fallback。

**建议**

每个详情页在 3D 展台下加入可见的资料区，直接复用已审核的 canonical 内容，无需另造 SEO 文案。

- 一段 80 至 200 字的独特介绍；
- “观察什么”与亲子提问；
- 年代、发现地区、大小、食性、分类；
- 哪些是化石证据，哪些是复原推断；
- 2 至 5 个第一手科学来源；
- 2 至 4 个同展厅或相关动物的描述性链接。

英文 title 可按查询意图逐步测试，例如 `Stegosaurus for Kids | 3D Exhibit and Facts`；中文可保留稳定的中文名，并在正文自然出现常见别名与拉丁/英文名。不要一次性批量制造只有名称变化的模板页面。Google 鼓励独特、准确的页面描述，也说明 snippet 主要来自页面正文。[Google snippet 与 meta description 指南](https://developers.google.com/search/docs/appearance/snippet)

图片是这个项目的天然搜索入口。详情页应继续使用标准 `<img src>` 或 `<picture>` 中带 `src` 的 fallback、具体的本地化 alt、相邻图注与稳定图片 URL。等 Search Console 的图片搜索有持续曝光后，再决定是否把关键 hero 图加入 image sitemap。[Google 图片 SEO 指南](https://developers.google.com/search/docs/appearance/google-images)

### 6. 英文 SEO

英文版已经有独立的 `/en/` URL。它当前更缺少完整英文正文、直达英文页的链接，以及来自英文内容和社区的真实引用。

**优先动作**

- 英文 README 的主 CTA 直接指向 `/museum/en/`；中文 README 直接指向 `/museum/zh-CN/`。
- 个人站中文项目页和中文文章直接链接中文首页；未来英文文章、X 英文帖、英文目录页直接链接英文首页或对应英文详情页。
- 英文首页 title 可从偏品牌的 `A 3D Family Adventure` 调整为更明确的用户任务，例如 `Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits`，但应结合 Search Console 的真实英文查询测试，不要频繁修改。
- 英文详情内容使用自然的家长搜索表达，如 `for kids`、`interactive 3D exhibit`、`facts`，同时保持科学准确；不要把同一关键词机械重复在标题、H1 和每段正文里。
- 先覆盖与产品高度一致的长尾，再期待宽泛词。可观察 `3D prehistoric animal museum for kids`、`interactive dinosaur museum for children`、`free dinosaur website for kids`，以及各动物 `for kids / facts / 3D model` 查询。

### 7. GitHub、作者身份与外链

**事实**

GitHub About 已完成关键调整。2026-08-26 的公开 API 显示以下信息。

- Description 已明确说明免费、亲子、3D、18 个展项与双语；
- Website 已指向 `/museum/en/`；
- Topics 已包含 `dinosaurs`、`education`、`kids`、`multilingual`、`museum`、`paleontology`、`react`、`threejs`、`typescript`、`webgl`；
- 审计时仓库约有 643 Stars、93 Forks。数字会继续变化。

来源见 [GitHub Repository API](https://api.github.com/repos/s010s/prehistoric-animal-museum) 和 [GitHub Topics API](https://api.github.com/repos/s010s/prehistoric-animal-museum/topics)。

**下一步**

- 修改英文、中文 README 的官网 CTA，使其直达对应语言页。
- 在 README 开头用一段普通文本明确 “Official website / 官方网站”，不能只依赖 hero 图片。
- 个人作品页、制作故事、RSS、未来内容项目用描述性锚文本链接具体 canonical URL。
- 对外传播优先寻找真正相关的亲子教育、自然史、古生物、Three.js 和开源社区；用可复用的科学来源清单、复原说明、开源实现或教学活动作为值得引用的资产。
- 不购买链接、不做互换链接网络、不批量提交低质量目录。Google 的排名系统仍使用链接分析来理解页面关系，但链接的价值来自真实编辑选择，不是数量堆积。[Google 排名系统指南](https://developers.google.com/search/docs/appearance/ranking-systems-guide)、[可抓取链接与锚文本指南](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)

## 二、`museum.s7ea.com` 对照分析

### 可验证事实

2026-08-26 直接检查了 [对照站首页](https://museum.s7ea.com/) 与用户提供的 [菊石 URL](https://museum.s7ea.com/animals/ammonite/)，结果如下。

- 两个 URL 都返回 `200`；除 Cloudflare 动态注入参数外，HTML 主体相同。
- `/animals/ammonite/` 没有返回菊石详情，而是返回中文整馆首页。
- HTML 有 H1“史前动物博物馆”、两段整馆介绍、海陆空三组目录和 26 个动物名称。
- 它的 canonical 指向 `https://leon-made-this.work/museum/zh-CN/`，中英文和 `x-default` 也全部指向官网。
- 它的 [robots.txt](https://museum.s7ea.com/robots.txt) 指向官网根 sitemap；它的 [sitemap.xml](https://museum.s7ea.com/sitemap.xml) 列出的也是 54 个 `leon-made-this.work` URL，而不是 `museum.s7ea.com` URL。
- 这份镜像列出 26 只动物，但当前官网 sitemap 仍是 18 只；例如官网对应的菊石 URL 当前返回 404。

### 原因判断

以下内容属于**推断**，不能当作 Google 已公开确认的单一排名原因。

1. 对照站错误地把整馆静态 shell 暴露在很多 200 URL 上。对“史前动物博物馆”这类查询，它的可见 HTML 比官网当前的“默认剑龙展项”更直接、词义更完整。
2. 两个站点和内容都很新，Google 可能尚未完成重复页面聚类、canonical 选择和重新排序。Google 明确说明 canonical 是强信号但不是绝对命令，Google 可以选择不同 canonical。
3. `/animals/ammonite/` 在官网当前是 404，而镜像返回内容丰富的 200 首页；如果用户搜索“菊石 + 史前动物博物馆”，官网没有可竞争的 canonical 详情页。
4. 用户看到的临时排序可能还受到地区、搜索语言与数据中心差异影响。

对照站目前主动把 canonical 指向官网，因此不建议把首要精力放在投诉或对抗上。更有效的处理是让官网拥有更完整、稳定、可见的内容，并在 Search Console 检查 Google-selected canonical。若 30 至 60 天后对照站仍持续取代官网，再考虑友好联系站长，邀请其将镜像入口 301 到官网或明确标注非官方 fork。

Google 说明重复页会被聚类，canonical 由多种信号共同决定；`rel=canonical`、重定向和 sitemap 都能表达偏好，但 Google 仍可能另选。[Google canonical 原理](https://developers.google.com/search/docs/crawling-indexing/canonicalization)、[指定 canonical 的方法](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

## 三、执行优先级

### P0　0 至 14 天，先修信号与内容落差

1. 把所有自有链接改成直接语言 URL。中文个人站与中文 README 指向 `/zh-CN/`，英文 README 与英文传播指向 `/en/`。
2. 在中英文首页加入持续可见、可预渲染的整馆介绍、玩法、藏品分组、科学与复原说明、作者和原仓库链接。
3. 继续让 sitemap 只收录官网真实存在且返回 200 的规范页。镜像列出的 26 只动物不构成官网补齐到 26 页的理由。
4. 在 Search Console URL Inspection 分别检查中英文首页和各 2 个详情页的抓取 HTML、Google-selected canonical 与 last crawl。

**P0 验收**

- 所有自有主入口不再链接动态跳转 URL；
- 两个语言首页的最终渲染 HTML 都能直接找到整馆说明和完整藏品链接；
- sitemap 中每个 URL 都返回 200、可索引、自指 canonical；
- 抽检详情页的 Google-selected canonical 与声明一致。

### P1　15 至 45 天，把详情页做成真正的长尾落地页

1. 为全部已发布动物输出可见的完整科学资料和来源区，保留 3D 互动为页面核心体验。
2. 为中英文详情页各自写自然、独特的标题和描述；从 Search Console 已有 query 反推措辞。
3. 增加同展厅与相关动物链接，使用动物名和关系作为锚文本。
4. 校验每页主图、alt、图注、OG 图与结构化数据；用 Rich Results Test 或 URL Inspection 检查渲染结果。
5. 监测 Core Web Vitals，尤其 3D 和大图页面。Google 建议 LCP ≤ 2.5 秒、INP < 200 毫秒、CLS < 0.1；以 Search Console 的真实用户数据为准。[Google Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)
6. 评估把 `/museum/` 改成返回 `200` 的双语选择页。若保留 `302`，继续让它只承担分流，并确保主入口直接链接语言首页。

**P1 验收**

- 100% 已发布详情页在不点击抽屉的情况下可读到年代、地区、体型、食性、分类、复原说明和来源；
- 中英文页面没有互相串语言，`hreflang` 成对且 URL 返回 200；
- 每页至少有 2 个有意义的相关动物链接；
- Search Console 的 Page indexing 报告没有系统性的“重复网页，Google 选择了不同的规范网页”或 soft 404 集群；
- 有足够 CrUX 数据时，主要 URL 组 Core Web Vitals 为 Good；暂无数据时保留实验室基线并继续等待真实数据。

### P2　46 至 90 天，基于真实查询扩展权威与内容

1. 每两周导出 Search Console 页面与查询数据，分别分析中文首页、英文首页和动物详情。
2. 对“曝光高、位置 5 至 20、CTR 低”的页面优化 title、description 和首段；一次只改一组，至少观察 2 至 4 周。
3. 对已有曝光的新查询补充真实内容，不按想象批量建页。例如“恐龙网站适合几岁”“恐龙模型可旋转”“Stegosaurus facts for kids”等只有在能提供独特答案时才扩写。
4. 发布少量高价值、可被引用的内容资产，如复原方法、科学来源说明、亲子观察活动或 Three.js 性能实践，并向真正相关的社区传播。
5. 检查对照站是否仍被 Google 选为展示 URL；若持续出现，再做站长沟通与品牌区分。

**P2 验收**

- 中文和英文各有独立的 Search Console query/page 周报；
- 28 天对比前 28 天时，获得曝光的 canonical 页面数和非品牌长尾 query 数有清晰记录；
- 对每个 title/content 调整保留日期、改动与前后数据，能判断保留或回滚；
- 新外链来自相关内容的正常引用，不来自付费链接或批量目录；
- 90 天复盘以 Search Console 趋势决定下一阶段，不以单次匿名搜索页码决定成败。

## 四、90 天观测框架

Search Console 的核心指标是 Clicks、Impressions、CTR 和 Average position，并可按 query、page、country、device 拆分。[Google Search Console 性能数据说明](https://developers.google.com/search/blog/2022/10/performance-data-deep-dive)

### 每周固定看

| 维度 | 过滤方式 | 要回答的问题 |
| --- | --- | --- |
| Sitemap | 根 sitemap | Last read 是否更新，两个子 sitemap 是否成功 |
| Page indexing | URL 前缀 `/museum/` | 规范页有多少已索引，未索引原因是否集中 |
| Canonical | URL Inspection 抽样 | Google-selected canonical 是否等于声明值 |
| 中文首页 | Page = `/museum/zh-CN/` | 哪些中文查询带来曝光、排名和点击 |
| 英文首页 | Page = `/museum/en/` | 是否开始出现英文非品牌查询 |
| 详情页 | Page regex 包含 `/animals/` | 哪些动物和语言先获得长尾曝光 |
| 搜索类型 | Web / Image 分开 | 模型图是否形成独立入口 |
| 地区和设备 | Country / Device | 英文弱势是否来自地区覆盖或移动体验 |
| 页面体验 | Core Web Vitals | 3D、图片和交互是否造成 URL 组级问题 |

### 建立基线

本报告无法访问站点的 Search Console 私有数据，因此不虚构当前 impressions、clicks、CTR 或 position。执行第一天应导出最近 28 天数据作为基线 `B0`；第 30、60、90 天分别导出同口径数据。新站数据量小，早期优先看“是否被发现、是否出现查询、canonical 是否正确”，不要过早用百分比增长下结论。

建议保存四个查询集。

- 中文品牌包括 `史前动物博物馆`、`Leon做了个`；
- 中文需求包括 `儿童恐龙网站`、`3D 恐龙`、`恐龙博物馆` 与具体动物名；
- 英文品牌包括 `Prehistoric Animal Museum`、`Leon Made This`；
- 英文需求包括 `dinosaur website for kids`、`interactive dinosaur museum`、`3D prehistoric animals` 与具体动物名。

## 五、不建议做的事

- 不要重复提交 sitemap 或反复请求同一 URL 收录；Google 明确说这不会加速抓取。
- 不要把 `/museum/` 做成中文重复首页，同时保留 `/zh-CN/`；这会制造新的 canonical 选择问题。
- 不要隐藏 SEO 段落、白字堆词或让爬虫和用户看到不同内容。
- 不要批量生成只有动物名不同的薄页面。
- 不要把结构化数据当作排名开关。它帮助理解内容，但不能替代可见正文，也不保证 rich result。
- 不要购买外链、刷导航站或复制站群。
- 不要用一次匿名搜索的“第几页”验收。排名是结果信号，Search Console 的长期 query/page 数据才适合诊断。

## 六、2026-08-28 实施核对

本节记录截至 2026-08-28 的代码级结果。这里的“完成”表示对应 HTML、链接、结构化数据或交互已经实现并通过本地构建验证，不表示 Google 已重新抓取，也不表示搜索排名已经提升。实际效果仍需在生产上线后通过 Search Console 观察。

### 已完成

| 项目 | 状态 | 实现与证据 |
| --- | --- | --- |
| 自有入口使用本地化官网 URL | 已完成 | 中文 README、个人站中文项目页和制作故事直接链接 `/museum/zh-CN/`；英文 README 直接链接 `/museum/en/`，不再把主要权重交给动态语言入口。 |
| 18 种动物的中英文研究资料 | 已完成代码实现 | 36 个预渲染详情页均包含与动物对应的研究摘要、年代、发现地区、体型、食性、分类说明、复原不确定性、科学来源与查阅日期。内容复用已审核的 canonical 数据，没有另造关键词段落。 |
| 研究资料进入最终 HTML | 已完成代码实现 | 家长资料和“关于这座博物馆”在关闭时也保留于预渲染 HTML 与初始 DOM。研究资料使用原生 `details` 折叠区，用户可从现有“家长资料”按钮打开并阅读；Googlebot 不需要触发点击才能在 HTML 中取得正文。 |
| 保持 3D 展馆体验 | 已完成 | 页面外层锁定为一个视口，隐藏文档滚动条并移除首屏外阅读区，用户不会从静态或 3D 展馆滚入 SEO 正文。可阅读内容只在用户主动打开的抽屉内滚动。 |
| 官方来源与品牌识别 | 已完成 | 所有动物家长资料和“关于”抽屉都显示 `Leon做了个`、个人官网及当前语言的博物馆官网地址；中文为 `/museum/zh-CN/`，英文为 `/museum/en/`。 |
| 博物馆结构化品牌信号 | 已完成 | 中英文首页输出 `WebApplication`，关联 `Brand`、创作者 Leon、个人 `WebSite` 与本地化 canonical；动物页 `WebPage` 同样关联创作者、品牌及所属博物馆。 |
| 个人站品牌实体 | 已完成 | 个人站首页输出 `Brand`，`WebSite` 使用 `Leon做了个` 及英文别名；博物馆作品页通过 `brand`、`sameAs`、源码地址和官网地址关联同一作品。 |
| 首页标题的用户任务表达 | 已完成代码实现 | 中文标题调整为“给 2–6 岁孩子的免费 3D 恐龙与古生物网站”，英文标题调整为 “Prehistoric Animal Museum for Kids \| Free Interactive 3D Exhibits”。上线后需观察 CTR 再决定是否保留。 |
| 构建与隐私边界 | 已完成 | 生产构建继续生成 2 个语言首页和 36 个动物详情页；边界检查未发现 source map 或私有来源标记。 |

### 与原建议的差异

原报告建议在首页和详情页首屏之后放置“持续可见、无需点击”的正文。实际评审确认这会破坏单屏 3D 展馆的核心体验，因此没有采用首屏外长页面，也没有把正文放成用户不可访问、只给搜索引擎读取的隐藏文本。

最终方案是把完整资料预渲染进初始 HTML，同时让真实用户通过现有“家长资料”或“关于”按钮访问。折叠区属于正常交互内容，不是爬虫专用内容。这个方案解决了“点击后才向 DOM 注入”的抓取缺口，也保护了展馆体验；但它不等同于原报告所说的持续可见正文，搜索相关性收益可能弱于独立可见的资料页。因此，原 P0 首页正文第 2 项和 P1“无需点击即可读”验收项应记为**调整方案后部分完成**，不应记为完全达标。

### 有效性判断与验收边界

以下改善可以在代码和构建产物中直接确认。

- 每种语言使用独立 canonical URL，并获得对应语言的自有链接；
- 36 个动物详情页的最终 HTML 都包含完整、独特且有来源的研究资料；
- 品牌、作者、官网、源码与作品之间形成一致的普通链接和 JSON-LD 关系；
- 没有白字、屏幕外关键词、按爬虫 user-agent 分流或用户不可访问的 SEO 专用正文；
- 3D 展馆仍保持单屏，研究资料只在用户主动打开的抽屉中出现。

这些措施能改善抓取可靠性、页面主题表达、本地化链接信号与品牌实体一致性，因此从技术 SEO 角度有效。但是否增加 impressions、clicks、非品牌 query、CTR 或排名，只能在生产上线并被重新抓取后判断。

### 尚未完成或需上线后验证

1. 生产发布后，用 URL Inspection 抽查中英文首页以及至少 2 个中英文动物详情页，确认 Google 看到研究资料并选择声明的 canonical。
2. 导出上线前 28 天 Search Console 数据作为 `B0`，在第 30、60、90 天按同一口径对比。
3. 观察新首页标题的 impressions、CTR 和查询构成，至少积累 2 至 4 周数据后再调整。
4. 继续观察 Core Web Vitals；本地构建和交互测试不能替代 CrUX 真实用户数据。
5. `/museum/` 是否改为 `200` 双语选择页仍未实施；现阶段继续让自有链接直接指向语言规范页。
6. 现有全馆导航能够发现全部动物，但“同展厅或相关动物”的语义化推荐仍可在后续基于真实查询补充。

## 七、源码与官方来源

### 本项目与公开页面

- [多语言 SEO 与 sitemap 生成器](../scripts/multilingual-seo.ts)
- [本地化预渲染逻辑](../scripts/prerender-localized-museum.ts)
- [预渲染测试](../tests/prerender-document.test.ts)
- [官网中文首页](https://leon-made-this.work/museum/zh-CN/)
- [官网英文首页](https://leon-made-this.work/museum/en/)
- [官网博物馆 sitemap](https://leon-made-this.work/museum/sitemap.xml)
- [个人站项目页](https://leon-made-this.work/projects/prehistoric-animal-museum/)
- [GitHub 原始仓库](https://github.com/s010s/prehistoric-animal-museum)
- [对照站菊石 URL](https://museum.s7ea.com/animals/ammonite/)

### Google Search Central 一手文档

- [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [创建有帮助、可靠、以用户为先的内容](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [多语言和多区域站点](https://developers.google.com/search/docs/advanced/crawling/managing-multi-regional-sites)
- [本地化页面与 hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Canonical 原理](https://developers.google.com/search/docs/crawling-indexing/canonicalization)
- [指定 canonical](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [JavaScript SEO 基础](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Sitemap 指南](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [请求重新抓取](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Title link 指南](https://developers.google.com/search/docs/appearance/title-link)
- [Snippet 与 meta description](https://developers.google.com/search/docs/appearance/snippet)
- [图片 SEO](https://developers.google.com/search/docs/appearance/google-images)
- [排名系统指南](https://developers.google.com/search/docs/appearance/ranking-systems-guide)
- [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)
