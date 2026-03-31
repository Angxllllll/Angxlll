import { calculateMAC } from 'libsignal/src/crypto.js'
import { SenderMessageKey } from './sender-message-key.js'

const MESSAGE_KEY_SEED = Buffer.from([0x01])
const CHAIN_KEY_SEED = Buffer.from([0x02])

export class SenderChainKey {
    constructor(iteration, chainKey) {
        this.iteration = iteration
        this.chainKey = Buffer.isBuffer(chainKey) ? chainKey : Buffer.from(chainKey || [])
    }

    getIteration() {
        return this.iteration
    }

    getSenderMessageKey() {
        return new SenderMessageKey(
            this.iteration,
            calculateMAC(this.chainKey, MESSAGE_KEY_SEED)
        )
    }

    getNext() {
        return new SenderChainKey(
            this.iteration + 1,
            calculateMAC(this.chainKey, CHAIN_KEY_SEED)
        )
    }

    getSeed() {
        return this.chainKey
    }
}