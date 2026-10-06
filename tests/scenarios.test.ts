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
    run(w, 20, 1 / 20);
    expect(w.security.lockdown).toBe(true);
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
});
