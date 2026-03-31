import WebSocket from 'ws'
import { DEFAULT_ORIGIN } from '../../Defaults/index.js'
import { AbstractSocketClient } from './types.js'

export class WebSocketClient extends AbstractSocketClient {
    constructor(url, config) {
        super(url, config)
        this.socket = null
    }

    get isOpen() {
        return this.socket?.readyState === WebSocket.OPEN
    }

    get isClosed() {
        return !this.socket || this.socket.readyState === WebSocket.CLOSED
    }

    get isClosing() {
        return !this.socket || this.socket.readyState === WebSocket.CLOSING
    }

    get isConnecting() {
        return this.socket?.readyState === WebSocket.CONNECTING
    }

    connect() {
        if (this.socket && !this.isClosed) return

        const ws = new WebSocket(this.url, {
            origin: DEFAULT_ORIGIN,
            headers: this.config.options?.headers,
            handshakeTimeout: this.config.connectTimeoutMs,
            timeout: this.config.connectTimeoutMs,
            agent: this.config.agent
        })

        ws.setMaxListeners(0)

        const forward = (event) => (...args) => this.emit(event, ...args)

        ws.on('open', forward('open'))
        ws.on('message', forward('message'))
        ws.on('close', (...args) => {
            this.cleanup()
            this.emit('close', ...args)
        })
        ws.on('error', (...args) => {
            this.emit('error', ...args)
        })
        ws.on('ping', forward('ping'))
        ws.on('pong', forward('pong'))
        ws.on('upgrade', forward('upgrade'))
        ws.on('unexpected-response', forward('unexpected-response'))

        this.socket = ws
    }

    cleanup() {
        if (!this.socket) return

        this.socket.removeAllListeners()
        this.socket = null
    }

    close() {
        if (!this.socket) return

        try {
            this.socket.close()
        } catch {}

        this.cleanup()
    }

    send(data, cb) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false
        }

        try {
            this.socket.send(data, cb)
            return true
        } catch {
            return false
        }
    }
}