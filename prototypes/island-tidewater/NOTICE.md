# 许可与资产署名

本目录不是对全部内容的统一重新授权。产品原有代码继续遵循根目录 GNU AGPL-3.0 许可；第三方代码和素材保留各自许可。

## Tidewater

固定来源 [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater/tree/4811ba48d795197de5621985f404e765c0b7c0ef)。原代码的 MIT 许可与版权声明完整保留在 `vendor/tidewater/LICENSE`，版权归 DRG Software Solutions LLC。`museum/MuseumApp.js` 派生于其 `src/App.js`；`runtime/FrameTimer.js` 的实际 pass 计时方式参考其 `src/core/Bench.js`。原始代码与逐文件来源清单保存在本目录。

`creek/CreekApp.js` 的初始化及帧内顺序继续派生于 Tidewater App；`CreekTerrain.js`、`CoastTerrain.js`、`CoastalOcean.js`、`CreekForest.js`、`CreekWater.js` 和 `CreekPlayer.js` 分别接入其地形、VegType/GrassField/ImpostorAtlas、水面/折射/水下后处理和步行/游泳接口。水下太阳折射、光照衰减及阴影入水点公式按上游 MIT 实现适配到自己的有限坡降水域；远树语义和风/速度输出在应用适配层调整。所有上游文件仍原样保留，没有删去来源再标为自研渲染器。

溪谷的地形、河床、侧泉、路径、动物位置和针叶树模板来自本项目原《溪畔的巨影》。`tools/prepare-creek.mjs` 只导出本项目的空间数据；新森林布点和参观界面由本项目设计。它们不属于 Tidewater 的原海湾场景。来源和生成数据 SHA-256 保存在 `creek/geography.lock.json` 与 `creek/coast.lock.json`。西岸地形同样来自原博物馆岛屿，未使用 Tidewater 原海湾的地形或村落布局。

上游第三方素材继续按 `vendor/tidewater/CREDITS.md` 及其链接的各级声明使用，包括 CC0 海滩扫描和声音、Microsoft Rocketbox MIT 人物、字体和云噪声声明。不能将这些资产统一标为产品 AGPL 或 Tidewater MIT。

`creek/ForestAir.js` 派生和适配同一固定提交的 `src/post/AirHaze.js` 与 `src/fx/AirMotes.js`，保留其 MIT 来源；局部林隙介质、博物馆生境、当前/历史粒子姿态及内陆水域屏蔽在应用层接入。巨木林群落、林隙、根盘、倒木与观览点由本项目设计，未使用 Tidewater 原海湾布局。

`creek/GrassDistance.js` 与 `CreekGrass.js` 在应用层延展原生草地分层和空间池；保留 Tidewater 草叶几何、风动、阴影与时间历史接口。远处地表覆盖使用同一原生草地衍生纹理。`GroveDesign.js`、`GrovePlanting.js`、`GroveDetails.js` 的连片林布局、混龄补植、枯立木及小型菌体形态为本项目设计。巨木展区属于古森林生态类比，采用现存老龄林的景观尺度，不把地标树高或泛化植被外形宣称为单一化石地点的实测复原。

`creek/MuseumClouds.js` 继承同一固定提交的 `src/sky/SkyProClouds.js`（MIT，DRG Software Solutions LLC），仅在云影地图的世界坐标中心改变时采用其原生全图更新路径；云体、光照积分和历史重投影仍使用原实现。草块保守包络、世界固定草土覆盖过渡和 `runtime/SceneReport.js` 的现场定位界面在应用层实现。

`creek/IslandLife.js` 复用并适配固定提交的 `FishGeometry`、`FishMaterial`、`ReefBatch`、`BirdBatch` 与 `Fish.js` 的转向/避让思路（MIT）；鱼群水域、行为和泛化外形组合由本项目接入，不宣称现代参考鱼种就是精确的史前物种。`creek/MuseumPlankton.js` 派生于同提交的 `fx/MarineSnow.js`（MIT），使用本项目的低能水流、前一帧位置与粒径。三段浅海地形、连续环岛浅海床和区域地图为博物馆自有布局与界面。

`creek/MuseumImpostorAtlas.js` 改编自固定提交的 `src/world/vegetation/Impostors.js`（MIT，DRG Software Solutions LLC），保留其图集烘焙、原生材质与 mip 管线；博物馆适配为完整上下半球视角、同总像素预算和有限深度重投影。`HeadwaterDesign.js` 的泉口流线、湿润轨迹与岩阶布局为博物馆设计，泉口块石几何继续使用上游 `RockGeometry.js`。

`creek/TravellingSurf.js` 在应用层重组同提交 `ShoreSim.js` 的原生计算内核与 `Breakers.js` 的浪唇/喷沫管线（MIT，DRG Software Solutions LLC），加入沿岸有限窗口、世界空间历史重投影和站点接入；不复制上游海湾地形。`CoastalShelf.js` 的外海连通域、岸距场、环岛海床和覆盖剖面由博物馆设计。`CoveRocks.js` 保留上游四种程序岩石、共同LOD与岩石材质；石群位置和接地碰撞由博物馆接入。

`creek/ShelfReef.js` 复用同一固定提交的 `ReefGeometry.js`、`ReefBatch.js`、`ReefMaterials.js` 与 `ReefNoise.js`（MIT，DRG Software Solutions LLC），在本项目的浅海床上设计固定斑块、砂槽留白、LOD和游客/鱼群避障。团块、盘状与指状珊瑚为环境形态代理，不把原生现代加勒比珊瑚物种直接称为某一史前年代的化石复原。截图与定位反馈由本项目在应用层实现，仅在用户主动触发时本地保存。

`creek/IslandHillShadow.js` 改编自同一固定提交的 `src/world/TerrainGPU.js`（MIT，DRG Software Solutions LLC），保留24步太阳遮挡射线与近处CSM的协同；应用层改为多分辨率地形输入、1024²相对净空储存和实际接收面重建，以适配32km博物馆岛屿。湖床沉积底色、实际水域退草与海岸历史泡沫的近远展示交接在本项目适配层实现。

## 博物馆动物

- “Apatosaurus” by **toro ardido modelos 3d**, [来源](https://sketchfab.com/3d-models/apatosaurus-fecabec8e4ef42ef98b5480dbf50c57d)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。项目名称“迷惑龙”。既有博物馆修改与权益记录完整保留在 `notices/apatosaurus-license.txt`。
- “Triceratops dinosaur” by **wojciechmiedziocha**, [来源](https://sketchfab.com/3d-models/triceratops-dinosaur-87527079bad44917ab1b98a456b46c7e)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。项目名称“三角龙”。既有修改与署名记录保留在 `notices/triceratops-license.txt`。

本次新增修改为解码压缩、浮点属性转换、WebP 解码像素转 PNG、迷惑龙 morph 数据提取与原生今／昨顶点形变适配、三角龙原生骨骼接入、米制与地面校准及原生 PBR 参数接入。原动物文件未覆盖，来源和转换文件 SHA-256 见 `museum/assets/conversion.json`。这里仍为本地评审版本；署名与许可记录不代表批准发布。

## 连续样板自制几何与自然声

`creek/assets/sample-fissure.json` 是本项目以米制在 Blender 制作并检查的闭合风化岩体，不是外部扫描或已测泉口。`ContinuousSample.js`、`SampleTerrain.js` 与样板林地/倒木为自有地貌与生态结构设计，采用现代类比，未把不同原始测绘的高程零点拼成实测复原。

`creek/assets/sample-stream-nps.mp3` 为 **National Park Service / Muir Woods** 的现代溪流实录摘录，来自 [NPS Stream](https://www.nps.gov/subjects/sound/sounds-stream.htm) 及其 [原始 MP3](https://www.nps.gov/nps-audiovideo/legacy/mp3/nri/avElement/nri-StreamMUWO.mp3)。[NPS Sound Gallery](https://www.nps.gov/subjects/sound/gallery.htm) 将所链接录音列为公共领域并请求署名。运行时作 0.4 秒等功率交叉淡化循环、响度缩放和泉口空间衰减，经原生水下低通与总音量；不采集麦克风，不宣称史前声景复原。来源与原始文件 SHA-256 见 `creek/sample.lock.json`。

## 本项目原始针叶与树皮素材

`creek/assets/needle-spray-v1.png` 为原博物馆 2026-09-28 的 AI 生成视觉代理贴图，保留原始字节；不把它作为植物学扫描或古植物复原证据。`creek/assets/fir-bark-albedo.webp` 来自原项目提取的 [Poly Haven fir_tree_01](https://polyhaven.com/a/fir_tree_01)，CC0，未重采样。二者的输入路径、字节数和 SHA-256 保存在 `creek/materials.lock.json`；构建会验证。
