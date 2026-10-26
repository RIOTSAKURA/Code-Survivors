import { ITEM, PALETTE } from '../config';

export type ItemId = 'hotfix' | 'sigkill' | 'fetch';

export interface ItemDef {
  id: ItemId;
  name: string;
  tagline: string;
  glyph: string;
  color: number;
  desc: string;
  detail: string;
}

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  hotfix: {
    id: 'hotfix',
    name: '热修复',
    tagline: 'Hotfix',
    glyph: 'hotfix',
    color: PALETTE.blue,
    desc: '给运行时在线打补丁，立刻补回生命值，不用停下战斗',
    detail: `回复 ${ITEM.heal} HP`,
  },
  sigkill: {
    id: 'sigkill',
    name: '强制终止',
    tagline: 'SIGKILL',
    glyph: 'kill -9',
    color: PALETTE.orange,
    desc: '向全场进程广播 SIGKILL：瞬间清空所有普通敌人，Boss 也会被打掉一大截血',
    detail: `清空全部普通敌人 · Boss 受 ${Math.round(ITEM.empBossPct * 100)}% 最大生命伤害`,
  },
  fetch: {
    id: 'fetch',
    name: '全量抓取',
    tagline: 'Fetch All',
    glyph: 'fetch',
    color: PALETTE.purple,
    desc: '把散落在战场上的二进制一次性抓回来，立刻结算全部经验',
    detail: '吸收场上所有经验球',
  },
};

export const ITEM_IDS: ItemId[] = ['hotfix', 'sigkill', 'fetch'];

export function itemDropChance(id: ItemId): number {
  return ITEM.rate[id];
}

export function totalItemChance(): number {
  return ITEM_IDS.reduce((sum, id) => sum + ITEM.rate[id], 0);
}

export function pickItemDrop(roll: number): ItemId | null {
  if (roll >= totalItemChance()) return null;
  let cursor = roll;
  for (const id of ITEM_IDS) {
    cursor -= ITEM.rate[id];
    if (cursor <= 0) return id;
  }
  return ITEM_IDS[ITEM_IDS.length - 1];
}
