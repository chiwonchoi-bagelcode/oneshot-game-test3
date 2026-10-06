import { describe, expect, it } from 'vitest';
import type { V2 } from '../src/core/math';
import { World } from '../src/sim/World';
import type { ItemType } from '../src/sim/rules';

const run = (w: World, seconds: number, dt = 1 / 30, until?: () => boolean) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    w.update(dt);
    if (until && until()) return true;
  }
  return false;
};
const tp = (w: World, p: V2, face = 0) => {
  w.player.pos = { ...p };
  w.player.facing = face;
};
const give = (w: World, t: ItemType) => w.givePlayer(t);
const doAction = (w: World, actionId: string, targetId?: string) => {
  w.update(1 / 60);
  const i = w.options.findIndex((o) => o.action.id === actionId && (!targetId || o.target?.id === targetId || o.item?.type === targetId));
  if (i < 0) throw new Error(`action ${actionId} not available; have: ${w.options.map((o) => `${o.target?.id ?? o.item?.type}:${o.action.id}${o.action.disabled ? '(x)' : ''}`).join(', ')}`);
  w.optionIdx = i;
  w.activateOption();
  const a = w.player.action;
  if (a) run(w, a.dur + 0.1, 1 / 60);
};

describe('systemic scenarios', () => {
  it('cutting the security breaker kills cameras and the duck alarm; the electrician fixes it', () => {
    const w = new World(7);
    run(w, 2);
    tp(w, { x: 14.5, z: 15.3 }, Math.PI);
    w.player.outfit = 'electrician';
    doAction(w, 'breaker_C', 'fusebox');
    expect(w.power.on('C')).toBe(false);
    expect(w.security.camsPowered(w)).toBe(false);
    // Nobody saw us, electrician uniform makes breaker work legal anyway.
    tp(w, { x: 36, z: 52 });
    const fixed = run(w, 150, 1 / 30, () => w.power.on('C'));
    expect(fixed).toBe(true);
  });

  it('a drugged coffee puts the security operator to sleep at his desk', () => {
    const w = new World(11);
    give(w, 'sleeping_pills');
    tp(w, { x: 13.6, z: 23.5 }, -Math.PI / 2);
    w.player.outfit = 'waiter';
    doAction(w, 'spike_sleeping_pills', 'coffee');
    expect(w.spiked.coffee?.type).toBe('sleeping_pills');
    tp(w, { x: 36, z: 52 });
    const op = w.npc('operator')!;
    const slept = run(w, 260, 1 / 30, () => !op.awake);
    expect(slept).toBe(true);
    expect(w.stats.drugged.has('operator')).toBe(true);
  });

  it('a guard who sees the player carrying the duck chases and radios the outfit', () => {
    const w = new World(3);
    run(w, 1);
    const duck = w.caseItem!;
    // Hand the duck to the player directly (as if stolen unseen).
    w.security.alarmArmed = false;
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    doAction(w, 'take', 'case');
    expect(w.player.hand).toBe(duck);
    // Walk out in front of the gallery guard (door opened for the test).
    const d = w.door('d_gallery');
    w.setDoorLocked(d, false, 'test');
    w.setDoorOpen(d, true, 'test');
    tp(w, { x: 37.4, z: 24.6 }, Math.PI);
    const gg = w.npc('gallery_guard')!;
    gg.facing = 0;
    const chased = run(w, 3, 1 / 30, () => gg.behavior.name === 'chase');
    expect(chased).toBe(true);
    run(w, 3);
    // Other guards learned about the guest outfit via radio.
    expect(w.npc('chief')!.knowledge.compromised.has('guest')).toBe(true);
    expect(w.npc('doorman')!.knowledge.compromised.has('guest')).toBe(true);
    // Guests do not have radios.
    const far = w.npcs.find((n) => n.role === 'guest' && !n.knowledge.seesPlayer && n.knowledge.suspicion === 0)!;
    expect(far.knowledge.compromised.size).toBe(0);
  });

  it('civilian witnesses run to a guard and report; the guard then knows', () => {
    const w = new World(5);
    run(w, 1);
    const b = w.npc('bartender')!;
    // Commit a crime in full view of the bartender (who stands behind the bar facing north).
    tp(w, { x: 51, z: 32.3 }, Math.PI);
    const reported = run(w, 2, 1 / 30, () => {
      w.player.illegalFlash = { text: '물건을 집어던진다', until: w.time + 1 };
      return b.behavior.name === 'report';
    });
    expect(reported).toBe(true);
    w.player.illegalFlash = null;
    tp(w, { x: 70, z: 62 }); // flee to the street
    const told = run(w, 40, 1 / 30, () => w.npcs.some((n) => n.isGuard && n.knowledge.compromised.has('guest')));
    expect(told).toBe(true);
  });

  it('stealing the duck unseen with the alarm off, then the host tour discovers the empty case and locks down', () => {
    const w = new World(9);
    w.security.alarmArmed = false;
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    doAction(w, 'take', 'case');
    expect(w.player.hasGoldenDuck()).toBe(true);
    expect(w.security.alarmOn).toBe(false);
    // Hide in the street with the duck in hand but not escaping (keep z < 60.2)
    tp(w, { x: 70, z: 57 });
    w.player.gone = true; // out of the picture
    const found = run(w, 520, 1 / 20, () => w.stats.theftKnownAt >= 0);
    expect(found).toBe(true);
    // Whoever noticed tells a guard; the chief orders a lockdown over the radio.
    const locked = run(w, 120, 1 / 20, () => w.security.lockdown);
    expect(locked).toBe(true);
    // Front gate gets closed by the doorman.
    run(w, 30, 1 / 20);
    expect(w.door('d_front_gate').locked).toBe(true);
  });

  it('a fake duck fools everyone until the host inspects it on the tour', () => {
    const w = new World(13);
    w.security.camerasEnabled = false;
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    give(w, 'rubber_duck');
    give(w, 'gold_paint');
    doAction(w, 'paint', 'self');
    expect(w.player.hand?.type).toBe('fake_duck');
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    doAction(w, 'swap', 'case');
    expect(w.caseItem?.type).toBe('fake_duck');
    expect(w.player.hand?.type).toBe('golden_duck');
    expect(w.security.alarmOn).toBe(false);
    w.player.gone = true;
    run(w, 200, 1 / 20);
    expect(w.stats.theftKnownAt).toBe(-1);
    const found = run(w, 400, 1 / 20, () => w.stats.theftKnownAt >= 0);
    expect(found).toBe(true);
    expect(w.stats.theftKnownHow).toBe('tour');
  });

  it('taking the duck with the alarm armed sets off the alarm and guards rush in', () => {
    const w = new World(17);
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    doAction(w, 'take', 'case');
    expect(w.security.alarmOn).toBe(true);
    run(w, 2);
    expect(w.security.lockdown).toBe(true);
    const responders = w.npcs.filter((n) => n.isGuard && (n.behavior.name === 'alarm' || n.behavior.name === 'search' || n.behavior.name === 'chase' || n.behavior.name === 'lockdown'));
    expect(responders.length).toBeGreaterThan(3);
  });

  it('a thrown bottle shatters, makes noise, and staff come to clean it up', () => {
    const w = new World(19);
    run(w, 3);
    tp(w, { x: 45, z: 40.5 }, -Math.PI / 2);
    give(w, 'gift_box');
    w.player.hand!.state = 'gone';
    w.player.hand = null;
    give(w, 'vase' as ItemType);
    // Throw it towards the foyer.
    w.throwHeld();
    run(w, 2);
    const shards = w.items.find((i) => i.type === 'shards');
    expect(shards).toBeDefined();
    tp(w, { x: 70, z: 62 });
    const cleaned = run(w, 90, 1 / 30, () => shards!.state === 'gone');
    expect(cleaned).toBe(true);
  });

  it('switching off a room light makes someone switch it back on', () => {
    const w = new World(23);
    run(w, 5);
    w.setSwitch('kitchen', false, 'player');
    expect(w.lighting.roomLit('kitchen')).toBe(false);
    const back = run(w, 40, 1 / 30, () => w.lighting.roomLit('kitchen'));
    expect(back).toBe(true);
  });

  it('walking out the front gate with the duck hidden in a gift box wins', () => {
    const w = new World(29);
    w.security.alarmArmed = false;
    w.security.camerasEnabled = false;
    give(w, 'gift_box');
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    doAction(w, 'take', 'case');
    expect(w.player.hand?.type).toBe('gift_box');
    expect(w.player.hand?.contents?.type).toBe('golden_duck');
    expect(w.playerStatus.duckVisible).toBe(false);
    tp(w, { x: 36, z: 58.5 }, 0);
    w.player.input = { x: 0, z: 1 };
    run(w, 3, 1 / 30, () => w.ended !== 'none');
    expect(w.ended).toBe('escaped');
    expect(w.stats.route).toBe('front');
  });

  it('changing clothes in front of someone compromises both outfits for them', () => {
    const w = new World(31);
    run(w, 1);
    w.player.owned.add('waiter');
    const chef = w.npc('chef')!;
    chef.pos = { x: 15.5, z: 33.65 };
    chef.facing = Math.PI;
    tp(w, { x: 15.5, z: 31.3 }, 0);
    w.requestOutfit('waiter');
    run(w, 2.5);
    expect(w.player.outfit).toBe('waiter');
    expect(chef.knowledge.compromised.has('guest')).toBe(true);
    expect(chef.knowledge.compromised.has('waiter')).toBe(true);
  });

  it('the doorman stops an uninvited guest, but lets them in with an invitation', () => {
    const w = new World(37);
    run(w, 1);
    tp(w, { x: 36.5, z: 60.5 }, Math.PI);
    w.player.input = { x: 0, z: -1 };
    const stopped = run(w, 4, 1 / 30, () => w.npc('doorman')!.behavior.name === 'confront');
    expect(stopped).toBe(true);
    w.player.input = { x: 0, z: 0 };
    give(w, 'invitation');
    run(w, 3);
    expect(w.player.legit).toBe(true);
    expect(w.npc('doorman')!.behavior.name).not.toBe('chase');
  });

  it('pickpocketing the late guest yields the invitation and he ends up arguing at the gate', () => {
    const w = new World(41);
    run(w, 1);
    const lg = w.npc('late_guest')!;
    tp(w, { x: lg.pos.x + 1.0, z: lg.pos.z }, -Math.PI / 2);
    lg.facing = -Math.PI / 2; // facing the gate (west), back to us
    doAction(w, 'pick', 'npc:late_guest');
    expect(w.player.hasItem('invitation')).toBe(true);
    tp(w, { x: 60, z: 62 });
    const argued = run(w, 120, 1 / 30, () => w.flags.lateGuestArguing);
    expect(argued).toBe(true);
  });

  it('changing clothes out of sight shakes off a chasing guard', () => {
    const w = new World(43);
    run(w, 1);
    const g = w.npc('patrol_front')!;
    // The guard spots and chases a suspicious guest in the front yard.
    tp(w, { x: g.pos.x, z: g.pos.z + 3 }, Math.PI);
    w.brain.escalate(w, g, 'crime', '테스트');
    expect(g.behavior.name).toBe('chase');
    // We slip behind the mansion (out of sight) and change into a waiter uniform.
    tp(w, { x: 66, z: 30 });
    w.player.owned.add('waiter');
    run(w, 1);
    w.requestOutfit('waiter');
    run(w, 2.2);
    expect(w.player.outfit).toBe('waiter');
    // The guard comes looking, sees "a waiter", and doesn't recognise us.
    const caught = run(w, 25, 1 / 30, () => w.ended === 'caught');
    expect(caught).toBe(false);
    expect(g.knowledge.compromised.has('waiter')).toBe(false);
  });

  it('guests may join the host on the gallery tour', () => {
    const w = new World(47);
    w.flags.tourActive = true;
    tp(w, { x: 34, z: 19.5 });
    run(w, 0.1);
    expect(w.playerStatus.trespass).toBe(false);
    w.flags.tourActive = false;
    run(w, 0.1);
    expect(w.playerStatus.trespass).toBe(true);
  });

  it('cameras switched off at the console are noticed and turned back on by the operator', () => {
    const w = new World(53);
    const op = w.npc('operator')!;
    // Wait for the coffee break, then sneak to the console.
    const away = run(w, 200, 1 / 30, () => op.behavior.name === 'routine' && Math.hypot(op.pos.x - 20.5, op.pos.z - 15.75) > 4);
    expect(away).toBe(true);
    tp(w, { x: 22.6, z: 16.2 }, Math.PI);
    doAction(w, 'cams', 'console');
    doAction(w, 'alarm', 'console');
    expect(w.security.camerasEnabled).toBe(false);
    expect(w.security.alarmArmed).toBe(false);
    tp(w, { x: 70, z: 62 });
    const back = run(w, 120, 1 / 30, () => w.security.camerasEnabled);
    expect(back).toBe(true);
    // The quiet part (the case alarm) went unnoticed.
    expect(w.security.alarmArmed).toBe(false);
  });

  it('the study secret door can be picked, giving a way into the gallery that avoids the guard', () => {
    const w = new World(59);
    for (const n of w.npcs) n.active = false;
    tp(w, { x: 44.5, z: 22.6 }, Math.PI);
    doAction(w, 'pick', 'door:d_study');
    expect(w.door('d_study').open).toBe(true);
    tp(w, { x: 41.6, z: 17.5 }, -Math.PI / 2);
    doAction(w, 'pick', 'door:d_study_gallery');
    expect(w.door('d_study_gallery').open).toBe(true);
  });

  it('if the electrician lost his key, someone else with a key comes to restore the power', () => {
    const w = new World(73);
    const el = w.npc('electrician')!;
    const key = el.pockets.find((i) => i.type === 'key_elec')!;
    el.pockets = el.pockets.filter((i) => i !== key);
    el.keys.delete('key_elec');
    key.state = 'gone';
    w.setBreaker('B', false, 'player');
    expect(w.power.on('B')).toBe(false);
    const fixed = run(w, 180, 1 / 30, () => w.power.on('B'));
    expect(fixed).toBe(true);
    run(w, 2);
    expect(w.flags.fixFailedBy.size).toBe(0);
  });

  it('a laxative in the water cooler sends the gallery guard running to the toilet, leaving his post', () => {
    const w = new World(79);
    // (Doing this right next to the guard would get you caught: we assume a moment he was away.)
    give(w, 'laxative');
    w.spike('cooler', 'laxative');
    expect(w.spiked.cooler?.type).toBe('laxative');
    tp(w, { x: 70, z: 62 });
    const gg = w.npc('gallery_guard')!;
    const sick = run(w, 300, 1 / 30, () => gg.behavior.name === 'sick');
    expect(sick).toBe(true);
    // He actually leaves the gallery hall.
    const left = run(w, 30, 1 / 30, () => w.grid.roomAt(gg.pos)?.id !== 'galhall');
    expect(left).toBe(true);
    // ...and eventually comes back to his post.
    const back = run(w, 120, 1 / 30, () => gg.behavior.name === 'routine' && Math.hypot(gg.pos.x - 36, gg.pos.z - 23.7) < 1);
    expect(back).toBe(true);
  });
  it('a guard who loses the player does not keep tracking them or learn the look they change into', () => {
    const w = new World(53);
    run(w, 1);
    const g = w.npc('patrol_front')!;
    tp(w, { x: g.pos.x, z: g.pos.z + 3 }, Math.PI);
    w.brain.escalate(w, g, 'crime', '테스트');
    expect(g.behavior.name).toBe('chase');
    // Gone: far away behind walls, and in different clothes (nobody watching).
    tp(w, { x: 20, z: 20 });
    w.changeOutfit('waiter', true);
    let chases = 0;
    let last = g.behavior.name;
    run(w, 30, 1 / 30, () => {
      if (g.behavior.name !== last && g.behavior.name === 'chase') chases++;
      last = g.behavior.name;
      return w.ended === 'caught';
    });
    expect(w.ended).not.toBe('caught');
    expect(chases).toBe(0);
    expect(g.knowledge.compromised.has('waiter')).toBe(false);
    expect(w.npcs.some((n) => n.knowledge.compromised.has('waiter'))).toBe(false);
  });

  it('the butler knows every waiter: a fake one gets questioned and the uniform reported', () => {
    const w = new World(59);
    run(w, 1);
    const butler = w.npc('butler')!;
    butler.pos = { x: 36, z: 39.5 };
    butler.facing = 0;
    w.player.outfit = 'waiter';
    tp(w, { x: 36, z: 41.5 }, Math.PI);
    const questioned = run(w, 6, 1 / 30, () => butler.behavior.name === 'confront');
    expect(questioned).toBe(true);
    // We just stand there instead of getting out of that uniform: it gets reported to security.
    const flagged = run(w, 60, 1 / 30, () => w.npcs.some((n) => n.isGuard && n.knowledge.compromised.has('waiter')));
    expect(flagged).toBe(true);
  });

  it('a found duck is put away once by a guard without the gallery key (no pick-up loops)', () => {
    const w = new World(61);
    run(w, 1);
    const duck = w.caseItem!;
    w.security.alarmArmed = false;
    tp(w, { x: 36, z: 19.8 }, Math.PI);
    doAction(w, 'take', 'case');
    // Drop it in the front yard and walk off.
    tp(w, { x: 30, z: 50 }, 0);
    w.dropHeld();
    tp(w, { x: 66, z: 30 });
    let pickups = 0;
    let holder = duck.holder;
    run(w, 150, 1 / 30, () => {
      if (duck.holder !== holder && duck.holder) pickups++;
      holder = duck.holder;
      return false;
    });
    expect(pickups).toBe(1);
    // Back on the pedestal, safely at the security desk, or in a guard's pocket — not lying around.
    expect(duck.state === 'display' || duck.secured || duck.state === 'pocket').toBe(true);
  });
});
