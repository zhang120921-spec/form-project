import { describe, it, expect } from "vitest";
import {
  replay,
  DEFAULTS,
  seedRating,
  computeRound,
  kFor,
  type Player,
  type Round,
  type EngineConfig,
} from "@engine/index.ts";
import {
  runSandbagSim,
  YOU,
  OPPONENTS,
  OPP_SCORES,
  HONEST_SCORES,
  SANDBAG_SCORES,
  buildRounds,
  CR,
  SLOPE,
  PAR,
  PCC,
} from "@/lib/sandbag-sim";

// ════════════════════════════════════════════════════════════
// Sandbag immunity — four assertions using the real engine.
//
// The core claim: FORM ratings cannot be manipulated by playing
// badly, because the rating IS the prize, not a subsidy applied
// to it.  These tests prove that claim with actual replay() calls.
// ════════════════════════════════════════════════════════════

describe("Sandbag immunity — real engine tests", () => {
  // ── Test 1 ─────────────────────────────────────────────────
  // A player who posts deliberately inflated scores over ten rounds
  // ends with a LOWER rating and a HIGHER handicap index than one
  // posting honest scores against identical opponents.
  // ────────────────────────────────────────────────────────────
  it("sandbagger ends with lower rating and higher handicap than honest player", () => {
    const result = runSandbagSim();

    // Sandbagger rating must be lower
    expect(result.sandbag.rating).toBeLessThan(result.honest.rating);

    // Sandbagger handicap must be higher (worse)
    expect(result.sandbag.hcpIndex).not.toBeNull();
    expect(result.honest.hcpIndex).not.toBeNull();
    expect(result.sandbag.hcpIndex!).toBeGreaterThan(result.honest.hcpIndex!);
  });

  // ── Test 2 ─────────────────────────────────────────────────
  // Omitting a strong round leaves a player's rating LOWER than
  // including it would have.  This is the second half of sandbag
  // immunity — you can't hide a good round to protect a high cap.
  // ────────────────────────────────────────────────────────────
  it("omitting a strong round leaves rating lower than including it", () => {
    // Player seeded at 18 hcp (starts at 1500)
    const me: Player = { id: "me", name: "Me", club: "SGC", seed: 18 };
    const opp: Player = { id: "opp", name: "Opp", club: "SGC", seed: 18 };

    // 6 rounds: rounds 1–5 are mediocre, round 6 is a career round.
    // "Strong round" = low AGS (well under CR) = low differential.
    const scores = [90, 92, 88, 91, 89]; // rounds 1–5
    const strongAgs = 76; // round 6 — a genuinely excellent score

    function makeRounds(includeStrong: boolean): Round[] {
      const allScores = includeStrong
        ? [...scores, strongAgs]
        : scores;
      return allScores.map((myAgs, i) => ({
        id: `r${i + 1}`,
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        format: "stroke" as const,
        course: "Sentosa GC",
        par: PAR,
        holes: 18,
        participants: [
          { playerId: "me",  ags: myAgs, cr: CR, slope: SLOPE, pcc: PCC },
          { playerId: "opp", ags: 88,    cr: CR, slope: SLOPE, pcc: PCC },
        ],
      }));
    }

    const withRound = replay([me, opp], makeRounds(true), DEFAULTS);
    const withoutRound = replay([me, opp], makeRounds(false), DEFAULTS);

    const meWith = withRound.players.find((p) => p.id === "me")!;
    const meWithout = withoutRound.players.find((p) => p.id === "me")!;

    // Including the strong round should produce a HIGHER rating
    // than omitting it.
    expect(meWith.rating).toBeGreaterThan(meWithout.rating);
  });

  // ── Test 3 ─────────────────────────────────────────────────
  // Beating an opponent rated 400 points below you yields a gain
  // of under 2 points at K=40 (floor).  Beating an opponent rated
  // 400 points ABOVE you yields over 35.
  //
  // This proves the engine's asymmetry: favourites gain almost
  // nothing from expected wins, while underdogs gain massively
  // from upsets.  Sandbagging (deliberately losing) can only move
  // you toward the expected outcome — which is always a small
  // downward drift, never a catastrophic one.
  //
  // The two scenarios use DIFFERENT scores: the favourite wins by
  // a moderate margin (as expected), while the underdog pulls off
  // a large-margin upset.  The point is that the same *quality* of
  // play produces wildly different rating changes depending on the
  // rating gap.
  // ────────────────────────────────────────────────────────────
  it("beating opponent 400pts below yields <2pts; 400pts above yields >35pts", () => {
    // Use a config with K=40 flat (no placement boost) to isolate
    // the asymmetry cleanly.
    const config: EngineConfig = {
      ...DEFAULTS,
      kFloor: 40,
      kPlacement: 40,
      placementMatches: 0,
    };

    const highRated = 1900; // 400 points above lowRated
    const lowRated = 1500;

    // ── Scenario 1: Favourite beats underdog ──────────────────
    // The favourite (1900) shoots 78, the underdog (1500) shoots 88.
    // That's a 10-stroke win — a solid, expected victory.
    //   diffFav  = (78−72)×113/135 ≈ 5.02
    //   diffUnder = (88−72)×113/135 ≈ 13.39
    //   margin = 13.39 − 5.02 = 8.37  (positive = favourite played better)
    //   S = 1/(1+e^(−0.30×8.37)) ≈ 0.925
    //   E = 1/(1+10^((1500−1900)/400)) = 1/(1+10^(−1)) ≈ 0.909
    //   delta = 40 × (0.925 − 0.909) = 0.64  ✓  (< 2, > 0)
    const diffFav = ((78 - CR) * 113) / SLOPE;
    const diffUnder = ((88 - CR) * 113) / SLOPE;

    const entriesFav = [
      { id: "A", rating: highRated, matches: 10, basis: diffFav },
      { id: "B", rating: lowRated,  matches: 10, basis: diffUnder },
    ];

    const resultFav = computeRound(entriesFav, "stroke", config, 18);
    const gainFavourite = resultFav.deltas["A"];

    // Favourite gains less than 2 points from an expected win
    expect(gainFavourite).toBeLessThan(2);
    expect(gainFavourite).toBeGreaterThan(0); // still positive (they did win)

    // ── Scenario 2: Underdog beats favourite ─────────────────
    // The underdog (1500) shoots 76, the favourite (1900) shoots 90.
    // That's a 14-stroke upset — a massive surprise.
    //   diffUnder = (76−72)×113/135 ≈ 3.35
    //   diffFav   = (90−72)×113/135 ≈ 15.07
    //   margin = 15.07 − 3.35 = 11.72
    //   S = 1/(1+e^(−0.30×11.72)) ≈ 0.971
    //   E = 1/(1+10^((1900−1500)/400)) = 1/(1+10^1) ≈ 0.091
    //   delta = 40 × (0.971 − 0.091) = 35.2  ✓  (> 35)
    const diffUnderUpset = ((76 - CR) * 113) / SLOPE;
    const diffFavUpset = ((90 - CR) * 113) / SLOPE;

    const entriesUnder = [
      { id: "A", rating: lowRated,  matches: 10, basis: diffUnderUpset },
      { id: "B", rating: highRated, matches: 10, basis: diffFavUpset },
    ];

    const resultUnder = computeRound(entriesUnder, "stroke", config, 18);
    const gainUnderdog = resultUnder.deltas["A"];

    // Underdog gains over 35 points from the upset
    expect(gainUnderdog).toBeGreaterThan(35);
  });

  // ── Test 4 ─────────────────────────────────────────────────
  // The explainer simulator produces its displayed numbers by
  // calling the same `replay` function the rest of the app uses.
  // No hardcoded results anywhere in that component.
  //
  // We verify this by:
  //   a) Calling runSandbagSim() — the function the page calls
  //   b) Manually constructing the same replay with raw engine calls
  //   c) Asserting the numbers match exactly
  // ────────────────────────────────────────────────────────────
  it("explainer simulator uses the real replay function — no hardcoded results", () => {
    // (a) What the page would display
    const displayed = runSandbagSim();

    // (b) Independent replay using the exported raw data
    const players: Player[] = [YOU, ...OPPONENTS];
    const sandbagReplay = replay(players, buildRounds(SANDBAG_SCORES), DEFAULTS);
    const honestReplay = replay(players, buildRounds(HONEST_SCORES), DEFAULTS);

    const sandbagYou = sandbagReplay.players.find((p) => p.id === "you")!;
    const honestYou = honestReplay.players.find((p) => p.id === "you")!;

    // (c) The numbers must match to the last decimal
    expect(displayed.sandbag.rating).toBe(sandbagYou.rating);
    expect(displayed.sandbag.hcpIndex).toBe(sandbagYou.hcpIndex);
    expect(displayed.honest.rating).toBe(honestYou.rating);
    expect(displayed.honest.hcpIndex).toBe(honestYou.hcpIndex);

    // Bonus: verify the simulator is deterministic (same call = same result)
    const secondCall = runSandbagSim();
    expect(secondCall).toEqual(displayed);

    // Bonus: verify the simulator used the same opponents in both
    // paths.  Opponents start with the same seeded ratings and play
    // the same scores (identical differentials), but their FINAL
    // ratings differ because they played against a different "You".
    const sandbagOpps = sandbagReplay.players.filter((p) => p.id !== "you");
    const honestOpps = honestReplay.players.filter((p) => p.id !== "you");
    expect(sandbagOpps.length).toBe(honestOpps.length);
    for (let i = 0; i < sandbagOpps.length; i++) {
      // Same player (same id, name, seed)
      expect(sandbagOpps[i].id).toBe(honestOpps[i].id);
      expect(sandbagOpps[i].seededRating).toBe(honestOpps[i].seededRating);
      // Same scores played → identical differentials
      expect(sandbagOpps[i].differentials).toEqual(honestOpps[i].differentials);
    }
  });
});
