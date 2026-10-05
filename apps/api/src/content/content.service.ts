import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MissionDefinition } from '@zero-root/types';
import { sortMissions } from '@zero-root/mission-engine';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

/**
 * Loads mission content from `content/chapters/`.
 *
 * This service is the only holder of full mission definitions, flags included, and it lives
 * entirely server-side. Flags are deliberately *not* stored in the database: there is no row
 * that could leak one through an ORM query, an admin screen or a backup, and the only way to
 * learn a flag is to read the repository.
 *
 * Missions are data (CLAUDE.md rule 1), so this is also the seam that lets a new mission ship
 * as a file rather than a deployment of new code.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  private missions = new Map<string, MissionDefinition>();

  /**
   * Content loads in the constructor rather than in `onModuleInit`.
   *
   * Lifecycle hooks run in module-resolution order, and MissionRegistryService's hook fired
   * first — so the registry synced an empty content set and published nothing. Loading here
   * means any consumer sees loaded content however the hooks happen to be ordered. It is
   * synchronous file reading with no dependencies, so there is nothing to await.
   */
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.load();
  }

  load(): void {
    const chaptersDir = join(this.config.contentDir, 'chapters');
    const loaded = new Map<string, MissionDefinition>();

    if (!existsSync(chaptersDir)) {
      this.logger.warn(`No mission content found at ${chaptersDir}`);
      this.missions = loaded;
      return;
    }

    for (const chapterDir of readdirSync(chaptersDir)) {
      const dir = join(chaptersDir, chapterDir);
      if (!statSync(dir).isDirectory()) continue;

      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const mission = JSON.parse(readFileSync(join(dir, file), 'utf8')) as MissionDefinition;
        loaded.set(mission.id, mission);
      }
    }

    this.missions = loaded;
    this.logger.log(`Loaded ${loaded.size} mission(s) from ${chaptersDir}`);
  }

  all(): MissionDefinition[] {
    return sortMissions([...this.missions.values()]);
  }

  find(missionId: string): MissionDefinition | undefined {
    return this.missions.get(missionId);
  }

  /**
   * Validates a submitted flag.
   *
   * Comparison happens here and the result crosses the boundary as a boolean, so the flag
   * itself never travels any further than this method.
   */
  flagMatches(missionId: string, submitted: string): boolean {
    const expected = this.missions.get(missionId)?.flag;
    if (expected === undefined) return false;
    return submitted.trim() === expected;
  }

  chapters(): { chapter: number; title: string; missionCount: number }[] {
    const titles: Record<number, string> = {
      1: 'Computer',
      2: 'Network',
      3: 'Web',
    };
    const counts = new Map<number, number>();
    for (const mission of this.missions.values()) {
      counts.set(mission.chapter, (counts.get(mission.chapter) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([chapter, missionCount]) => ({
        chapter,
        title: titles[chapter] ?? `Chapter ${chapter}`,
        missionCount,
      }));
  }
}
