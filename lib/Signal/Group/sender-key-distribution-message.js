import { proto } from '../../../WAProto/index.js'
import { CiphertextMessage } from './ciphertext-message.js'

export class SenderKeyDistributionMessage extends CiphertextMessage {
    constructor(id, iteration, chainKey, signatureKey, serialized) {
        super()

        if (serialized) {
            try {
                const message = serialized.subarray(1)
                const decoded = proto.SenderKeyDistributionMessage.decode(message)

                this.serialized = serialized
                this.id = decoded.id
                this.iteration = decoded.iteration
                this.chainKey = Buffer.isBuffer(decoded.chainKey)
                    ? decoded.chainKey
                    : Buffer.from(decoded.chainKey || [])
                this.signatureKey = Buffer.isBuffer(decoded.signingKey)
                    ? decoded.signingKey
                    : Buffer.from(decoded.signingKey || [])
            } catch (e) {
                throw new Error(String(e))
            }
        } else {
            const version = ((this.CURRENT_VERSION << 4) | this.CURRENT_VERSION) & 0xff

            this.id = id
            this.iteration = iteration
            this.chainKey = chainKey
            this.signatureKey = signatureKey

            const message = proto.SenderKeyDistributionMessage.encode(
                proto.SenderKeyDistributionMessage.create({
                    id,
                    iteration,
                    chainKey,
                    signingKey: signatureKey
                })
            ).finish()

            this.serialized = Buffer.concat([Buffer.from([version]), message])
        }
    }

    serialize() {
        return this.serialized
    }

    getType() {
        return this.SENDERKEY_DISTRIBUTION_TYPE
    }

    getIteration() {
        return this.iteration
    }

    getChainKey() {
        return this.chainKey
    }

    getSignatureKey() {
        return this.signatureKey
    }

    getId() {
        return this.id
    }
}