// 快速录入表单：原生 DOM 构建，无框架依赖
// 支持新增和编辑两种模式

import type {LedgerData, Transaction, TxType} from "../core/types";
import type {LedgerStore} from "../core/store";

export interface QuickEntryCallbacks {
  onSaved: () => void;
}

export class QuickEntry {
  private el: HTMLElement;
  private store: LedgerStore;
  private data: LedgerData;
  private i18n: Record<string, string>;
  private cb: QuickEntryCallbacks;
  private currentType: TxType = "expense";
  private selectedCategoryId = "";
  /** 正在编辑的交易 ID，null 表示新增模式 */
  private editingId: string | null = null;

  constructor(
    store: LedgerStore,
    data: LedgerData,
    i18n: Record<string, string>,
    cb: QuickEntryCallbacks,
  ) {
    this.store = store;
    this.data = data;
    this.i18n = i18n;
    this.cb = cb;
    this.el = this.render();
    this.bind();
  }

  get element(): HTMLElement {
    return this.el;
  }

  /** 数据刷新 */
  refresh(data: LedgerData): void {
    this.data = data;
    this.fillCategories();
    this.fillAccounts();
  }

  /** 进入编辑模式：预填表单 */
  startEditing(tx: Transaction): void {
    this.editingId = tx.id;
    this.currentType = tx.type;
    // 切换 tab 高亮
    this.el.querySelectorAll<HTMLButtonElement>(".ledger-type-tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.type === tx.type),
    );
    this.fillCategories();
    this.selectedCategoryId = tx.categoryId;
    this.el.querySelectorAll(".ledger-cat-btn").forEach((b) =>
      b.classList.toggle("active", (b as HTMLElement).dataset.id === tx.categoryId),
    );
    (this.el.querySelector(".ledger-amount") as HTMLInputElement).value =
      String(tx.amount / 100);
    (this.el.querySelector(".ledger-account") as HTMLSelectElement).value = tx.accountId;
    (this.el.querySelector(".ledger-note") as HTMLInputElement).value = tx.note ?? "";
    (this.el.querySelector(".ledger-date") as HTMLInputElement).value = tx.date;
    // 切换按钮文字
    const btn = this.el.querySelector(".ledger-save-btn") as HTMLButtonElement;
    btn.textContent = this.i18n.updateBtn ?? "保存修改";
  }

  /** 退出编辑模式，清空表单 */
  stopEditing(): void {
    this.editingId = null;
    this.resetForm();
    const btn = this.el.querySelector(".ledger-save-btn") as HTMLButtonElement;
    btn.textContent = this.i18n.saveBtn ?? "记一笔";
  }

  // ---- 渲染 ----

  private render(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ledger-quick-entry";
    wrap.innerHTML = `
      <div class="ledger-type-tabs">
        <button class="ledger-type-tab active" data-type="expense">${this.i18n.expense ?? "支出"}</button>
        <button class="ledger-type-tab" data-type="income">${this.i18n.income ?? "收入"}</button>
      </div>
      <div class="ledger-field">
        <input class="ledger-amount" type="number" inputmode="decimal"
               step="0.01" min="0" placeholder="${this.i18n.amountPlaceholder ?? "0.00"}" />
      </div>
      <div class="ledger-categories"></div>
      <div class="ledger-field">
        <select class="ledger-account"></select>
      </div>
      <div class="ledger-field">
        <input class="ledger-note" type="text" placeholder="${this.i18n.notePlaceholder ?? "备注（可选）"}" />
      </div>
      <div class="ledger-field">
        <input class="ledger-date" type="date" />
      </div>
      <div class="ledger-btn-row">
        <button class="ledger-save-btn">${this.i18n.saveBtn ?? "记一笔"}</button>
        <button class="ledger-cancel-btn" style="display:none">${this.i18n.cancelBtn ?? "取消"}</button>
      </div>
    `;
    this.fillCategories();
    this.fillAccounts();
    (wrap.querySelector(".ledger-date") as HTMLInputElement).value =
      new Date().toISOString().slice(0, 10);
    return wrap;
  }

  private fillCategories(): void {
    const box = this.el.querySelector(".ledger-categories") as HTMLElement;
    const cats = this.data.categories.filter((c) => c.type === this.currentType);
    box.innerHTML = "";
    this.selectedCategoryId = cats[0]?.id ?? "";
    for (const c of cats) {
      const btn = document.createElement("button");
      btn.className = "ledger-cat-btn";
      btn.dataset.id = c.id;
      btn.innerHTML = `<span class="ledger-cat-icon">${c.icon}</span><span class="ledger-cat-name">${c.name}</span>`;
      if (c.id === this.selectedCategoryId) btn.classList.add("active");
      box.appendChild(btn);
    }
  }

  private fillAccounts(): void {
    const sel = this.el.querySelector(".ledger-account") as HTMLSelectElement;
    sel.innerHTML = "";
    for (const a of this.data.accounts) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.icon ?? ""} ${a.name}`;
      sel.appendChild(opt);
    }
  }

  // ---- 事件 ----

  private bind(): void {
    // 类型切换
    this.el.querySelectorAll<HTMLButtonElement>(".ledger-type-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this.currentType = tab.dataset.type as TxType;
        this.el
          .querySelectorAll<HTMLButtonElement>(".ledger-type-tab")
          .forEach((t) => t.classList.toggle("active", t === tab));
        this.fillCategories();
      });
    });

    // 分类点击更新选中状态
    this.el.querySelector(".ledger-categories")!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".ledger-cat-btn") as HTMLElement | null;
      if (btn) {
        this.selectedCategoryId = btn.dataset.id ?? "";
        this.el
          .querySelectorAll(".ledger-cat-btn")
          .forEach((b) => b.classList.toggle("active", b === btn));
      }
    });

    // 提交
    this.el.querySelector(".ledger-save-btn")!.addEventListener("click", () => {
      void this.submit();
    });

    // 取消编辑
    this.el.querySelector(".ledger-cancel-btn")!.addEventListener("click", () => {
      this.stopEditing();
      this.el.querySelector(".ledger-cancel-btn")!.setAttribute("style", "display:none");
    });
  }

  private async submit(): Promise<void> {
    const amountStr = (this.el.querySelector(".ledger-amount") as HTMLInputElement).value;
    const amount = Math.round(parseFloat(amountStr) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.flash(this.i18n.invalidAmount ?? "请输入有效金额");
      return;
    }
    const accountId = (this.el.querySelector(".ledger-account") as HTMLSelectElement).value;
    const note = (this.el.querySelector(".ledger-note") as HTMLInputElement).value.trim();
    const date = (this.el.querySelector(".ledger-date") as HTMLInputElement).value;

    if (this.editingId) {
      // 编辑模式：更新
      await this.store.updateTransaction(this.editingId, {
        type: this.currentType,
        amount,
        categoryId: this.selectedCategoryId,
        accountId,
        date: date || new Date().toISOString().slice(0, 10),
        note: note || undefined,
      });
      this.stopEditing();
      this.el.querySelector(".ledger-cancel-btn")!.setAttribute("style", "display:none");
      this.flash(this.i18n.updateSuccess ?? "已更新 ✓");
    } else {
      // 新增模式
      await this.store.addTransaction({
        type: this.currentType,
        amount,
        currency: "CNY",
        categoryId: this.selectedCategoryId,
        accountId,
        date: date || new Date().toISOString().slice(0, 10),
        note: note || undefined,
      });
      this.resetForm();
      this.flash(this.i18n.saveSuccess ?? "已记录 ✓");
    }
    this.cb.onSaved();
  }

  private resetForm(): void {
    (this.el.querySelector(".ledger-amount") as HTMLInputElement).value = "";
    (this.el.querySelector(".ledger-note") as HTMLInputElement).value = "";
    (this.el.querySelector(".ledger-date") as HTMLInputElement).value =
      new Date().toISOString().slice(0, 10);
  }

  private flash(msg: string): void {
    const btn = this.el.querySelector(".ledger-save-btn") as HTMLButtonElement;
    const old = btn.textContent;
    btn.textContent = msg;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = old;
      btn.disabled = false;
    }, 800);
  }
}
