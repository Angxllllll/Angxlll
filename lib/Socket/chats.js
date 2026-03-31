import NodeCache from '@cacheable/node-cache'
import { Boom } from '@hapi/boom'
import { proto } from '../../WAProto/index.js'
import { DEFAULT_CACHE_TTLS, PROCESSABLE_HISTORY_TYPES } from '../Defaults/index.js'
import { ALL_WA_PATCH_NAMES } from '../Types/index.js'
import { SyncState } from '../Types/State.js'
import {
  chatModificationToAppPatch,
  decodePatches,
  decodeSyncdSnapshot,
  encodeSyncdPatch,
  extractSyncdPatches,
  generateProfilePicture,
  getHistoryMsg,
  newLTHashState,
  processSyncAction
} from '../Utils/index.js'
import { makeMutex } from '../Utils/make-mutex.js'
import processMessage from '../Utils/process-message.js'
import {
  getBinaryNodeChild,
  getBinaryNodeChildren,
  jidDecode,
  jidNormalizedUser,
  reduceBinaryNodeToDictionary,
  S_WHATSAPP_NET
} from '../WABinary/index.js'
import { USyncQuery, USyncUser } from '../WAUSync/index.js'
import { makeUSyncSocket } from './usync.js'

const MAX_SYNC_ATTEMPTS = 2

export const makeChatsSocket = (config) => {
  const {
    logger,
    markOnlineOnConnect,
    fireInitQueries,
    appStateMacVerification,
    shouldIgnoreJid,
    shouldSyncHistoryMessage
  } = config

  const sock = makeUSyncSocket(config)
  const { ev, ws, authState, generateMessageTag, sendNode, query, onUnexpectedError } = sock

  let privacySettings
  let syncState = SyncState.Connecting
  let awaitingSyncTimeout

  const processingMutex = makeMutex()

  const placeholderResendCache =
    config.placeholderResendCache ||
    new NodeCache({
      stdTTL: DEFAULT_CACHE_TTLS.MSG_RETRY,
      useClones: false
    })

  config.placeholderResendCache ||= placeholderResendCache

  const getAppStateSyncKey = async (keyId) => {
    const { [keyId]: key } = await authState.keys.get('app-state-sync-key', [keyId])
    return key
  }

  const privacyQuery = (name, value) =>
    query({
      tag: 'iq',
      attrs: {
        xmlns: 'privacy',
        to: S_WHATSAPP_NET,
        type: 'set'
      },
      content: [
        {
          tag: 'privacy',
          attrs: {},
          content: [
            {
              tag: 'category',
              attrs: { name, value }
            }
          ]
        }
      ]
    })

  const fetchPrivacySettings = async (force = false) => {
    if (!privacySettings || force) {
      const { content } = await query({
        tag: 'iq',
        attrs: {
          xmlns: 'privacy',
          to: S_WHATSAPP_NET,
          type: 'get'
        },
        content: [{ tag: 'privacy', attrs: {} }]
      })
      privacySettings = reduceBinaryNodeToDictionary(content?.[0], 'category')
    }
    return privacySettings
  }

  const sendPresenceUpdate = async (type, toJid) => {
    const me = authState.creds.me

    if (type === 'available' || type === 'unavailable') {
      if (!me?.name) return

      ev.emit('connection.update', { isOnline: type === 'available' })

      await sendNode({
        tag: 'presence',
        attrs: {
          name: me.name.replace(/@/g, ''),
          type
        }
      })
      return
    }

    const { server } = jidDecode(toJid)
    const isLid = server === 'lid'

    await sendNode({
      tag: 'chatstate',
      attrs: {
        from: isLid ? me.lid : me.id,
        to: toJid
      },
      content: [
        {
          tag: type === 'recording' ? 'composing' : type,
          attrs: type === 'recording' ? { media: 'audio' } : {}
        }
      ]
    })
  }

  const resyncAppState = ev.createBufferedFunction(async (collections, isInitialSync) => {
    const initialVersionMap = {}
    const globalMutationMap = {}

    await authState.keys.transaction(async () => {
      const collectionsToHandle = new Set(collections)
      const attemptsMap = {}

      while (collectionsToHandle.size) {
        const states = {}
        const nodes = []

        for (const name of collectionsToHandle) {
          const result = await authState.keys.get('app-state-sync-version', [name])
          let state = result[name] || newLTHashState()

          states[name] = state

          nodes.push({
            tag: 'collection',
            attrs: {
              name,
              version: state.version.toString(),
              return_snapshot: (!state.version).toString()
            }
          })
        }

        const result = await query({
          tag: 'iq',
          attrs: {
            to: S_WHATSAPP_NET,
            xmlns: 'w:sync:app:state',
            type: 'set'
          },
          content: [{ tag: 'sync', attrs: {}, content: nodes }]
        })

        const decoded = await extractSyncdPatches(result, config?.options)

        for (const key in decoded) {
          const { patches, hasMorePatches, snapshot } = decoded[key]

          try {
            if (snapshot) {
              const { state, mutationMap } = await decodeSyncdSnapshot(
                key,
                snapshot,
                getAppStateSyncKey,
                initialVersionMap[key],
                appStateMacVerification.snapshot
              )

              states[key] = state
              Object.assign(globalMutationMap, mutationMap)

              await authState.keys.set({ 'app-state-sync-version': { [key]: state } })
            }

            if (patches.length) {
              const { state, mutationMap } = await decodePatches(
                key,
                patches,
                states[key],
                getAppStateSyncKey,
                config.options,
                initialVersionMap[key],
                logger,
                appStateMacVerification.patch
              )

              await authState.keys.set({ 'app-state-sync-version': { [key]: state } })

              Object.assign(globalMutationMap, mutationMap)
              initialVersionMap[key] = state.version
            }

            if (!hasMorePatches) collectionsToHandle.delete(key)
          } catch {
            attemptsMap[key] = (attemptsMap[key] || 0) + 1

            if (attemptsMap[key] >= MAX_SYNC_ATTEMPTS) {
              collectionsToHandle.delete(key)
            } else {
              await authState.keys.set({ 'app-state-sync-version': { [key]: null } })
            }
          }
        }
      }
    })

    const handler = (mutation) =>
      processSyncAction(
        mutation,
        ev,
        authState.creds.me,
        isInitialSync ? { accountSettings: authState.creds.accountSettings } : undefined,
        logger
      )

    for (const key in globalMutationMap) handler(globalMutationMap[key])
  })

  const upsertMessage = ev.createBufferedFunction(async (msg, type) => {
    ev.emit('messages.upsert', { messages: [msg], type })

    const historyMsg = getHistoryMsg(msg.message)
    const shouldProcessHistoryMsg =
      historyMsg &&
      shouldSyncHistoryMessage(historyMsg) &&
      PROCESSABLE_HISTORY_TYPES.includes(historyMsg.syncType)

    const doAppStateSync = async () => {
      if (syncState === SyncState.Syncing) {
        await resyncAppState(ALL_WA_PATCH_NAMES, true)
        syncState = SyncState.Online
        ev.flush()
      }
    }

    await Promise.all([
      shouldProcessHistoryMsg ? doAppStateSync() : null,
      processMessage(msg, {
        shouldProcessHistoryMsg,
        placeholderResendCache,
        ev,
        creds: authState.creds,
        keyStore: authState.keys,
        logger,
        options: config.options
      })
    ])
  })

  ws.on('CB:presence', () => {})
  ws.on('CB:chatstate', () => {})

  return {
    ...sock,
    processingMutex,
    fetchPrivacySettings,
    upsertMessage,
    resyncAppState,
    sendPresenceUpdate
  }
}