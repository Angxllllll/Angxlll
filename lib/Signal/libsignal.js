import * as libsignal from 'libsignal'
import { generateSignalPubKey } from '../Utils/index.js'
import { jidDecode } from '../WABinary/index.js'
import { SenderKeyName } from './Group/sender-key-name.js'
import { SenderKeyRecord } from './Group/sender-key-record.js'
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage } from './Group/index.js'

export function makeLibSignalRepository(auth) {
    const storage = signalStorage(auth)

    const senderKeyCache = new Map()
    const jidCache = new Map()

    const getSenderKey = async (id) => {
        if (senderKeyCache.has(id)) return senderKeyCache.get(id)
        const { [id]: key } = await auth.keys.get('sender-key', [id])
        if (key) {
            const value = SenderKeyRecord.deserialize(key)
            senderKeyCache.set(id, value)
            return value
        }
        const fresh = new SenderKeyRecord()
        senderKeyCache.set(id, fresh)
        return fresh
    }

    const jidToAddrCached = (jid) => {
        if (jidCache.has(jid)) return jidCache.get(jid)
        const { user, device } = jidDecode(jid)
        const addr = new libsignal.ProtocolAddress(user, device || 0)
        jidCache.set(jid, addr)
        return addr
    }

    return {
        decryptGroupMessage({ group, authorJid, msg }) {
            const senderName = new SenderKeyName(group, jidToAddrCached(authorJid))
            const cipher = new GroupCipher(storage, senderName)
            return cipher.decrypt(msg)
        },

        async processSenderKeyDistributionMessage({ item, authorJid }) {
            const builder = new GroupSessionBuilder(storage)
            if (!item.groupId) throw new Error('Group ID is required for sender key distribution message')

            const senderName = new SenderKeyName(item.groupId, jidToAddrCached(authorJid))
            const senderNameStr = senderName.toString()

            let senderKey = senderKeyCache.get(senderNameStr)
            if (!senderKey) {
                const { [senderNameStr]: key } = await auth.keys.get('sender-key', [senderNameStr])
                senderKey = key ? SenderKeyRecord.deserialize(key) : new SenderKeyRecord()
                senderKeyCache.set(senderNameStr, senderKey)
                if (!key) await storage.storeSenderKey(senderName, senderKey)
            }

            const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage)
            await builder.process(senderName, senderMsg)
        },

        async decryptMessage({ jid, type, ciphertext }) {
            const session = new libsignal.SessionCipher(storage, jidToAddrCached(jid))
            if (type === 'pkmsg') return session.decryptPreKeyWhisperMessage(ciphertext)
            if (type === 'msg') return session.decryptWhisperMessage(ciphertext)
            throw new Error(`Unknown message type: ${type}`)
        },

        async encryptMessage({ jid, data }) {
            const cipher = new libsignal.SessionCipher(storage, jidToAddrCached(jid))
            const { type: sigType, body } = await cipher.encrypt(data)
            return {
                type: sigType === 3 ? 'pkmsg' : 'msg',
                ciphertext: Buffer.from(body, 'binary')
            }
        },

        async encryptGroupMessage({ group, meId, data }) {
            const senderName = new SenderKeyName(group, jidToAddrCached(meId))
            const builder = new GroupSessionBuilder(storage)
            const senderNameStr = senderName.toString()

            let senderKey = senderKeyCache.get(senderNameStr)
            if (!senderKey) {
                const { [senderNameStr]: key } = await auth.keys.get('sender-key', [senderNameStr])
                senderKey = key ? SenderKeyRecord.deserialize(key) : new SenderKeyRecord()
                senderKeyCache.set(senderNameStr, senderKey)
                if (!key) await storage.storeSenderKey(senderName, senderKey)
            }

            const senderKeyDistributionMessage = await builder.create(senderName)
            const session = new GroupCipher(storage, senderName)
            const ciphertext = await session.encrypt(data)

            return {
                ciphertext,
                senderKeyDistributionMessage: senderKeyDistributionMessage.serialize()
            }
        },

        async injectE2ESession({ jid, session }) {
            const cipher = new libsignal.SessionBuilder(storage, jidToAddrCached(jid))
            await cipher.initOutgoing(session)
        },

        jidToSignalProtocolAddress(jid) {
            return jidToAddrCached(jid).toString()
        }
    }
}

function signalStorage({ creds, keys }) {
    const senderKeyCache = new Map()

    return {
        loadSession: async (id) => {
            const { [id]: sess } = await keys.get('session', [id])
            if (sess) return libsignal.SessionRecord.deserialize(sess)
        },

        storeSession: async (id, session) => {
            await keys.set({ session: { [id]: session.serialize() } })
        },

        isTrustedIdentity: () => true,

        loadPreKey: async (id) => {
            const keyId = id.toString()
            const { [keyId]: key } = await keys.get('pre-key', [keyId])
            if (key) {
                return {
                    privKey: Buffer.from(key.private),
                    pubKey: Buffer.from(key.public)
                }
            }
        },

        removePreKey: (id) => keys.set({ 'pre-key': { [id]: null } }),

        loadSignedPreKey: () => {
            const key = creds.signedPreKey
            return {
                privKey: Buffer.from(key.keyPair.private),
                pubKey: Buffer.from(key.keyPair.public)
            }
        },

        loadSenderKey: async (senderKeyName) => {
            const keyId = senderKeyName.toString()
            if (senderKeyCache.has(keyId)) return senderKeyCache.get(keyId)

            const { [keyId]: key } = await keys.get('sender-key', [keyId])
            const value = key ? SenderKeyRecord.deserialize(key) : new SenderKeyRecord()

            senderKeyCache.set(keyId, value)
            return value
        },

        storeSenderKey: async (senderKeyName, key) => {
            const keyId = senderKeyName.toString()
            const serialized = key.serialize()
            senderKeyCache.set(keyId, key)
            await keys.set({ 'sender-key': { [keyId]: serialized } })
        },

        getOurRegistrationId: () => creds.registrationId,

        getOurIdentity: () => {
            const { signedIdentityKey } = creds
            return {
                privKey: Buffer.from(signedIdentityKey.private),
                pubKey: generateSignalPubKey(signedIdentityKey.public)
            }
        }
    }
}