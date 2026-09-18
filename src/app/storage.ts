/**
 * The device storage adapter — REQ-11 (#53).
 *
 * The only file in the app that touches the native storage module. Everything
 * else takes a `KeyValueStore`, which is why the persistence rules are testable
 * in Node with no device and no mocking framework.
 *
 * **Not imported by any test.** Importing AsyncStorage under vitest would try
 * to load a native module that is not there; the tests use
 * `createMemoryStore()` instead, and that is deliberate rather than an
 * oversight.
 *
 * ADR-011: this writes to the device and nowhere else. Android auto-backup is
 * disabled (`allowBackup="false"`, asserted in CI), so it does not sync to
 * Google either.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { createMemoryStore, type KeyValueStore } from './persistence';

/**
 * The device store, or an in-memory one if the native module is unusable.
 *
 * Falling back rather than throwing is the point: a phone where storage is
 * broken should still run the match, exactly as the app did before persistence
 * existed. The coach loses the save, not the game.
 */
export function createDeviceStore(): KeyValueStore {
  try {
    if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
      return {
        getItem: (key) => AsyncStorage.getItem(key),
        setItem: (key, value) => AsyncStorage.setItem(key, value),
        removeItem: (key) => AsyncStorage.removeItem(key),
      };
    }
  } catch {
    // Fall through.
  }
  return createMemoryStore();
}
