/**
 * This install's signing key — #193, ADR-021 D4.
 *
 * Made once, on the first launch after the update: 32 random bytes from the
 * platform's secure generator, kept in the platform's secure store (the
 * Android Keystore, the iOS Keychain), never in AsyncStorage and never in a
 * file. Only its public half ever reaches the ledger (`entrySigning.ts`).
 *
 * Not imported by any test, like `storage.ts`: the modules are not there in
 * Node. A phone whose secure store fails records unsigned, as before —
 * signing is evidence, never a reason to stop recording a match.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { setEntrySigner, signerFromSecret } from '../entrySigning';

const KEY = 'coaching-app.device-key.v1';

interface StoredKey {
  deviceId: string;
  secret: string;
}

function parse(raw: string | null): StoredKey | null {
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as Partial<StoredKey>;
    return typeof k.deviceId === 'string' && typeof k.secret === 'string' && k.secret.length === 64
      ? { deviceId: k.deviceId, secret: k.secret }
      : null;
  } catch {
    return null;
  }
}

/** Load this install's key, making it on first use, and install its signer. */
export async function installDeviceSigner(): Promise<boolean> {
  try {
    // A value the store cannot decrypt (an Android backup restored onto a new
    // phone, whose Keystore never held the key) reads as no key: this install
    // makes its own, and the old signatures still verify by the key in the chain.
    let key = parse(await SecureStore.getItemAsync(KEY).catch(() => null));
    if (!key) {
      const made: StoredKey = { deviceId: Crypto.randomUUID(), secret: bytesToHex(Crypto.getRandomBytes(32)) };
      const text = JSON.stringify(made);
      await SecureStore.setItemAsync(KEY, text);
      // Proved before use: a key that did not stick would sign entries no
      // later launch could ever sign again under the same device.
      if ((await SecureStore.getItemAsync(KEY)) !== text) throw new Error('key did not read back');
      key = made;
    }
    setEntrySigner(signerFromSecret(key.deviceId, hexToBytes(key.secret)));
    return true;
  } catch {
    setEntrySigner(null);
    return false;
  }
}
