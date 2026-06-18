// Dock 面板：常驻侧边栏，上半部分快速录入，下半部分当月汇总 + 最近 5 笔
//
// 注意：思源 addDock 的 init 回调里会传入一个 Custom model，
// 我们把根 DOM 挂到 model.element 上即可。
// QuickEntry 在 init() 数据就绪后才创建，避免 data 为 undefined 时崩溃。

import type {LedgerData} from "../core/types";
import type {LedgerStore} from "../core/store";
import {formatAmount, summarize, inMonth} from "../core/stats";
import {QuickEntry} from "./QuickEntry";

export class DockPanel {
  private store: LedgerStore;
  private data: LedgerData | null = null;
  private root: HTMLElement;
  private entry: QuickEntry | null = null;
  private i18n: Record<string, string>;

  constructor(store: LedgerStore, mountTarget: HTMLElement, i18n: Record<string, string>) {
    this.store = store;
    this.i18n = i18n;
    this.root = this.buildShell();
    mountTarget.appendChild(this.root);
  }

  /** 首次渲染前必须先 await 装载数据 */
  async init(): Promise<void> {
    try {
      this.data = await this.store.load();
      // 数据就绪后再创建 QuickEntry
      if (!this.entry) {
        this.entry = new QuickEntry(this.store, this.data, this.i18n, {
          onSaved: () => this.refresh(),
        });
        this.root.querySelector(".ledger-dock-entry")!.appendChild(this.entry.element);
      } else {
        this.entry.refresh(this.data);
      }
      this.renderSummary();
    } catch (e) {
      console.error("[ledger] DockPanel init error:", e);
      // 在面板中显示错误提示，避免空白
      const recentBox = this.root.querySelector(".ledger-dock-recent") as HTMLElement;
      if (recentBox) {
        recentBox.innerHTML = `<div class="ledger-recent-title">${this.i18n.recent ?? "最近记录"}</div>
          <div class="ledger-empty">数据加载中，请稍候…</div>`;
      }
    }
  }

  /** 重新拉数据并刷新统计区 */
  async refresh(): Promise<void> {
    this.data = await this.store.load();
    if (this.entry) this.entry.refresh(this.data);
    this.renderSummary();
  }

  private buildShell(): HTMLElement {
    const root = document.createElement("div");
    root.className = "ledger-dock";
    root.innerHTML = `
      <div class="ledger-dock-entry"></div>
      <div class="ledger-dock-summary"></div>
      <div class="ledger-dock-recent"><div class="ledger-recent-title">${this.i18n.recent ?? "最近"}</div></div>
    `;
    return root;
  }

  private renderSummary(): void {
    if (!this.data) return;
    const ym = new Date().toISOString().slice(0, 7);
    const monthTx = this.data.transactions.filter((t) => inMonth(t, ym));
    const s = summarize(monthTx);
    const box = this.root.querySelector(".ledger-dock-summary") as HTMLElement;
    box.innerHTML = `
      <div class="ledger-summary-row">
        <span>${this.i18n.monthExpense ?? "本月支出"}</span><b class="ledger-expense">${formatAmount(s.expense)}</b>
      </div>
      <div class="ledger-summary-row">
        <span>${this.i18n.monthIncome ?? "本月收入"}</span><b class="ledger-income">${formatAmount(s.income)}</b>
      </div>
      <div class="ledger-summary-row">
        <span>${this.i18n.balance ?? "结余"}</span><b class="ledger-balance">${formatAmount(s.balance)}</b>
      </div>
    `;

    // 最近 20 笔
    const recent = [...this.data.transactions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
    const recentBox = this.root.querySelector(".ledger-dock-recent") as HTMLElement;
    const list = recent.length
      ? recent
          .map((t) => {
            const cat = this.data!.categories.find((c) => c.id === t.categoryId);
            const sign = t.type === "income" ? "+" : "-";
            return `<div class="ledger-tx-item">
              <span class="ledger-tx-icon">${cat?.icon ?? "•"}</span>
              <span class="ledger-tx-info">
                <span class="ledger-tx-name">${cat?.name ?? "-"}${t.note ? " · " + t.note : ""}</span>
                <span class="ledger-tx-date">${t.date}</span>
              </span>
              <span class="ledger-tx-amount ${t.type}">${sign}${formatAmount(t.amount)}</span>
            </div>`;
          })
          .join("")
      : `<div class="ledger-empty">${this.i18n.empty ?? "暂无记录"}</div>`;
    recentBox.innerHTML = `<div class="ledger-recent-title">${this.i18n.recent ?? "最近"}</div>${list}`;
  }
}
