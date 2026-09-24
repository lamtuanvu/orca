import { randomUUID } from 'node:crypto'
import {
  pluginReviewSchema,
  pluginOpenReviewSchema,
  pluginReviewContentsSchema,
  type PluginReview,
  type PluginOpenReviewInput,
  type PluginOpenedReview,
  type PluginReviewContents
} from '../../shared/plugins/plugin-review-contract'

type Session = {
  owner: string
  plugin: string
  generation: string
  review: PluginReview
  command: string
  pending: number
}
type Services = {
  generation(plugin: string): string | null
  resolveProvider(
    plugin: string,
    provider: string,
    args: unknown
  ): {
    snapshotCommand: string
    contentCommand: string
    args: unknown
  }
  invoke(plugin: string, command: string, args: unknown): Promise<unknown>
}

export class PluginReviewSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly owners = new Map<string, number>()
  constructor(private readonly services: Services) {}

  async open(
    owner: string,
    plugin: string,
    input: PluginOpenReviewInput
  ): Promise<PluginOpenedReview> {
    const generation = this.services.generation(plugin)
    if (!generation) {
      throw new Error('Review unavailable')
    }
    const request = pluginOpenReviewSchema.parse(input)
    const provider = this.services.resolveProvider(plugin, request.providerId, request.args)
    const epoch = this.owners.get(owner) ?? 0
    this.owners.set(owner, epoch)
    const review = pluginReviewSchema.parse(
      await this.services.invoke(plugin, provider.snapshotCommand, provider.args)
    )
    if (
      epoch !== (this.owners.get(owner) ?? 0) ||
      this.services.generation(plugin) !== generation
    ) {
      throw new Error('Review unavailable')
    }
    if ([...this.sessions.values()].filter((session) => session.owner === owner).length >= 10) {
      throw new Error('Close an existing review first')
    }
    const reviewId = randomUUID()
    this.sessions.set(reviewId, {
      owner,
      plugin,
      generation,
      review,
      command: provider.contentCommand,
      pending: 0
    })
    return { reviewId, review }
  }

  private resolve(owner: string, id: string): Session {
    const session = this.sessions.get(id)
    if (
      !session ||
      session.owner !== owner ||
      this.services.generation(session.plugin) !== session.generation
    ) {
      throw new Error('Review unavailable')
    }
    return session
  }

  async read(owner: string, id: string, index: number): Promise<PluginReviewContents> {
    const session = this.resolve(owner, id)
    const file = Number.isInteger(index) && index >= 0 ? session.review.files[index] : undefined
    if (!file) {
      throw new Error('Unknown review file')
    }
    if (session.pending >= 4) {
      throw new Error('Too many concurrent file requests')
    }
    session.pending++
    try {
      const contents = pluginReviewContentsSchema.parse(
        await this.services.invoke(session.plugin, session.command, {
          context: session.review.context,
          file
        })
      )
      if (this.resolve(owner, id) !== session) {
        throw new Error('Review unavailable')
      }
      return contents
    } finally {
      session.pending--
    }
  }

  close(owner: string, id: string): void {
    if (this.sessions.get(id)?.owner === owner) {
      this.sessions.delete(id)
    }
  }
  revokeOwner(owner: string): void {
    this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1)
    for (const [id, session] of this.sessions) {
      if (session.owner === owner) {
        this.sessions.delete(id)
      }
    }
  }
  clear(): void {
    for (const owner of this.owners.keys()) {
      this.revokeOwner(owner)
    }
    for (const session of this.sessions.values()) {
      this.revokeOwner(session.owner)
    }
    this.sessions.clear()
  }
}
