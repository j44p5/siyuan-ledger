// 存储层：封装插件 data API，提供带类型与默认初始化的读写
//
// 思源约束：禁止直接 fs 读写，必须走 this.loadData / this.saveData。
// 数据落盘位置：{workspace}/data/storage/petal/{plugin.name}/ledger.json
// 该目录随思源同步，无需我们额外处理多端一致性。

import type {App, Plugin} from "siyuan";
import {emptyData, type LedgerData, type Transaction} from "./types";

const STORAGE_KEY = "ledger.json";

/**
 * 生成 uuid。优先用 crypto.randomUUID（思源桌面端是安全上下文），
 * 否则降级到手写 v4，兼容部分非安全上下文。
 */
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * LedgerStore 持有一个 Plugin 实例引用，所有读写都委托给插件 data API。
 * 它本身不缓存数据——每次 load 都重新读取，保证多端同步后取到最新值。
 */
export class LedgerStore {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /** 读取全部数据；若不存在则写入默认结构后返回 */
  async load(): Promise<LedgerData> {
    const raw = await this.plugin.loadData(STORAGE_KEY);
    if (!raw) {
      const fresh = emptyData();
      await this.save(fresh);
      return fresh;
    }
    // loadData 返回 string | object，统一成对象
    const data: LedgerData =
      typeof raw === "string" ? JSON.parse(raw) : (raw as LedgerData);
    return this.normalize(data);
  }

  /** 持久化全部数据 */
  async save(data: LedgerData): Promise<void> {
    await this.plugin.saveData(STORAGE_KEY, JSON.stringify(data, null, 2));
  }

  /**
   * 追加一笔交易并保存。
   * 返回写入后的完整交易对象（含 id/时间戳）。
   */
  async addTransaction(
    input: Omit<Transaction, "id" | "createdAt" | "updatedAt">,
  ): Promise<Transaction> {
    const data = await this.load();
    const now = Date.now();
    const tx: Transaction = {
      ...input,
      id: uuid(),
      createdAt: now,
      updatedAt: now,
    };
    data.transactions.push(tx);
    await this.save(data);
    return tx;
  }

  /** 删除单笔 */
  async removeTransaction(id: string): Promise<void> {
    const data = await this.load();
    data.transactions = data.transactions.filter((t) => t.id !== id);
    await this.save(data);
  }

  /** 更新单笔 */
  async updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
    const data = await this.load();
    const idx = data.transactions.findIndex((t) => t.id === id);
    if (idx < 0) return;
    data.transactions[idx] = {
      ...data.transactions[idx],
      ...patch,
      id,
      updatedAt: Date.now(),
    };
    await this.save(data);
  }

  /** 兼容旧数据 / 补全字段 */
  private normalize(data: Partial<LedgerData>): LedgerData {
    const base = emptyData();
    return {
      version: data.version ?? base.version,
      transactions: data.transactions ?? [],
      categories: data.categories?.length ? data.categories : base.categories,
      accounts: data.accounts?.length ? data.accounts : base.accounts,
    };
  }
}

/**
 * 帮助函数：从 Plugin/App 构造 store 的工厂。
 * 保留 app 参数以备未来 kernel 直连使用。
 */
export function createStore(plugin: Plugin, _app: App): LedgerStore {
  return new LedgerStore(plugin);
}
