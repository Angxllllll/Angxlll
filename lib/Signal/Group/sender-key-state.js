import { SenderChainKey } from './sender-chain-key.js'
import { SenderMessageKey } from './sender-message-key.js'

export class SenderKeyState {
    constructor(id, iteration, chainKey, signatureKeyPair, signatureKeyPublic, signatureKeyPrivate, structure) {
        this.MAX_MESSAGE_KEYS = 2000
        this._map = new Map()

        if (structure) {
            this.senderKeyStateStructure = {
                ...structure,
                senderMessageKeys: Array.isArray(structure.senderMessageKeys) ? structure.senderMessageKeys : []
            }

            for (const k of this.senderKeyStateStructure.senderMessageKeys) {
                this._map.set(k.iteration, k)
            }
        } else {
            if (signatureKeyPair) {
                signatureKeyPublic = signatureKeyPair.public
                signatureKeyPrivate = signatureKeyPair.private
            }

            const seed = Buffer.isBuffer(chainKey) ? chainKey : Buffer.from(chainKey || [])

            this.senderKeyStateStructure = {
                senderKeyId: id || 0,
                senderChainKey: {
                    iteration: iteration || 0,
                    seed
                },
                senderSigningKey: {
                    public: Buffer.isBuffer(signatureKeyPublic) ? signatureKeyPublic : Buffer.from(signatureKeyPublic || []),
                    private: signatureKeyPrivate
                        ? Buffer.isBuffer(signatureKeyPrivate)
                            ? signatureKeyPrivate
                            : Buffer.from(signatureKeyPrivate)
                        : undefined
                },
                senderMessageKeys: []
            }
        }
    }

    getKeyId() {
        return this.senderKeyStateStructure.senderKeyId
    }

    getSenderChainKey() {
        const { iteration, seed } = this.senderKeyStateStructure.senderChainKey
        return new SenderChainKey(iteration, seed)
    }

    setSenderChainKey(chainKey) {
        this.senderKeyStateStructure.senderChainKey = {
            iteration: chainKey.getIteration(),
            seed: chainKey.getSeed()
        }
    }

    getSigningKeyPublic() {
        return Buffer.isBuffer(this.senderKeyStateStructure.senderSigningKey.public)
            ? this.senderKeyStateStructure.senderSigningKey.public
            : Buffer.from(this.senderKeyStateStructure.senderSigningKey.public || [])
    }

    getSigningKeyPrivate() {
        const key = this.senderKeyStateStructure.senderSigningKey.private
        if (!key) return undefined
        return Buffer.isBuffer(key) ? key : Buffer.from(key)
    }

    hasSenderMessageKey(iteration) {
        return this._map.has(iteration)
    }

    addSenderMessageKey(senderMessageKey) {
        const entry = {
            iteration: senderMessageKey.getIteration(),
            seed: senderMessageKey.getSeed()
        }

        this.senderKeyStateStructure.senderMessageKeys.push(entry)
        this._map.set(entry.iteration, entry)

        if (this.senderKeyStateStructure.senderMessageKeys.length > this.MAX_MESSAGE_KEYS) {
            const removed = this.senderKeyStateStructure.senderMessageKeys.shift()
            if (removed) this._map.delete(removed.iteration)
        }
    }

    removeSenderMessageKey(iteration) {
        const entry = this._map.get(iteration)
        if (!entry) return null

        this._map.delete(iteration)

        const index = this.senderKeyStateStructure.senderMessageKeys.findIndex(k => k.iteration === iteration)
        if (index !== -1) {
            this.senderKeyStateStructure.senderMessageKeys.splice(index, 1)
        }

        return new SenderMessageKey(entry.iteration, entry.seed)
    }

    getStructure() {
        return this.senderKeyStateStructure
    }
}