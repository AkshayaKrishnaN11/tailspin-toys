import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Category, Game, Publisher } from '../types/game';

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

export type GameFilters = {
    categoryIds?: number[];
    publisherIds?: number[];
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function normalizeIds(ids: number[] | undefined): number[] {
    const uniqueValues = new Set<number>();

    for (const id of ids ?? []) {
        if (Number.isInteger(id) && id > 0) {
            uniqueValues.add(id);
        }
    }

    return [...uniqueValues].sort((left, right) => left - right);
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

/** Get all categories ordered by name for filter controls. */
export async function getAllCategories(db: Database): Promise<Category[]> {
    const rows = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
    return rows.map((row) => ({ id: row.id, name: row.name }));
}

/** Get all publishers ordered by name for filter controls. */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    const rows = await db.select({ id: publishers.id, name: publishers.name }).from(publishers).orderBy(asc(publishers.name));
    return rows.map((row) => ({ id: row.id, name: row.name }));
}

/** All games ordered by title. */
export async function getAllGames(db: Database): Promise<Game[]> {
    return getFilteredGames(db);
}

/** All games matching the selected category and publisher filters, ordered by title. */
export async function getFilteredGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const categoryIds = normalizeIds(filters.categoryIds);
    const publisherIds = normalizeIds(filters.publisherIds);
    const clauses = [];

    if (categoryIds.length > 0) {
        clauses.push(inArray(games.categoryId, categoryIds));
    }

    if (publisherIds.length > 0) {
        clauses.push(inArray(games.publisherId, publisherIds));
    }

    const query = clauses.length > 0 ? baseGamesQuery(db).where(and(...clauses)) : baseGamesQuery(db);
    const rows = await query.orderBy(asc(games.title));
    return rows.map(mapGame);
}

/** All game ids ordered by title. */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/** A single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
