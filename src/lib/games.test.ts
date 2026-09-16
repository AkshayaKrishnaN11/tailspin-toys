import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllCategories,
    getAllGameIds,
    getAllGames,
    getAllPublishers,
    getFilteredGames,
    getGameById,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

async function seedFilterFixtures(db: Database): Promise<void> {
    const [strategy] = await db.insert(categories).values({ name: 'Strategy', description: 'cat' }).returning({ id: categories.id });
    const [puzzle] = await db.insert(categories).values({ name: 'Puzzle', description: 'cat' }).returning({ id: categories.id });
    const [forge] = await db.insert(publishers).values({ name: 'CodeForge Studios', description: 'pub' }).returning({ id: publishers.id });
    const [devMasters] = await db.insert(publishers).values({ name: 'DevMasters Inc.', description: 'pub' }).returning({ id: publishers.id });

    await db.insert(games).values([
        {
            title: 'Alpha Tactics',
            description: 'A strategy game from CodeForge',
            starRating: 4.8,
            categoryId: strategy.id,
            publisherId: forge.id,
        },
        {
            title: 'Beta Puzzler',
            description: 'A puzzle game from CodeForge',
            starRating: 4.4,
            categoryId: puzzle.id,
            publisherId: forge.id,
        },
        {
            title: 'Gamma Tactics',
            description: 'Another strategy game from DevMasters',
            starRating: 4.2,
            categoryId: strategy.id,
            publisherId: devMasters.id,
        },
        {
            title: 'Delta Puzzler',
            description: 'A puzzle game from DevMasters',
            starRating: 3.8,
            categoryId: puzzle.id,
            publisherId: devMasters.id,
        },
    ]);
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('returns category and publisher options in name order', async () => {
        await seedFilterFixtures(db);
        const categoriesList = await getAllCategories(db);
        const publishersList = await getAllPublishers(db);

        expect(categoriesList.map((category) => category.name)).toEqual(['Puzzle', 'Strategy']);
        expect(publishersList.map((publisher) => publisher.name)).toEqual(['CodeForge Studios', 'DevMasters Inc.']);
    });

    it('filters games by category and publisher together', async () => {
        await seedFilterFixtures(db);
        const filtered = await getFilteredGames(db, {
            categoryIds: [1],
            publisherIds: [1],
        });

        expect(filtered.map((game) => game.title)).toEqual(['Alpha Tactics']);
        expect(filtered[0].category).toEqual({ id: 1, name: 'Strategy' });
        expect(filtered[0].publisher).toEqual({ id: 1, name: 'CodeForge Studios' });
    });

    it('returns an empty list when no matching game exists for the selected filters', async () => {
        await seedFilterFixtures(db);
        const filtered = await getFilteredGames(db, {
            categoryIds: [999],
            publisherIds: [999],
        });

        expect(filtered).toEqual([]);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
