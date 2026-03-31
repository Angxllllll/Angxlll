import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js'
import { makeGroupsSocket } from './groups.js'

const makeWASocket = (config = {}) => {
  const newConfig = {
    ...DEFAULT_CONNECTION_CONFIG,
    ...config,
    shouldSyncHistoryMessage:
      config.shouldSyncHistoryMessage ??
      (() => !!config.syncFullHistory)
  }

  return makeGroupsSocket(newConfig)
}

export default makeWASocket