// Island-local metres. Each stop uses a separate viewing area and keeps the
// canonical specimen's time label, even where a region spans several periods.
export const ISLAND_FAUNA_REGIONS = [
  {id:'cambrian-shelf', districtId:'west-coast', title:'寒武纪浅海沙槽', point:[-1414, 212], time:11.5},
  {id:'coal-age-banks', districtId:'wetland', title:'石炭纪湿地与潮岸', point:[5730, 7040], time:10.1},
  {id:'permian-terraces', districtId:'dry-upland', title:'二叠纪至早三叠世河阶', point:[4690, 786], time:15.5},
  {id:'early-jurassic-bench', districtId:'lake', title:'早侏罗世湖岸与林缘', point:[3244, -1935], time:9.4},
  {id:'jurassic-grove', districtId:'creek', title:'晚侏罗世谷地与林缘', point:[-692, -262], time:8.5},
  {id:'jurassic-conifer-grove', districtId:'giant-forest', title:'晚侏罗世古林林隙', point:[1410, -2090], time:9.2},
  {id:'jurassic-lagoon', districtId:'west-coast', title:'侏罗纪滨海潟湖', point:[-177, 5615], time:10.8},
  {id:'cretaceous-freshwater', districtId:'grassland', title:'早白垩世曲流与淡水岸', point:[7905, 4200], time:9.7},
  {id:'early-cretaceous-shore', districtId:'wetland', title:'白垩纪南岸低地', point:[5660, 6290], time:8.7},
  {id:'cretaceous-western-woods', districtId:'grassland', title:'晚白垩世北美疏林与河漫滩', point:[7850, 2660], time:9.1},
  {id:'cretaceous-dry-woods', districtId:'dry-upland', title:'晚白垩世疏林与高低草地', point:[4700, 1440], time:15.4},
  {id:'cretaceous-coast', districtId:'east-bay', title:'晚白垩世东岸海崖与浅海', point:[10416, 174], time:10.2},
  {id:'neogene-sea', districtId:'east-bay', title:'中新世近海', point:[9060, -2610], time:13.3},
  {id:'neogene-grassland', districtId:'grassland', title:'中新世开阔草地', point:[6260, 2400], time:16.0},
  {id:'ice-age-uplands', districtId:'highland', title:'冰期寒凉高地', point:[3940, -4740], time:10.3},
];

function stops(regionId, rows) {
  return rows.map(([id, title, englishName, era, medium, behavior, preferred, radius, speed, length, note]) => ({
    id, title, englishName, era, regionId, medium, behavior, preferred, radius, speed, length, note,
    visitId: 'fauna-' + id,
  }));
}

export const LYSTROSAURUS_CLEARING = [4540, 996];

export const ISLAND_FAUNA_PLAN = [
  ...stops('cambrian-shelf', [
    ['anomalocaris', '奇虾', 'Anomalocaris', '寒武纪中期（约 5.05 亿年前）', 'marine', 'cruise', [-1425, 197], 7, 0.65, .625, '两侧的游泳叶逐片起伏，头部的眼柄与附肢从正前方看得最清楚。'],
    ['opabinia', '欧巴宾虫', 'Opabinia', '寒武纪 · 乌溜期', 'marine', 'hover', [-1406, 212], .52, .10, .10, '贴着砂底看五只小眼和细长的吻部。'],
    ['hallucigenia', '怪诞虫', 'Hallucigenia', '寒武纪', 'benthic', 'crawl', [-1392, 226], .13, .018, .03, '靠近砂面找成对的背刺，近观保留三厘米体长。'],
  ]),
  ...stops('coal-age-banks', [
    ['meganeura', '巨脉蜻蜓', 'Meganeura', '晚石炭世（约 3 亿年前）', 'air', 'flutter', [5400, 5915], 5.3, .88, .70, '低空折返时能看到四片翅膀和细密的翅脉。'],
    ['tullimonstrum', '塔利怪物', 'Tully monster', '石炭纪', 'marine', 'hover', [5305, 7872], 1.1, .16, .30, '靠近横向伸出的眼柄，找前端细长的吻部。'],
  ]),
  ...stops('permian-terraces', [
    ['dimetrodon', '异齿龙', 'Dimetrodon', '早二叠世', 'ground', 'patrol', [4910, 555], 7, .66, 3.0, '它转过侧身时，背帆的形状最清楚。'],
    ['lystrosaurus', '水龙兽', 'Lystrosaurus', '晚二叠世至早三叠世（约 2.55 亿至 2.47 亿年前）', 'ground', 'forage', LYSTROSAURUS_CLEARING, 5, .36, 1.6, '留意低头觅食的短脸、喙和两枚獠牙。'],
  ]),
  ...stops('early-jurassic-bench', [
    ['dilophosaurus', '双冠龙', 'Dilophosaurus', '早侏罗世（约 1.93 亿年前）', 'ground', 'patrol', [3253, -1934], 13, 1.2, 6.5, '从侧前方看头顶并列的双冠。'],
  ]),
  ...stops('jurassic-grove', [
    ['apatosaurus', '迷惑龙', 'Apatosaurus', '晚侏罗世（约 1.52亿–1.45亿年前）', 'ground', 'browse', [-556, 308], 15, .37, 22, '沿林缘绕到侧面，看颈部、长尾和四根柱状的腿。'],
    ['stegosaurus', '剑龙', 'Stegosaurus', '晚侏罗世', 'ground', 'graze', [-659, -118], 11, .49, 7.75, '从侧面观察两排骨板，再找尾巴末端的尖刺。'],
    ['allosaurus-pandras', '异特龙', 'Allosaurus', '晚侏罗世', 'ground', 'patrol', [-573, -305], 18, 1.12, 9.7, '看眼睛上方突起，留意前肢三根带爪的手指。'],
    ['anurognathus', '蛙嘴翼龙', 'Anurognathus', '晚侏罗世（约 1.5 亿年前）', 'air', 'flutter', [-737, -221], 3.4, .72, .35, '从近处看小翼龙掠过林隙时宽圆的脸。'],
    ['sordes', '索德斯翼龙', 'Sordes', '晚侏罗世', 'air', 'glide', [-695, -138], 3.25, .75, .6, '看它飞过谷坡时，留意薄翼膜和末端延伸的尾巴。'],
  ]),
  ...stops('jurassic-conifer-grove', [
    ['archaeopteryx', '始祖鸟', 'Archaeopteryx', '晚侏罗世（约 1.49 亿至 1.45 亿年前）', 'air', 'flutter', [1410, -2096], 2.3, .60, .5, '站在林隙看低处的短距离扑翼，留意翅爪和长尾羽。'],
  ]),
  ...stops('jurassic-lagoon', [
    ['rhamphorhynchus', '喙嘴翼龙', 'Rhamphorhynchus', '晚侏罗世（约 1.5 亿年前）', 'air', 'fish', [-10, 5368], 7.1, 1.25, 1.4, '靠近岸边等小翼龙低飞，找尾巴末端的小帆。'],
    ['dakosaurus', '达科龙', 'Dakosaurus', '晚侏罗世', 'marine', 'cruise', [-353, 5814], 19, 2, 4.8, '顺着四只鳍状肢看向尾鳍，留意身体转弯的姿态。'],
    ['plesiosaurus', '蛇颈龙类', 'Plesiosaurs', '晚三叠世至晚白垩世', 'marine', 'cruise', [-425, 5780], 24, 1.8, 8.7, '看四片鳍状肢划水时，长颈怎样保持方向。'],
    ['ichthyosaur', '鱼龙类', 'Ichthyosaurs', '三叠纪至晚白垩世', 'marine', 'cruise', [-214, 5890], 19, 2.25, 7.3, '观察流线形身体和尾鳍驱动，找与现生海豚相似的轮廓。'],
    ['ammonite', '菊石类', 'Ammonites', '古生代至中生代', 'marine', 'hover', [-115, 5550], 1.2, .17, .48, '从壳口看柔软的触腕，再绕到侧面看卷曲的壳。'],
  ]),
  ...stops('cretaceous-freshwater', [
    ['sarcosuchus', '帝鳄', 'Sarcosuchus', '早白垩世', 'freshwater', 'ambush', [7853, 4200], 5.2, .47, 9, '看它沿缓流移动时长吻和背甲露出的轮廓。'],
    ['baryonyx', '重爪龙', 'Baryonyx', '早白垩世（约 1.3 亿至 1.25 亿年前）', 'ground', 'wade', [7910, 4210], 10, .69, 8.75, '在水边观察细长的吻部和粗大的前爪。'],
    ['sauropelta', '胄甲龙', 'Sauropelta', '早白垩世（约 1.15 亿至 1.05 亿年前）', 'ground', 'graze', [8040, 3940], 8, .54, 5.5, '顺着背甲往前看，肩部两旁突出的是长刺。'],
  ]),
  ...stops('early-cretaceous-shore', [
    ['spinosaurus', '棘龙', 'Spinosaurus', '晚白垩世早期（约 1 亿至 9300 万年前）', 'ground', 'wade', [5324, 5929], 13, .76, 14.5, '看长吻、高背帆和长尾。这里展示它在水岸活动的一种情景。'],
    ['tupandactylus', '古神翼龙', 'Tupandactylus', '早白垩世', 'air', 'glide', [5515, 6389], 9, 2.1, 2.7, '望向低空飞过的头冠，观察它与翼膜形成的轮廓。'],
  ]),
  ...stops('cretaceous-western-woods', [
    ['maiasaura', '慈母龙', 'Maiasaura', '晚白垩世（约 8000 万至 7500 万年前）', 'ground', 'forage', [7950, 2805], 23, .61, 8, '观察慈母龙在开阔地觅食时的鼻口和后腿。'],
    ['parasaurolophus', '副栉龙', 'Parasaurolophus', '晚白垩世', 'ground', 'browse', [8160, 2920], 18, .72, 9.45, '让视线跟着向后弯曲的头冠，等它把头转过来。'],
    ['regaliceratops', '帝王角龙', 'Regaliceratops', '晚白垩世', 'ground', 'browse', [7800, 2490], 10, .59, 4.5, '看鼻角和眼上小角，再沿边缘数一数颈盾上的骨突。'],
    ['ankylosaurus', '甲龙', 'Ankylosaurus', '晚白垩世', 'ground', 'forage', [7770, 3000], 12, .44, 8, '看它转身时摇动的尾槌，留意后背的骨质甲片。'],
    ['pachycephalosaurus', '肿头龙', 'Pachycephalosaurus', '晚白垩世', 'ground', 'amble', [8032, 2560], 9, .71, 3.75, '侧面最容易看清圆顶和外围的一圈小骨突。'],
    ['triceratops', '三角龙', 'Triceratops', '晚白垩世（约 6800万–6600万年前）', 'ground', 'graze', [7440, 2930], 18, .59, 8.5, '等它转头，看两枚长角和连接肩部的宽颈盾。'],
    ['tyrannosaurus-rex', '霸王龙', 'Tyrannosaurus rex', '晚白垩世（约 6800万–6600万年前）', 'ground', 'patrol', [7490, 2540], 23, 1.27, 12.25, '从开阔处观察它的两指前肢和粗壮的后腿。'],
  ]),
  ...stops('cretaceous-dry-woods', [
    ['therizinosaurus', '镰刀龙', 'Therizinosaurus', '晚白垩世', 'ground', 'browse', [4520, 1670], 13, .63, 10, '从侧前方看弯曲的长爪，沿每根爪子向后看前肢。'],
    ['gallimimus', '似鸡龙', 'Gallimimus', '晚白垩世', 'ground', 'amble', [4760, 1776], 28, 1.68, 6, '观察细长的后腿，再抬头找小脑袋和无齿的喙。'],
    ['gigantoraptor', '巨盗龙', 'Gigantoraptor', '晚白垩世', 'ground', 'forage', [5215, 1180], 16, .74, 8, '从林缘看它的侧影，比较长颈、后腿和短粗的喙。'],
    ['carnotaurus', '食肉牛龙', 'Carnotaurus', '晚白垩世（约 7100 万至 6900 万年前）', 'ground', 'patrol', [4198, 565], 19, 1.21, 8, '从侧前方找短脸上的双角，再看眼睛以下的小前肢。'],
  ]),
  ...stops('cretaceous-coast', [
    ['pteranodon', '无齿翼龙', 'Pteranodon', '晚白垩世', 'air', 'soar', [10423, 234], 30, 6.2, 7.0, '从岸上一人高的视角看它掠水，再抬头追随展开的大翼。'],
    ['quetzalcoatlus', '风神翼龙', 'Quetzalcoatlus', '晚白垩世', 'air', 'soar', [10010, 467], 41, 5.9, 9.5, '先留意长脖子和喙，再沿翼膜看完整的翼展。'],
    ['dallasaurus', '达拉斯蜥蜴', 'Dallasaurus', '晚白垩世', 'marine', 'cruise', [10596, 196], 4.2, .57, 1.0, '近看四条小腿和脚趾，留意它怎样摆动尾部。'],
    ['xiphactinus', '剑射鱼', 'Xiphactinus', '晚白垩世', 'marine', 'school', [11030, 195], 23, 2.5, 5.5, '看大嘴和腹侧小鳍如何随着鱼转向显现。'],
    ['mosasaurus', '沧龙', 'Mosasaurus', '晚白垩世（约 8200 万至 6600 万年前）', 'marine', 'cruise', [11208, 53], 34, 3.4, 12, '从侧面观察有力的尾部和拨水的四只鳍状肢。'],
    ['styxosaurus', '冥河龙', 'Styxosaurus', '晚白垩世', 'marine', 'cruise', [11157, -128], 32, 2.1, 10.7, '不妨先看划水的四只鳍，再沿长颈找到小小的头。'],
  ]),
  ...stops('neogene-sea', [
    ['livyatan', '梅氏利维坦鲸', 'Livyatan', '中新世', 'marine', 'cruise', [9125, -2665], 52, 3.6, 13.5, '看它从侧面经过，留意宽大的头与水平的尾叶。'],
    ['megalodon', '巨齿鲨', 'Megalodon', '中新世早期至上新世早期（约 2300 万至 360 万年前）', 'marine', 'cruise', [9340, -2500], 51, 4.25, 16.5, '让它从侧前方游过，比较鲨鱼的垂直尾鳍与鲸的水平尾叶。'],
  ]),
  ...stops('neogene-grassland', [
    ['phorusrhacos', '骇鸟', 'Phorusrhacos', '中新世', 'ground', 'patrol', [6200, 2400], 14, 1.45, 2.4, '在草地上绕到它的侧面，看长腿和尖端向下钩的大喙。'],
  ]),
  ...stops('ice-age-uplands', [
    ['mammoth', '长毛猛犸象', 'Woolly mammoth', '更新世至全新世早期（约 80万–4000年前）', 'ground', 'graze', [3870, -4730], 18, .63, 3.25, '从坡脚看弯曲的长牙，再沿着高耸的肩部朝背后看。'],
  ]),
];
