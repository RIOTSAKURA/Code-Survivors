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
    desc: '+20% 攻速',
    color: PALETTE.yellow,
    maxLevel: 5,
    note: '所有武器冷却 -17%',
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
    desc: '自动拾取范围 +30%',
    color: PALETTE.purple,
    maxLevel: 5,
    note: '二进制经验球的吸附半径扩大',
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
    desc: '+1 护甲（减伤）',
    color: PALETTE.text,
    maxLevel: 5,
    note: '编译期检查拦下更多伤害',
  },
  parallel: {
    id: 'parallel',
    name: '并行计算',
    symbol: '||',
    tagline: 'Parallelism',
    desc: '所有武器冷却 -10%',
    color: PALETTE.orange,
    maxLevel: 5,
    note: '多线程调度，武器转得更快',
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
