// Adversarial tests for database.rules.json. Each case names the attack it blocks.
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
    assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, set, update, get, serverTimestamp } from 'firebase/database';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const GID = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 chars, base64url

let env;
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();
const g  = (uid, path = '') => ref(db(uid), `games/${GID}${path}`);

const newGame = (creator) => ({
    players:   { w: creator },
    state:     { fen: START, turn: 'w', updatedAt: serverTimestamp() },
    createdAt: serverTimestamp(),
});
const move = (fen, turn, san) => ({ fen, turn, lastMove: san, updatedAt: serverTimestamp() });

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-chess-rules',
        database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
    });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

async function seatedGame() {
    await assertSucceeds(set(g('alice'), newGame('alice')));
    await assertSucceeds(set(g('bob', '/players/b'), 'bob'));
}

describe('game creation', () => {
    test('creator can create a game seated as White', async () => {
        await assertSucceeds(set(g('alice'), newGame('alice')));
    });
    test('unauthenticated client cannot create', async () => {
        await assertFails(set(g(null), newGame('alice')));
    });
    test('cannot seat someone else as White', async () => {
        await assertFails(set(g('alice'), newGame('mallory')));
    });
    test('cannot pre-seat Black at creation', async () => {
        await assertFails(set(g('alice'), { ...newGame('alice'), players: { w: 'alice', b: 'bob' } }));
    });
    test('cannot start from a non-initial position', async () => {
        const bad = newGame('alice'); bad.state.fen = AFTER_E4; bad.state.turn = 'b';
        await assertFails(set(g('alice'), bad));
    });
    test('cannot overwrite an existing game', async () => {
        await seatedGame();
        await assertFails(set(g('alice'), newGame('alice')));
        await assertFails(set(g('mallory'), newGame('mallory')));
    });
    test('cannot hijack a game mid-play by rewriting the whole node', async () => {
        // Turn is 'b' here, so a full overwrite with turn 'w' would satisfy the
        // turn-flip check — only the !data.exists() guard stops it.
        await seatedGame();
        await assertSucceeds(set(g('alice', '/state'), move(AFTER_E4, 'b', 'e4')));
        await assertFails(set(g('mallory'), newGame('mallory')));
    });
    test('rejects guessable / malformed game IDs', async () => {
        await assertFails(set(ref(db('alice'), 'games/abc'), newGame('alice')));
    });
    test('rejects unknown top-level fields', async () => {
        await assertFails(set(g('alice'), { ...newGame('alice'), admin: true }));
    });
});

describe('seat claiming', () => {
    test('a second player can claim Black once', async () => {
        await seatedGame();
        await assertFails(set(g('mallory', '/players/b'), 'mallory'));
    });
    test('White cannot also claim Black', async () => {
        await assertSucceeds(set(g('alice'), newGame('alice')));
        await assertFails(set(g('alice', '/players/b'), 'alice'));
    });
    test('cannot claim Black on behalf of someone else', async () => {
        await assertSucceeds(set(g('alice'), newGame('alice')));
        await assertFails(set(g('bob', '/players/b'), 'carol'));
    });
    test('cannot claim a seat in a game that does not exist', async () => {
        await assertFails(set(g('bob', '/players/b'), 'bob'));
    });
    test('nobody can reassign White', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/players/w'), 'bob'));
        await assertFails(set(g('mallory', '/players/w'), 'mallory'));
    });
});

describe('moves', () => {
    test('side to move can move, then the other side', async () => {
        await seatedGame();
        await assertSucceeds(set(g('alice', '/state'), move(AFTER_E4, 'b', 'e4')));
        await assertSucceeds(set(g('bob',   '/state'), move(AFTER_E5, 'w', 'e5')));
    });
    test('White can open before Black has joined', async () => {
        await assertSucceeds(set(g('alice'), newGame('alice')));
        await assertSucceeds(set(g('alice', '/state'), move(AFTER_E4, 'b', 'e4')));
    });
    test('cannot move out of turn', async () => {
        await seatedGame();
        await assertFails(set(g('bob', '/state'), move(AFTER_E4, 'b', 'e4')));
    });
    test('cannot move twice in a row', async () => {
        await seatedGame();
        await assertSucceeds(set(g('alice', '/state'), move(AFTER_E4, 'b', 'e4')));
        await assertFails(set(g('alice', '/state'), move(AFTER_E5, 'w', 'e5')));
    });
    test('spectator cannot move', async () => {
        await seatedGame();
        await assertFails(set(g('mallory', '/state'), move(AFTER_E4, 'b', 'e4')));
    });
    test('turn must flip', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/state'), move(START, 'w', 'xx')));
    });
    test('FEN side-to-move must agree with turn', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/state'), move(START, 'b', 'e4')));
    });
    test('client-supplied timestamps are rejected', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/state'),
            { fen: AFTER_E4, turn: 'b', updatedAt: Date.now() + 86_400_000 }));
    });
    test('garbage FEN is rejected', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/state'), move('<script>alert(1)</script> b', 'b', 'e4')));
    });
    test('extra fields in state are rejected', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/state'), { ...move(AFTER_E4, 'b', 'e4'), winner: 'w' }));
    });
});

describe('names and comments', () => {
    test('a player can set their own name and comment', async () => {
        await seatedGame();
        await assertSucceeds(set(g('alice', '/names/w'), 'Alice'));
        await assertSucceeds(set(g('bob', '/comments/b'), 'gl hf'));
    });
    test("cannot write the opponent's name or comment", async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/names/b'), 'Loser'));
        await assertFails(set(g('mallory', '/comments/w'), 'spam'));
    });
    test('oversized values are rejected', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/names/w'), 'x'.repeat(25)));
        await assertFails(set(g('alice', '/comments/w'), 'x'.repeat(501)));
    });
    test('unknown seat keys are rejected', async () => {
        await seatedGame();
        await assertFails(set(g('alice', '/names/admin'), 'x'));
    });
});

describe('reads and legacy', () => {
    test('signed-in user with the link can read a game', async () => {
        await seatedGame();
        await assertSucceeds(get(g('mallory')));
    });
    test('unauthenticated client cannot read', async () => {
        await seatedGame();
        await assertFails(get(g(null)));
    });
    test('games cannot be enumerated', async () => {
        await assertFails(get(ref(db('alice'), 'games')));
    });
    test('legacy current_match is frozen', async () => {
        await assertFails(update(ref(db('alice'), 'current_match'), { fen: START, timestamp: Date.now() }));
    });
});
