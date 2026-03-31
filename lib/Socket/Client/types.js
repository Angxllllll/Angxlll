import { EventEmitter } from 'events'

export class AbstractSocketClient extends EventEmitter {
    constructor(url, config = {}) {
        super()

        this.url = typeof url === 'string' ? url : url?.toString()
        this.config = config

        this.setMaxListeners(0)
    }

    emitSafe(event, ...args) {
        try {
            this.emit(event, ...args)
        } catch {}
    }
}