/**
 * 最小 DOM stub：在 Node 里执行原型页的内联脚本。
 * 构建期用它做「预渲染」（把渲染结果写回 HTML，使页面在无 JS 环境下也有内容），
 * 冒烟测试用它断言渲染结果。
 */

export function makeEl(id){
  const cls = new Set();
  return {
    id, value:'', textContent:'', innerHTML:'', style:{}, dataset:{}, _classes: cls,
    classList:{
      toggle(c, force){ const want = force === undefined ? !cls.has(c) : !!force; want ? cls.add(c) : cls.delete(c); return want; },
      add(c){ cls.add(c); }, remove(c){ cls.delete(c); }, contains(c){ return cls.has(c); },
    },
    querySelectorAll: () => [],
    addEventListener(){},
  };
}

export function makeEnv({ auto = false, card = false, docked = false } = {}){
  const els = new Map();
  const document = {
    body: makeEl('body'),
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    querySelectorAll: () => [],
  };
  const window = {
    matchMedia: q => {
      let matches = false;
      if (/orientation/.test(q)) matches = docked;      // 停靠：横屏宽屏
      else if (/900px/.test(q)) matches = auto;         // 窄屏 / 竖屏
      else if (/640px/.test(q)) matches = card;         // 手机宽度
      return { matches, addEventListener(){} };
    },
    addEventListener(){},
  };
  return { document, window, els };
}

/** 取出页面里那段带 RAW 数据的内联脚本 */
export function extractScript(html){
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){
    if (m[1].includes('const RAW')) return m[1];
  }
  throw new Error('未在 HTML 中找到内联脚本');
}

/**
 * 在 stub 环境里跑页面脚本。
 * @param {string} html  页面 HTML
 * @param {object} opt   { auto, card }：模拟的媒体查询结果
 * @param {string} epilogue  追加在脚本末尾的代码，其返回值即为 runPage 的 result
 */
export function runPage(html, { auto = false, card = false, docked = false, epilogue = '' } = {}){
  const code = extractScript(html);
  const env = makeEnv({ auto, card, docked });
  const fn = new Function('document', 'window', code + '\n' + epilogue);
  const result = fn(env.document, env.window);
  return { result, document: env.document, window: env.window, els: env.els };
}
