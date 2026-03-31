const _queueAsyncBuckets = new Map()
const _gcLimit = 10000

async function _asyncQueueExecutor(queue, cleanup) {
    let index = 0

    while (index < queue.length) {
        const job = queue[index++]

        try {
            job.resolve(await job.awaitable())
        } catch (e) {
            job.reject(e)
        }

        if (index >= _gcLimit) {
            queue.splice(0, index)
            index = 0
        }
    }

    cleanup()
}

export default function queueJob(bucket, awaitable) {
    let queue = _queueAsyncBuckets.get(bucket)
    let inactive = false

    if (!queue) {
        queue = []
        _queueAsyncBuckets.set(bucket, queue)
        inactive = true
    }

    const job = new Promise((resolve, reject) => {
        queue.push({ awaitable, resolve, reject })
    })

    if (inactive) {
        _asyncQueueExecutor(queue, () => _queueAsyncBuckets.delete(bucket))
    }

    return job
}