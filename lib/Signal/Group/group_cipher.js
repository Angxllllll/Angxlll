import { decrypt, encrypt } from 'libsignal/src/crypto.js'
import queueJob from './queue-job.js'
import { SenderKeyMessage } from './sender-key-message.js'
import { SenderKeyName } from './sender-key-name.js'
import { SenderKeyRecord } from './sender-key-record.js'
import { SenderKeyState } from './sender-key-state.js'

export class GroupCipher {
    constructor(senderKeyStore, senderKeyName) {
        this.senderKeyStore = senderKeyStore
        this.senderKeyName = senderKeyName
        this.cache = new Map()
    }

    queueJob(awaitable) {
        return queueJob(this.senderKeyName.toString(), awaitable)
    }

    async getRecord() {
        const id = this.senderKeyName.toString()
        if (this.cache.has(id)) return this.cache.get(id)

        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName)
        this.cache.set(id, record)
        return record
    }

    async encrypt(paddedPlaintext) {
        return this.queueJob(async () => {
            const record = await this.getRecord()
            if (!record) throw new Error('No SenderKeyRecord found for encryption')

            const senderKeyState = record.getSenderKeyState()
            if (!senderKeyState) throw new Error('No session to encrypt message')

            const iteration = senderKeyState.getSenderChainKey().getIteration()
            const senderKey = this.getSenderKey(senderKeyState, iteration === 0 ? 0 : iteration + 1)

            const ciphertext = await this.getCipherText(
                senderKey.getIv(),
                senderKey.getCipherKey(),
                paddedPlaintext
            )

            const senderKeyMessage = new SenderKeyMessage(
                senderKeyState.getKeyId(),
                senderKey.getIteration(),
                ciphertext,
                senderKeyState.getSigningKeyPrivate()
            )

            await this.senderKeyStore.storeSenderKey(this.senderKeyName, record)
            return senderKeyMessage.serialize()
        })
    }

    async decrypt(senderKeyMessageBytes) {
        return this.queueJob(async () => {
            const record = await this.getRecord()
            if (!record) throw new Error('No SenderKeyRecord found for decryption')

            const senderKeyMessage = new SenderKeyMessage(null, null, null, null, senderKeyMessageBytes)
            const senderKeyState = record.getSenderKeyState(senderKeyMessage.getKeyId())
            if (!senderKeyState) throw new Error('No session found to decrypt message')

            senderKeyMessage.verifySignature(senderKeyState.getSigningKeyPublic())

            const senderKey = this.getSenderKey(senderKeyState, senderKeyMessage.getIteration())

            const plaintext = await this.getPlainText(
                senderKey.getIv(),
                senderKey.getCipherKey(),
                senderKeyMessage.getCipherText()
            )

            await this.senderKeyStore.storeSenderKey(this.senderKeyName, record)
            return plaintext
        })
    }

    getSenderKey(senderKeyState, iteration) {
        let senderChainKey = senderKeyState.getSenderChainKey()

        if (senderChainKey.getIteration() > iteration) {
            if (senderKeyState.hasSenderMessageKey(iteration)) {
                const messageKey = senderKeyState.removeSenderMessageKey(iteration)
                if (!messageKey) throw new Error('No sender message key found for iteration')
                return messageKey
            }
            throw new Error(`Received message with old counter: ${senderChainKey.getIteration()}, ${iteration}`)
        }

        if (iteration - senderChainKey.getIteration() > 2000) {
            throw new Error('Over 2000 messages into the future!')
        }

        while (senderChainKey.getIteration() < iteration) {
            senderKeyState.addSenderMessageKey(senderChainKey.getSenderMessageKey())
            senderChainKey = senderChainKey.getNext()
        }

        senderKeyState.setSenderChainKey(senderChainKey.getNext())
        return senderChainKey.getSenderMessageKey()
    }

    async getPlainText(iv, key, ciphertext) {
        try {
            return decrypt(key, ciphertext, iv)
        } catch {
            throw new Error('InvalidMessageException')
        }
    }

    async getCipherText(iv, key, plaintext) {
        try {
            const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'base64')
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64')
            const plaintextBuffer = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)
            return encrypt(keyBuffer, plaintextBuffer, ivBuffer)
        } catch {
            throw new Error('InvalidMessageException')
        }
    }
}