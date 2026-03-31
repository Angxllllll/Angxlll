import * as nodeCrypto from 'crypto'
import { generateKeyPair } from 'libsignal/src/curve.js'

export function generateSenderKey() {
    return nodeCrypto.randomBytes(32)
}

export function generateSenderKeyId() {
    return nodeCrypto.randomInt(0x7fffffff)
}

export function generateSenderSigningKey(key) {
    const pair = key || generateKeyPair()
    return {
        public: Buffer.from(pair.pubKey),
        private: Buffer.from(pair.privKey)
    }
}