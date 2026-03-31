import { deriveSecrets } from 'libsignal/src/crypto.js'

export class SenderMessageKey {
    constructor(iteration, seed) {
        const [d1, d2] = deriveSecrets(seed, Buffer.alloc(32), Buffer.from('WhisperGroup'))

        const iv = d1.subarray(0, 16)

        const cipherKey = Buffer.allocUnsafe(32)
        d1.copy(cipherKey, 0, 16, 32)
        d2.copy(cipherKey, 16, 0, 16)

        this.iv = iv
        this.cipherKey = cipherKey
        this.iteration = iteration
        this.seed = seed
    }

    getIteration() {
        return this.iteration
    }

    getIv() {
        return this.iv
    }

    getCipherKey() {
        return this.cipherKey
    }

    getSeed() {
        return this.seed
    }
}