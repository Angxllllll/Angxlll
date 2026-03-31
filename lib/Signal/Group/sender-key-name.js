function hashCode(str) {
    let hash = 0
    if (str) {
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) | 0
        }
    }
    return hash
}

export class SenderKeyName {
    constructor(groupId, sender) {
        this.groupId = groupId
        this.sender = sender
    }

    getGroupId() {
        return this.groupId
    }

    getSender() {
        return this.sender
    }

    serialize() {
        return this.groupId + '::' + this.sender.id + '::' + this.sender.deviceId
    }

    toString() {
        return this.serialize()
    }

    equals(other) {
        return !!other &&
            this.groupId === other.groupId &&
            this.sender.toString() === other.sender.toString()
    }

    hashCode() {
        return hashCode(this.groupId) ^ hashCode(this.sender.toString())
    }
}