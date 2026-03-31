import NodeCache from '@cacheable/node-cache'
import { Boom } from '@hapi/boom'
import { randomBytes } from 'crypto'
import Long from 'long'
import { proto } from '../../WAProto/index.js'
import {
DEFAULT_CACHE_TTLS,
KEY_BUNDLE_TYPE,
MIN_PREKEY_COUNT
} from '../Defaults/index.js'
import {
WAMessageStatus,
WAMessageStubType
} from '../Types/index.js'
import {
aesDecryptCTR,
aesEncryptGCM,
cleanMessage,
Curve,
decodeMediaRetryNode,
decodeMessageNode,
decryptMessageNode,
delay,
derivePairingCodeKey,
encodeBigEndian,
encodeSignedDeviceIdentity,
getCallStatusFromNode,
getHistoryMsg,
getNextPreKeys,
getStatusFromReceiptType,
hkdf,
MISSING_KEYS_ERROR_TEXT,
NACK_REASONS,
NO_MESSAGE_FOUND_ERROR_TEXT,
unixTimestampSeconds,
xmppPreKey,
xmppSignedPreKey
} from '../Utils/index.js'
import { makeMutex } from '../Utils/make-mutex.js'
import {
areJidsSameUser,
getAllBinaryNodeChildren,
getBinaryNodeChild,
getBinaryNodeChildBuffer,
getBinaryNodeChildren,
getBinaryNodeChildString,
isJidGroup,
isJidStatusBroadcast,
isJidUser,
isLidUser,
jidDecode,
jidNormalizedUser,
S_WHATSAPP_NET
} from '../WABinary/index.js'
import { extractGroupMetadata } from './groups.js'
import { makeMessagesSocket } from './messages-send.js'

export const makeMessagesRecvSocket = (config) => {
const {
logger,
retryRequestDelayMs,
maxMsgRetryCount,
getMessage,
shouldIgnoreJid
} = config

const sock = makeMessagesSocket(config)

const {
ev,
authState,
ws,
processingMutex,
signalRepository,
query,
upsertMessage,
resyncAppState,
onUnexpectedError,
assertSessions,
sendNode,
relayMessage,
sendReceipt,
uploadPreKeys,
sendPeerDataOperationMessage
} = sock

const retryMutex = makeMutex()

const msgRetryCache = config.msgRetryCounterCache || new NodeCache({
stdTTL: DEFAULT_CACHE_TTLS.MSG_RETRY,
useClones: false
})

const callOfferCache = config.callOfferCache || new NodeCache({
stdTTL: DEFAULT_CACHE_TTLS.CALL_OFFER,
useClones: false
})

const placeholderResendCache = config.placeholderResendCache || new NodeCache({
stdTTL: DEFAULT_CACHE_TTLS.MSG_RETRY,
useClones: false
})

let sendActiveReceipts = false

const sendMessageAck = async (node, errorCode) => {
const { tag, attrs } = node

const stanza = {
tag: 'ack',
attrs: {
id: attrs.id,
to: attrs.from,
class: tag
}
}

if (errorCode) stanza.attrs.error = errorCode.toString()
if (attrs.participant) stanza.attrs.participant = attrs.participant
if (attrs.recipient) stanza.attrs.recipient = attrs.recipient
if (attrs.type) stanza.attrs.type = attrs.type

await sendNode(stanza)
}

const rejectCall = async (callId, callFrom) => {
await query({
tag: 'call',
attrs: {
from: authState.creds.me.id,
to: callFrom
},
content: [{
tag: 'reject',
attrs: {
'call-id': callId,
'call-creator': callFrom,
count: '0'
}
}]
})
}
const sendRetryRequest = async (node, forceIncludeKeys = false) => {
const { fullMessage } = decodeMessageNode(node, authState.creds.me.id, authState.creds.me.lid || '')
const { key: msgKey } = fullMessage

const msgId = msgKey.id
const participant = msgKey.participant || ''
const cacheKey = msgId + ':' + participant

let retryCount = msgRetryCache.get(cacheKey) || 0

if (retryCount >= maxMsgRetryCount) {
msgRetryCache.del(cacheKey)
return
}

retryCount++
msgRetryCache.set(cacheKey, retryCount)

const { account, signedPreKey, signedIdentityKey: identityKey } = authState.creds

const deviceIdentity = encodeSignedDeviceIdentity(account, true)

await authState.keys.transaction(async () => {
const receipt = {
tag: 'receipt',
attrs: {
id: msgId,
type: 'retry',
to: node.attrs.from
},
content: [
{
tag: 'retry',
attrs: {
count: retryCount.toString(),
id: node.attrs.id,
t: node.attrs.t,
v: '1'
}
},
{
tag: 'registration',
content: encodeBigEndian(authState.creds.registrationId)
}
]
}

if (retryCount > 1 || forceIncludeKeys) {
const { update, preKeys } = await getNextPreKeys(authState, 1)
const keyId = Object.keys(preKeys)[0]
const key = preKeys[keyId]

receipt.content.push({
tag: 'keys',
content: [
{ tag: 'type', content: Buffer.from(KEY_BUNDLE_TYPE) },
{ tag: 'identity', content: identityKey.public },
xmppPreKey(key, +keyId),
xmppSignedPreKey(signedPreKey),
{ tag: 'device-identity', content: deviceIdentity }
]
})

ev.emit('creds.update', update)
}

await sendNode(receipt)
})
}

const handleMessage = async (node) => {
const from = node.attrs.from

if (shouldIgnoreJid(from) && from !== '@s.whatsapp.net') {
await sendMessageAck(node)
return
}

const encNode = getBinaryNodeChild(node, 'enc')
const unavailableNode = getBinaryNodeChild(node, 'unavailable')

if (encNode && encNode.attrs.type === 'msmsg') {
await sendMessageAck(node)
return
}

if (unavailableNode && !encNode) {
await sendMessageAck(node)
const { key } = decodeMessageNode(node, authState.creds.me.id, authState.creds.me.lid || '').fullMessage
await requestPlaceholderResend(key)
return
}

const { fullMessage: msg, decrypt } = decryptMessageNode(
node,
authState.creds.me.id,
authState.creds.me.lid || '',
signalRepository,
logger
)

await processingMutex.mutex(async () => {
await decrypt()

if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
await retryMutex.mutex(async () => {
if (ws.isOpen) {
await sendRetryRequest(node, !encNode)
if (retryRequestDelayMs) await delay(retryRequestDelayMs)
}
})
return
}

let type
let participant = msg.key.participant

if (msg.key.fromMe) {
type = 'sender'
} else if (!sendActiveReceipts) {
type = 'inactive'
}

await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type)

cleanMessage(msg, authState.creds.me.id)

await upsertMessage(msg, node.attrs.offline ? 'append' : 'notify')
})

await sendMessageAck(node)
}

ws.on('CB:message', async (node) => {
await handleMessage(node)
})

ws.on('CB:receipt', async (node) => {
await sendMessageAck(node)
})

ws.on('CB:notification', async (node) => {
await sendMessageAck(node)
})

ws.on('CB:call', async (node) => {
await sendMessageAck(node)
})

return {
...sock,
sendMessageAck,
sendRetryRequest,
rejectCall
}
}