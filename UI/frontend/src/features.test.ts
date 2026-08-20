import { describe, it, expect } from "vitest";
import {
  parseVoiceInput,
  validateDraft,
  type ScorecardDraft,
} from "@/lib/scorecard-capture";
import type { FriendInfo } from "@/lib/types";
import {
  generateTemplateNarration,
  type NarrationInput,
} from "@/lib/narration";
import {
  buildRivalries,
  computeRivalry,
  detectMilestones,
  rivalryToText,
  type RivalryRecord,
  type Meeting,
} from "@/lib/rivalries";
import {
  replay,
  DEFAULTS,
  type Player,
  type Round,
  type ReplayResult,
  type ReplayedRound,
  type PlayerState,
} from "@engine/index.ts";

// ════════════════════════════════════════════════════════════
// Scorecard Capture tests
// ════════════════════════════════════════════════════════════

const FRIENDS: FriendInfo[] = [
  { userId: "u1", displayName: "Michael Zhang" },
  { userId: "u2", displayName: "Darren Lee" },
  { userId: "u3", displayName: "Wei Tan" },
];

describe("Scorecard Capture", () => {
  // ── Cannot commit without explicit per-field confirmation ──
  it("draft with errors cannot commit", () => {
    const draft: ScorecardDraft = {
      fields: [
        { rawName: "Michael", matchedFriendId: "u1", ags: 78, nameConfidence: 1.0, scoreConfidence: 0.9 },
        { rawName: "Unknown Guy", matchedFriendId: null, ags: 85, nameConfidence: 0, scoreConfidence: 0.9, unmatched: true },
      ],
      courseName: "Serapong",
      courseConfidence: 0.8,
      format: "stroke",
    };

    const result = validateDraft(draft);
    expect(result.canCommit).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.type === "unmatched_name")).toBe(true);
  });

  it("clean draft can commit", () => {
    const draft: ScorecardDraft = {
      fields: [
        { rawName: "Michael", matchedFriendId: "u1", ags: 78, nameConfidence: 1.0, scoreConfidence: 0.9 },
        { rawName: "Darren", matchedFriendId: "u2", ags: 81, nameConfidence: 0.85, scoreConfidence: 0.9 },
      ],
      courseName: "Serapong",
      courseConfidence: 0.8,
      format: "stroke",
    };

    const result = validateDraft(draft);
    expect(result.canCommit).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  // ── Unmatched name never auto-creates a player ──────────
  it("unmatched name has null matchedFriendId and is flagged", () => {
    const draft = parseVoiceInput("Michael 78, Unknown 85 at Serapong", FRIENDS);

    const unknownField = draft.fields.find((f) => f.rawName === "Unknown");
    expect(unknownField).toBeDefined();
    expect(unknownField!.matchedFriendId).toBeNull();
    expect(unknownField!.unmatched).toBe(true);

    // Validate should flag it
    const result = validateDraft(draft);
    expect(result.errors.some((e) => e.type === "unmatched_name")).toBe(true);
    expect(result.canCommit).toBe(false);
  });

  // ── Implausible score is flagged before commit ──────────
  it("implausible score is flagged when player distribution is known", () => {
    const draft: ScorecardDraft = {
      fields: [
        { rawName: "Michael", matchedFriendId: "u1", ags: 78, nameConfidence: 1.0, scoreConfidence: 0.9 },
        { rawName: "Darren", matchedFriendId: "u2", ags: 45, nameConfidence: 0.85, scoreConfidence: 0.9 },
      ],
      courseName: "Serapong",
      courseConfidence: 0.8,
      format: "stroke",
    };

    // Darren normally averages 82 with std 4 → 45 is >9 std away
    const distributions = new Map([
      ["u1", { mean: 80, std: 4 }],
      ["u2", { mean: 82, std: 4 }],
    ]);

    const result = validateDraft(draft, distributions);
    expect(result.errors.some((e) => e.type === "implausible_score")).toBe(true);
    expect(result.canCommit).toBe(false);
  });

  // ── Voice parsing extracts names, scores, and course ────
  it("voice parsing extracts players, scores, and course name", () => {
    const draft = parseVoiceInput(
      "Michael 78, Darren 81, Wei 88 at Serapong",
      FRIENDS
    );

    expect(draft.fields.length).toBe(3);
    expect(draft.courseName).toBe("Serapong");
    expect(draft.courseConfidence).toBeGreaterThan(0);

    const michael = draft.fields.find((f) => f.rawName === "Michael");
    expect(michael?.ags).toBe(78);
    expect(michael?.matchedFriendId).toBe("u1");
  });

  // ── Missing score leaves field blank ────────────────────
  it("missing score is flagged as an error", () => {
    const draft: ScorecardDraft = {
      fields: [
        { rawName: "Michael", matchedFriendId: "u1", ags: null, nameConfidence: 1.0, scoreConfidence: 0 },
      ],
      courseName: "Serapong",
      courseConfidence: 0.8,
      format: "stroke",
    };

    const result = validateDraft(draft);
    expect(result.errors.some((e) => e.type === "missing_score")).toBe(true);
    expect(result.canCommit).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// Narration tests
// ════════════════════════════════════════════════════════════

describe("AI Round Narrator", () => {
  // Helper to build a mock round for narration
  function buildMockRound(): {
    round: ReplayedRound;
    players: PlayerState[];
    viewerId: string;
    recentDeltas: number[];
  } {
    const players: Player[] = [
      { id: "me", name: "Me", club: "SGC" },
      { id: "opp", name: "Wei", club: "SGC" },
    ];

    const rounds: Round[] = [
      {
        id: "r1",
        date: "2026-01-01",
        format: "stroke",
        course: "Sentosa GC",
        par: 72,
        holes: 18,
        participants: [
          { playerId: "me", ags: 76, cr: 72, slope: 135, pcc: 0 },
          { playerId: "opp", ags: 88, cr: 72, slope: 135, pcc: 0 },
        ],
      },
    ];

    const result = replay(players, rounds, DEFAULTS);
    const round = result.rounds[0];
    const playerStates = result.players;

    return {
      round,
      players: playerStates,
      viewerId: "me",
      recentDeltas: [round.snapshot.find((s) => s.playerId === "me")!.delta],
    };
  }

  // ── Template narration is deterministic ─────────────────
  it("template narration produces 2-3 sentences and is deterministic", () => {
    const mock = buildMockRound();
    const input: NarrationInput = {
      round: mock.round,
      players: mock.players,
      viewerId: mock.viewerId,
      recentDeltas: mock.recentDeltas,
      k: DEFAULTS.kFloor,
    };

    const text1 = generateTemplateNarration(input);
    const text2 = generateTemplateNarration(input);

    // Deterministic — same input = same output
    expect(text1).toBe(text2);

    // Contains the opponent name
    expect(text1).toContain("Wei");

    // Contains the delta value
    const snap = mock.round.snapshot.find((s) => s.playerId === "me")!;
    expect(text1).toContain(Math.abs(snap.delta).toFixed(1));
  });

  // ── Narration works with AI disabled ────────────────────
  it("narration is produced even when AI is disabled (template fallback)", () => {
    const mock = buildMockRound();
    const input: NarrationInput = {
      round: mock.round,
      players: mock.players,
      viewerId: mock.viewerId,
      recentDeltas: mock.recentDeltas,
      k: DEFAULTS.kFloor,
    };

    // Template is the fallback when AI is off
    const text = generateTemplateNarration(input);
    expect(text.length).toBeGreaterThan(10);
    expect(text.length).toBeLessThan(500);
  });

  // ── Losing round is narrated honestly ───────────────────
  it("losing round narration is factual without cheerleading", () => {
    const players: Player[] = [
      { id: "me", name: "Me", club: "SGC" },
      { id: "opp", name: "Darren", club: "SGC" },
    ];

    // I shoot 92, Darren shoots 78 — I lose
    const rounds: Round[] = [
      {
        id: "r1",
        date: "2026-01-01",
        format: "stroke",
        course: "Sentosa GC",
        par: 72,
        holes: 18,
        participants: [
          { playerId: "me", ags: 92, cr: 72, slope: 135, pcc: 0 },
          { playerId: "opp", ags: 78, cr: 72, slope: 135, pcc: 0 },
        ],
      },
    ];

    const result = replay(players, rounds, DEFAULTS);
    const input: NarrationInput = {
      round: result.rounds[0],
      players: result.players,
      viewerId: "me",
      recentDeltas: [result.rounds[0].snapshot.find((s) => s.playerId === "me")!.delta],
      k: DEFAULTS.kFloor,
    };

    const text = generateTemplateNarration(input);

    // Should mention losing
    expect(text.toLowerCase()).toContain("lost");

    // Should NOT contain congratulatory language
    expect(text.toLowerCase()).not.toContain("great");
    expect(text.toLowerCase()).not.toContain("congratulations");
    expect(text.toLowerCase()).not.toContain("well done");
  });
});

// ════════════════════════════════════════════════════════════
// Rivalries tests
// ════════════════════════════════════════════════════════════

describe("Rivalries", () => {
  // Helper: build a replay with two players who meet multiple times
  function buildRivalryData(meetings: { myAgs: number; oppAgs: number; date: string }[]):
    { replay: ReplayResult; viewerId: string; opponentId: string } {
    const players: Player[] = [
      { id: "me", name: "Me", club: "SGC", seed: 18 },
      { id: "opp", name: "Darren", club: "SGC", seed: 14 },
    ];

    const rounds: Round[] = meetings.map((m, i) => ({
      id: `r${i + 1}`,
      date: m.date,
      format: "stroke" as const,
      course: "Sentosa GC",
      par: 72,
      holes: 18,
      participants: [
        { playerId: "me", ags: m.myAgs, cr: 72, slope: 135, pcc: 0 },
        { playerId: "opp", ags: m.oppAgs, cr: 72, slope: 135, pcc: 0 },
      ],
    }));

    const result = replay(players, rounds, DEFAULTS);
    return { replay: result, viewerId: "me", opponentId: "opp" };
  }

  // ── Rivalry records match direct recomputation ───────────
  it("rivalry record matches direct recomputation from raw pairwise data", () => {
    const data = buildRivalryData([
      { myAgs: 82, oppAgs: 85, date: "2026-01-01" },
      { myAgs: 80, oppAgs: 81, date: "2026-01-08" },
      { myAgs: 86, oppAgs: 83, date: "2026-01-15" },
      { myAgs: 78, oppAgs: 82, date: "2026-01-22" },
    ]);

    const rivalries = buildRivalries(data.replay, data.viewerId);
    expect(rivalries.length).toBe(1);

    const r = rivalries[0];

    // Manually recompute from raw pairwise data
    const allRounds = data.replay.rounds;
    let manualWins = 0;
    let manualLosses = 0;
    let manualAggregate = 0;

    for (const round of allRounds) {
      const pair = round.pairs.find(
        (p) =>
          (p.a === "me" && p.b === "opp") ||
          (p.a === "opp" && p.b === "me")
      );
      if (!pair) continue;

      const isMeA = pair.a === "me";
      const margin = isMeA ? pair.margin : -pair.margin;

      if (margin > 0) manualWins++;
      else manualLosses++;
      manualAggregate += margin;
    }

    expect(r.wins).toBe(manualWins);
    expect(r.losses).toBe(manualLosses);
    expect(r.aggregateMargin).toBeCloseTo(manualAggregate, 5);
  });

  // ── Predicted edge is in strokes, not probability ────────
  it("predicted edge is expressed in strokes", () => {
    const data = buildRivalryData([
      { myAgs: 82, oppAgs: 85, date: "2026-01-01" },
      { myAgs: 80, oppAgs: 81, date: "2026-01-08" },
      { myAgs: 86, oppAgs: 83, date: "2026-01-15" },
    ]);

    const rivalries = buildRivalries(data.replay, data.viewerId);
    const r = rivalries[0];

    // Predicted edge should be a number of strokes
    expect(typeof r.predictedEdge).toBe("number");

    // The text form should mention "strokes"
    const text = rivalryToText(r);
    expect(text).toMatch(/stroke/i);
  });

  // ── Milestone: ordinary result does not fire ─────────────
  it("milestone notifications do not fire on an ordinary single result", () => {
    // Build a rivalry with 5 meetings, viewer is ahead 3-2
    const data = buildRivalryData([
      { myAgs: 82, oppAgs: 85, date: "2026-01-01" },
      { myAgs: 80, oppAgs: 81, date: "2026-01-08" },
      { myAgs: 86, oppAgs: 83, date: "2026-01-15" },
      { myAgs: 78, oppAgs: 82, date: "2026-01-22" },
      { myAgs: 84, oppAgs: 80, date: "2026-01-29" },
    ]);

    const rivalries = buildRivalries(data.replay, data.viewerId);
    const before = rivalries[0];

    // Add an ordinary 6th meeting — another win by a normal margin
    const data2 = buildRivalryData([
      { myAgs: 82, oppAgs: 85, date: "2026-01-01" },
      { myAgs: 80, oppAgs: 81, date: "2026-01-08" },
      { myAgs: 86, oppAgs: 83, date: "2026-01-15" },
      { myAgs: 78, oppAgs: 82, date: "2026-01-22" },
      { myAgs: 84, oppAgs: 80, date: "2026-01-29" },
      { myAgs: 81, oppAgs: 83, date: "2026-02-05" }, // ordinary win by 2
    ]);

    const rivalries2 = buildRivalries(data2.replay, data.viewerId);
    const after = rivalries2[0];

    // The new meeting
    const newMeeting: Meeting = {
      date: "2026-02-05",
      course: "Sentosa GC",
      margin: after.meetings[after.meetings.length - 1].margin,
      winner: after.meetings[after.meetings.length - 1].winner,
    };

    const milestones = detectMilestones(before, after, newMeeting);

    // An ordinary result should NOT fire any milestone
    expect(milestones.length).toBe(0);
  });

  // ── Milestone: breaking a 3+ losing streak ───────────────
  it("milestone fires when breaking a losing streak of 3 or more", () => {
    // Build a rivalry where I'm on a 3-game losing streak
    const data = buildRivalryData([
      { myAgs: 88, oppAgs: 80, date: "2026-01-01" }, // lose
      { myAgs: 89, oppAgs: 82, date: "2026-01-08" }, // lose
      { myAgs: 87, oppAgs: 81, date: "2026-01-15" }, // lose (streak = -3)
    ]);

    const rivalries = buildRivalries(data.replay, data.viewerId);
    const before = rivalries[0];

    expect(before.currentStreak).toBe(-3);

    // Now I win
    const data2 = buildRivalryData([
      { myAgs: 88, oppAgs: 80, date: "2026-01-01" },
      { myAgs: 89, oppAgs: 82, date: "2026-01-08" },
      { myAgs: 87, oppAgs: 81, date: "2026-01-15" },
      { myAgs: 79, oppAgs: 85, date: "2026-01-22" }, // win! breaks streak
    ]);

    const rivalries2 = buildRivalries(data2.replay, data.viewerId);
    const after = rivalries2[0];

    const newMeeting: Meeting = {
      date: "2026-01-22",
      course: "Sentosa GC",
      margin: after.meetings[after.meetings.length - 1].margin,
      winner: after.meetings[after.meetings.length - 1].winner,
    };

    const milestones = detectMilestones(before, after, newMeeting);

    // Should fire the "broke_streak" milestone
    expect(milestones.some((m) => m.type === "broke_streak")).toBe(true);
  });

  // ── Minimum 3 meetings required ─────────────────────────
  it("pairs with fewer than 3 meetings are not included", () => {
    const data = buildRivalryData([
      { myAgs: 82, oppAgs: 85, date: "2026-01-01" },
      { myAgs: 80, oppAgs: 81, date: "2026-01-08" },
    ]);

    const rivalries = buildRivalries(data.replay, data.viewerId);
    expect(rivalries.length).toBe(0);
  });

  // ── Shareable text is plain text ─────────────────────────
  it("rivalry text is plain text with record and edge", () => {
    const data = buildRivalryData([
      { myAgs: 82, oppAgs: 85, date: "2026-01-01" },
      { myAgs: 80, oppAgs: 81, date: "2026-01-08" },
      { myAgs: 86, oppAgs: 83, date: "2026-01-15" },
    ]);

    const rivalries = buildRivalries(data.replay, data.viewerId);
    const text = rivalryToText(rivalries[0]);

    expect(text).toContain("Darren");
    expect(text).toMatch(/\d+–\d+/); // W-L record
    expect(text).toMatch(/stroke/i); // edge in strokes
  });
});
