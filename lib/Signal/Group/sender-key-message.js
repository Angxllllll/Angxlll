import { calculateSignature, verifySignature } from 'libsignal/src/curve.js'
import { proto } from '../../../WAProto/index.js'
import { CiphertextMessage } from './ciphertext-message.js'

export class SenderKeyMessage extends CiphertextMessage {
    constructor(keyId, iteration, ciphertext, signatureKey, serialized) {
        super()
        this.SIGNATURE_LENGTH = 64

        if (serialized) {
            const version = serialized[0]
            const message = serialized.subarray(1, serialized.length - this.SIGNATURE_LENGTH)
            const signature = serialized.subarray(serialized.length - this.SIGNATURE_LENGTH)

            const decoded = proto.SenderKeyMessage.decode(message)

            this.serialized = serialized
            this.messageVersion = (version & 0xff) >> 4
            this.keyId = decoded.id
            this.iteration = decoded.iteration
            this.ciphertext = Buffer.isBuffer(decoded.ciphertext)
                ? decoded.ciphertext
                : Buffer.from(decoded.ciphertext || [])
            this.signature = signature
        } else {
            const version = ((this.CURRENT_VERSION << 4) | this.CURRENT_VERSION) & 0xff
            const ciphertextBuffer = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext)

            const message = proto.SenderKeyMessage.encode(
                proto.SenderKeyMessage.create({
                    id: keyId,
                    iteration,
                    ciphertext: ciphertextBuffer
                })
            ).finish()

            const full = Buffer.concat([Buffer.from([version]), message])
            const signature = Buffer.from(calculateSignature(signatureKey, full))

            this.serialized = Buffer.concat([full, signature])
            this.messageVersion = this.CURRENT_VERSION
            this.keyId = keyId
            this.iteration = iteration
            this.ciphertext = ciphertextBuffer
            this.signature = signature
        }
    }

    getKeyId() {
        return this.keyId
    }

    getIteration() {
        return this.iteration
    }

    getCipherText() {
        return this.ciphertext
    }

    verifySignature(signatureKey) {
        const data = this.serialized.subarray(0, this.serialized.length - this.SIGNATURE_LENGTH)
        const sig = this.serialized.subarray(this.serialized.length - this.SIGNATURE_LENGTH)

        if (!verifySignature(signatureKey, data, sig)) {
            throw new Error('Invalid signature!')
        }
    }

    serialize() {
        return this.serialized
    }

    getType() {
        return 4
    }
}