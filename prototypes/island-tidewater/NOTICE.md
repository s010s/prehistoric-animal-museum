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

连续样板另从馆内36项主馆藏接入以下4种原模型，均沿用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)：

- “Lystrosaurus” by **seth the yutyrannus**，[来源](https://sketchfab.com/3d-models/lystrosaurus-32ea6a3bedd948638f9add8da7483b28)。完整记录在 `notices/sample-lystrosaurus-license.txt`。
- “Parasaurolophus” by **htqj寒潭秋镜**，[来源](https://sketchfab.com/3d-models/parasaurolophus-0f25fa4a55ba48c88adef066161f5e83)。完整记录在 `notices/sample-parasaurolophus-license.txt`。
- “Pteranodon animated” by **Chistodrako._. / Oscar López Riviello**，[来源](https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b)。完整记录在 `notices/sample-pteranodon-license.txt`。
- “Ichthyosaurus” by **Julian Johnson-Mortimer / FreddyFoxFreddy**，[来源](https://sketchfab.com/3d-models/ichthyosaurus-ef8609f5efa84984bc1800bdb36aac3c)。完整记录在 `notices/sample-ichthyosaur-license.txt`。

新增转换由 `tools/prepare-sample-animals.mjs` 解码 Meshopt、取消量化并无损转存PNG；源网格、材质、骨骼和动作轨道保留。原生今／昨骨骼调色板合并源模型多个蒙皮部件，保留鱼龙三个部件各自的逆绑定矩阵。运行时加入米制、实际地面支撑、有限觅食路径、访客让行与海岸飞行/海槽游动。源字节与转换文件、动画元数据、署名文件的哈希在 `creek/sample-animals.lock.json`，构建逐项核验。跨年代共处属于展区设定，无齿翼龙不归入鸟类。

## 连续样板自制几何与自然声

`creek/SampleHabitatEnrichment.js` 使用 **Leon Made This / s010s** 创作的 [Lowpoly Vault](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af) 植物与足迹几何，许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。源项目为 cycad、fern-cluster、horsetail-cluster、marsilea、montsechia、halimeda 与 three-toed-track，7个GLB总计947,076字节。逐项固定来源、SHA-256、尺寸与修改记录见 `creek/sample-habitat.lock.json`。原始GLB未改；运行时合并材质、校准尺寸与配色，加入根部固定的风/水流形变，按真实水位延伸水蕨叶柄，从泥板源几何提取凹印并贴合现有地形。足迹作为副栉龙形三趾后足的旧步迹示意，不认定具体足迹属，也不宣称是当前短步动画的实时落足印。海草额外复用 Tidewater 同固定提交的 MIT `ReefGeometry.js`，来源归 DRG Software Solutions LLC。

### Lowpoly Vault 连续样板生物

样板新增模型由 **Leon Made This / s010s** 创作，来自 [s010s/lowpoly-vault](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af)，核对该提交的最新清单后按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用：

- [Aeger spinipes](https://github.com/s010s/lowpoly-vault/tree/main/assets/additions/aeger/lean-ready44-r001)，本地 `creek/assets/aeger-lowpoly-vault.glb`，SHA-256 `222535c0d9686735a44a026db6bafc0bf1d16244e3910699b51fef5731c86b45`。
- [Aspidorhynchus](https://github.com/s010s/lowpoly-vault/tree/main/assets/additions/aspidorhynchus/lean-ready44-r001)，本地 `creek/assets/aspidorhynchus-lowpoly-vault.glb`，SHA-256 `29c75a67d0b21a56719eba2957518b8833d10a948ace6785660610d3c027d648`。
- [Rhamphorhynchus](https://github.com/s010s/lowpoly-vault/tree/main/assets/additions/rhamphorhynchus/reviewed-static4-20261026-r002)，本地 `creek/assets/rhamphorhynchus-lowpoly-vault.glb`，SHA-256 `a21ed6bdfa7613667bdca232064c2f667a2c3dac5dcd63f755f65dd6dc8b9f02`。
- [Diplomystus](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/diplomystus/small-fauna-v2)，本地 `creek/assets/diplomystus-lowpoly-vault.glb`，SHA-256 `36f382a00d8f93c0970d5cc9fef34a0ac4099cf9eec7edd0ce9f3f4a5f54cbe8`。
- [Eusthenopteron](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/eusthenopteron/reviewed-static4-20261026-r001)，本地 `creek/assets/eusthenopteron-lowpoly-vault.glb`，SHA-256 `fcdd29201fb1941b995abb2eaee2a4cc5fa6591967d10e6c8ae8c87d1cc66686`。
- [Anomalocaris](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/anomalocaris/small-life-round09-20261018)，本地 `creek/assets/anomalocaris-lowpoly-vault.glb`，SHA-256 `7b6ea43bbf6e6cc0b8f8f92087dfc5990a4bc724f7d0fc215d6174b1d028bc90`。
- [Eryon](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/eryon/ready72-r001)，本地 `creek/assets/eryon-lowpoly-vault.glb`，SHA-256 `59dca23417fd48b7757eab666593292daeb354e7092c618adbd2fbf4f8e2ad0d`。
- [Thecosmilia](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/thecosmilia/small-life-round03-20261018)，本地 `creek/assets/thecosmilia-lowpoly-vault.glb`，SHA-256 `5b396b9e0385ba85eb28b028fa4291f6f98485b4ad162cedfb2632ee4f222150`。
- [Favosites](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/favosites/small-life-round02-20261018)，本地 `creek/assets/favosites-lowpoly-vault.glb`，SHA-256 `364bb5b4209a2eb7076527dc87b28d4659eee233462fd7f44a3f41b21ee5327e`。
- [Acrocyathus](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/acrocyathus/small-life-round05-20261018)，本地 `creek/assets/acrocyathus-lowpoly-vault.glb`，SHA-256 `85c65487af8ddb08595248c5dfda912ddfdc3a1d9e22116177937d848b08400c`。
- [Gryphaea](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/gryphaea/small-life-round12-20261018)，本地 `creek/assets/gryphaea-lowpoly-vault.glb`，SHA-256 `fa7f25433044c572d589ee356625b2767f76f655226d78eff718598e3f750c7e`。
- [Hippurites](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/hippurites/ready72-r001)，本地 `creek/assets/hippurites-lowpoly-vault.glb`，SHA-256 `d2fb4e1e9b73434148d22758dd322227560e4edd70d2f0b1fe8d162165ed2d0d`。
- [Meganeura](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/meganeura/lean-ready30-r001)，本地 `creek/assets/meganeura-lowpoly-vault.glb`，SHA-256 `9dcfc035e9376508196fa6d13079f323692771cf856f1b974b89470dcb5aa96f`。
- [Pterodaustro](https://github.com/s010s/lowpoly-vault/tree/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/pterodaustro/ready72-r001)，本地 `creek/assets/pterodaustro-lowpoly-vault.glb`，SHA-256 `dda98ce2987b57880de969fcbb0e5c561e2025c65c8ac81e9c6f584296b7b71c`。


本轮补齐全部17种珊瑚，并新增8种壳体、2种海绵及2种溪潭鱼。以下26个新增 GLB 均来自上述固定提交；作者仍为 **Leon Made This / s010s**，许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。

| 资产 | 原始来源 | 本地 SHA-256 |
| --- | --- | --- |
| calceola | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/calceola/small-life-round02-20261018/calceola.glb) | `13ed3091c6408621858a183b8df90fc17984c0de0f01380600faac6c9a0c56b4` |
| goniophyllum | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/goniophyllum/small-life-round02-20261018/goniophyllum.glb) | `8f0caa08c7ac6062a68b9bfae0c7b43f8c1c919b641b7e6122fae45895972ced` |
| halysites | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/halysites/small-life-round02-20261018/halysites.glb) | `451a6f8e7b5f2f93c4b3108ffbf5a17cf1d1486f86b4021ee3252be0e97541ca` |
| aulopora | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/aulopora/small-life-round02-20261018/aulopora.glb) | `c652b3dec0eb541bee597922251933af32c301cb2cb8a9eba5744c66ffaa5657` |
| thamnopora | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/thamnopora/small-life-round02-20261018/thamnopora.glb) | `35e1e2d644be711752340b2f4b7270ca600cc39de91b418d54ae35c6fcc33c20` |
| syringopora | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/syringopora/small-life-round03-20261018/syringopora.glb) | `63024697f0b688183d6a4de8f681c4cb17e8d002ba6efaff33cb74db9ce68036` |
| heliophyllum | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/heliophyllum/small-life-round03-20261018/heliophyllum.glb) | `2e70992168ff04d758a2debbd0c77d08a5090626c89489849553491f71950517` |
| meandrina | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/meandrina/small-life-round03-20261018/meandrina.glb) | `2a17fa8ddcab195ebc714a377ddc487110f790762b33d59480fbb5266509077c` |
| flabellum | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/flabellum/small-life-round04-20261018/flabellum.glb) | `fedfac4035f835b425b3d66f3b56e3977d7c0c0ddde69229e324024c8e9a5c69` |
| micrabacia | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/micrabacia/small-life-round04-20261018/micrabacia.glb) | `89bc867f362236919fe72faec8dbdf789ce4f5b61d745cb83eefc9226b34c40e` |
| cystiphyllum | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/cystiphyllum/small-life-round04-20261018/cystiphyllum.glb) | `0e8239998b510334a1e6743adf82de0fabc4c3f557b3ca8b43d6fa0f9b049dbf` |
| montlivaltia | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/montlivaltia/small-life-round05-20261018/montlivaltia.glb) | `535626995156365c82bf6d31e7f219055a568573de07b938ccf2d2525971996f` |
| pleurodictyum | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/pleurodictyum/small-life-round06-20261018/pleurodictyum.glb) | `2b904cc71378663b71fdd74680de4f5ee24b5f34729681a0080c343a776dca3c` |
| isastraea | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/isastraea/small-life-round06-20261018/isastraea.glb) | `6380b1770d80a0f6e9521fb69189cce836f2b42be07e4b0aa238adc1cfb0ece9` |
| neithea | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/neithea/drive-r001/neithea.glb) | `e2cf1c42134cfeab37eb5573075d05f32cb0fa5be921778bc33b6f579c915678` |
| trigonia | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/trigonia/drive-r001/trigonia.glb) | `1cd08ae17f99af63cb812c292f28743014eb62a2738e42aaa1349b4598f9d90e` |
| cucullaea | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/cucullaea/drive-r001/cucullaea.glb) | `b5cfb5feca23d85c79163567b8b63f1cae550176eef4259e5a164678f1e5ba69` |
| pinna | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/pinna/ready72-r001/model.glb) | `761bb1eab5a49158c04283c7c37f6b15ebc73a4c53a66fd43ca2a05cdc7e33b1` |
| radiolites | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/radiolites/ready72-r001/model.glb) | `08bc6ecc0e1c992b94ade516d1fbc2620eb0b75541d641ec5f80b1be468291ef` |
| naticarius | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/naticarius/ready72-r001/model.glb) | `88aefedc61fea69387caf8d4f65a57e4b16e313149d562c7adc6d2d51e0ebf11` |
| siphocypraea | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/siphocypraea/ready72-r001/model.glb) | `75facf6a93410ff30d28c5613e83f4b26fb36d3b0d5df6610ae31e321c6b713c` |
| trochita | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/trochita/ready72-r001/model.glb) | `19a6026bed3bbc3d6063380afca8c3cc8e1f413362d7a5476ccc8e4cf3ae94e9` |
| vauxia | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/vauxia/small-life-round03-20261018/vauxia.glb) | `1b55a5dbc587b8574c40d9086fb759c8b1ce6da9d86a8b10c03e4f6fa096dfe5` |
| pirania | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/pirania/small-life-round03-20261018/pirania.glb) | `d51dc5a8215fb2fd3af11cbcba4134eaae082c308b8ff6b744b0eb966804c2e9` |
| coccosteus | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/coccosteus/lean-ready30-r001/model.glb) | `8f5b99e9f88aa040116ca8cac6fd62c4e3900acbcdf62ee98d3cfbef57e7bfd9` |
| dipterus | [GLB来源](https://github.com/s010s/lowpoly-vault/blob/38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af/assets/additions/dipterus/ready72-r001/model.glb) | `eb1709a97f0c4d789b6bbdc0e1eed38768c0092e2f79dac902963b2c4a4dd88a` |

每个本地路径为 `creek/assets/<资产名>-lowpoly-vault.glb`。尺寸、字节数、三角形和来源路径记录在 `creek/vault-reef.lock.json`，构建会核验这些GLB字节。运行时保留原始形态比例，将各珊瑚按策展尺寸成簇布置，加入克制的色差与基部遮蔽，并根据实际顶点与海床接触。壳体仅作静态半埋或硬底展示。Coccosteus 与 Dipterus 用于慢流溪潭的生态类比，鱼体居中后加入鳍和尾部动作；参考 [NatureScot Achanarras 记录](https://www.nature.scot/doc/collecting-fossils-achanarras-quarry-and-access-notice)与[非海相湖泊遗址说明](https://www.nature.scot/sites/default/files/site-special-scientific-interest/13/sssi-citation.pdf)。原始 GLB 字节没有修改。

上述新增 GLB 字节未改。场景代码按模型部位拆分翼膜和步足，加入局部动作；Anomalocaris 的运行时材质做了偏暗绿色调整。17种珊瑚与两种海绵仅放在浅海的硬底礁丛及邻近海床上；溪床水草和碎石来自固定 Tidewater MIT 几何的本地布置，没有把珊瑚放入淡水。Gryphaea 与 Hippurites 原资产明确是化石壳体形态，场景只以静态壳形散落、半埋或立于硬底展示，不创造未经证据支持的足、外套膜或活体动作。该岛作为跨年代的想象展区使用这些造型，淡水与海水栖息位置仍按生境区分。

`VaultCoastLife.js` 在运行时将静态网格转换成原生渲染几何，给鱼和虾添加身体摆动、底栖停留及逃逸行为，并使翼龙的左右翼分别运动。模型为低多边形美术复原，不是化石扫描。

`VaultArticulation.js`、`VaultSwimRigData.js` 与 `VaultSwimMotion.js` 是本馆为上述 CC BY 4.0 静态模型增加的功能绑定与展示动作。它们在运行时增加骨骼、权重、附肢根部及相位，原始拓扑、来源颜色和 GLB 字节保留。翼龙的肩肘腕指、昆虫四翼及腹节、Eryon 分节步足与尾扇、Aeger 步足/颚足/腹泳足/触须、鱼类成对鳍及奇虾侧瓣采用不同驱动。动作频率和幅度属于美术推断，不是化石测得的生物力学数据；奇虾连续侧瓣波的现代模拟参考 [Usami 2006](https://doi.org/10.1016/j.jtbi.2005.05.008)。署名、原始来源和许可继续按上表及资产锁逐项保留。

`museum/AnimalMotionPolish.js` 在运行时克隆馆藏绑定与动画，修正鱼龙鳍根和各 skin 的逆绑定，平滑旋转曲线，并复用副栉龙源 Idle 的颈尾通道；没有改写源 GLB、重新授权模型或丢弃原来的署名文件。

`creek/assets/sample-fissure.json` 是本项目以米制在 Blender 制作并检查的闭合风化岩体，不是外部扫描或已测泉口。`ContinuousSample.js`、`SampleTerrain.js` 与样板林地/倒木为自有地貌与生态结构设计，采用现代类比，未把不同原始测绘的高程零点拼成实测复原。

`creek/assets/sample-stream-nps.mp3` 为 **National Park Service / Muir Woods** 的现代溪流实录摘录，来自 [NPS Stream](https://www.nps.gov/subjects/sound/sounds-stream.htm) 及其 [原始 MP3](https://www.nps.gov/nps-audiovideo/legacy/mp3/nri/avElement/nri-StreamMUWO.mp3)。[NPS Sound Gallery](https://www.nps.gov/subjects/sound/gallery.htm) 将所链接录音列为公共领域并请求署名。运行时作 0.4 秒等功率交叉淡化循环、响度缩放和泉口空间衰减，经原生水下低通与总音量；不采集麦克风，不宣称史前声景复原。来源与原始文件 SHA-256 见 `creek/sample.lock.json`。

## 本项目原始针叶与树皮素材

`creek/assets/needle-spray-v1.png` 为原博物馆 2026-09-28 的 AI 生成视觉代理贴图，保留原始字节；不把它作为植物学扫描或古植物复原证据。`creek/assets/fir-bark-albedo.webp` 来自原项目提取的 [Poly Haven fir_tree_01](https://polyhaven.com/a/fir_tree_01)，CC0，未重采样。二者的输入路径、字节数和 SHA-256 保存在 `creek/materials.lock.json`；构建会验证。
