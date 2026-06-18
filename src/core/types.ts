// 记账本核心数据模型
// 设计原则：
//  - 金额一律存「分」(cents) 的整数，规避浮点误差，展示层再除以 100
//  - 日期一律存 ISO 字符串 (yyyy-mm-dd)，与时区解耦
//  - id 用 crypto.randomUUID()，无需依赖思源块机制

/** 交易类型 */
export type TxType = "expense" | "income" | "transfer";

/** 单笔交易 */
export interface Transaction {
  id: string;
  type: TxType;
  /** 金额，单位：分。例如 12.34 元 -> 1234 */
  amount: number;
  /** 货币 ISO 代码，如 CNY / USD */
  currency: string;
  /** 分类 id，指向 categories[].id */
  categoryId: string;
  /** 账户 id，指向 accounts[].id；transfer 时 asFrom 表示转出账户 */
  accountId: string;
  toAccountId?: string;
  /** 交易日期 yyyy-mm-dd */
  date: string;
  note?: string;
  tags?: string[];
  /** 关联的思源块 ID，点击可跳转到对应笔记块 */
  blockId?: string;
  createdAt: number;
  updatedAt: number;
}

/** 分类 */
export interface Category {
  id: string;
  name: string;
  /** emoji 或图标名，用于列表展示 */
  icon: string;
  /** 仅用于前端分组，不影响存储 */
  type: TxType;
}

/** 账户 */
export interface Account {
  id: string;
  name: string;
  /** 初始余额，单位分 */
  initialBalance: number;
  icon?: string;
}

/** 插件设置（持久化在 setting.json，由 Setting 类管理） */
export interface LedgerSettings {
  currency: string;
  defaultAccountId: string;
  /** 默认 dock 位置 */
  dockPosition: "LeftBottom" | "RightBottom";
}

/** 完整数据结构，序列化为 ledger.json 存入插件 data 目录 */
export interface LedgerData {
  version: number;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
}

/** 当前数据版本号，用于未来 schema 迁移 */
export const DATA_VERSION = 1;

/** 生成默认分类（中英由 i18n 在 UI 层覆盖，这里仅占位） */
export function defaultCategories(): Category[] {
  return [
    {id: "cat_food", name: "餐饮", icon: "🍚", type: "expense"},
    {id: "cat_transport", name: "交通", icon: "🚌", type: "expense"},
    {id: "cat_shopping", name: "购物", icon: "🛍️", type: "expense"},
    {id: "cat_housing", name: "居家", icon: "🏠", type: "expense"},
    {id: "cat_fun", name: "娱乐", icon: "🎮", type: "expense"},
    {id: "cat_other_exp", name: "其他", icon: "📝", type: "expense"},
    {id: "cat_salary", name: "工资", icon: "💰", type: "income"},
    {id: "cat_bonus", name: "奖金", icon: "🎁", type: "income"},
    {id: "cat_other_inc", name: "其他收入", icon: "➕", type: "income"},
  ];
}

/** 生成默认账户 */
export function defaultAccounts(): Account[] {
  return [
    {id: "acc_cash", name: "现金", initialBalance: 0, icon: "💵"},
    {id: "acc_card", name: "银行卡", initialBalance: 0, icon: "💳"},
  ];
}

/** 生成默认设置 */
export function defaultSettings(): LedgerSettings {
  return {
    currency: "CNY",
    defaultAccountId: "acc_cash",
    dockPosition: "RightBottom",
  };
}

/** 生成全新的空数据 */
export function emptyData(): LedgerData {
  return {
    version: DATA_VERSION,
    transactions: [],
    categories: defaultCategories(),
    accounts: defaultAccounts(),
  };
}
