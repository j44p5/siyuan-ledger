// 记账本插件入口

import {Plugin, Dialog, showMessage, openTab, type Protyle} from "siyuan";
import {createStore, type LedgerStore} from "./core/store";
import {DockPanel} from "./ui/DockPanel";
import {formatAmount, summarize, inMonth, byCategory, inDateRange, inAmountRange} from "./core/stats";
import {smartParse, formatEntrySummary} from "./core/slash-parser";
import type {LedgerData, TxType, Transaction} from "./core/types";

const DOCK_TYPE = "ledger-dock";
const TOPBAR_ICON = "iconAccount";

const FINANCE_QUOTES = [
  "省钱就是赚钱",
  "量入为出，细水长流",
  "复利是世界第八大奇迹",
  "不要把所有鸡蛋放在一个篮子里",
  "今日省下的一分钱，就是明日的一分利",
  "财富不在于赚多少，而在于留多少",
  "花钱容易，攒钱难，理财更难",
  "投资自己，是最好的理财",
  "记账是财务自由的第一步",
  "每一笔支出，都是一次选择",
  "不为明天忧虑，但要为明天准备",
  "小钱不攒，大钱不来",
  "会花钱的人，才会赚钱",
  "节俭不是不花钱，而是花得值",
  "财务自由不是有钱，而是有选择",
];
function randomQuote(): string {
  return FINANCE_QUOTES[Math.floor(Math.random() * FINANCE_QUOTES.length)];
}

export default class LedgerPlugin extends Plugin {
  private store!: LedgerStore;
  private dockPanel: DockPanel | null = null;
  private topBarEl: HTMLElement | null = null;

  onload(): void {
    this.store = createStore(this, this.app);
    const store = this.store;
    const i18n = this.i18n;
    const self = this;

    this.addDock({
      config: {
        position: "RightBottom",
        size: {width: 240, height: 0},
        icon: TOPBAR_ICON,
        title: this.i18n.dockTitle ?? "记账本",
        hotkey: "",
      },
      data: {},
      type: DOCK_TYPE,
      init(dockModel) {
        self.dockPanel = new DockPanel(store, this.element, i18n, self.app);
        self.dockPanel.init().catch((e) => {
          console.error("[ledger] dock init failed", e);
        });
      },
      destroy() {
        self.dockPanel = null;
      },
    });

    this.topBarEl = this.addTopBar({
      icon: TOPBAR_ICON,
      title: this.i18n.openDock ?? "打开记账本",
      position: "right",
      callback: () => {
        void this.openLedgerDialog();
      },
    });

    // 斜杠命令：/记账
    this.protyleSlash = [
      {
        filter: ["记账", "jz", "ledger"],
        html: `<div class="b3-list-item__text">💰 ${this.i18n.slashTitle ?? "快速记账"}</div>`,
        id: "ledger-slash-entry",
        callback: (protyle: Protyle) => {
          this.handleSlashCommand(protyle);
        },
      },
    ];
  }

  /** 斜杠命令回调：弹出输入对话框 */
  private handleSlashCommand(protyle: Protyle): void {
    // 保存当前光标位置和块 ID（Dialog 弹出后编辑器 selection 会丢失）
    let blockId: string | undefined;
    let savedRange: Range | null = null;
    try {
      const range = getSelection()?.getRangeAt(0);
      if (range) {
        savedRange = range.cloneRange();
        const blockEl = range.startContainer.parentElement?.closest("[data-node-id]");
        blockId = blockEl?.getAttribute("data-node-id") ?? undefined;
      }
    } catch {
      // 忽略
    }

    const i18n = this.i18n;
    const store = this.store;
    const uid = "slash-" + Date.now();

    const dialog = new Dialog({
      title: "💰 " + (i18n.slashTitle ?? "快速记账"),
      content: `<div style="padding:12px 16px">
        <div style="font-size:12px;color:var(--b3-theme-on-surface-light);margin-bottom:8px">
          ${i18n.slashFormatHint ?? "直接输入，如：买烟40元、打车回家花了25、工资5000"}
        </div>
        <input id="${uid}" type="text" class="b3-text-field" style="width:100%;margin-bottom:8px"
               placeholder="${i18n.slashPlaceholder ?? "例如：买烟40元、午餐花了25、工资5000"}" />
        <button class="b3-button" id="${uid}-btn" style="width:100%">${i18n.slashSubmit ?? "记录"}</button>
      </div>`,
      width: "360px",
    });

    const input = dialog.element.querySelector(`#${uid}`) as HTMLInputElement;
    const btn = dialog.element.querySelector(`#${uid}-btn`) as HTMLButtonElement;

    if (input) {
      input.focus();
      // 回车提交
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void submitEntry();
        }
      });
    }

    const submitEntry = async () => {
      const text = input?.value?.trim();
      if (!text) return;

      const data = await store.load();
      const result = smartParse(text, data.categories);

      if ("error" in result) {
        showMessage(result.error, 4000, "error");
        return;
      }

      // 创建交易记录（先暂存 blockId，insert 后修正为摘要实际所在的块）
      const tx = await store.addTransaction({
        type: result.type,
        amount: result.amount,
        currency: "CNY",
        categoryId: result.categoryId,
        accountId: data.accounts[0]?.id ?? "",
        date: result.date,
        note: result.note,
        blockId,
      });

      // 恢复光标位置后再插入摘要（Dialog 会吃掉编辑器的 selection）
      if (savedRange) {
        const sel = getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange);
        }
      }

      // 在当前块插入格式化摘要
      const summary = formatEntrySummary(result);
      protyle.insert(summary);

      // insert 完成后，捕获摘要实际所在块的 ID 并更新交易记录
      // （protyle.insert 会在当前块下方创建新块，原始 blockId 指向的是父/前驱块）
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          try {
            const range = getSelection()?.getRangeAt(0);
            if (range) {
              const newBlockEl = range.startContainer.parentElement?.closest("[data-node-id]");
              const newBlockId = newBlockEl?.getAttribute("data-node-id");
              if (newBlockId && newBlockId !== blockId) {
                void store.updateTransaction(tx.id, {blockId: newBlockId});
              }
            }
          } catch {
            // 忽略：如果获取失败，保留原始 blockId
          }
          resolve();
        }, 150);
      });

      showMessage(i18n.saveSuccess ?? "已记录 ✓");
      dialog.destroy();

      // 刷新 dock 面板
      if (this.dockPanel) void this.dockPanel.refresh();
    };

    if (btn) {
      btn.addEventListener("click", () => {
        void submitEntry();
      });
    }
  }

  /** 打开记账对话框 — 全部 HTML 内联，事件委托 */
  private async openLedgerDialog(): Promise<void> {
    const data = await this.store.load();
    const i18n = this.i18n;
    const store = this.store;

    const entryHtml = this.buildEntryHtml(data);
    const summaryHtml = this.buildSummaryHtml(data);
    const listHtml = this.buildListHtml(data);
    const statsHtml = this.buildStatsHtml(data);
    const searchHtml = this.buildSearchHtml(data);

    const dialog = new Dialog({
      title: i18n.dockTitle ?? "记账本",
      content: `<div class="ledger-dialog-body">
        <div class="ledger-dialog-quote-bar">💡 ${randomQuote()}</div>
        <div class="ledger-dialog-tabs">
          <button class="ledger-dialog-tab active" data-tab="expense">${i18n.expense ?? "支出"}</button>
          <button class="ledger-dialog-tab" data-tab="income">${i18n.income ?? "收入"}</button>
          <button class="ledger-dialog-tab" data-tab="stats">${i18n.tabStats ?? "统计"}</button>
          <button class="ledger-dialog-tab" data-tab="search">${i18n.tabSearch ?? "查询"}</button>
        </div>
        <div class="ledger-tab-page ledger-tab-entry">
          ${entryHtml}
          <div class="ledger-dialog-summary">${summaryHtml}</div>
          <div class="ledger-dialog-list">${listHtml}</div>
        </div>
        <div class="ledger-tab-page ledger-tab-stats" style="display:none">
          ${statsHtml}
        </div>
        <div class="ledger-tab-page ledger-tab-search" style="display:none">
          ${searchHtml}
        </div>
      </div>`,
      width: "500px",
    });

    // 当前编辑状态
    let editingId: string | null = null;
    let currentType: TxType = "expense";
    let lastFiltered: Transaction[] = [];

    const body = dialog.element.querySelector(".b3-dialog__body") ?? dialog.element;

    // 刷新对话框内容
    const refreshAll = async () => {
      const fresh = await store.load();
      const s = body.querySelector(".ledger-dialog-summary") as HTMLElement | null;
      const l = body.querySelector(".ledger-dialog-list") as HTMLElement | null;
      if (s) s.innerHTML = this.buildSummaryHtml(fresh);
      if (l) l.innerHTML = this.buildListHtml(fresh);
      // 刷新分类和账户下拉
      const catBox = body.querySelector(".ledger-categories") as HTMLElement | null;
      if (catBox) catBox.innerHTML = this.buildCategoriesHtml(fresh, currentType);
      const accSel = body.querySelector(".ledger-account") as HTMLSelectElement | null;
      if (accSel) accSel.innerHTML = this.buildAccountsHtml(fresh);
      if (this.dockPanel) void this.dockPanel.refresh();
    };

    // 事件委托：统一处理所有点击
    body.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;

      // 顶层标签切换（支出 / 收入 / 统计 / 查询）
      const dialogTab = target.closest(".ledger-dialog-tab") as HTMLElement | null;
      if (dialogTab) {
        const tab = dialogTab.dataset.tab;
        body.querySelectorAll(".ledger-dialog-tab").forEach((t) =>
          t.classList.toggle("active", t === dialogTab),
        );
        const entryPage = body.querySelector(".ledger-tab-entry") as HTMLElement | null;
        const statsPage = body.querySelector(".ledger-tab-stats") as HTMLElement | null;
        const searchPage = body.querySelector(".ledger-tab-search") as HTMLElement | null;

        if (tab === "stats") {
          if (entryPage) entryPage.style.display = "none";
          if (searchPage) searchPage.style.display = "none";
          if (statsPage) {
            statsPage.style.display = "";
            void (async () => {
              const fresh = await store.load();
              statsPage.innerHTML = this.buildStatsHtml(fresh);
            })();
          }
        } else if (tab === "search") {
          if (entryPage) entryPage.style.display = "none";
          if (statsPage) statsPage.style.display = "none";
          if (searchPage) searchPage.style.display = "";
        } else {
          // 支出 or 收入
          currentType = (tab as TxType) ?? "expense";
          if (entryPage) entryPage.style.display = "";
          if (statsPage) statsPage.style.display = "none";
          if (searchPage) searchPage.style.display = "none";
          const catBox = body.querySelector(".ledger-categories") as HTMLElement | null;
          void (async () => {
            const fresh = await store.load();
            if (catBox) catBox.innerHTML = this.buildCategoriesHtml(fresh, currentType);
          })();
        }
        return;
      }

      // 分类点击选
      const catBtn = target.closest(".ledger-cat-btn") as HTMLElement | null;
      if (catBtn) {
        body.querySelectorAll(".ledger-cat-btn").forEach((b) =>
          b.classList.toggle("active", b === catBtn),
        );
        return;
      }

      // 提交按钮
      if (target.closest(".ledger-save-btn")) {
        void (async () => {
          const amount = Math.round(
            parseFloat((body.querySelector(".ledger-amount") as HTMLInputElement).value) * 100,
          );
          if (!Number.isFinite(amount) || amount <= 0) {
            showMessage(i18n.invalidAmount ?? "请输入有效金额", 3000, "error");
            return;
          }
          const activeCat = body.querySelector(".ledger-cat-btn.active") as HTMLElement | null;
          const categoryId = activeCat?.dataset.id ?? "";
          const accountId = (body.querySelector(".ledger-account") as HTMLSelectElement).value;
          const note = (body.querySelector(".ledger-note") as HTMLInputElement).value.trim();
          const date =
            (body.querySelector(".ledger-date") as HTMLInputElement).value ||
            new Date().toISOString().slice(0, 10);

          if (editingId) {
            await store.updateTransaction(editingId, {
              type: currentType, amount, categoryId, accountId, date, note: note || undefined,
            });
            editingId = null;
            (body.querySelector(".ledger-save-btn") as HTMLButtonElement).textContent =
              i18n.saveBtn ?? "记一笔";
            showMessage(i18n.updateSuccess ?? "已更新 ✓");
          } else {
            await store.addTransaction({
              type: currentType, amount, currency: "CNY", categoryId, accountId, date,
              note: note || undefined,
            });
            // 重置表单
            (body.querySelector(".ledger-amount") as HTMLInputElement).value = "";
            (body.querySelector(".ledger-note") as HTMLInputElement).value = "";
            showMessage(i18n.saveSuccess ?? "已记录 ✓");
          }
          await refreshAll();
        })();
        return;
      }

      // 删除
      const delBtn = target.closest("[data-action='delete']") as HTMLElement | null;
      if (delBtn) {
        const id = delBtn.dataset.id!;
        if (confirm(i18n.confirmDelete ?? "确认删除这笔记录？")) {
          void (async () => {
            await store.removeTransaction(id);
            await refreshAll();
          })();
        }
        return;
      }

      // 跳转到关联块
      const gotoBtn = target.closest("[data-action='goto-block']") as HTMLElement | null;
      if (gotoBtn) {
        const blockId = gotoBtn.dataset.blockId;
        if (blockId) {
          openTab({app: this.app, doc: {id: blockId}});
        }
        return;
      }

      // 编辑
      const editBtn = target.closest("[data-action='edit']") as HTMLElement | null;
      if (editBtn) {
        const id = editBtn.dataset.id!;
        void (async () => {
          const fresh = await store.load();
          const tx = fresh.transactions.find((t) => t.id === id);
          if (!tx) return;
          editingId = tx.id;
          currentType = tx.type;
          // 预填表单：切换到对应类型的顶层标签
          body.querySelectorAll(".ledger-dialog-tab").forEach((t) =>
            t.classList.toggle("active", (t as HTMLElement).dataset.tab === tx.type),
          );
          const entryPage = body.querySelector(".ledger-tab-entry") as HTMLElement | null;
          const statsPage = body.querySelector(".ledger-tab-stats") as HTMLElement | null;
          const searchPage = body.querySelector(".ledger-tab-search") as HTMLElement | null;
          if (entryPage) entryPage.style.display = "";
          if (statsPage) statsPage.style.display = "none";
          if (searchPage) searchPage.style.display = "none";
          const catBox = body.querySelector(".ledger-categories") as HTMLElement;
          catBox.innerHTML = this.buildCategoriesHtml(fresh, tx.type);
          body.querySelectorAll(".ledger-cat-btn").forEach((b) =>
            b.classList.toggle("active", (b as HTMLElement).dataset.id === tx.categoryId),
          );
          (body.querySelector(".ledger-amount") as HTMLInputElement).value = String(tx.amount / 100);
          (body.querySelector(".ledger-account") as HTMLSelectElement).value = tx.accountId;
          (body.querySelector(".ledger-note") as HTMLInputElement).value = tx.note ?? "";
          (body.querySelector(".ledger-date") as HTMLInputElement).value = tx.date;
          (body.querySelector(".ledger-save-btn") as HTMLButtonElement).textContent =
            i18n.updateBtn ?? "保存修改";
          body.querySelector(".ledger-quick-entry")?.scrollIntoView({behavior: "smooth"});
        })();
        return;
      }

      // 查询按钮
      if (target.closest("[data-action='search']")) {
        void (async () => {
          const fresh = await store.load();
          const dateFrom = (body.querySelector(".ledger-search-from") as HTMLInputElement)?.value ?? "";
          const dateTo = (body.querySelector(".ledger-search-to") as HTMLInputElement)?.value ?? "";
          const typeVal = (body.querySelector(".ledger-search-type") as HTMLSelectElement)?.value ?? "";
          const catVal = (body.querySelector(".ledger-search-cat") as HTMLSelectElement)?.value ?? "";
          const minVal = parseFloat((body.querySelector(".ledger-search-min") as HTMLInputElement)?.value ?? "0") || 0;
          const maxVal = parseFloat((body.querySelector(".ledger-search-max") as HTMLInputElement)?.value ?? "0") || 0;
          const minCents = Math.round(minVal * 100);
          const maxCents = Math.round(maxVal * 100);

          let filtered = fresh.transactions.filter((t) => {
            if (!inDateRange(t, dateFrom, dateTo)) return false;
            if (typeVal && t.type !== typeVal) return false;
            if (catVal && t.categoryId !== catVal) return false;
            if (!inAmountRange(t, minCents, maxCents)) return false;
            return true;
          });

          filtered.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

          lastFiltered = filtered;

          const resultBox = body.querySelector(".ledger-search-results") as HTMLElement;
          if (resultBox) {
            resultBox.innerHTML = this.buildSearchResultsHtml(filtered, fresh);
          }
        })();
        return;
      }

      // 导出 CSV
      if (target.closest("[data-action='export-csv']")) {
        if (!lastFiltered.length) {
          showMessage(i18n.exportEmpty ?? "无数据可导出", 4000, "info");
          return;
        }
        void (async () => {
          const fresh = await store.load();
          const csv = this.buildCsvString(lastFiltered, fresh);
          const bom = "\uFEFF";
          const blob = new Blob([bom + csv], {type: "text/csv;charset=utf-8"});
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          a.href = url;
          a.download = `ledger_${dateStr}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        })();
        return;
      }

      // 导入 CSV — 触发隐藏文件选择
      if (target.closest("[data-action='import-csv']")) {
        const fileInput = body.querySelector(".ledger-import-file") as HTMLInputElement | null;
        if (fileInput) {
          fileInput.value = "";
          fileInput.click();
        }
        return;
      }
    });

    // 查询页类型切换时更新分类下拉
    body.addEventListener("change", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("ledger-search-type")) {
        const typeVal = (target as HTMLSelectElement).value;
        const catSelect = body.querySelector(".ledger-search-cat") as HTMLSelectElement;
        if (catSelect) {
          void (async () => {
            const fresh = await store.load();
            catSelect.innerHTML = this.buildSearchCategoryOptions(fresh, typeVal);
          })();
        }
      }

      // CSV 文件选择后导入
      if (target.classList.contains("ledger-import-file")) {
        const input = target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          void (async () => {
            try {
              const text = reader.result as string;
              const rows = this.parseCsv(text);
              if (!rows.length) {
                showMessage(i18n.importError ?? "CSV 解析失败，请检查格式", 4000, "error");
                return;
              }

              const fresh = await store.load();

              // 去重：按 date+type+amount(分)+note 组合键
              const existKeys = new Set(
                fresh.transactions.map((t) => `${t.date}|${t.type}|${t.amount}|${t.note ?? ""}`)
              );

              let imported = 0;
              let skipped = 0;

              for (const row of rows) {
                const date = row.date;
                const typeVal = row.type === (i18n.income ?? "收入") ? "income" : "expense";
                const amountCents = Math.round(parseFloat(row.amount) * 100);
                if (!date || isNaN(amountCents) || amountCents <= 0) {
                  skipped++;
                  continue;
                }

                const dedupKey = `${date}|${typeVal}|${amountCents}|${row.note ?? ""}`;
                if (existKeys.has(dedupKey)) {
                  skipped++;
                  continue;
                }

                // 分类匹配：按名称查找，未找到则自动创建
                let cat = fresh.categories.find((c) => c.name === row.category && c.type === typeVal);
                if (!cat) {
                  cat = {
                    id: "cat_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
                    name: row.category || (typeVal === "income" ? (i18n.income ?? "收入") : (i18n.expense ?? "支出")),
                    icon: typeVal === "income" ? "💰" : "📝",
                    type: typeVal as TxType,
                  };
                  fresh.categories.push(cat);
                }

                // 账户匹配：按名称查找，未找到使用默认
                const acc = fresh.accounts.find((a) => a.name === row.account) ?? fresh.accounts[0];

                await store.addTransaction({
                  type: typeVal as TxType,
                  amount: amountCents,
                  currency: "CNY",
                  categoryId: cat.id,
                  accountId: acc.id,
                  date,
                  note: row.note || undefined,
                });

                existKeys.add(dedupKey);
                imported++;
              }

              // 保存分类变更（如果有新增分类）
              await store.save(fresh);

              let msg = (i18n.importSuccess ?? "成功导入 %d 条记录").replace("%d", String(imported));
              if (skipped > 0) {
                msg += "，" + (i18n.importSkipDup ?? "跳过 %d 条重复记录").replace("%d", String(skipped));
              }
              showMessage(msg, 4000, imported > 0 ? "info" : "error");

              // 刷新对话框和 dock
              await refreshAll();
              if (this.dockPanel) void this.dockPanel.refresh();
            } catch {
              showMessage(i18n.importError ?? "CSV 解析失败，请检查格式", 4000, "error");
            }
          })();
        };
        reader.readAsText(file, "UTF-8");
      }
    });
  }

  // ---- HTML 构建 ----

  private buildEntryHtml(data: LedgerData): string {
    const cats = this.buildCategoriesHtml(data, "expense");
    const accs = this.buildAccountsHtml(data);
    const today = new Date().toISOString().slice(0, 10);
    return `<div class="ledger-quick-entry">
      <div class="ledger-field">
        <input class="ledger-amount" type="number" inputmode="decimal"
               step="0.01" min="0" placeholder="${this.i18n.amountPlaceholder ?? "0.00"}" />
      </div>
      <div class="ledger-categories">${cats}</div>
      <div class="ledger-field">
        <select class="ledger-account">${accs}</select>
      </div>
      <div class="ledger-field">
        <input class="ledger-note" type="text" placeholder="${this.i18n.notePlaceholder ?? "备注（可选）"}" />
      </div>
      <div class="ledger-field">
        <input class="ledger-date" type="date" value="${today}" />
      </div>
      <button class="ledger-save-btn">${this.i18n.saveBtn ?? "记一笔"}</button>
    </div>`;
  }

  private buildCategoriesHtml(data: LedgerData, type: TxType): string {
    const cats = data.categories
      .filter((c) => c.type === type)
      .sort((a, b) => {
        const aOther = a.id.startsWith("cat_other") ? 1 : 0;
        const bOther = b.id.startsWith("cat_other") ? 1 : 0;
        return aOther - bOther;
      });
    return cats
      .map(
        (c, i) =>
          `<button class="ledger-cat-btn${i === 0 ? " active" : ""}" data-id="${c.id}">
            <span class="ledger-cat-icon">${c.icon}</span>
            <span class="ledger-cat-name">${c.name}</span>
          </button>`,
      )
      .join("");
  }

  private buildAccountsHtml(data: LedgerData): string {
    return data.accounts
      .map((a) => `<option value="${a.id}">${a.icon ?? ""} ${a.name}</option>`)
      .join("");
  }

  private buildSummaryHtml(data: LedgerData): string {
    const ym = new Date().toISOString().slice(0, 7);
    const s = summarize(data.transactions.filter((t) => inMonth(t, ym)));
    return `
      <div class="ledger-summary-row"><span>${this.i18n.monthExpense ?? "本月支出"}</span><b class="ledger-expense">${formatAmount(s.expense)}</b></div>
      <div class="ledger-summary-row"><span>${this.i18n.monthIncome ?? "本月收入"}</span><b class="ledger-income">${formatAmount(s.income)}</b></div>
      <div class="ledger-summary-row"><span>${this.i18n.balance ?? "结余"}</span><b class="ledger-balance">${formatAmount(s.balance)}</b></div>`;
  }

  private buildListHtml(data: LedgerData): string {
    const sorted = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    if (!sorted.length) {
      return `<div class="ledger-empty">${this.i18n.empty ?? "暂无记录"}</div>`;
    }
    const title = `<div class="ledger-recent-title">${this.i18n.allRecords ?? "全部记录"}</div>`;
    return (
      title +
      sorted
        .map((t) => {
          const cat = data.categories.find((c) => c.id === t.categoryId);
          const sign = t.type === "income" ? "+" : "-";
          return `<div class="ledger-tx-item">
            <span class="ledger-tx-icon">${cat?.icon ?? "•"}</span>
            <span class="ledger-tx-info">
              <span class="ledger-tx-name">${cat?.name ?? "-"}${t.note ? " · " + t.note : ""}</span>
              <span class="ledger-tx-date">${t.date}</span>
            </span>
            <span class="ledger-tx-amount ${t.type}">${sign}${formatAmount(t.amount)}</span>
            <span class="ledger-tx-actions">
              ${t.blockId ? `<button class="ledger-tx-btn" data-action="goto-block" data-block-id="${t.blockId}" title="${this.i18n.linkedBlock ?? "已关联"}">🔗</button>` : ""}
              <button class="ledger-tx-btn" data-action="edit" data-id="${t.id}" title="${this.i18n.editBtn ?? "编辑"}">✏️</button>
              <button class="ledger-tx-btn" data-action="delete" data-id="${t.id}" title="${this.i18n.deleteBtn ?? "删除"}">🗑️</button>
            </span>
          </div>`;
        })
        .join("")
    );
  }

  // ---- 查询页 ----

  private buildSearchHtml(data: LedgerData): string {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + "01";
    const catOptions = this.buildSearchCategoryOptions(data, "");
    return `<div class="ledger-search-form">
      <div class="ledger-search-row">
        <label class="ledger-search-label">${this.i18n.searchDateFrom ?? "起始日期"}</label>
        <input class="ledger-search-from ledger-field" type="date" value="${monthStart}" />
        <label class="ledger-search-label">${this.i18n.searchDateTo ?? "结束日期"}</label>
        <input class="ledger-search-to ledger-field" type="date" value="${today}" />
      </div>
      <div class="ledger-search-row">
        <label class="ledger-search-label">${this.i18n.searchType ?? "类型"}</label>
        <select class="ledger-search-type ledger-field">
          <option value="">${this.i18n.searchAllTypes ?? "全部"}</option>
          <option value="expense">${this.i18n.expense ?? "支出"}</option>
          <option value="income">${this.i18n.income ?? "收入"}</option>
        </select>
        <label class="ledger-search-label">${this.i18n.searchCategory ?? "分类"}</label>
        <select class="ledger-search-cat ledger-field">
          <option value="">${this.i18n.searchAllCategories ?? "全部"}</option>
          ${catOptions}
        </select>
      </div>
      <div class="ledger-search-row">
        <label class="ledger-search-label">${this.i18n.searchAmountMin ?? "最小金额"}</label>
        <input class="ledger-search-min ledger-field" type="number" step="0.01" min="0" placeholder="0.00" />
        <label class="ledger-search-label">${this.i18n.searchAmountMax ?? "最大金额"}</label>
        <input class="ledger-search-max ledger-field" type="number" step="0.01" min="0" placeholder="0.00" />
      </div>
      <button class="ledger-search-btn" data-action="search">${this.i18n.searchBtn ?? "查询"}</button>
      <div class="ledger-search-io">
        <button class="ledger-io-btn" data-action="export-csv">📥 ${this.i18n.exportCsv ?? "导出 CSV"}</button>
        <button class="ledger-io-btn" data-action="import-csv">📤 ${this.i18n.importCsv ?? "导入 CSV"}</button>
        <input type="file" accept=".csv" class="ledger-import-file" style="display:none" />
      </div>
    </div>
    <div class="ledger-search-results"></div>`;
  }

  private buildSearchCategoryOptions(data: LedgerData, typeVal: string): string {
    const cats = typeVal
      ? data.categories.filter((c) => c.type === typeVal)
      : data.categories;
    const allLabel = this.i18n.searchAllCategories ?? "全部分类";
    return `<option value="">${allLabel}</option>` +
      cats
        .map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`)
        .join("");
  }

  private buildSearchResultsHtml(filtered: Transaction[], data: LedgerData): string {
    if (!filtered.length) {
      return `<div class="ledger-empty">${this.i18n.empty ?? "暂无记录"}</div>`;
    }
    // 汇总
    const totalExpense = filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const totalIncome = filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const countLabel = (this.i18n.searchResultCount ?? "共 %d 条记录").replace("%d", String(filtered.length));

    const summary = `<div class="ledger-search-summary">
      <span>${countLabel}</span>
      ${totalExpense > 0 ? `<span class="ledger-expense">${this.i18n.expense ?? "支出"}: ${formatAmount(totalExpense)}</span>` : ""}
      ${totalIncome > 0 ? `<span class="ledger-income">${this.i18n.income ?? "收入"}: ${formatAmount(totalIncome)}</span>` : ""}
    </div>`;

    const list = filtered
      .map((t) => {
        const cat = data.categories.find((c) => c.id === t.categoryId);
        const sign = t.type === "income" ? "+" : "-";
        return `<div class="ledger-tx-item">
          <span class="ledger-tx-icon">${cat?.icon ?? "•"}</span>
          <span class="ledger-tx-info">
            <span class="ledger-tx-name">${cat?.name ?? "-"}${t.note ? " · " + t.note : ""}</span>
            <span class="ledger-tx-date">${t.date}</span>
          </span>
          <span class="ledger-tx-amount ${t.type}">${sign}${formatAmount(t.amount)}</span>
          <span class="ledger-tx-actions">
            ${t.blockId ? `<button class="ledger-tx-btn" data-action="goto-block" data-block-id="${t.blockId}" title="${this.i18n.linkedBlock ?? "已关联"}">🔗</button>` : ""}
            <button class="ledger-tx-btn" data-action="edit" data-id="${t.id}" title="${this.i18n.editBtn ?? "编辑"}">✏️</button>
            <button class="ledger-tx-btn" data-action="delete" data-id="${t.id}" title="${this.i18n.deleteBtn ?? "删除"}">🗑️</button>
          </span>
        </div>`;
      })
      .join("");

    return summary + list;
  }

  // ---- CSV 工具 ----

  /** 将交易列表导出为 CSV 字符串（不含 BOM，调用方自行添加） */
  private buildCsvString(transactions: Transaction[], data: LedgerData): string {
    const header = "日期,类型,分类,金额,账户,备注";
    const rows = transactions.map((t) => {
      const cat = data.categories.find((c) => c.id === t.categoryId);
      const acc = data.accounts.find((a) => a.id === t.accountId);
      const typeLabel = t.type === "income" ? (this.i18n.income ?? "收入") : (this.i18n.expense ?? "支出");
      const amount = (t.amount / 100).toFixed(2);
      const note = (t.note ?? "").replace(/"/g, '""');
      const catName = cat?.name ?? "";
      const accName = acc?.name ?? "";
      return `${t.date},${typeLabel},${catName},${amount},${accName},"${note}"`;
    });
    return header + "\n" + rows.join("\n");
  }

  /** 简单 CSV 解析，支持引号包裹字段 */
  private parseCsv(text: string): Array<{date: string; type: string; category: string; amount: string; account: string; note: string}> {
    // 去除 BOM
    const clean = text.replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    // 跳过表头
    const results: Array<{date: string; type: string; category: string; amount: string; account: string; note: string}> = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = this.splitCsvLine(lines[i]);
      if (fields.length < 4) continue;
      results.push({
        date: fields[0]?.trim() ?? "",
        type: fields[1]?.trim() ?? "",
        category: fields[2]?.trim() ?? "",
        amount: fields[3]?.trim() ?? "",
        account: fields[4]?.trim() ?? "",
        note: fields[5]?.trim() ?? "",
      });
    }
    return results;
  }

  /** 拆分 CSV 单行，正确处理引号内的逗号 */
  private splitCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  // ---- 统计图表 ----

  private buildStatsHtml(data: LedgerData): string {
    const ym = new Date().toISOString().slice(0, 7);
    const monthTx = data.transactions.filter((t) => inMonth(t, ym));
    const catStats = byCategory(monthTx, "expense");

    const donutHtml = this.buildDonutChart(catStats, data);
    const barHtml = this.buildBarChart(data);

    // 全年支出分类
    const yearPrefix = String(new Date().getFullYear());
    const yearTx = data.transactions.filter((t) => t.date.startsWith(yearPrefix) && t.type === "expense");
    const yearCatStats = byCategory(yearTx, "expense");
    const yearDonutHtml = this.buildDonutChart(yearCatStats, data, this.i18n.statsYearlyLabel ?? "全年支出");

    return `
      <div class="ledger-stats-section">
        <div class="ledger-stats-title">${this.i18n.statsCategoryTitle ?? "本月支出分类"}</div>
        ${donutHtml}
      </div>
      <div class="ledger-stats-section">
        <div class="ledger-stats-title">${this.i18n.statsYearlyTitle ?? "全年支出分类"}</div>
        ${yearDonutHtml}
      </div>
      <div class="ledger-stats-section">
        <div class="ledger-stats-title">${this.i18n.statsTrendTitle ?? "近 6 个月收支趋势"}</div>
        ${barHtml}
      </div>`;
  }

  /** 分类占比环形图（SVG） */
  private buildDonutChart(
    catStats: {categoryId: string; total: number; ratio: number}[],
    data: LedgerData,
    centerLabel?: string,
  ): string {
    if (!catStats.length) {
      return `<div class="ledger-empty">${this.i18n.empty ?? "暂无数据"}</div>`;
    }

    const colors = [
      "#f56c6c", "#e6a23c", "#409eff", "#67c23a", "#909399",
      "#b37feb", "#36cfc9", "#f759ab", "#ffc53d", "#597ef7",
    ];
    const r = 60;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    const segments: string[] = [];
    const legends: string[] = [];

    catStats.forEach((s, i) => {
      const len = s.ratio * circumference;
      const color = colors[i % colors.length];
      segments.push(
        `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${color}" stroke-width="20"
          stroke-dasharray="${len} ${circumference - len}"
          stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)" />`,
      );
      offset += len;

      const cat = data.categories.find((c) => c.id === s.categoryId);
      const pct = (s.ratio * 100).toFixed(1);
      const yuan = (s.total / 100).toFixed(0);
      legends.push(
        `<div class="ledger-legend-item">
          <span class="ledger-legend-dot" style="background:${color}"></span>
          <span class="ledger-legend-name">${cat?.icon ?? ""} ${cat?.name ?? "-"}</span>
          <span class="ledger-legend-val">¥${yuan} (${pct}%)</span>
        </div>`,
      );
    });

    // 中心总额
    const totalYuan = (catStats.reduce((s, c) => s + c.total, 0) / 100).toFixed(0);

    return `<div class="ledger-donut-wrap">
      <svg viewBox="0 0 160 160" class="ledger-donut">
        ${segments.join("")}
        <text x="80" y="76" text-anchor="middle" class="ledger-donut-label">¥${totalYuan}</text>
        <text x="80" y="92" text-anchor="middle" class="ledger-donut-sublabel">${centerLabel ?? (this.i18n.monthExpense ?? "本月支出")}</text>
      </svg>
      <div class="ledger-legend">${legends.join("")}</div>
    </div>`;
  }

  /** 近 6 个月收支柱状图（SVG） */
  private buildBarChart(data: LedgerData): string {
    const now = new Date();
    const months: {ym: string; label: string; income: number; expense: number}[] = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${d.getMonth() + 1}月`;
      const txs = data.transactions.filter((t) => inMonth(t, ym));
      const s = summarize(txs);
      months.push({ym, label, income: s.income, expense: s.expense});
    }

    const maxVal = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
    const chartH = 120;
    const barW = 8;
    const gap = 24;
    const padL = 6;
    const svgW = padL + months.length * gap;

    const bars: string[] = [];
    const labels: string[] = [];

    months.forEach((m, i) => {
      const x = padL + i * gap;
      const incH = (m.income / maxVal) * chartH;
      const expH = (m.expense / maxVal) * chartH;

      // 收入柱（绿）
      bars.push(
        `<rect x="${x}" y="${chartH - incH}" width="${barW}" height="${incH}" rx="3" fill="#67c23a" />`,
      );
      // 支出柱（红）
      bars.push(
        `<rect x="${x + barW + 2}" y="${chartH - expH}" width="${barW}" height="${expH}" rx="3" fill="#f56c6c" />`,
      );
      // 月份标签
      labels.push(
        `<text x="${x + barW + 1}" y="${chartH + 14}" text-anchor="middle" class="ledger-bar-label">${m.label}</text>`,
      );
    });

    return `<div class="ledger-bar-wrap">
      <svg viewBox="0 0 ${svgW} ${chartH + 20}" class="ledger-bar-chart">
        ${bars.join("")}
        ${labels.join("")}
      </svg>
      <div class="ledger-bar-legend">
        <span class="ledger-legend-dot" style="background:#67c23a"></span> ${this.i18n.income ?? "收入"}
        <span class="ledger-legend-dot" style="background:#f56c6c;margin-left:12px"></span> ${this.i18n.expense ?? "支出"}
      </div>
    </div>`;
  }

  async onLayoutReady(): Promise<void> {
    try {
      await this.store.load();
      // 数据就绪后刷新 dock 面板（兜底：dock init 可能先于数据加载完成）
      if (this.dockPanel) {
        await this.dockPanel.refresh();
      }
    } catch (e) {
      console.error("[ledger] load failed", e);
      showMessage("记账本数据加载失败", 4000, "error");
    }
  }

  onunload(): void {
    this.dockPanel = null;
    this.topBarEl = null;
  }
}
