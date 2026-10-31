import { RAY_LOCK } from '../config';
import { CACHE_PASSIVE } from '../data/passives';
import { DART_FOCUS } from '../data/evolutions';
import type { RunState } from '../core/types';

export function usesFocusTarget(run: RunState): boolean {
  return (
    (run.passives.cache ?? 0) > 0 ||
    run.evolutions.dart === 'dart_stack' ||
    run.evolutions.ray === 'ray_lock' ||
    run.evolutions.clone === 'clone_focus'
  );
}

export function focusChainWindow(run: RunState): number {
  return Math.max(
    (run.passives.cache ?? 0) > 0 ? CACHE_PASSIVE.window : 0,
    run.evolutions.dart === 'dart_stack' ? DART_FOCUS.window : 0,
    run.evolutions.ray === 'ray_lock' ? RAY_LOCK.window : 0,
    1,
  );
}

export function focusChainMaxStacks(run: RunState): number {
  return Math.max(
    (run.passives.cache ?? 0) > 0 ? CACHE_PASSIVE.maxStacks : 0,
    run.evolutions.dart === 'dart_stack' ? DART_FOCUS.maxStacks : 0,
    run.evolutions.ray === 'ray_lock' ? RAY_LOCK.maxStacks : 0,
    CACHE_PASSIVE.maxStacks,
  );
}
