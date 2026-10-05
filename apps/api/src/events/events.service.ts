import { Injectable } from '@nestjs/common';
import type { GameEvent, GameEventType } from '@zero-root/types';
import { PrismaService } from '../prisma/prisma.service';

/** Everything an event needs beyond what the server already knows. */
export type EventPayload = Record<string, unknown>;

/**
 * The recorded event stream.
 *
 * Append-only, and **server-authored**: callers pass the facts the server has established —
 * a command the gateway saw, the verdict of a flag comparison the server performed — never a
 * claim the client made about its own progress. There is deliberately no method to update or
 * delete an event, because the stream is also the audit trail (CLAUDE.md rule 3).
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    userId: string,
    missionId: string,
    type: GameEventType,
    payload: EventPayload = {},
    sessionId?: string,
  ): Promise<void> {
    await this.prisma.labEvent.create({
      data: {
        userId,
        missionId,
        type,
        payload: payload as object,
        sessionId: sessionId ?? null,
      },
    });
  }

  /** Rehydrates the stream for one mission, oldest first, as the engine expects it. */
  async stream(userId: string, missionId: string): Promise<GameEvent[]> {
    const rows = await this.prisma.labEvent.findMany({
      where: { userId, missionId },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map(
      (row) =>
        ({
          ...(row.payload as object),
          type: row.type,
          sessionId: row.sessionId ?? '',
          missionId: row.missionId,
          timestamp: row.createdAt.toISOString(),
        }) as GameEvent,
    );
  }

  async countFor(userId: string, missionId: string, type: GameEventType): Promise<number> {
    return this.prisma.labEvent.count({ where: { userId, missionId, type } });
  }
}
