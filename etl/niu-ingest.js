// ETL 第六步：NiuTrans 古籍双语数据 → out/poems-niu.jsonl（集合 gwdj 古文典籍）
const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/xiang/Downloads/poetry-site/downloads/niu';
const LIST = JSON.parse(fs.readFileSync('C:/Users/xiang/Downloads/poetry-site/etl/niu-bitext-list.json', 'utf8'));
const OUT = 'C:/Users/xiang/Downloads/poetry-site/etl/out/poems-niu.jsonl';

// 书 → [作者, 朝代]
const BOOK_META = {
  '史记': ['司马迁', '西汉'], '汉书': ['班固', '东汉'], '后汉书': ['范晔', '南朝宋'], '三国志': ['陈寿', '西晋'],
  '左传': ['左丘明', '先秦'], '国语': ['左丘明', '先秦'], '战国策': ['刘向 编', '西汉'], '尚书': ['佚名', '先秦'],
  '礼记': ['戴圣 编', '西汉'], '周礼': ['佚名', '先秦'], '仪礼': ['佚名', '先秦'], '孝经': ['孔子及其弟子', '先秦'],
  '论语': ['孔子及弟子', '先秦'], '孟子': ['孟子', '战国'], '孔子家语': ['王肃 编', '三国魏'],
  '庄子': ['庄周', '战国'], '老子': ['李耳', '春秋'], '列子': ['列御寇', '战国'], '墨子': ['墨翟', '战国'],
  '荀子': ['荀况', '战国'], '韩非子': ['韩非', '战国'], '管子': ['管仲', '春秋'], '商君书': ['商鞅', '战国'],
  '吕氏春秋': ['吕不韦 门客', '秦'], '淮南子': ['刘安', '西汉'], '论衡': ['王充', '东汉'], '盐铁论': ['桓宽', '西汉'],
  '世说新语': ['刘义庆', '南朝宋'], '搜神记': ['干宝', '东晋'], '搜神后记': ['陶潜', '东晋'],
  '文心雕龙': ['刘勰', '南朝梁'], '水经注': ['郦道元', '北魏'], '颜氏家训': ['颜之推', '南北朝'],
  '晋书': ['房玄龄 等', '唐'], '隋书': ['魏征 等', '唐'], '南史': ['李延寿', '唐'], '北史': ['李延寿', '唐'],
  '旧唐书': ['刘昫 等', '后晋'], '新唐书': ['欧阳修 等', '宋'], '旧五代史': ['薛居正 等', '宋'],
  '新五代史': ['欧阳修', '宋'], '宋书': ['沈约', '南朝梁'], '南齐书': ['萧子显', '南朝梁'],
  '梁书': ['姚思廉', '唐'], '陈书': ['姚思廉', '唐'], '魏书': ['魏收', '北齐'], '北齐书': ['李百药', '唐'],
  '周书': ['令狐德棻', '唐'], '宋史': ['脱脱 等', '元'], '辽史': ['脱脱 等', '元'], '金史': ['脱脱 等', '元'],
  '元史': ['宋濂 等', '明'], '明史': ['张廷玉 等', '清'], '资治通鉴': ['司马光', '宋'],
  '贞观政要': ['吴兢', '唐'], '太平广记': ['李昉 等', '宋'], '容斋随笔': ['洪迈', '宋'],
  '梦溪笔谈': ['沈括', '宋'], '黄帝内经': ['佚名', '先秦至汉'], '伤寒论': ['张仲景', '东汉'],
  '山海经': ['佚名', '先秦'], '天工开物': ['宋应星', '明'], '徐霞客游记': ['徐霞客', '明'],
  '菜根谭': ['洪应明', '明'], '围炉夜话': ['王永彬', '清'], '笑林广记': ['游戏主人', '清'],
  '智囊(选录)': ['冯梦龙', '明'], '孙子兵法': ['孙武', '春秋'], '孙膑兵法': ['孙膑', '战国'],
  '吴子': ['吴起', '战国'], '六韬': ['姜尚', '商周'], '司马法': ['司马穰苴', '战国'], '尉缭子': ['尉缭', '战国'],
  '三略': ['佚名', '汉'], '百战奇略': ['刘基', '明'], '将苑': ['诸葛亮', '三国'], '三十六计': ['佚名', '明清'],
  '鬼谷子': ['鬼谷子', '战国'], '素书': ['黄石公', '汉'], '冰鉴': ['曾国藩', '清'],
  '黄帝四经': ['佚名', '战国'], '易传': ['佚名', '先秦'], '逸周书': ['佚名', '先秦'],
  '抱朴子': ['葛洪', '东晋'], '睡虎地秦墓竹简': ['佚名', '秦'], '农桑辑要': ['佚名', '元'],
  '棋经十三篇': ['张拟', '宋'], '心经': ['玄奘 译', '唐'], '文昌孝经': ['佚名', '宋'],
  '公孙龙子': ['公孙龙', '战国'],
};
const SKIP_BOOKS = new Set(['三字经', '千字文', '弟子规', '增广贤文', '幼学琼林', '朱子家训', '中庸', '大学章句集注']);

function parseBitext(txt) {
  const pairs = [];
  const re = /古文：([\s\S]*?)\n现代文：([\s\S]*?)(?=\n\n古文：|\n*$)/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const a = m[1].trim(), b = m[2].trim();
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}

(async () => {
  const w = fs.createWriteStream(OUT, { encoding: 'utf8' });
  const stats = {};
  let idx = 0, bad = 0;
  for (const item of LIST) {
    const parts = item.p.split('/');
    const book = parts[1];
    if (SKIP_BOOKS.has(book)) continue;
    const safe = item.p.replace(/[\\/]/g, '~');
    const full = path.join(DIR, safe);
    if (!fs.existsSync(full) || fs.statSync(full).size < 50) { bad++; continue; }
    const txt = fs.readFileSync(full, 'utf8');
    const pairs = parseBitext(txt);
    if (!pairs.length) { bad++; continue; }
    const chapter = parts.length > 4 ? parts[2] : '';
    const title = parts[parts.length - 2];
    const meta = BOOK_META[book] || ['', ''];
    const rec = {
      c: 'gwdj', t: title, a: meta[0] || '佚名', d: meta[1] || '',
      p: pairs.map(x => x[0]),
      f: { y: pairs.map(x => x[1]).join('\n') },
      tg: [book].concat(chapter ? [chapter] : []),
    };
    rec.oi = idx++;
    w.write(JSON.stringify(rec) + '\n');
    stats[book] = (stats[book] || 0) + 1;
  }
  await new Promise(res => w.end(res));
  console.log(`收编古籍篇目 ${idx} (缺失/失败 ${bad}), 书籍 ${Object.keys(stats).length}`);
  const top = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log('Top:', top);
  fs.writeFileSync('C:/Users/xiang/Downloads/poetry-site/etl/out/niu-stats.json', JSON.stringify({ total: idx, bad, stats }, null, 1));
  console.log('NIU_INGEST_OK');
})();
