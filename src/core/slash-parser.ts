// 斜杠命令文本解析器
// 支持两种模式：
//   1. 管道分隔：金额|类型|分类|备注|日期（向后兼容）
//   2. 语义智能：自然语言，如 "买烟40元"、"打车回家花了25"、"工资5000"

import type {Category, TxType} from "./types";

export interface ParsedEntry {
  /** 金额，单位分 */
  amount: number;
  type: TxType;
  categoryId: string;
  categoryName: string;
  note?: string;
  date: string;
}

export interface ParseError {
  error: string;
}

// ─── 类型别名（管道格式用） ───

const TYPE_ALIASES: Record<string, TxType> = {
  expense: "expense",
  income: "income",
  支出: "expense",
  收入: "income",
  花: "expense",
  赚: "income",
};

// ─── 语义解析用：关键词表 ───

/** 支出动作词（纯动作，不与分类关键词重叠） */
const EXPENSE_VERBS = [
  "买", "花", "付", "消费", "支出", "用", "交",
  "缴费", "付款", "花费", "给了",
  "吃", "喝", "玩", "住",
];

/** 收入动作词 */
const INCOME_VERBS = [
  "工资", "收入", "赚", "收", "奖金", "报销", "红包", "到账",
  "进账", "提成", "稿费", "兼职", "利息", "分红", "退款",
];

/** 分类关键词映射：关键词 → 分类 name */
const CATEGORY_KEYWORDS: Record<string, string> = {
  // 餐饮
  "吃饭": "餐饮", "午饭": "餐饮", "晚饭": "餐饮", "早饭": "餐饮",
  "午餐": "餐饮", "晚餐": "餐饮", "早餐": "餐饮", "夜宵": "餐饮",
  "外卖": "餐饮", "奶茶": "餐饮", "咖啡": "餐饮", "水果": "餐饮",
  "零食": "餐饮", "饮料": "餐饮", "买菜": "餐饮", "超市": "餐饮",
  "火锅": "餐饮", "烧烤": "餐饮", "快餐": "餐饮", "食堂": "餐饮",
  "饭": "餐饮", "餐": "餐饮", "烟": "餐饮", "酒": "餐饮",
  "茶": "餐饮", "面": "餐饮", "粉": "餐饮",
  // 交通
  "打车": "交通", "地铁": "交通", "公交": "交通", "滴滴": "交通",
  "加油": "交通", "停车": "交通", "高速": "交通", "过路费": "交通",
  "出租": "交通", "骑车": "交通", "共享单车": "交通", "火车": "交通",
  "机票": "交通", "飞机": "交通", "船票": "交通", "坐车": "交通",
  "车费": "交通", "油费": "交通", "充电": "交通",
  // 购物
  "衣服": "购物", "鞋": "购物", "包": "购物", "帽子": "购物",
  "淘宝": "购物", "京东": "购物", "拼多多": "购物", "网购": "购物",
  "日用品": "购物", "化妆品": "购物", "护肤": "购物", "数码": "购物",
  "手机": "购物", "电脑": "购物", "家电": "购物", "家具": "购物",
  // 居家
  "房租": "居家", "水电": "居家", "物业": "居家", "燃气": "居家",
  "电费": "居家", "水费": "居家", "网费": "居家", "宽带": "居家",
  "话费": "居家", "维修": "居家", "装修": "居家",
  // 娱乐
  "电影": "娱乐", "游戏": "娱乐", "KTV": "娱乐", "唱歌": "娱乐",
  "旅游": "娱乐", "门票": "娱乐", "演出": "娱乐", "健身": "娱乐",
  "游泳": "娱乐", "运动": "娱乐", "球": "娱乐", "书": "娱乐",
  "充值": "娱乐", "会员": "娱乐", "订阅": "娱乐",
  // 育儿
  "奶粉": "育儿", "尿不湿": "育儿", "纸尿裤": "育儿", "尿布": "育儿",
  "幼儿园": "育儿", "学费": "育儿", "补习": "育儿", "培训班": "育儿",
  "兴趣班": "育儿", "绘本": "育儿", "玩具": "育儿", "童装": "育儿",
  "童鞋": "育儿", "产检": "育儿", "月子": "育儿", "保姆": "育儿",
  "月嫂": "育儿", "疫苗": "育儿", "体检": "育儿", "早教": "育儿",
  // 社交
  "红包": "社交", "份子钱": "社交", "随礼": "社交", "礼金": "社交",
  "请客": "社交", "聚餐": "社交", "聚会": "社交", "送礼": "社交",
  "礼物": "社交", "份子": "社交", "人情": "社交", "AA": "社交",
  // 收入分类
  "工资": "工资", "薪水": "工资", "月薪": "工资",
  "奖金": "奖金", "年终奖": "奖金", "绩效": "奖金", "提成": "奖金",
};

// ─── 主入口：智能解析 ───

/**
 * 统一解析入口。
 * 如果输入包含 "|"，走管道分隔解析器；否则走语义智能解析。
 */
export function smartParse(
  input: string,
  categories: Category[],
): ParsedEntry | ParseError {
  const trimmed = input.trim();
  if (!trimmed) return {error: "输入不能为空"};

  // 管道分隔格式向后兼容
  if (trimmed.includes("|")) {
    return parseSlashInput(trimmed, categories);
  }

  return parseNatural(trimmed, categories);
}

// ─── 语义智能解析器 ───

function parseNatural(
  input: string,
  categories: Category[],
): ParsedEntry | ParseError {
  let text = input;

  // 1. 提取日期
  const {date, rest: afterDate} = extractDate(text);

  // 2. 提取金额
  const {amount, rest: afterAmount} = extractAmount(afterDate);
  if (amount <= 0) {
    return {error: "未能识别金额，请包含数字（如 40元、¥40、40块）"};
  }

  // 3. 先推断分类（分类关键词比动作词更具体，优先匹配）
  //    分类自带 type 信息，匹配成功即可确定收支类型
  const catResult = inferCategory(afterAmount, categories);

  let type: TxType;
  let noteText: string;

  if (catResult.matched) {
    // 分类匹配成功：从分类对象获取类型
    type = catResult.category.type;
    noteText = catResult.rest;
  } else {
    // 分类未匹配：退回到动作词推断类型
    const {type: inferredType, rest: afterType} = inferType(afterAmount);
    type = inferredType;
    noteText = afterType;
    // 再尝试用推断出的类型找默认分类
    const fallbackCat = categories.find((c) => c.type === type);
    if (fallbackCat) {
      return {
        amount,
        type,
        categoryId: fallbackCat.id,
        categoryName: fallbackCat.name,
        note: cleanNote(noteText) || undefined,
        date,
      };
    }
  }

  // 4. 清理备注
  const note = cleanNote(noteText);

  return {
    amount,
    type,
    categoryId: catResult.category!.id,
    categoryName: catResult.category!.name,
    note: note || undefined,
    date,
  };
}

/** 提取金额：匹配数字 + 可选单位（元/块/¥） */
function extractAmount(text: string): {amount: number; rest: string} {
  // 模式：¥/￥ + 数字
  let m = text.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const yuan = parseFloat(m[1]);
    if (yuan > 0) {
      return {amount: Math.round(yuan * 100), rest: text.replace(m[0], "")};
    }
  }

  // 模式：数字 + 元/块/块钱
  m = text.match(/(\d+(?:\.\d{1,2})?)\s*(?:块钱|块|元)/);
  if (m) {
    const yuan = parseFloat(m[1]);
    if (yuan > 0) {
      return {amount: Math.round(yuan * 100), rest: text.replace(m[0], "")};
    }
  }

  // 模式：花了/付了/消费 + 数字
  m = text.match(/(?:花了|付了|消费|花费|支出|用了)\s*(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const yuan = parseFloat(m[1]);
    if (yuan > 0) {
      return {amount: Math.round(yuan * 100), rest: text.replace(m[0], "")};
    }
  }

  // 模式：纯数字（取最大的那个数字作为金额）
  const nums = text.match(/\d+(?:\.\d{1,2})?/g);
  if (nums && nums.length > 0) {
    // 选最大值作为金额（避免把日期中的数字误识别）
    const values = nums.map(Number).filter((n) => n > 0);
    if (values.length > 0) {
      const yuan = Math.max(...values);
      return {amount: Math.round(yuan * 100), rest: text.replace(String(yuan), "")};
    }
  }

  return {amount: 0, rest: text};
}

/** 提取日期 */
function extractDate(text: string): {date: string; rest: string} {
  const today = new Date();

  // 今天 / 今天
  if (/今天/.test(text)) {
    return {date: fmt(today), rest: text.replace("今天", "")};
  }

  // 昨天
  if (/昨天/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return {date: fmt(d), rest: text.replace("昨天", "")};
  }

  // 前天
  if (/前天/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 2);
    return {date: fmt(d), rest: text.replace("前天", "")};
  }

  // X月X号 / X月X日
  let m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/);
  if (m) {
    const d = new Date(today.getFullYear(), parseInt(m[1]) - 1, parseInt(m[2]));
    return {date: fmt(d), rest: text.replace(m[0], "")};
  }

  // yyyy-mm-dd / yyyy/mm/dd
  m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return {date: fmt(d), rest: text.replace(m[0], "")};
  }

  return {date: fmt(today), rest: text};
}

/** 推断收支类型 */
function inferType(text: string): {type: TxType; rest: string} {
  let rest = text;

  // 先检查收入关键词（收入词更具体，优先匹配）
  for (const kw of INCOME_VERBS) {
    if (text.includes(kw)) {
      rest = rest.replace(kw, "");
      return {type: "income", rest};
    }
  }

  // 检查支出关键词
  for (const kw of EXPENSE_VERBS) {
    if (text.includes(kw)) {
      rest = rest.replace(kw, "");
      return {type: "expense", rest};
    }
  }

  // 默认支出
  return {type: "expense", rest};
}

/** 推断分类：在文本中查找分类关键词，优先匹配最长的 */
function inferCategory(
  text: string,
  categories: Category[],
): {matched: boolean; category: Category | null; rest: string} {
  let rest = text;
  let bestKw = "";
  let bestCatName = "";
  let bestLen = 0;

  // 在文本中查找分类关键词，优先匹配最长的
  for (const [kw, catName] of Object.entries(CATEGORY_KEYWORDS)) {
    if (text.includes(kw) && kw.length > bestLen) {
      const exists = categories.some((c) => c.name === catName);
      if (exists) {
        bestKw = kw;
        bestCatName = catName;
        bestLen = kw.length;
      }
    }
  }

  if (bestCatName) {
    rest = rest.replace(bestKw, "");
    const cat = categories.find((c) => c.name === bestCatName) ?? null;
    return {matched: true, category: cat, rest};
  }

  // 直接匹配分类名称
  for (const cat of categories) {
    if (text.includes(cat.name)) {
      rest = rest.replace(cat.name, "");
      return {matched: true, category: cat, rest};
    }
  }

  return {matched: false, category: null, rest: text};
}

/** 清理备注文本：去除多余空格、标点和残留的无意义单字动词 */
function cleanNote(text: string): string {
  let s = text
    .replace(/[，,。.！!？?、；;：:"""''（）()\[\]【】{}了着过的]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 如果清理后只剩一个常见的无意义单字动词，则清空
  if (/^(买|花|付|交|充|吃|喝|玩|住|看|给|用|坐|打)$/.test(s)) {
    return "";
  }
  return s;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── 管道分隔解析器（向后兼容） ───

/**
 * 解析管道分隔格式：金额|类型|分类|备注|日期
 */
export function parseSlashInput(
  input: string,
  categories: Category[],
): ParsedEntry | ParseError {
  const parts = input.split("|").map((s) => s.trim()).filter((s) => s.length > 0);

  if (parts.length < 3) {
    return {error: "格式错误：至少需要 金额|类型|分类 三个字段"};
  }

  const amountYuan = parseFloat(parts[0]);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    return {error: "金额无效：请输入正数"};
  }
  const amount = Math.round(amountYuan * 100);

  const typeRaw = parts[1].toLowerCase();
  const type = TYPE_ALIASES[typeRaw];
  if (!type) {
    return {error: `类型无效："${parts[1]}"，请使用 expense/income 或 支出/收入`};
  }

  const catName = parts[2];
  let cat = categories.find((c) => c.name === catName && c.type === type);
  if (!cat) cat = categories.find((c) => c.name === catName);
  if (!cat) {
    cat = categories.find((c) => c.type === type);
    if (!cat) return {error: `找不到分类"${catName}"`};
  }

  const note = parts[3] || undefined;
  let date = new Date().toISOString().slice(0, 10);
  if (parts[4] && /^\d{4}-\d{2}-\d{2}$/.test(parts[4])) {
    date = parts[4];
  }

  return {amount, type, categoryId: cat.id, categoryName: cat.name, note, date};
}

// ─── 格式化摘要 ───

/**
 * 将解析结果格式化为可插入笔记的摘要文本。
 */
export function formatEntrySummary(entry: ParsedEntry): string {
  const yuan = (entry.amount / 100).toFixed(2);
  const sign = entry.type === "income" ? "+" : "-";
  const parts = [`${entry.categoryName}`];
  if (entry.note) parts.push(entry.note);
  return `📝 ${parts.join(" · ")} ${sign}¥${yuan}`;
}
