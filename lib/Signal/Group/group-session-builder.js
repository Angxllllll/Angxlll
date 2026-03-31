import * as keyhelper from './keyhelper.js'
import { SenderKeyDistributionMessage } from './sender-key-distribution-message.js'
import { SenderKeyName } from './sender-key-name.js'
import { SenderKeyRecord } from './sender-key-record.js'

export class GroupSessionBuilder {
    constructor(senderKeyStore) {
        this.senderKeyStore = senderKeyStore
        this.cache = new Map()
    }

    async getRecord(senderKeyName) {
        const id = senderKeyName.toString()
        if (this.cache.has(id)) return this.cache.get(id)

        const record = await this.senderKeyStore.loadSenderKey(senderKeyName)
        this.cache.set(id, record)
        return record
    }

    async process(senderKeyName, senderKeyDistributionMessage) {
        const senderKeyRecord = await this.getRecord(senderKeyName)

        senderKeyRecord.addSenderKeyState(
            senderKeyDistributionMessage.getId(),
            senderKeyDistributionMessage.getIteration(),
            senderKeyDistributionMessage.getChainKey(),
            senderKeyDistributionMessage.getSignatureKey()
        )

        await this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord)
    }

    async create(senderKeyName) {
        const senderKeyRecord = await this.getRecord(senderKeyName)

        if (senderKeyRecord.isEmpty()) {
            const keyId = keyhelper.generateSenderKeyId()
            const senderKey = keyhelper.generateSenderKey()
            const signingKey = keyhelper.generateSenderSigningKey()

            senderKeyRecord.setSenderKeyState(keyId, 0, senderKey, signingKey)
            await this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord)
        }

        const state = senderKeyRecord.getSenderKeyState()
        if (!state) throw new Error('No session state available')

        return new SenderKeyDistributionMessage(
            state.getKeyId(),
            state.getSenderChainKey().getIteration(),
            state.getSenderChainKey().getSeed(),
            state.getSigningKeyPublic()
        )
    }
}