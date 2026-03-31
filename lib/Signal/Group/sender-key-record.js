import { BufferJSON } from '../../Utils/generics.js'
import { SenderKeyState } from './sender-key-state.js'

export class SenderKeyRecord {
    constructor(serialized) {
        this.MAX_STATES = 5
        this.senderKeyStates = []
        this._map = new Map()

        if (serialized) {
            for (const structure of serialized) {
                const state = new SenderKeyState(null, null, null, null, null, null, structure)
                this.senderKeyStates.push(state)
                this._map.set(state.getKeyId(), state)
            }
        }
    }

    isEmpty() {
        return this.senderKeyStates.length === 0
    }

    getSenderKeyState(keyId) {
        if (keyId === undefined) {
            return this.senderKeyStates[this.senderKeyStates.length - 1]
        }
        return this._map.get(keyId)
    }

    addSenderKeyState(id, iteration, chainKey, signatureKey) {
        const state = new SenderKeyState(id, iteration, chainKey, null, signatureKey)

        this.senderKeyStates.push(state)
        this._map.set(id, state)

        if (this.senderKeyStates.length > this.MAX_STATES) {
            const removed = this.senderKeyStates.shift()
            if (removed) this._map.delete(removed.getKeyId())
        }
    }

    setSenderKeyState(id, iteration, chainKey, keyPair) {
        this.senderKeyStates.length = 0
        this._map.clear()

        const state = new SenderKeyState(id, iteration, chainKey, keyPair)
        this.senderKeyStates.push(state)
        this._map.set(id, state)
    }

    serialize() {
        return this.senderKeyStates.map(state => state.getStructure())
    }

    static deserialize(data) {
        let parsed

        if (typeof data === 'string') {
            parsed = JSON.parse(data, BufferJSON.reviver)
        } else if (data instanceof Uint8Array) {
            parsed = JSON.parse(Buffer.from(data).toString('utf-8'), BufferJSON.reviver)
        } else {
            parsed = data
        }

        return new SenderKeyRecord(parsed)
    }
}