// 统计聚合：纯函数，无副作用，便于测试
//
// 所有金额以「分」参与运算，展示层再格式化。

import type {Transaction, TxType} from "./types";

export interface PeriodSummary {
  income: number;
  expense: number;
  /** 收入 - 支出 */
  balance: number;
  count: number;
}

export interface CategoryStat {
  categoryId: string;
  total: number;
  count: number;
  /** 占比 0~1，基于 total 计算 */
  ratio: number;
}

/** 筛选某月的交易（date 形如 2024-06） */
export function inMonth(tx: Transaction, yearMonth: string): boolean {
  return tx.date.startsWith(yearMonth);
}

/** 筛选某年的交易（date 形如 2024） */
export function inYear(tx: Transaction, year: string): boolean {
  return tx.date.startsWith(year);
}

/** 按日期范围筛选（含两端），from/to 为 yyyy-mm-dd */
export function inDateRange(tx: Transaction, from: string, to: string): boolean {
  if (from && tx.date < from) return false;
  if (to && tx.date > to) return false;
  return true;
}

/** 按金额范围筛选（单位分），min/max 为 0 表示不限 */
export function inAmountRange(tx: Transaction, min: number, max: number): boolean {
  if (min > 0 && tx.amount < min) return false;
  if (max > 0 && tx.amount > max) return false;
  return true;
}

/** 计算一组交易的收支汇总 */
export function summarize(transactions: Transaction[]): PeriodSummary {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
    // transfer 不计入收支
  }
  return {income, expense, balance: income - expense, count: transactions.length};
}

/** 按分类聚合（默认只看支出） */
export function byCategory(
  transactions: Transaction[],
  type: TxType = "expense",
): CategoryStat[] {
  const map = new Map<string, {total: number; count: number}>();
  for (const t of transactions) {
    if (t.type !== type) continue;
    const cur = map.get(t.categoryId) ?? {total: 0, count: 0};
    cur.total += t.amount;
    cur.count += 1;
    map.set(t.categoryId, cur);
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v.total, 0);
  return Array.from(map.entries())
    .map(([categoryId, v]) => ({
      categoryId,
      total: v.total,
      count: v.count,
      ratio: total > 0 ? v.total / total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/** 金额（分）-> 显示字符串，例如 1234 -> "12.34" */
export function formatAmount(cents: number, currency = "CNY"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${fen.toString().padStart(2, "0")} ${currency}`;
}
