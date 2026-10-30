import { PALETTE } from '../config';
import type { PassiveId } from '../core/types';

export interface PassiveDef {
  id: PassiveId;
  name: string;
  symbol: string;
  tagline: string;
  desc: string;
  color: number;
  maxLevel: number;
  note: string;
}

export const CACHE_PASSIVE = {
  maxStacks: 5,
  window: 3,
  perStack: (level: number): number => 0.06 + 0.02 * (level - 1),
};

export const PARALLEL_PASSIVE = {
  bonus: (level: number): number => 0.1 + 0.05 * (level - 1),
};

export const GC_PASSIVE = {
  window: 2,
  threshold: (level: number): number => 18 - 2 * (level - 1),
  radius: (level: number): number => 300 + 15 * (level - 1),
  damage: (level: number): number => 40 + 20 * level,
};

export const TYPESAFE_PASSIVE = {
  delay: (level: number): number => 13 - 2 * (level - 1),
  radius: 34,
};

export const PASSIVE_DEFS: Record<PassiveId, PassiveDef> = {
  multicore: {
    id: 'multicore',
    name: '多核处理',
    symbol: '++',
    tagline: 'Multi-core',
    desc: '+1 投射物数量',
    color: PALETTE.cyan,
    maxLevel: 3,
    note: '每个武器额外发射 1 个投射物',
  },
  cache: {
    id: 'cache',
    name: '缓存优化',
    symbol: '>>',
    tagline: 'Cache Opt',
    desc: '连续攻击同一目标时叠加攻速，切换目标或停火后重置',
    color: PALETTE.yellow,
    maxLevel: 5,
    note: `每层 +${Math.round(CACHE_PASSIVE.perStack(1) * 100)}%~${Math.round(CACHE_PASSIVE.perStack(5) * 100)}% 攻速 · 最多 ${CACHE_PASSIVE.maxStacks} 层`,
  },
  memory: {
    id: 'memory',
    name: '内存扩展',
    symbol: '[]',
    tagline: 'Heap Grow',
    desc: '+20 最大 HP 并立即回复',
    color: PALETTE.green,
    maxLevel: 5,
    note: '堆内存扩容，立即回收 20 HP',
  },
  gc: {
    id: 'gc',
    name: '垃圾回收',
    symbol: '{}',
    tagline: 'Garbage Collector',
    desc: '短时间内连续拾取经验，积攒一次范围清扫',
    color: PALETTE.purple,
    maxLevel: 5,
    note: `${GC_PASSIVE.window}s 内连续拾取 · 满层清扫周围敌人`,
  },
  compile: {
    id: 'compile',
    name: '编译加速',
    symbol: '=>',
    tagline: 'Fast Compile',
    desc: '+15% 移动速度',
    color: PALETTE.blue,
    maxLevel: 5,
    note: 'JIT 预热，位移更快',
  },
  typesafe: {
    id: 'typesafe',
    name: '类型安全',
    symbol: 'T',
    tagline: 'Type Safety',
    desc: '一段时间不受伤后生成一层护盾，抵挡一次伤害',
    color: PALETTE.text,
    maxLevel: 5,
    note: `未受伤 ${TYPESAFE_PASSIVE.delay(1)}~${TYPESAFE_PASSIVE.delay(5)}s 生成 · 破碎后重新计时`,
  },
  parallel: {
    id: 'parallel',
    name: '并行计算',
    symbol: '||',
    tagline: 'Parallelism',
    desc: '不同武器交替命中同一目标时造成额外伤害',
    color: PALETTE.orange,
    maxLevel: 5,
    note: `交替命中 +${Math.round(PARALLEL_PASSIVE.bonus(1) * 100)}%~${Math.round(PARALLEL_PASSIVE.bonus(5) * 100)}% 伤害 · 鼓励多武器搭配`,
  },
  quantum: {
    id: 'quantum',
    name: '量子纠缠',
    symbol: '~',
    tagline: 'Entanglement',
    desc: '投射物 15% 概率分裂',
    color: PALETTE.white,
    maxLevel: 3,
    note: '命中时分裂出纠缠态副弹',
  },
};

export const PASSIVE_IDS: PassiveId[] = [
  'multicore',
  'cache',
  'memory',
  'gc',
  'compile',
  'typesafe',
  'parallel',
  'quantum',
];
