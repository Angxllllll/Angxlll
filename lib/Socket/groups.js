import { proto } from '../../WAProto/index.js'
import { WAMessageStubType } from '../Types/index.js'
import { generateMessageIDV2, unixTimestampSeconds } from '../Utils/index.js'
import {
  getBinaryNodeChild,
  getBinaryNodeChildren,
  getBinaryNodeChildString,
  isJidUser,
  isLidUser,
  jidEncode,
  jidNormalizedUser
} from '../WABinary/index.js'
import { makeChatsSocket } from './chats.js'

export const makeGroupsSocket = (config) => {
  const sock = makeChatsSocket(config)
  const { authState, ev, query, upsertMessage } = sock

  const groupQuery = (jid, type, content) =>
    query({
      tag: 'iq',
      attrs: { type, xmlns: 'w:g2', to: jid },
      content
    })

  const groupMetadata = async (jid) => {
    const res = await groupQuery(jid, 'get', [{ tag: 'query', attrs: { request: 'interactive' } }])
    return extractGroupMetadata(res)
  }

  const groupFetchAllParticipating = async () => {
    const res = await query({
      tag: 'iq',
      attrs: { to: '@g.us', xmlns: 'w:g2', type: 'get' },
      content: [{
        tag: 'participating',
        attrs: {},
        content: [
          { tag: 'participants', attrs: {} },
          { tag: 'description', attrs: {} }
        ]
      }]
    })

    const groupsNode = getBinaryNodeChild(res, 'groups')
    const data = {}

    if (groupsNode) {
      for (const node of getBinaryNodeChildren(groupsNode, 'group')) {
        const meta = extractGroupMetadata({ tag: 'result', attrs: {}, content: [node] })
        data[meta.id] = meta
      }
    }

    ev.emit('groups.update', Object.values(data))
    return data
  }

  sock.ws.on('CB:ib,,dirty', async (node) => {
    const { attrs } = getBinaryNodeChild(node, 'dirty')
    if (attrs.type === 'groups') {
      await groupFetchAllParticipating()
      await sock.cleanDirtyBits('groups')
    }
  })

  return {
    ...sock,

    groupMetadata,

    groupCreate: async (subject, participants) => {
      const res = await groupQuery('@g.us', 'set', [{
        tag: 'create',
        attrs: { subject, key: generateMessageIDV2() },
        content: participants.map(jid => ({ tag: 'participant', attrs: { jid } }))
      }])
      return extractGroupMetadata(res)
    },

    groupLeave: (id) =>
      groupQuery('@g.us', 'set', [{
        tag: 'leave',
        attrs: {},
        content: [{ tag: 'group', attrs: { id } }]
      }]),

    groupUpdateSubject: (jid, subject) =>
      groupQuery(jid, 'set', [{
        tag: 'subject',
        attrs: {},
        content: Buffer.from(subject, 'utf-8')
      }]),

    groupRequestParticipantsList: async (jid) => {
      const res = await groupQuery(jid, 'get', [{ tag: 'membership_approval_requests', attrs: {} }])
      return getBinaryNodeChildren(
        getBinaryNodeChild(res, 'membership_approval_requests'),
        'membership_approval_request'
      ).map(v => v.attrs)
    },

    groupRequestParticipantsUpdate: async (jid, participants, action) => {
      const res = await groupQuery(jid, 'set', [{
        tag: 'membership_requests_action',
        attrs: {},
        content: [{
          tag: action,
          attrs: {},
          content: participants.map(jid => ({ tag: 'participant', attrs: { jid } }))
        }]
      }])

      const node = getBinaryNodeChild(getBinaryNodeChild(res, 'membership_requests_action'), action)
      return getBinaryNodeChildren(node, 'participant').map(p => ({
        status: p.attrs.error || '200',
        jid: p.attrs.jid
      }))
    },

    groupParticipantsUpdate: async (jid, participants, action) => {
      const res = await groupQuery(jid, 'set', [{
        tag: action,
        attrs: {},
        content: participants.map(jid => ({ tag: 'participant', attrs: { jid } }))
      }])

      return getBinaryNodeChildren(getBinaryNodeChild(res, action), 'participant').map(p => ({
        status: p.attrs.error || '200',
        jid: p.attrs.jid,
        content: p
      }))
    },

    groupUpdateDescription: async (jid, description) => {
      const { descId } = await groupMetadata(jid)

      await groupQuery(jid, 'set', [{
        tag: 'description',
        attrs: {
          ...(description ? { id: generateMessageIDV2() } : { delete: 'true' }),
          ...(descId ? { prev: descId } : {})
        },
        content: description
          ? [{ tag: 'body', attrs: {}, content: Buffer.from(description, 'utf-8') }]
          : undefined
      }])
    },

    groupInviteCode: async (jid) =>
      getBinaryNodeChild(await groupQuery(jid, 'get', [{ tag: 'invite', attrs: {} }]), 'invite')?.attrs.code,

    groupRevokeInvite: async (jid) =>
      getBinaryNodeChild(await groupQuery(jid, 'set', [{ tag: 'invite', attrs: {} }]), 'invite')?.attrs.code,

    groupAcceptInvite: async (code) =>
      getBinaryNodeChild(await groupQuery('@g.us', 'set', [{ tag: 'invite', attrs: { code } }]), 'group')?.attrs.jid,

    groupRevokeInviteV4: async (groupJid, invitedJid) =>
      !!(await groupQuery(groupJid, 'set', [
        { tag: 'revoke', attrs: {}, content: [{ tag: 'participant', attrs: { jid: invitedJid } }] }
      ])),

    groupAcceptInviteV4: ev.createBufferedFunction(async (key, inviteMessage) => {
      key = typeof key === 'string' ? { remoteJid: key } : key

      const res = await groupQuery(inviteMessage.groupJid, 'set', [{
        tag: 'accept',
        attrs: {
          code: inviteMessage.inviteCode,
          expiration: inviteMessage.inviteExpiration.toString(),
          admin: key.remoteJid
        }
      }])

      if (key.id) {
        inviteMessage = proto.Message.GroupInviteMessage.fromObject(inviteMessage)
        inviteMessage.inviteExpiration = 0
        inviteMessage.inviteCode = ''

        ev.emit('messages.update', [{
          key,
          update: { message: { groupInviteMessage: inviteMessage } }
        }])
      }

      await upsertMessage({
        key: {
          remoteJid: inviteMessage.groupJid,
          id: generateMessageIDV2(sock.user?.id),
          fromMe: false,
          participant: key.remoteJid
        },
        messageStubType: WAMessageStubType.GROUP_PARTICIPANT_ADD,
        messageStubParameters: [authState.creds.me.id],
        participant: key.remoteJid,
        messageTimestamp: unixTimestampSeconds()
      }, 'notify')

      return res.attrs.from
    }),

    groupGetInviteInfo: async (code) =>
      extractGroupMetadata(await groupQuery('@g.us', 'get', [{ tag: 'invite', attrs: { code } }])),

    groupToggleEphemeral: (jid, exp) =>
      groupQuery(jid, 'set', [exp
        ? { tag: 'ephemeral', attrs: { expiration: exp.toString() } }
        : { tag: 'not_ephemeral', attrs: {} }
      ]),

    groupSettingUpdate: (jid, setting) =>
      groupQuery(jid, 'set', [{ tag: setting, attrs: {} }]),

    groupMemberAddMode: (jid, mode) =>
      groupQuery(jid, 'set', [{ tag: 'member_add_mode', attrs: {}, content: mode }]),

    groupJoinApprovalMode: (jid, mode) =>
      groupQuery(jid, 'set', [{
        tag: 'membership_approval_mode',
        attrs: {},
        content: [{ tag: 'group_join', attrs: { state: mode } }]
      }]),

    groupFetchAllParticipating
  }
}